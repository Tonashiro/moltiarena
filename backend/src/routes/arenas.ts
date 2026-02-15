import { Router, Request, Response } from "express";
import { prisma } from "../db.js";
import { getCurrentEpoch, getLatestEpoch } from "../services/epochService.js";
import { registerArenaBodySchema } from "../schemas/requests.js";
import { handleRouteError, parseId } from "./routeHelpers.js";

const router = Router();

router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const arenas = await prisma.arena.findMany({
      include: {
        arenaRegistrations: {
          where: { isActive: true },
          select: { id: true },
        },
      },
      orderBy: { id: "asc" },
    });
    const list = arenas.map((a) => ({
      id: a.id,
      tokenAddress: a.tokenAddress,
      name: a.name,
      onChainId: a.onChainId,
      activeAgentsCount: a.arenaRegistrations.length,
    }));
    res.json({ arenas: list });
  } catch (e) {
    handleRouteError(e, res, "GET /arenas");
  }
});

// IMPORTANT: More specific routes must come BEFORE the general /:arenaId route
// Otherwise Express will match /:arenaId first and "leaderboard"/"trades" will be treated as arenaId

router.get("/:arenaId/leaderboard", async (req: Request, res: Response): Promise<void> => {
  try {
    const arenaId = parseId(req.params.arenaId, "arenaId", res);
    if (arenaId === null) return;
    const epochIdParam = req.query.epochId;
    const arena = await prisma.arena.findUnique({
      where: { id: arenaId },
    });
    if (!arena) {
      res.status(404).json({ error: "Arena not found" });
      return;
    }

    // Resolve epoch: ?epochId=X or current/latest
    let epochId: number | null = null;
    let epochEndAt: string | null = null;
    if (typeof epochIdParam === "string") {
      const parsed = parseInt(epochIdParam, 10);
      if (!isNaN(parsed)) {
        const epoch = await prisma.epoch.findUnique({
          where: { id: parsed, arenaId },
        });
        if (epoch) {
          epochId = epoch.id;
          epochEndAt = epoch.endAt.toISOString();
        }
      }
    }
    if (epochId === null) {
      const latest =
        epochIdParam === undefined
          ? await getCurrentEpoch({ prisma }, arenaId)
          : await getLatestEpoch({ prisma }, arenaId);
      if (latest) {
        epochId = latest.id;
        epochEndAt = latest.endAt.toISOString();
      }
    }

    const latest = await prisma.leaderboardSnapshot.findFirst({
      where: { arenaId, ...(epochId != null ? { epochId } : {}) },
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
        volumeTraded?: number;
        tradeCount?: number;
        points?: number;
        rank?: number;
      }>;
      let rewardPoolDistributed: string | null = null;
      const rewardByAgent = new Map<number, string>();
      if (epochId != null) {
        const regs = await prisma.epochRegistration.findMany({
          where: { epochId, pendingRewardAmountWei: { not: null } },
          select: { agentId: true, pendingRewardAmountWei: true },
        });
        let total = BigInt(0);
        for (const r of regs) {
          if (r.pendingRewardAmountWei) {
            rewardByAgent.set(r.agentId, r.pendingRewardAmountWei);
            total += BigInt(r.pendingRewardAmountWei);
          }
        }
        rewardPoolDistributed = total > BigInt(0) ? total.toString() : null;
      }
      // Normalize points when no activity: 0 vol + 0 trades => 0.175 (displays as 17.5) so all such agents tie
      const withReward = (r: (typeof rankings)[0]) => rewardByAgent.get(r.agentId) ?? null;
      const normalizedRankings = rankings
        .map((r) => {
          const vol = r.volumeTraded ?? 0;
          const trades = r.tradeCount ?? 0;
          const points = vol === 0 && trades === 0 ? 0.175 : (r.points ?? 0);
          return {
            agentId: r.agentId,
            name: r.name,
            pnlPct: r.pnlPct,
            equity: r.equity,
            cashMon: r.cashMon,
            tokenUnits: r.tokenUnits,
            initialCapital: r.initialCapital ?? 0,
            volumeTraded: vol,
            tradeCount: trades,
            points,
            rewardAmountWei: withReward(r),
          };
        })
        .sort((a, b) => b.points - a.points || a.agentId - b.agentId);
      res.json({
        arenaId,
        epochId,
        epochEndAt,
        tick: latest.tick,
        createdAt: latest.createdAt,
        rewardPoolDistributed,
        rankings: normalizedRankings.map((r, i) => ({ ...r, rank: i + 1 })),
      });
      return;
    }

    // No snapshot yet — build rankings from registered agents' portfolios
    // Only include agents who paid for this epoch when epochId is set
    const agentIdFilter =
      epochId != null
        ? {
            agentId: {
              in: (
                await prisma.epochRegistration.findMany({
                  where: { epochId },
                  select: { agentId: true },
                })
              ).map((r) => r.agentId),
            },
          }
        : {};
    const portfolios = await prisma.portfolio.findMany({
      where: { arenaId, ...agentIdFilter },
      include: {
        agent: {
          select: { id: true, name: true },
        },
      },
      orderBy: { cashMon: "desc" },
    });

    const fallbackRankings = portfolios.map((p) => {
      // Without a market price snapshot we can only use cash as equity approximation.
      const eq = p.cashMon;
      const pnl = p.initialCapital > 0
        ? ((eq - p.initialCapital) / p.initialCapital) * 100
        : 0;
      // No snapshot = no activity; use neutral points (0.175) so everyone shows 17.5 (same as engine when 0 vol/trades).
      const points = 0.175;
      return {
        agentId: p.agent.id,
        name: p.agent.name,
        pnlPct: pnl,
        equity: eq,
        cashMon: p.cashMon,
        tokenUnits: p.tokenUnits,
        initialCapital: p.initialCapital,
        points,
      };
    });

    fallbackRankings.sort((a, b) => b.points - a.points);

    res.json({
      arenaId,
      epochId,
      epochEndAt,
      tick: null,
      createdAt: null,
      rewardPoolDistributed: null,
      rankings: fallbackRankings.map((r, i) => ({
        ...r,
        volumeTraded: 0,
        tradeCount: 0,
        points: r.points,
        rank: i + 1,
        rewardAmountWei: null,
      })),
    });
  } catch (e) {
    handleRouteError(e, res, "GET /arenas/:arenaId/leaderboard");
  }
});

