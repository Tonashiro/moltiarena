/**
 * Event handlers for MoltiArena contract events.
 * Each handler processes a decoded event log and upserts the corresponding
 * database record.
 */
import type { PrismaClient } from "@prisma/client";
import { formatEther } from "viem";

const TAG = "[indexer]";

// ─── AgentCreated ────────────────────────────────────────────────────

export interface AgentCreatedArgs {
  agentId: bigint;
  owner: `0x${string}`;
  wallet: `0x${string}`;
  profileHash: `0x${string}`;
}

export async function handleAgentCreated(
  prisma: PrismaClient,
  args: AgentCreatedArgs,
  txHash: string,
): Promise<void> {
  const onChainId = Number(args.agentId);
  console.log(
    `${TAG} AgentCreated: id=${onChainId} owner=${args.owner} wallet=${args.wallet}`,
  );

  // Upsert: if the agent was already synced via POST /agents/sync, we update;
  // otherwise we create a placeholder that will be enriched later.
  const existing = await prisma.agent.findUnique({
    where: { onChainId },
  });

  if (existing) {
    await prisma.agent.update({
      where: { onChainId },
      data: {
        ownerAddress: args.owner,
        walletAddress: args.wallet,
        profileHash: args.profileHash,
        creationTxHash: txHash,
      },
    });
  } else {
    await prisma.agent.create({
      data: {
        onChainId,
        ownerAddress: args.owner,
        walletAddress: args.wallet,
        name: `Agent #${onChainId}`,
        profileHash: args.profileHash,
        profileJson: {},
        creationTxHash: txHash,
      },
    });
  }
}

// ─── ArenaCreated ────────────────────────────────────────────────────

export interface ArenaCreatedArgs {
  arenaId: bigint;
  tokenAddress: `0x${string}`;
  name: string;
}

export async function handleArenaCreated(
  prisma: PrismaClient,
  args: ArenaCreatedArgs,
): Promise<void> {
  const onChainId = Number(args.arenaId);
  // Normalize token address to lowercase (seeder also lowercases)
  const tokenAddress = args.tokenAddress.toLowerCase();
  console.log(
    `${TAG} ArenaCreated: id=${onChainId} token=${tokenAddress} name="${args.name}"`,
  );

  // Upsert by tokenAddress (may already exist from seeder)
  await prisma.arena.upsert({
    where: { tokenAddress },
    create: {
      tokenAddress,
      name: args.name || null,
      onChainId,
    },
    update: {
      onChainId,
      name: args.name || undefined,
    },
  });
}

// ─── AgentRegistered ─────────────────────────────────────────────────

export interface AgentRegisteredArgs {
  agentId: bigint;
  arenaId: bigint;
}

