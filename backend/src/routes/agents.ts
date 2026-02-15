import { Router, Request, Response } from "express";
import { prisma } from "../db.js";
import { createAgentBodySchema, syncAgentBodySchema } from "../schemas/requests.js";
import { AgentProfileConfigSchema } from "../schemas/agentProfile.js";
import { hashProfileConfig } from "../utils/profileHash.js";
import { handleRouteError, parseId } from "./routeHelpers.js";
import {
  createAgentWallet,
  getMoltiBalance,
  withdrawMolti,
  withdrawMon,
  approveMoltiForArena,
} from "../services/smartAccount.js";
import { getPendingRewardFromContract } from "../services/epochService.js";
import { formatEther, parseEther, type Address } from "viem";

const router = Router();

router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerFilter = typeof req.query.owner === "string" ? req.query.owner : undefined;

    const agents = await prisma.agent.findMany({
      where: ownerFilter
        ? { ownerAddress: { equals: ownerFilter, mode: "insensitive" } }
        : undefined,
      select: {
        id: true,
        name: true,
        ownerAddress: true,
        profileHash: true,
        onChainId: true,
        walletAddress: true,
        smartAccountAddress: true,
        creationTxHash: true,
        fundedBalance: true,
        createdAt: true,
        arenaRegistrations: {
          where: { isActive: true },
          select: { arenaId: true },
        },
      },
      orderBy: { id: "asc" },
    });
    const walletAddresses = agents.map(
      (a) => (a.smartAccountAddress ?? a.walletAddress) as Address | null
    );
    const balances = await Promise.all(
      walletAddresses.map((addr) =>
        addr ? getMoltiBalance(addr) : Promise.resolve(0n)
      )
    );

    res.json({
      agents: agents.map((a, i) => ({
        id: a.id,
        name: a.name,
        ownerAddress: a.ownerAddress,
        profileHash: a.profileHash,
        onChainId: a.onChainId,
        walletAddress: a.smartAccountAddress ?? a.walletAddress,
        smartAccountAddress: a.smartAccountAddress,
        creationTxHash: a.creationTxHash,
        fundedBalance: a.fundedBalance,
        moltiBalance: Number(formatEther(balances[i] ?? 0n)),
        createdAt: a.createdAt,
        registeredArenaIds: a.arenaRegistrations.map((r) => r.arenaId),
      })),
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents");
  }
});