// GET /arenas/:arenaId/epochs — list past/current epochs for an arena
router.get("/:arenaId/epochs", async (req: Request, res: Response): Promise<void> => {
  try {
    const arenaId = parseId(req.params.arenaId, "arenaId", res);
    if (arenaId === null) return;
    const arena = await prisma.arena.findUnique({
      where: { id: arenaId },
    });
    if (!arena) {
      res.status(404).json({ error: "Arena not found" });
      return;
    }
    const epochs = await prisma.epoch.findMany({
      where: { arenaId },
      orderBy: { startAt: "desc" },
      include: {
        epochRegistrations: {
          where: { pendingRewardAmountWei: { not: null } },
          select: { pendingRewardAmountWei: true },
        },
      },
    });
    const list = epochs.map((e) => {
      const distributed = e.epochRegistrations.reduce(
        (sum, r) => sum + (r.pendingRewardAmountWei ? BigInt(r.pendingRewardAmountWei) : BigInt(0)),
        BigInt(0)
      );
      return {
        id: e.id,
        onChainEpochId: e.onChainEpochId,
        startAt: e.startAt,
        endAt: e.endAt,
        status: e.status,
        rewardPoolDistributed: distributed > BigInt(0) ? distributed.toString() : null,
        rewardsDistributedAt: e.rewardsDistributedAt,
        distributionTxHash: e.distributionTxHash,
        rewardsSweptAt: e.rewardsSweptAt,
      };
    });
    res.json({ arenaId, epochs: list });
  } catch (e) {
    handleRouteError(e, res, "GET /arenas/:arenaId/epochs");
  }
});

