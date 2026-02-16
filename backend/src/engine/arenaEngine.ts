import type { PrismaClient } from "@prisma/client";
import type { InMemoryMarketStore } from "../market/store.js";
import type { ArenaContextForDecision } from "../ai/decision.js";
import { decideTradesForAllArenas } from "../ai/decision.js";
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
import { getCurrentEpoch, autoRenewAgentsForEpoch } from "../services/epochService.js";

const MON_BALANCE_THRESHOLD_WEI = BigInt(
  Math.floor(1 * 1e18)
); // 1 MON

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

type Reg = {
  agentId: number;
  agent: {
    id: number;
    name: string;
    profileJson: unknown;
    onChainId: number | null;
    encryptedSignerKey: string | null;
    smartAccountAddress: string | null;
  };
};

/** Per (agent, arena) context after validation and loading; used for one AI call per agent. */
export interface AgentArenaContext {
  agent: Reg["agent"];
  arena: ArenaWithRegistrations & { onChainId: number | null };
  snapshot: MarketSnapshot;
  portfolioRow: Awaited<ReturnType<PrismaClient["portfolio"]["findFirst"]>> & NonNullable<Awaited<ReturnType<PrismaClient["portfolio"]["findFirst"]>>>;
  portfolio: {
    cashMon: number;
    tokenUnits: number;
    moltiLocked: number;
    avgEntryPrice: number | null;
    tradesThisWindow: number;
    lastTradeTick: number | null;
    initialCapital: number | null;
  };
  currentEpoch: NonNullable<Awaited<ReturnType<typeof getCurrentEpoch>>>;
  epochReg: NonNullable<Awaited<ReturnType<PrismaClient["epochRegistration"]["findUnique"]>>>;
  walletAddress: `0x${string}`;
  walletMoltiWei: bigint;
  agentOnChainId: number;
  arenaOnChainId: number;
  profileConfig: import("../schemas/agentProfile.js").AgentProfileConfig;
}

/** Prepare context for one (agent, arena). Returns null if agent should be skipped. */
async function prepareAgentArenaContext(
  deps: ArenaEngineDeps,
  arena: ArenaWithRegistrations & { onChainId: number | null },
  snapshot: MarketSnapshot,
  reg: Reg,
): Promise<AgentArenaContext | null> {
  const agent = reg.agent;
  if (
    !agent.encryptedSignerKey ||
    agent.onChainId == null ||
    arena.onChainId == null ||
    !agent.smartAccountAddress
  ) {
    if (DEBUG) {
      console.log(`[arenaEngine] agent ${agent.id} (${agent.name}) missing on-chain credentials, skip`);
    }
    return null;
  }
  const profileParsed = AgentProfileConfigSchema.safeParse(agent.profileJson);
  if (!profileParsed.success) {
    if (DEBUG) {
      console.log(`[arenaEngine] agent ${agent.id} (${agent.name}) invalid profile, skip`);
    } else {
      console.warn(`[arenaEngine] agent ${agent.id} invalid profile, skip`);
    }
    return null;
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
      console.warn(`[arenaEngine] no portfolio agent ${agent.id} arena ${arena.id}, skip`);
    }
    return null;
  }

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

  const currentEpoch = await getCurrentEpoch(deps, arena.id);
  if (!currentEpoch) {
    if (DEBUG) {
      console.log(`[arenaEngine] agent ${agent.id} (${agent.name}) arena ${arena.id}: no current epoch, skip AI`);
    }
    return null;
  }
  const epochReg = await deps.prisma.epochRegistration.findUnique({
    where: { epochId_agentId: { epochId: currentEpoch.id, agentId: agent.id } },
  });
  if (!epochReg) {
    if (DEBUG) {
      console.log(
        `[arenaEngine] agent ${agent.id} (${agent.name}) arena ${arena.id}: not renewed for epoch ${currentEpoch.id}, skip AI`,
      );
    }
    return null;
  }

  if (DEBUG) {
    console.log(
      `[arenaEngine] agent ${agent.id} (${agent.name}) arena ${arena.id} (${arena.name ?? arena.tokenAddress.slice(0, 10)}...) tick ${snapshot.tick} ` +
        `cash=${cashMon.toFixed(2)} tokens=${tokenUnits.toFixed(4)} locked=${moltiLocked.toFixed(2)}`,
    );
  }

  return {
    agent,
    arena,
    snapshot,
    portfolioRow,
    portfolio,
    currentEpoch,
    epochReg,
    walletAddress,
    walletMoltiWei,
    agentOnChainId,
    arenaOnChainId,
    profileConfig,
  };
}