export async function handleAgentRegistered(
  prisma: PrismaClient,
  args: AgentRegisteredArgs,
  txHash: string,
): Promise<void> {
  const onChainAgentId = Number(args.agentId);
  const onChainArenaId = Number(args.arenaId);

  console.log(
    `${TAG} AgentRegistered: agent=${onChainAgentId} arena=${onChainArenaId}`,
  );

  // Find agent and arena by on-chain IDs
  const agent = await prisma.agent.findUnique({
    where: { onChainId: onChainAgentId },
  });
  const arena = await prisma.arena.findFirst({
    where: { onChainId: onChainArenaId },
  });

  if (!agent || !arena) {
    console.warn(
      `${TAG} AgentRegistered: skipping — agent or arena not found in DB (agent=${onChainAgentId}, arena=${onChainArenaId})`,
    );
    return;
  }

  // Create registration (no deposit — MOLTI is pulled on BUY)
  await prisma.arenaRegistration.upsert({
    where: {
      agentId_arenaId: { agentId: agent.id, arenaId: arena.id },
    },
    create: {
      agentId: agent.id,
      arenaId: arena.id,
      isActive: true,
      deposit: "0",
      registrationTxHash: txHash,
    },
    update: {
      isActive: true,
      registrationTxHash: txHash,
    },
  });

  // Initialize portfolio with wallet MOLTI as initial capital
  // The agent's funded balance represents their total MOLTI across all arenas
  const funded = agent.fundedBalance > 0 ? agent.fundedBalance : 0;
  const regs = await prisma.arenaRegistration.findMany({
    where: { agentId: agent.id, isActive: true },
  });
  const perArena = regs.length > 0 ? funded / regs.length : 0;

  console.log(
    `${TAG} Portfolio init: agent=${agent.id} arena=${arena.id} capital=${perArena} (fundedBalance=${agent.fundedBalance} arenas=${regs.length})`,
  );

  const existingPortfolio = await prisma.portfolio.findFirst({
    where: { agentId: agent.id, arenaId: arena.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!existingPortfolio) {
    await prisma.portfolio.create({
      data: {
        agentId: agent.id,
        arenaId: arena.id,
        initialCapital: perArena,
        cashMon: perArena,
        tokenUnits: 0,
        moltiLocked: 0,
      },
    });
    // Rebalance existing portfolios for this agent: update initialCapital when tokenUnits=0
    const otherPortfolios = await prisma.portfolio.findMany({
      where: { agentId: agent.id, arenaId: { not: arena.id } },
    });
    for (const p of otherPortfolios) {
      if (p.tokenUnits === 0) {
        await prisma.portfolio.update({
          where: { id: p.id },
          data: { initialCapital: perArena, cashMon: perArena },
        });
      }
    }
  }
}

// ─── AgentUnregistered ───────────────────────────────────────────────

export interface AgentUnregisteredArgs {
  agentId: bigint;
  arenaId: bigint;
}

export async function handleAgentUnregistered(
  prisma: PrismaClient,
  args: AgentUnregisteredArgs,
): Promise<void> {
  const onChainAgentId = Number(args.agentId);
  const onChainArenaId = Number(args.arenaId);

  console.log(
    `${TAG} AgentUnregistered: agent=${onChainAgentId} arena=${onChainArenaId}`,
  );

  const agent = await prisma.agent.findUnique({
    where: { onChainId: onChainAgentId },
  });
  const arena = await prisma.arena.findFirst({
    where: { onChainId: onChainArenaId },
  });

  if (!agent || !arena) {
    console.warn(
      `${TAG} AgentUnregistered: skipping — agent or arena not found`,
    );
    return;
  }

  await prisma.arenaRegistration.updateMany({
    where: { agentId: agent.id, arenaId: arena.id },
    data: { isActive: false },
  });
}

// ─── AgentEpochRenewed ────────────────────────────────────────────────

export interface AgentEpochRenewedArgs {
  agentId: bigint;
  arenaId: bigint;
  epochId: bigint;
  amount: bigint;
}

export async function handleAgentEpochRenewed(
  prisma: PrismaClient,
  args: AgentEpochRenewedArgs,
): Promise<void> {
  const onChainAgentId = Number(args.agentId);
  const onChainArenaId = Number(args.arenaId);
  const onChainEpochId = Number(args.epochId);

  console.log(
    `${TAG} AgentEpochRenewed: agent=${onChainAgentId} arena=${onChainArenaId} epoch=${onChainEpochId} amount=${formatEther(args.amount)} MOLTI`,
  );

  const agent = await prisma.agent.findUnique({
    where: { onChainId: onChainAgentId },
  });
  const arena = await prisma.arena.findFirst({
    where: { onChainId: onChainArenaId },
  });

  if (!agent || !arena) {
    console.warn(
      `${TAG} AgentEpochRenewed: skipping — agent or arena not found (agent=${onChainAgentId}, arena=${onChainArenaId})`,
    );
    return;
  }

  const epoch = await prisma.epoch.findFirst({
    where: {
      arenaId: arena.id,
      onChainEpochId,
    },
  });

  if (!epoch) {
    console.warn(
      `${TAG} AgentEpochRenewed: skipping — epoch not found (arena=${arena.id}, onChainEpochId=${onChainEpochId}). Epoch service should create epochs first.`,
    );
    return;
  }

  await prisma.epochRegistration.upsert({
    where: {
      epochId_agentId: { epochId: epoch.id, agentId: agent.id },
    },
    create: {
      epochId: epoch.id,
      agentId: agent.id,
      depositAmount: "0",
      feesPaid: "0",
      principalClaimed: false,
      rewardClaimed: false,
    },
    update: {},
  });

  console.log(
    `${TAG} EpochRegistration created/updated: agent=${agent.id} arena=${arena.id} epoch=${epoch.id}`,
  );
}

// ─── TradePlaced (log only for now) ──────────────────────────────────

export interface TradePlacedArgs {
  agentId: bigint;
  arenaId: bigint;
  action: number;
  sizePctOrAmount: bigint;
  price: bigint;
  moltiLockedAfter: bigint;
  tokenUnitsAfter: bigint;
}

export async function handleTradePlaced(
  _prisma: PrismaClient,
  args: TradePlacedArgs,
): Promise<void> {
  const actionNames = ["BUY", "SELL", "HOLD"];
  const action = actionNames[args.action] ?? args.action;
  const detail =
    action === "BUY"
      ? `amount=${formatEther(args.sizePctOrAmount)}`
      : `sizePct=${formatEther(args.sizePctOrAmount)}`;
  console.log(
    `${TAG} TradePlaced: agent=${Number(args.agentId)} arena=${Number(args.arenaId)} action=${action} ${detail} price=${formatEther(args.price)} moltiLocked=${formatEther(args.moltiLockedAfter)}`,
  );
  // Trade execution is handled by the arena engine off-chain for now.
  // This log is useful for auditing on-chain trades.
}
