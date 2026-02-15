import type { PrismaClient } from "@prisma/client";
import type { InMemoryMarketStore } from "../market/store.js";
import { decideTrade } from "../ai/decision.js";
import { applyGuardrails, getEffectiveFilters } from "./guardrails.js";
import { executePaperTrade } from "./execution.js";
import { AgentProfileConfigSchema } from "../schemas/agentProfile.js";
import type { MarketSnapshot } from "../market/types.js";
import type { AgentMemoryService } from "../ai/memory.js";
import { formatEther } from "viem";
import {
  executeOnChainTrade,
  getContractPortfolio,
  getMonBalance,
  getMoltiBalance,
} from "../services/smartAccount.js";
import { getCurrentEpoch } from "../services/epochService.js";

const MON_BALANCE_THRESHOLD_WEI = BigInt(
  Math.floor(0.1 * 1e18)
); // 0.1 MON

const DEBUG = process.env.ARENA_ENGINE_DEBUG === "true" || process.env.ARENA_ENGINE_DEBUG === "1";

export interface ArenaEngineDeps {
  prisma: PrismaClient;
  marketStore: InMemoryMarketStore;
  tickSeconds?: number;
  memoryService?: AgentMemoryService;
}

export interface LeaderboardEntry {
  agentId: number;
  name: string;
  pnlPct: number;
  equity: number;
  cashMon: number;      // wallet MOLTI balance
  tokenUnits: number;   // virtual token position
  moltiLocked: number;  // MOLTI staked in this arena
  initialCapital: number;
  volumeTraded: number;
  tradeCount: number;
  points: number;
  rank: number;
}

function equity(cashMon: number, tokenUnits: number, price: number): number {
  return cashMon + tokenUnits * price;
}

/**
 * Calculate PnL percentage using the agent's actual initial capital.
 * PnL% = ((currentEquity - initialCapital) / initialCapital) * 100
 */
function pnlPct(equityNow: number, initialCapital: number): number {
  if (initialCapital <= 0) return 0;
  return ((equityNow - initialCapital) / initialCapital) * 100;
}

type ArenaWithRegistrations =
  Awaited<ReturnType<PrismaClient["arena"]["findMany"]>> extends (infer T)[]
    ? T
    : never;