router.get("/:agentId", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        arenaRegistrations: {
          where: { isActive: true },
          include: { arena: true },
        },
      },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    // Sum registration fees (100 MOLTI per arena) for display
    const registrationFeesPaid = agent.arenaRegistrations.reduce(
      (s, r) => s + (r.deposit ? Number(r.deposit) / 1e18 : 0),
      0,
    );
    const personaMemory = await prisma.agentPersonaMemory.findUnique({
      where: { agentId },
      select: {
        memoryText: true,
        lastUpdatedTick: true,
        lastAiSummarizedAt: true,
        updatedAt: true,
      },
    });
    const arenasWithPnl = await Promise.all(
      agent.arenaRegistrations.map(async (reg) => {
        // Prefer live Portfolio (source of truth) over stale LeaderboardSnapshot
        const portfolio = await prisma.portfolio.findFirst({
          where: { agentId, arenaId: reg.arenaId },
          orderBy: { updatedAt: "desc" },
        });
        let pnlPctVal: number | null = null;
        let equityVal: number | null = null;
        let cashMonVal: number | null = null;
        let tokenUnitsVal: number | null = null;
        let initialCapitalVal: number | null = null;

        if (portfolio) {
          cashMonVal = portfolio.cashMon;
          tokenUnitsVal = portfolio.tokenUnits;
          initialCapitalVal = portfolio.initialCapital;
          // Equity = cash + tokens×price; without price use cash as proxy (exact when tokenUnits=0)
          equityVal = portfolio.cashMon;
          pnlPctVal =
            portfolio.initialCapital > 0
              ? ((portfolio.cashMon - portfolio.initialCapital) / portfolio.initialCapital) * 100
              : 0;
        } else {
          // Fallback: no portfolio yet (e.g. just registered), use latest snapshot
          const latest = await prisma.leaderboardSnapshot.findFirst({
            where: { arenaId: reg.arenaId },
            orderBy: { createdAt: "desc" },
          });
          if (latest) {
            const rankings = latest.rankingsJson as Array<{
              agentId: number;
              name: string;
              pnlPct: number;
              equity: number;
              cashMon: number;
              tokenUnits: number;
              initialCapital?: number;
            }>;
            const entry = rankings.find((r) => r.agentId === agentId);
            if (entry) {
              pnlPctVal = entry.pnlPct;
              equityVal = entry.equity;
              cashMonVal = entry.cashMon;
              tokenUnitsVal = entry.tokenUnits;
              initialCapitalVal = entry.initialCapital ?? null;
            }
          }
        }

        // Points from latest LeaderboardSnapshot
        const latestSnapshot = await prisma.leaderboardSnapshot.findFirst({
          where: { arenaId: reg.arenaId },
          orderBy: { createdAt: "desc" },
        });
        let pointsVal: number | null = null;
        if (latestSnapshot) {
          const rankings = latestSnapshot.rankingsJson as Array<{ agentId: number; points: number }>;
          const entry = rankings.find((r) => r.agentId === agentId);
          if (entry) pointsVal = entry.points ?? null;
        }

        return {
          arenaId: reg.arena.id,
          tokenAddress: reg.arena.tokenAddress,
          arenaName: reg.arena.name,
          pnlPct: pnlPctVal,
          equity: equityVal,
          cashMon: cashMonVal,
          tokenUnits: tokenUnitsVal,
          initialCapital: initialCapitalVal,
          points: pointsVal,
          memory: personaMemory
            ? {
                text: personaMemory.memoryText,
                tick: personaMemory.lastUpdatedTick,
                lastAiSummarizedAt: personaMemory.lastAiSummarizedAt,
                updatedAt: personaMemory.updatedAt,
              }
            : null,
        };
      }),
    );
    // Parse profile JSON to expose select fields (goal, style, customRules)
    const profileParsed = AgentProfileConfigSchema.safeParse(agent.profileJson);
    const profileConfig = profileParsed.success
      ? {
          goal: profileParsed.data.goal,
          style: profileParsed.data.style,
          customRules: profileParsed.data.customRules ?? "",
        }
      : null;

    res.json({
      id: agent.id,
      name: agent.name,
      ownerAddress: agent.ownerAddress,
      profileHash: agent.profileHash,
      onChainId: agent.onChainId,
      walletAddress: agent.smartAccountAddress ?? agent.walletAddress,
      smartAccountAddress: agent.smartAccountAddress,
      creationTxHash: agent.creationTxHash,
      fundedBalance: agent.fundedBalance,
      registrationFeesPaid,
      createdAt: agent.createdAt,
      profileConfig,
      arenas: arenasWithPnl,
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId");
  }
});

/**
 * GET /agents/:agentId/equity-history
 * Returns historical equity data for an agent across all arenas.
 * Extracted from LeaderboardSnapshot records.
 */
router.get("/:agentId/equity-history", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        arenaRegistrations: {
          where: { isActive: true },
          select: { arenaId: true, arena: { select: { name: true, tokenAddress: true } } },
        },
        portfolios: {
          select: { arenaId: true, initialCapital: true },
        },
      },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    // Build a map of arenaId → initialCapital
    const capitalMap = new Map<number, number>();
    for (const p of agent.portfolios) {
      capitalMap.set(p.arenaId, p.initialCapital);
    }

    // For each arena the agent is in, get the last 200 leaderboard snapshots
    const arenaIds = agent.arenaRegistrations.map((r) => r.arenaId);

    const snapshots = await prisma.leaderboardSnapshot.findMany({
      where: { arenaId: { in: arenaIds } },
      orderBy: { createdAt: "asc" },
      take: 2000, // Generous limit across all arenas
      select: {
        arenaId: true,
        tick: true,
        rankingsJson: true,
        createdAt: true,
      },
    });

    // Extract this agent's equity from each snapshot
    type EquityPoint = {
      tick: number;
      equity: number;
      pnlPct: number;
      cashMon: number;
      tokenUnits: number;
      createdAt: string;
    };

    const perArena: Record<string, {
      arenaId: number;
      arenaName: string | null;
      tokenAddress: string;
      initialCapital: number;
      points: EquityPoint[];
    }> = {};

    // Initialize arena entries
    for (const reg of agent.arenaRegistrations) {
      perArena[reg.arenaId] = {
        arenaId: reg.arenaId,
        arenaName: reg.arena.name,
        tokenAddress: reg.arena.tokenAddress,
        initialCapital: capitalMap.get(reg.arenaId) ?? 0,
        points: [],
      };
    }

    for (const snap of snapshots) {
      const rankings = snap.rankingsJson as Array<{
        agentId: number;
        pnlPct: number;
        equity: number;
        cashMon: number;
        tokenUnits: number;
      }>;
      const entry = rankings.find((r) => r.agentId === agentId);
      if (entry && perArena[snap.arenaId]) {
        perArena[snap.arenaId].points.push({
          tick: snap.tick,
          equity: entry.equity,
          pnlPct: entry.pnlPct,
          cashMon: entry.cashMon,
          tokenUnits: entry.tokenUnits,
          createdAt: snap.createdAt.toISOString(),
        });
      }
    }

    // Compute aggregated equity curve (sum across all arenas)
    // Group by tick → sum equity
    const tickMap = new Map<number, { equity: number; createdAt: string }>();
    for (const arena of Object.values(perArena)) {
      for (const pt of arena.points) {
        const existing = tickMap.get(pt.tick);
        if (existing) {
          existing.equity += pt.equity;
        } else {
          tickMap.set(pt.tick, { equity: pt.equity, createdAt: pt.createdAt });
        }
      }
    }

    const totalInitialCapital = Array.from(capitalMap.values()).reduce((s, v) => s + v, 0);
    const aggregated = Array.from(tickMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([tick, data]) => ({
        tick,
        equity: data.equity,
        pnlPct: totalInitialCapital > 0
          ? ((data.equity - totalInitialCapital) / totalInitialCapital) * 100
          : 0,
        createdAt: data.createdAt,
      }));

    res.json({
      agentId,
      totalInitialCapital,
      arenas: Object.values(perArena),
      aggregated,
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId/equity-history");
  }
});