function snapshotToMarket(snapshot: MarketSnapshot) {
  return {
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
  };
}

/** Apply guardrails and execute (MON check, record decision, HOLD vs on-chain trade, portfolio/memory). */
async function executeDecisionForAgentArena(
  deps: ArenaEngineDeps,
  ctx: AgentArenaContext,
  finalDecision: import("../ai/decision.js").TradeDecision,
): Promise<void> {
  const { agent, arena, snapshot, portfolioRow, portfolio, currentEpoch } = ctx;
  const action = finalDecision.action;
  const sizePct = finalDecision.sizePct ?? 0;

  if (action !== "HOLD") {
    try {
      const monBal = await getMonBalance(ctx.walletAddress);
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
          console.log(`[arenaEngine] agent ${agent.id} skipped: low MON balance (${monBal})`);
        }
        return;
      }
    } catch (err) {
      console.warn(
        `[arenaEngine] agent ${agent.id} MON balance check failed, skip:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }
  }

  const equityNow = equity(portfolio.cashMon, portfolio.tokenUnits, snapshot.price);
  const pnlPctAtDecision = pnlPct(equityNow, portfolio.initialCapital ?? 0);

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
    return;
  }

  const encKey = agent.encryptedSignerKey as string;
  const epochOnChainId = currentEpoch.onChainEpochId ?? 0;

  let buyAmountWei: bigint | undefined;
  if (action === "BUY" && sizePct > 0) {
    buyAmountWei = (ctx.walletMoltiWei * BigInt(Math.floor(sizePct * 1e18))) / BigInt(1e18);
    if (buyAmountWei === 0n) {
      console.warn(
        `[arenaEngine] agent ${agent.id} BUY amount is 0 (wallet=${ctx.walletMoltiWei} sizePct=${sizePct}), skip`,
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
      agentOnChainId: ctx.agentOnChainId,
      arenaOnChainId: ctx.arenaOnChainId,
      epochOnChainId,
      action,
      sizePct,
      buyAmountWei,
      price: snapshot.price,
      tick: snapshot.tick,
    });
  } catch (err) {
    console.error(`[arenaEngine] on-chain trade failed agent ${agent.id} arena ${arena.id}:`, err);
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

  const [walletAfterWei, portfolioAfter] = await Promise.all([
    getMoltiBalance(ctx.walletAddress),
    getContractPortfolio(ctx.agentOnChainId, ctx.arenaOnChainId),
  ]);

  const cashAfter = Number(formatEther(walletAfterWei));
  const tokenUnitsAfter = Number(formatEther(portfolioAfter.tokenUnits));
  const moltiLockedAfter = Number(formatEther(portfolioAfter.moltiLocked));

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
          epochId: currentEpoch.id,
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
}

async function processOneAgent(
  deps: ArenaEngineDeps,
  arena: ArenaWithRegistrations & { onChainId: number | null },
  snapshot: MarketSnapshot,
  reg: Reg,
): Promise<void> {
  const ctx = await prepareAgentArenaContext(deps, arena, snapshot, reg);
  if (!ctx) return;

  const equityVal = equity(ctx.portfolio.cashMon, ctx.portfolio.tokenUnits, ctx.snapshot.price);
  const positionPctVal =
    equityVal > 0
      ? (ctx.portfolio.tokenUnits * ctx.snapshot.price) / equityVal
      : 0;

  const memory =
    deps.memoryService !== undefined
      ? await deps.memoryService.getMemory(ctx.agent.id)
      : undefined;

  const { decideTrade } = await import("../ai/decision.js");
  const modelDecision = await decideTrade({
    market: snapshotToMarket(ctx.snapshot),
    portfolio: {
      cashMon: ctx.portfolio.cashMon,
      tokenUnits: ctx.portfolio.tokenUnits,
      avgEntryPrice: ctx.portfolio.avgEntryPrice,
      tradesThisWindow: ctx.portfolio.tradesThisWindow,
      lastTradeTick: ctx.portfolio.lastTradeTick,
      currentTick: ctx.snapshot.tick,
      equity: equityVal,
      positionPct: positionPctVal,
      initialCapital: ctx.portfolio.initialCapital ?? 0,
    },
    profile: {
      goal: ctx.profileConfig.goal,
      style: ctx.profileConfig.style,
      constraints: ctx.profileConfig.constraints,
      filters: getEffectiveFilters(ctx.profileConfig.filters),
    },
    customRules: ctx.profileConfig.customRules,
    memory,
  });

  const finalDecision = applyGuardrails({
    snapshot: {
      tick: ctx.snapshot.tick,
      price: ctx.snapshot.price,
      events_1h: ctx.snapshot.events_1h,
      volume_mon_1h: ctx.snapshot.volume_mon_1h,
    },
    portfolio: {
      cashMon: ctx.portfolio.cashMon,
      tokenUnits: ctx.portfolio.tokenUnits,
      tradesThisWindow: ctx.portfolio.tradesThisWindow,
      lastTradeTick: ctx.portfolio.lastTradeTick,
    },
    profileConfig: ctx.profileConfig,
    modelDecision,
  });

  await executeDecisionForAgentArena(deps, ctx, finalDecision);
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

      // Try to renew any agents registered but not renewed (e.g. registered before funding, then funded later)
      const depsEpoch = { prisma: deps.prisma };
      for (const arena of arenas) {
        const snapshot = deps.marketStore.get(arena.tokenAddress);
        if (!snapshot || arena.onChainId == null) continue;
        const currentEpoch = await getCurrentEpoch(depsEpoch, arena.id);
        if (!currentEpoch || currentEpoch.onChainEpochId == null) continue;
        const renewedCount = await deps.prisma.epochRegistration.count({
          where: {
            epochId: currentEpoch.id,
            agentId: { in: arena.arenaRegistrations.map((r) => r.agentId) },
          },
        });
        const registeredCount = arena.arenaRegistrations.length;
        if (renewedCount < registeredCount) {
          try {
            const { renewed } = await autoRenewAgentsForEpoch(
              depsEpoch,
              arena.id,
              arena.onChainId,
              currentEpoch.id,
              currentEpoch.onChainEpochId,
            );
            if (renewed > 0) {
              console.log(`[arenaEngine] renewed ${renewed} agent(s) for arena ${arena.id} (catch-up)`);
            }
          } catch (err) {
            console.warn(`[arenaEngine] catch-up renewal for arena ${arena.id} failed:`, err instanceof Error ? err.message : err);
          }
        }
      }

      // Build (agent, arena) contexts then group by agent for one AI call per agent
      const contexts: AgentArenaContext[] = [];
      for (const arena of arenas) {
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
            `[arenaEngine] arena ${arena.id} (${arena.name ?? arena.tokenAddress.slice(0, 10)}...) ${arena.arenaRegistrations.length} agent(s)`,
          );
        }
        for (const reg of arena.arenaRegistrations) {
          try {
            const ctx = await prepareAgentArenaContext(deps, arena, snapshot, reg);
            if (ctx) contexts.push(ctx);
          } catch (error_) {
            console.error(`[arenaEngine] prepare agent ${reg.agentId} arena ${arena.id} failed:`, error_);
          }
        }
      }

      const byAgentId = new Map<number, AgentArenaContext[]>();
      for (const ctx of contexts) {
        const list = byAgentId.get(ctx.agent.id) ?? [];
        list.push(ctx);
        byAgentId.set(ctx.agent.id, list);
      }
      for (const list of byAgentId.values()) {
        list.sort((a, b) => a.arena.id - b.arena.id);
      }

      for (const [, list] of byAgentId) {
        try {
          const arenasForAi: ArenaContextForDecision[] = list.map((c) => {
            const eq = equity(c.portfolio.cashMon, c.portfolio.tokenUnits, c.snapshot.price);
            const posPct = eq > 0 ? (c.portfolio.tokenUnits * c.snapshot.price) / eq : 0;
            return {
              arenaLabel: c.arena.name ?? c.arena.tokenAddress.slice(0, 10) + "...",
              market: snapshotToMarket(c.snapshot),
              portfolio: {
                cashMon: c.portfolio.cashMon,
                tokenUnits: c.portfolio.tokenUnits,
                avgEntryPrice: c.portfolio.avgEntryPrice,
                tradesThisWindow: c.portfolio.tradesThisWindow,
                lastTradeTick: c.portfolio.lastTradeTick,
                currentTick: c.snapshot.tick,
                equity: eq,
                positionPct: posPct,
                initialCapital: c.portfolio.initialCapital ?? 0,
              },
            };
          });

          const memory =
            deps.memoryService !== undefined
              ? await deps.memoryService.getMemory(list[0].agent.id)
              : undefined;

          const multiInput = {
            profile: {
              goal: list[0].profileConfig.goal,
              style: list[0].profileConfig.style,
              constraints: list[0].profileConfig.constraints,
              filters: getEffectiveFilters(list[0].profileConfig.filters),
            },
            customRules: list[0].profileConfig.customRules,
            memory,
            arenas: arenasForAi,
          };

          const decisions = await decideTradesForAllArenas(multiInput);

          for (let i = 0; i < list.length; i++) {
            const ctx = list[i];
            const modelDecision = decisions[i] ?? {
              action: "HOLD" as const,
              sizePct: 0,
              confidence: 0,
              reason: "model_error",
            };
            const finalDecision = applyGuardrails({
              snapshot: {
                tick: ctx.snapshot.tick,
                price: ctx.snapshot.price,
                events_1h: ctx.snapshot.events_1h,
                volume_mon_1h: ctx.snapshot.volume_mon_1h,
              },
              portfolio: {
                cashMon: ctx.portfolio.cashMon,
                tokenUnits: ctx.portfolio.tokenUnits,
                tradesThisWindow: ctx.portfolio.tradesThisWindow,
                lastTradeTick: ctx.portfolio.lastTradeTick,
              },
              profileConfig: ctx.profileConfig,
              modelDecision,
            });
            await executeDecisionForAgentArena(deps, ctx, finalDecision);
          }

          if (deps.memoryService !== undefined) {
            try {
              await deps.memoryService.updateMemory(list[0].agent.id, list[0].snapshot.tick);
            } catch (err) {
              console.warn(`[arenaEngine] Failed to update persona memory for agent ${list[0].agent.id}:`, err);
            }
          }
        } catch (error_) {
          console.error(`[arenaEngine] agent ${list[0].agent.id} multi-arena failed:`, error_);
        }
      }

      // Leaderboard snapshots per arena — only agents who paid for this epoch
      for (const arena of arenas) {
        try {
          const snapshot = deps.marketStore.get(arena.tokenAddress);
          if (!snapshot) continue;

          const currentEpoch = await getCurrentEpoch(
            { prisma: deps.prisma },
            arena.id
          );
          const epochId = currentEpoch?.id ?? null;

          // Only include agents who have renewed (paid) for the current epoch
          const activeInArena = new Set(
            arena.arenaRegistrations.map((r) => r.agentId)
          );
          const renewedAgentIds =
            epochId != null
              ? (
                  await deps.prisma.epochRegistration.findMany({
                    where: { epochId },
                    select: { agentId: true },
                  })
                ).map((r) => r.agentId).filter((id) => activeInArena.has(id))
              : [...activeInArena];
          const activeAgentIds = renewedAgentIds;

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
            const normTrades = maxTrades > 0 ? trades / maxTrades : 0;
            // Only use PnL for points when the agent had activity this epoch; otherwise neutral (0.5) so no-activity agents tie
            const rawNormPnl = Math.max(0, Math.min(1, (pnl + 50) / 100));
            const normPnl = vol === 0 && trades === 0 ? 0.5 : rawNormPnl;
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