router.get("/:arenaId/trades", async (req: Request, res: Response): Promise<void> => {
  try {
    const arenaId = parseId(req.params.arenaId, "arenaId", res);
    if (arenaId === null) return;
    const arena = await prisma.arena.findUnique({
      where: { id: arenaId },
    });
    if (!arena) {
      res.status(404).json({ error: "Arena not found" });
      return;
    }
    const trades = await prisma.trade.findMany({
      where: { arenaId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { agent: { select: { name: true } } },
    });
    res.json({
      arenaId,
      trades: trades.map((t) => ({
        agentName: t.agent.name,
        action: t.action,
        sizePct: t.sizePct,
        price: t.price,
        reason: t.reason,
        onChainTxHash: t.onChainTxHash,
        createdAt: t.createdAt,
      })),
    });
  } catch (e) {
    handleRouteError(e, res, "GET /arenas/:arenaId/trades");
  }
});

router.get("/:arenaId/token-trades", async (req: Request, res: Response): Promise<void> => {
  try {
    const arenaId = parseId(req.params.arenaId, "arenaId", res);
    if (arenaId === null) return;
    const arena = await prisma.arena.findUnique({
      where: { id: arenaId },
    });
    if (!arena) {
      res.status(404).json({ error: "Arena not found" });
      return;
    }

    const events = await prisma.marketEvent.findMany({
      where: {
        tokenAddress: arena.tokenAddress,
        eventType: { in: ["Buy", "Sell", "Swap"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        eventType: true,
        price: true,
        volumeMon: true,
        traderAddress: true,
        transactionHash: true,
        createdAt: true,
      },
    });

    res.json({
      arenaId,
      tokenAddress: arena.tokenAddress,
      trades: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        price: e.price,
        volume: e.volumeMon,
        trader: e.traderAddress,
        txHash: e.transactionHash,
        createdAt: e.createdAt,
      })),
    });
  } catch (e) {
    handleRouteError(e, res, "GET /arenas/:arenaId/token-trades");
  }
});

router.get("/:arenaId", async (req: Request, res: Response): Promise<void> => {
  try {
    const arenaId = parseId(req.params.arenaId, "arenaId", res);
    if (arenaId === null) return;
    const arena = await prisma.arena.findUnique({
      where: { id: arenaId },
      include: {
        arenaRegistrations: {
          where: { isActive: true },
          select: { id: true },
        },
      },
    });
    if (!arena) {
      res.status(404).json({ error: "Arena not found" });
      return;
    }
    res.json({
      id: arena.id,
      tokenAddress: arena.tokenAddress,
      name: arena.name,
      onChainId: arena.onChainId,
      activeAgentsCount: arena.arenaRegistrations.length,
    });
  } catch (e) {
    handleRouteError(e, res, "GET /arenas/:arenaId");
  }
});

router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = registerArenaBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { ownerAddress, agentId, tokenAddress, arenaName } = parsed.data;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (agent.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      res.status(403).json({ error: "Agent ownership mismatch" });
      return;
    }

    const arena = await prisma.arena.upsert({
      where: { tokenAddress },
      create: {
        tokenAddress,
        name: arenaName ?? null,
      },
      update: arenaName === undefined ? {} : { name: arenaName },
    });

    const registration = await prisma.arenaRegistration.upsert({
      where: {
        agentId_arenaId: { agentId, arenaId: arena.id },
      },
      create: {
        agentId,
        arenaId: arena.id,
        isActive: true,
      },
      update: { isActive: true },
    });

    const existingPortfolio = await prisma.portfolio.findFirst({
      where: { agentId, arenaId: arena.id },
      orderBy: { updatedAt: "desc" },
    });
    if (!existingPortfolio) {
      await prisma.portfolio.create({
        data: {
          agentId,
          arenaId: arena.id,
          cashMon: 1,
          tokenUnits: 0,
        },
      });
    }

    res.status(201).json({
      arenaId: arena.id,
      registrationId: registration.id,
    });
  } catch (e) {
    handleRouteError(e, res, "POST /arenas/register");
  }
});

export default router;