/**
 * GET /agents/:agentId/points-history
 * Returns points per day with arena breakdown (from LeaderboardSnapshot).
 * Used for the daily points bar chart.
 */
router.get("/:agentId/points-history", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        arenaRegistrations: {
          where: { isActive: true },
          include: { arena: { select: { id: true, name: true } } },
        },
      },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const arenaIds = agent.arenaRegistrations.map((r) => r.arenaId);
    const arenaMap = new Map(
      agent.arenaRegistrations.map((r) => [r.arenaId, r.arena.name ?? `Arena ${r.arenaId}`])
    );

    const snapshots = await prisma.leaderboardSnapshot.findMany({
      where: { arenaId: { in: arenaIds } },
      orderBy: { createdAt: "asc" },
      take: 5000,
      select: {
        arenaId: true,
        tick: true,
        rankingsJson: true,
        createdAt: true,
      },
    });

    // Group by date (YYYY-MM-DD), then by arena. For each (date, arena), keep snapshot with latest tick.
    const byDate = new Map<
      string,
      Map<number, { tick: number; points: number; arenaName: string }>
    >();
    for (const snap of snapshots) {
      const rankings = snap.rankingsJson as Array<{
        agentId: number;
        points: number;
      }>;
      const entry = rankings.find((r) => r.agentId === agentId);
      if (!entry) continue;

      const dateStr = snap.createdAt.toISOString().slice(0, 10);
      let dateMap = byDate.get(dateStr);
      if (!dateMap) {
        dateMap = new Map();
        byDate.set(dateStr, dateMap);
      }
      const existing = dateMap.get(snap.arenaId);
      if (!existing || snap.tick >= existing.tick) {
        dateMap.set(snap.arenaId, {
          tick: snap.tick,
          points: entry.points ?? 0,
          arenaName: arenaMap.get(snap.arenaId) ?? `Arena ${snap.arenaId}`,
        });
      }
    }

    const days = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, arenaMapInner]) => {
        const byArena = Array.from(arenaMapInner.entries()).map(([arenaId, v]) => ({
          arenaId,
          arenaName: v.arenaName,
          points: v.points,
        }));
        const totalPoints = byArena.reduce((s, a) => s + a.points, 0);
        return {
          date,
          totalPoints,
          byArena,
        };
      });

    res.json({ agentId, days });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId/points-history");
  }
});

/**
 * GET /agents/:agentId/stats
 * Returns aggregated stats: trades count, fees paid, rewards collected, pending rewards.
 */