async function processOneAgent(
  deps: ArenaEngineDeps,
  arena: ArenaWithRegistrations & { onChainId: number | null },
  snapshot: MarketSnapshot,
  reg: {
    agentId: number;
    agent: {
      id: number;
      name: string;
      profileJson: unknown;
      onChainId: number | null;
      encryptedSignerKey: string | null;
      smartAccountAddress: string | null;
    };
  },
): Promise<void> {
  const agent = reg.agent;

  // All agents must have on-chain credentials
  if (
    !agent.encryptedSignerKey ||
    agent.onChainId == null ||
    arena.onChainId == null ||
    !agent.smartAccountAddress
  ) {
    if (DEBUG) {
      console.log(
        `[arenaEngine] agent ${agent.id} (${agent.name}) missing on-chain credentials, skip`,
      );
    }
    return;
  }

  const profileParsed = AgentProfileConfigSchema.safeParse(agent.profileJson);
  if (!profileParsed.success) {
    if (DEBUG) {
      console.log(`[arenaEngine] agent ${agent.id} (${agent.name}) invalid profile, skip`);
    } else {
      console.warn(`[arenaEngine] agent ${agent.id} invalid profile, skip`);
    }
    return;
  }
  const profileConfig = profileParsed.data;

  const portfolioRow = await deps.prisma.portfolio.findFirst({
    where: { agentId: agent.id, arenaId: arena.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!portfolioRow) {
    if (DEBUG) {
      console.log(
        `[arenaEngine] no portfolio agent ${agent.id} (${agent.name}) arena ${arena.id} (${arena.name ?? arena.tokenAddress.slice(0, 10)}...), skip`,
      );
    } else {
      console.warn(
        `[arenaEngine] no portfolio agent ${agent.id} arena ${arena.id}, skip`,
      );
    }
    return;
  }

  // Read on-chain state: wallet MOLTI balance as "cash", contract tokenUnits + moltiLocked
  const walletAddress = agent.smartAccountAddress as `0x${string}`;
  const agentOnChainId = agent.onChainId as number;
  const arenaOnChainId = arena.onChainId as number;

  const [walletMoltiWei, onChainPortfolio] = await Promise.all([
    getMoltiBalance(walletAddress),
    getContractPortfolio(agentOnChainId, arenaOnChainId),
  ]);

  const cashMon = Number(formatEther(walletMoltiWei));
  const tokenUnits = Number(formatEther(onChainPortfolio.tokenUnits));
  const moltiLocked = Number(formatEther(onChainPortfolio.moltiLocked));

  const portfolio = {
    cashMon,
    tokenUnits,
    moltiLocked,
    avgEntryPrice: portfolioRow.avgEntryPrice,
    tradesThisWindow: portfolioRow.tradesThisWindow,
    lastTradeTick: portfolioRow.lastTradeTick,
    initialCapital: portfolioRow.initialCapital,
  };

  // Get agent memory for this arena (if memory service is available)
  const memory =
    deps.memoryService !== undefined
      ? await deps.memoryService.getMemory(agent.id, arena.id)
      : undefined;

  if (DEBUG) {
    console.log(
      `[arenaEngine] AI decision agent ${agent.id} (${agent.name}) arena ${arena.id} (${arena.name ?? arena.tokenAddress.slice(0, 10)}...) tick ${snapshot.tick} ` +
        `cash=${cashMon.toFixed(2)} tokens=${tokenUnits.toFixed(4)} locked=${moltiLocked.toFixed(2)}`,
    );
  }
  const equityVal = equity(portfolio.cashMon, portfolio.tokenUnits, snapshot.price);
  const positionPctVal =
    equityVal > 0
      ? (portfolio.tokenUnits * snapshot.price) / equityVal
      : 0;

  const modelDecision = await decideTrade({
    market: {
      price: snapshot.price,
      ret_1m_pct: snapshot.ret_1m_pct,
      ret_5m_pct: snapshot.ret_5m_pct,
      vol_5m_pct: snapshot.vol_5m_pct,
      events_1h: snapshot.events_1h,
      volume_mon_1h: snapshot.volume_mon_1h,
      price_tail: snapshot.price_tail,
      buyCount: snapshot.buyCount,
      sellCount: snapshot.sellCount,
      swapCount: snapshot.swapCount,
      buySellRatio: snapshot.buySellRatio,
      recentEvents: snapshot.recentEvents,
      uniqueTraders: snapshot.uniqueTraders,
      avgVolumePerTrader: snapshot.avgVolumePerTrader,
      largestTrade: snapshot.largestTrade,
      whaleActivity: snapshot.whaleActivity,
      momentum: snapshot.momentum,
      volumeTrend: snapshot.volumeTrend,
      priceVolatility: snapshot.priceVolatility,
    },
    portfolio: {
      cashMon: portfolio.cashMon,
      tokenUnits: portfolio.tokenUnits,
      avgEntryPrice: portfolio.avgEntryPrice,
      tradesThisWindow: portfolio.tradesThisWindow,
      lastTradeTick: portfolio.lastTradeTick,
      currentTick: snapshot.tick,
      equity: equityVal,
      positionPct: positionPctVal,
      initialCapital: portfolio.initialCapital ?? 0,
    },
    profile: {
      goal: profileConfig.goal,
      style: profileConfig.style,
      constraints: profileConfig.constraints,
      filters: getEffectiveFilters(profileConfig.filters),
    },
    customRules: profileConfig.customRules,
    memory,
  });

  const finalDecision = applyGuardrails({
    snapshot: {
      tick: snapshot.tick,
      price: snapshot.price,
      events_1h: snapshot.events_1h,
      volume_mon_1h: snapshot.volume_mon_1h,
    },
    portfolio: {
      cashMon: portfolio.cashMon,
      tokenUnits: portfolio.tokenUnits,
      tradesThisWindow: portfolio.tradesThisWindow,
      lastTradeTick: portfolio.lastTradeTick,
    },
    profileConfig: profileConfig,
    modelDecision,
  });

  const action = finalDecision.action;
  const sizePct = finalDecision.sizePct ?? 0;

  // Pre-flight MON check: skip agents with insufficient gas for on-chain trades
  if (action !== "HOLD") {
    try {
      const monBal = await getMonBalance(walletAddress);
      if (monBal < MON_BALANCE_THRESHOLD_WEI) {
        await deps.prisma.agentDecision.create({
          data: {
            agentId: agent.id,
            arenaId: arena.id,
            tick: snapshot.tick,
            action: action as string,
            sizePct,
            reason: finalDecision.reason,
            confidence: finalDecision.confidence ?? null,
            price: snapshot.price,
            status: "skipped_no_gas",
            onChainTxHash: null,
          },
        });
        if (DEBUG) {
          console.log(
            `[arenaEngine] agent ${agent.id} skipped: low MON balance (${monBal})`
          );
        }
        return;
      }
    } catch (err) {
      console.warn(
        `[arenaEngine] agent ${agent.id} MON balance check failed, skip:`,
        err instanceof Error ? err.message : err
      );
      return;
    }
  }

  // Compute unrealized PnL at decision time (for HOLD display in audit log)
  const equityNow = equity(portfolio.cashMon, portfolio.tokenUnits, snapshot.price);
  const pnlPctAtDecision = pnlPct(equityNow, portfolio.initialCapital);

  // Store AgentDecision for every tick (audit log)
  const decisionRecord = await deps.prisma.agentDecision.create({
    data: {
      agentId: agent.id,
      arenaId: arena.id,
      tick: snapshot.tick,
      action: action as string,
      sizePct,
      reason: finalDecision.reason,
      confidence: finalDecision.confidence ?? null,
      price: snapshot.price,
      pnlPctAtDecision,
      status: action === "HOLD" ? "success" : "pending",
      onChainTxHash: null,
    },
  });

  if (action === "HOLD") {
    // No on-chain call, no portfolio update; still update memory
    if (deps.memoryService !== undefined) {
      try {
        const recentTrades = await deps.prisma.trade.findMany({
          where: { agentId: agent.id, arenaId: arena.id },
          orderBy: { tick: "desc" },
          take: 10,
        });
        const equityNow = equity(
          portfolio.cashMon,
          portfolio.tokenUnits,
          snapshot.price
        );
        const pnlNow = pnlPct(equityNow, portfolio.initialCapital);
        const totalTrades = await deps.prisma.trade.count({
          where: { agentId: agent.id, arenaId: arena.id },
        });
        await deps.memoryService.updateMemory(
          agent.id,
          arena.id,
          snapshot.tick,
          recentTrades.reverse().map((t) => ({
            tick: t.tick,
            action: t.action,
            sizePct: t.sizePct,
            price: t.price,
            reason: t.reason,
          })),
          pnlNow,
          totalTrades
        );
      } catch {
        // Ignore memory update errors for HOLD
      }
    }
    return;
  }

  // BUY/SELL: on-chain first, then update DB only on success
  const encKey = agent.encryptedSignerKey as string;

  const currentEpoch = await getCurrentEpoch(
    { prisma: deps.prisma },
    arena.id
  );
  const epochOnChainId = currentEpoch?.onChainEpochId ?? 0;

  // For BUY: compute the MOLTI amount to send from wallet
  let buyAmountWei: bigint | undefined;
  if (action === "BUY" && sizePct > 0) {
    buyAmountWei =
      (walletMoltiWei * BigInt(Math.floor(sizePct * 1e18))) / BigInt(1e18);
    if (buyAmountWei === 0n) {
      console.warn(
        `[arenaEngine] agent ${agent.id} BUY amount is 0 (wallet=${walletMoltiWei} sizePct=${sizePct}), skip`
      );
      await deps.prisma.agentDecision.update({
        where: { id: decisionRecord.id },
        data: { status: "failed" },
      });
      return;
    }
  }

  let txHash: string | null = null;
  try {
    txHash = await executeOnChainTrade({
      encryptedSignerKey: encKey,
      agentOnChainId,
      arenaOnChainId,
      epochOnChainId,
      action,
      sizePct,
      buyAmountWei,
      price: snapshot.price,
      tick: snapshot.tick,
    });
  } catch (err) {
    console.error(
      `[arenaEngine] on-chain trade failed agent ${agent.id} arena ${arena.id}:`,
      err
    );
    await deps.prisma.agentDecision.update({
      where: { id: decisionRecord.id },
      data: { status: "failed" },
    });
    return;
  }

  if (!txHash) {
    await deps.prisma.agentDecision.update({
      where: { id: decisionRecord.id },
      data: { status: "failed" },
    });
    return;
  }

  // On-chain success: re-read on-chain state and sync DB
  const [walletAfterWei, portfolioAfter] = await Promise.all([
    getMoltiBalance(walletAddress),
    getContractPortfolio(agentOnChainId, arenaOnChainId),
  ]);

  const cashAfter = Number(formatEther(walletAfterWei));
  const tokenUnitsAfter = Number(formatEther(portfolioAfter.tokenUnits));
  const moltiLockedAfter = Number(formatEther(portfolioAfter.moltiLocked));

  // Use on-chain paper trade to compute trade record for DB
  const { nextPortfolio, tradeRecord } = executePaperTrade(
    { tick: snapshot.tick, price: snapshot.price },
    {
      cashMon: portfolio.cashMon,
      tokenUnits: portfolio.tokenUnits,
      moltiLocked: portfolio.moltiLocked,
      avgEntryPrice: portfolio.avgEntryPrice,
      tradesThisWindow: portfolio.tradesThisWindow,
      lastTradeTick: portfolio.lastTradeTick,
    },
    finalDecision,
  );

  // Override paper values with actual on-chain state
  nextPortfolio.cashMon = cashAfter;
  nextPortfolio.tokenUnits = tokenUnitsAfter;
  nextPortfolio.moltiLocked = moltiLockedAfter;

  await deps.prisma.$transaction(async (tx) => {
    await tx.portfolio.update({
      where: { id: portfolioRow.id },
      data: {
        cashMon: nextPortfolio.cashMon,
        tokenUnits: nextPortfolio.tokenUnits,
        moltiLocked: nextPortfolio.moltiLocked,
        avgEntryPrice: nextPortfolio.avgEntryPrice,
        tradesThisWindow: nextPortfolio.tradesThisWindow,
        lastTradeTick: nextPortfolio.lastTradeTick,
      },
    });

    if (tradeRecord) {
      await tx.trade.create({
        data: {
          agentId: agent.id,
          arenaId: arena.id,
          epochId: currentEpoch?.id ?? null,
          tick: tradeRecord.tick,
          action: tradeRecord.action,
          sizePct: tradeRecord.sizePct,
          price: tradeRecord.price,
          tradeValueMon: tradeRecord.tradeValueMon,
          avgEntryPriceBefore: tradeRecord.avgEntryPriceBefore,
          cashAfter: tradeRecord.cashAfter,
          tokenAfter: tradeRecord.tokenAfter,
          reason: tradeRecord.reason,
          onChainTxHash: txHash,
        },
      });
    }

    await tx.agentDecision.update({
      where: { id: decisionRecord.id },
      data: { status: "success", onChainTxHash: txHash },
    });
  });

  if (DEBUG && tradeRecord) {
    console.log(
      `[arenaEngine] agent ${agent.id} (${agent.name}) ${tradeRecord.action} ${(tradeRecord.sizePct * 100).toFixed(0)}% @ ${tradeRecord.price} arena ${arena.name ?? arena.id} tx=${txHash}`,
    );
  }

  // Update agent memory after successful trade
  if (deps.memoryService !== undefined && tradeRecord) {
    try {
      const recentTrades = await deps.prisma.trade.findMany({
        where: { agentId: agent.id, arenaId: arena.id },
        orderBy: { tick: "desc" },
        take: 10,
      });
      const equityAfter = equity(
        nextPortfolio.cashMon,
        nextPortfolio.tokenUnits,
        snapshot.price
      );
      const pnlAfter = pnlPct(equityAfter, portfolio.initialCapital);
      const totalTrades = await deps.prisma.trade.count({
        where: { agentId: agent.id, arenaId: arena.id },
      });
      await deps.memoryService.updateMemory(
        agent.id,
        arena.id,
        snapshot.tick,
        recentTrades.reverse().map((t) => ({
          tick: t.tick,
          action: t.action,
          sizePct: t.sizePct,
          price: t.price,
          reason: t.reason,
        })),
        pnlAfter,
        totalTrades
      );
    } catch (error) {
      console.error(
        `[arenaEngine] Failed to update memory for agent ${agent.id} arena ${arena.id}:`,
        error
      );
    }
  }
}

export function startArenaEngine(deps: ArenaEngineDeps): { stop: () => void } {
  const tickMs = (deps.tickSeconds ?? 60) * 1000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const runTick = async (): Promise<void> => {
    try {
      const arenas = await deps.prisma.arena.findMany({
        where: {
          arenaRegistrations: { some: { isActive: true } },
        },
        include: {
          arenaRegistrations: {
            where: { isActive: true },
            include: {
              agent: {
                select: {
                  id: true,
                  name: true,
                  profileJson: true,
                  onChainId: true,
                  encryptedSignerKey: true,
                  smartAccountAddress: true,
                },
              },
            },
          },
        },
      });

      if (DEBUG && arenas.length > 0) {
        console.log(`[arenaEngine] tick: ${arenas.length} arena(s) with active agents`);
      }
      for (const arena of arenas) {
        try {
          const snapshot = deps.marketStore.get(arena.tokenAddress);
          if (!snapshot) {
            if (DEBUG) {
              console.log(
                `[arenaEngine] arena ${arena.id} (${arena.name ?? arena.tokenAddress.slice(0, 10)}...) no market snapshot, skip (is token in ARENA_TOKENS?)`,
              );
            }
            continue;
          }
          if (DEBUG) {
            console.log(
              `[arenaEngine] processing arena ${arena.id} (${arena.name ?? arena.tokenAddress.slice(0, 10)}...) ${arena.arenaRegistrations.length} agent(s)`,
            );
          }
          for (const reg of arena.arenaRegistrations) {
            try {
              await processOneAgent(deps, arena, snapshot, reg);
            } catch (error_) {
              console.error(
                `[arenaEngine] agent ${reg.agentId} arena ${arena.id} failed:`,
                error_,
              );
            }
          }

          const activeAgentIds = arena.arenaRegistrations.map((r) => r.agentId);
          const currentEpoch = await getCurrentEpoch(
            { prisma: deps.prisma },
            arena.id
          );
          const epochId = currentEpoch?.id ?? null;

          const portfoliosForArena = await deps.prisma.portfolio.findMany({
            where: {
              arenaId: arena.id,
              agentId: { in: activeAgentIds },
            },
            include: { agent: { select: { id: true, name: true } } },
          });

          // Aggregate volume and trade count per agent (for current epoch or all time)
          const tradeAggs = await deps.prisma.trade.groupBy({
            by: ["agentId"],
            where: {
              arenaId: arena.id,
              agentId: { in: activeAgentIds },
              ...(epochId != null ? { epochId } : {}),
            },
            _sum: { tradeValueMon: true },
            _count: true,
          });
          const volByAgent = new Map(
            tradeAggs.map((t) => [t.agentId, t._sum.tradeValueMon ?? 0])
          );
          const tradesByAgent = new Map(
            tradeAggs.map((t) => [t.agentId, t._count])
          );

          const maxVol = Math.max(...volByAgent.values(), 1);
          const maxTrades = Math.max(...tradesByAgent.values(), 1);

          const rankings: LeaderboardEntry[] = portfoliosForArena.map((p) => {
            const eq = equity(p.cashMon, p.tokenUnits, snapshot.price);
            const pnl = pnlPct(eq, p.initialCapital);
            const vol = volByAgent.get(p.agent.id) ?? 0;
            const trades = tradesByAgent.get(p.agent.id) ?? 0;
            const normVol = maxVol > 0 ? vol / maxVol : 0;
            const normPnl = Math.max(0, Math.min(1, (pnl + 50) / 100));
            const normTrades = maxTrades > 0 ? trades / maxTrades : 0;
            const points =
              0.5 * normVol + 0.35 * normPnl + 0.15 * normTrades;
            return {
              agentId: p.agent.id,
              name: p.agent.name,
              pnlPct: pnl,
              equity: eq,
              cashMon: p.cashMon,
              tokenUnits: p.tokenUnits,
              moltiLocked: p.moltiLocked,
              initialCapital: p.initialCapital,
              volumeTraded: vol,
              tradeCount: trades,
              points,
              rank: 0,
            };
          });
          rankings.sort((a, b) => b.points - a.points);
          rankings.forEach((r, i) => {
            r.rank = i + 1;
          });

          await deps.prisma.leaderboardSnapshot.create({
            data: {
              arenaId: arena.id,
              epochId,
              tick: snapshot.tick,
              rankingsJson: rankings as unknown as object,
            },
          });
        } catch (error_) {
          console.error(`[arenaEngine] arena ${arena.id} failed:`, error_);
        }
      }
    } catch (err) {
      console.error("[arenaEngine] tick failed:", err);
    }
    timeoutId = setTimeout(runTick, tickMs);
  };

  timeoutId = setTimeout(runTick, tickMs);

  return {
    stop() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    },
  };
}