router.get("/:agentId/stats", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const tradeCount = await prisma.trade.count({
      where: { agentId },
    });

    // Trade fees: 0.5% of tradeValueMon per trade (matches contract TRADE_FEE_BPS)
    const tradeFeesResult = await prisma.trade.aggregate({
      where: { agentId },
      _sum: { tradeValueMon: true },
    });
    const tradeFeesMolti =
      (tradeFeesResult._sum.tradeValueMon ?? 0) * 0.005;

    const epochRegs = await prisma.epochRegistration.findMany({
      where: { agentId },
      include: {
        epoch: {
          select: {
            arenaId: true,
            endAt: true,
            status: true,
            onChainEpochId: true,
            arena: { select: { onChainId: true, name: true } },
          },
        },
      },
    });
    let feesPaid = 0;
    let rewardsClaimedWei = BigInt(0);
    const pendingRewards: Array<{
      epochId: number;
      arenaId: number;
      arenaName: string | null;
      onChainEpochId: number | null;
      arenaOnChainId: number | null;
      amount: string;
      endAt: string;
    }> = [];
    for (const reg of epochRegs) {
      const feesWei = reg.feesPaid ? parseFloat(reg.feesPaid) / 1e18 : 0;
      feesPaid += feesWei;
      if (reg.rewardClaimed && reg.claimedRewardAmountWei) {
        rewardsClaimedWei += BigInt(reg.claimedRewardAmountWei);
      }
      if (!reg.rewardClaimed && reg.epoch.status === "ended") {
        let amount = reg.pendingRewardAmountWei ?? "0";
        const agentOnChainId = agent.onChainId;
        const arenaOnChainId = reg.epoch.arena?.onChainId ?? null;
        const epochOnChainId = reg.epoch.onChainEpochId ?? null;
        if (
          agentOnChainId != null &&
          arenaOnChainId != null &&
          epochOnChainId != null
        ) {
          amount = await getPendingRewardFromContract(
            agentOnChainId,
            arenaOnChainId,
            epochOnChainId
          );
        }
        if (BigInt(amount) > BigInt(0)) {
          pendingRewards.push({
            epochId: reg.epochId,
            arenaId: reg.epoch.arenaId,
            arenaName: reg.epoch.arena?.name ?? null,
            onChainEpochId: epochOnChainId,
            arenaOnChainId,
            amount,
            endAt: reg.epoch.endAt.toISOString(),
          });
        }
      }
    }

    const rewardsCollected = Number(rewardsClaimedWei) / 1e18;

    res.json({
      agentId,
      tradeCount,
      feesPaid: feesPaid + tradeFeesMolti,
      rewardsCollected,
      pendingRewards,
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId/stats");
  }
});

/**
 * GET /agents/:agentId/decisions
 * Paginated audit log of all decisions (BUY/SELL/HOLD) with reason, status, tx link.
 */
router.get("/:agentId/decisions", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const page = Math.max(1, parseInt(String(req.query.page ?? 1), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? 20), 10)));
    const skip = (page - 1) * limit;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const [decisions, total] = await Promise.all([
      prisma.agentDecision.findMany({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          arena: { select: { id: true, name: true, tokenAddress: true } },
        },
      }),
      prisma.agentDecision.count({ where: { agentId } }),
    ]);

    // Fetch matching trades for BUY/SELL decisions (for moltiAmount and PnL)
    const decisionKeys = decisions
      .filter((d) => d.action === "BUY" || d.action === "SELL")
      .map((d) => ({ agentId, arenaId: d.arenaId, tick: d.tick }));
    const trades = await prisma.trade.findMany({
      where: {
        agentId,
        OR: decisionKeys.map((k) => ({
          arenaId: k.arenaId,
          tick: k.tick,
        })),
      },
    });
    const tradeByKey = new Map(
      trades.map((t) => [`${t.arenaId}:${t.tick}`, t])
    );

    res.json({
      agentId,
      decisions: decisions.map((d) => {
        const trade =
          d.action === "BUY" || d.action === "SELL"
            ? tradeByKey.get(`${d.arenaId}:${d.tick}`)
            : undefined;

        // MOLTI amount: from Trade (gross for BUY, cost-basis for SELL)
        const moltiAmount: number | null =
          trade?.tradeValueMon != null ? trade.tradeValueMon : null;

        // PnL: for SELL = (tokensSold * price) - costBasis (MOLTI); for BUY = null; for HOLD = pnlPctAtDecision (%)
        let pnl: number | null = null;
        let pnlUnit: "MOLTI" | "%" | null = null;
        if (d.action === "SELL" && trade) {
          const costBasis = trade.tradeValueMon ?? 0;
          const sizePct = trade.sizePct;
          const avgEntry = trade.avgEntryPriceBefore;
          if (sizePct > 0) {
            let tokensSold: number;
            if (sizePct >= 1 && avgEntry != null && avgEntry > 0) {
              // Full sell: tokensSold = costBasis / avgEntryPrice
              tokensSold = costBasis / avgEntry;
            } else if (sizePct < 1) {
              tokensSold = (trade.tokenAfter * sizePct) / (1 - sizePct);
            } else {
              tokensSold = 0;
            }
            const valueAtSell = tokensSold * trade.price;
            pnl = valueAtSell - costBasis;
            pnlUnit = "MOLTI";
          }
        } else if (d.action === "HOLD" && d.pnlPctAtDecision != null) {
          pnl = d.pnlPctAtDecision;
          pnlUnit = "%";
        }

        return {
          id: d.id,
          arenaId: d.arenaId,
          arenaName: d.arena.name,
          tick: d.tick,
          action: d.action,
          sizePct: d.sizePct,
          price: d.price,
          moltiAmount,
          pnl,
          pnlUnit,
          reason: d.reason,
          confidence: d.confidence,
          status: d.status,
          onChainTxHash: d.onChainTxHash,
          createdAt: d.createdAt,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId/decisions");
  }
});

/**
 * GET /agents/:agentId/memory
 * Returns the agent's persona memory (one evolving summary across all arenas).
 */
router.get("/:agentId/memory", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const persona = await prisma.agentPersonaMemory.findUnique({
      where: { agentId },
    });

    res.json({
      agentId,
      memory: persona
        ? {
            memoryText: persona.memoryText,
            lastUpdatedTick: persona.lastUpdatedTick,
            lastAiSummarizedAt: persona.lastAiSummarizedAt,
            updatedAt: persona.updatedAt,
          }
        : null,
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId/memory");
  }
});

/**
 * GET /agents/:agentId/trades
 * Returns recent trades for an agent across all arenas.
 */
router.get("/:agentId/trades", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const trades = await prisma.trade.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        arena: { select: { name: true, tokenAddress: true } },
      },
    });

    res.json({
      agentId,
      trades: trades.map((t) => ({
        id: t.id,
        arenaId: t.arenaId,
        arenaName: t.arena.name,
        tick: t.tick,
        action: t.action,
        sizePct: t.sizePct,
        price: t.price,
        cashAfter: t.cashAfter,
        tokenAfter: t.tokenAfter,
        reason: t.reason,
        onChainTxHash: t.onChainTxHash,
        createdAt: t.createdAt,
      })),
    });
  } catch (e) {
    handleRouteError(e, res, "GET /agents/:agentId/trades");
  }
});

/**
 * POST /agents/create-wallet
 * Generate an ERC-4337 SimpleAccount wallet for a new agent.
 * Returns the smart account address to use in the on-chain createAgent call.
 */
router.post("/create-wallet", async (req: Request, res: Response): Promise<void> => {
  try {
    const wallet = await createAgentWallet();
    res.json({
      smartAccountAddress: wallet.smartAccountAddress,
      signerAddress: wallet.signerAddress,
      encryptedKey: wallet.encryptedKey,
    });
  } catch (e) {
    handleRouteError(e, res, "POST /agents/create-wallet");
  }
});

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createAgentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { ownerAddress, profile } = parsed.data;

    const profileHash = hashProfileConfig(profile);
    const profileJson = profile as unknown as object;

    const agent = await prisma.agent.create({
      data: {
        ownerAddress,
        name: profile.name,
        profileHash,
        profileJson,
      },
    });

    res.status(201).json({
      agentId: agent.id,
      profileHash,
    });
  } catch (e) {
    handleRouteError(e, res, "POST /agents");
  }
});

/**
 * POST /agents/:agentId/fund
 * Record that the owner funded the agent's wallet with MOLTI.
 * Called by the frontend after a successful ERC20 transfer to the agent wallet.
 */
router.post("/:agentId/fund", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const { amount, txHash } = req.body;
    if (typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data: {
        fundedBalance: agent.fundedBalance + amount,
      },
    });

    console.log(
      `[agents] Agent ${agentId} funded +${amount} MOLTI (total: ${updated.fundedBalance}) tx=${txHash ?? "N/A"}`,
    );

    res.json({
      agentId: updated.id,
      fundedBalance: updated.fundedBalance,
      txHash: txHash ?? null,
    });
  } catch (e) {
    handleRouteError(e, res, "POST /agents/:agentId/fund");
  }
});

/**
 * POST /agents/:agentId/approve-molti
 * Approve MoltiArena to spend MOLTI from the agent's wallet (required for epoch renewal).
 * Call this after funding the agent so autoRenewEpoch can pull the renewal fee.
 */
router.post("/:agentId/approve-molti", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { encryptedSignerKey: true },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (!agent.encryptedSignerKey) {
      res.status(400).json({ error: "Agent has no wallet key; cannot approve" });
      return;
    }

    const txHash = await approveMoltiForArena({
      encryptedSignerKey: agent.encryptedSignerKey,
    });

    if (!txHash) {
      res.status(500).json({ error: "Approval transaction failed" });
      return;
    }

    res.json({ txHash });
  } catch (e) {
    handleRouteError(e, res, "POST /agents/:agentId/approve-molti");
  }
});

/**
 * POST /agents/sync
 * Attach off-chain profile data to an on-chain indexed agent.
 * Called by the frontend after a successful createAgent transaction.
 */
router.post("/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = syncAgentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { onChainId, profile, ownerAddress, walletAddress, smartAccountAddress, encryptedSignerKey, txHash } = parsed.data;

    const profileHash = hashProfileConfig(profile);
    const profileJson = profile as unknown as object;

    // Try to find agent by onChainId (created by indexer)
    let agent = await prisma.agent.findUnique({
      where: { onChainId },
    });

    if (agent) {
      // Update existing indexed agent with profile data
      agent = await prisma.agent.update({
        where: { onChainId },
        data: {
          name: profile.name,
          profileHash,
          profileJson,
          ownerAddress: ownerAddress ?? agent.ownerAddress,
          walletAddress: walletAddress ?? agent.walletAddress,
          smartAccountAddress: smartAccountAddress ?? agent.smartAccountAddress,
          encryptedSignerKey: encryptedSignerKey ?? agent.encryptedSignerKey,
          creationTxHash: txHash ?? agent.creationTxHash,
        },
      });
    } else {
      // Indexer hasn't caught up yet — create the agent proactively
      agent = await prisma.agent.create({
        data: {
          onChainId,
          ownerAddress: ownerAddress ?? "",
          walletAddress: walletAddress ?? null,
          smartAccountAddress: smartAccountAddress ?? null,
          encryptedSignerKey: encryptedSignerKey ?? null,
          name: profile.name,
          profileHash,
          profileJson,
          creationTxHash: txHash ?? null,
        },
      });
    }

    // Auto-approve MoltiArena to spend MOLTI from the agent's wallet (infinite allowance).
    // This is fire-and-forget: approval failures are logged but don't block the sync response.
    const keyForApproval = encryptedSignerKey ?? agent.encryptedSignerKey;
    if (keyForApproval) {
      approveMoltiForArena({ encryptedSignerKey: keyForApproval }).catch((err) => {
        console.warn(
          `[agents/sync] Auto-approve MOLTI failed for agent ${agent!.id}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }

    res.status(200).json({
      agentId: agent.id,
      onChainId: agent.onChainId,
      profileHash,
    });
  } catch (e) {
    handleRouteError(e, res, "POST /agents/sync");
  }
});

/**
 * POST /agents/:agentId/withdraw
 * Withdraw MOLTI or MON from the agent's smart account.
 * Only the agent owner can withdraw. Sends a UserOperation via Pimlico bundler.
 */
router.post("/:agentId/withdraw", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = parseId(req.params.agentId, "agentId", res);
    if (agentId === null) return;

    const { token, amount, toAddress, ownerAddress } = req.body;
    if (!token || !amount || !toAddress || !ownerAddress) {
      res.status(400).json({ error: "token, amount, toAddress, ownerAddress are required" });
      return;
    }
    if (token !== "MOLTI" && token !== "MON") {
      res.status(400).json({ error: "token must be MOLTI or MON" });
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    // Verify caller is the owner
    if (agent.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      res.status(403).json({ error: "Only the agent owner can withdraw" });
      return;
    }
    if (!agent.encryptedSignerKey) {
      res.status(400).json({ error: "Agent does not have a smart account wallet" });
      return;
    }

    const amountWei = parseEther(amount);
    let txHash: string;

    if (token === "MOLTI") {
      txHash = await withdrawMolti(
        agent.encryptedSignerKey,
        toAddress as Address,
        amountWei,
      );
    } else {
      txHash = await withdrawMon(
        agent.encryptedSignerKey,
        toAddress as Address,
        amountWei,
      );
    }

    res.json({ txHash, token, amount });
  } catch (e) {
    handleRouteError(e, res, "POST /agents/:agentId/withdraw");
  }
});

export default router;
