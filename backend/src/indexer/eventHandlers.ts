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
  deposit: bigint;
}

export async function handleAgentRegistered(
  prisma: PrismaClient,
  args: AgentRegisteredArgs,
  txHash: string,
): Promise<void> {
  const onChainAgentId = Number(args.agentId);
  const onChainArenaId = Number(args.arenaId);
  const depositStr = args.deposit.toString();

  console.log(
    `${TAG} AgentRegistered: agent=${onChainAgentId} arena=${onChainArenaId} deposit=${formatEther(args.deposit)} MOLTI`,
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

  // Create registration
  await prisma.arenaRegistration.upsert({
    where: {
      agentId_arenaId: { agentId: agent.id, arenaId: arena.id },
    },
    create: {
      agentId: agent.id,
      arenaId: arena.id,
      isActive: true,
      deposit: depositStr,
      registrationTxHash: txHash,
    },
    update: {
      isActive: true,
      deposit: depositStr,
      registrationTxHash: txHash,
    },
  });

  // Paper capital = (fundedBalance - total registration fees) / num arenas.
  // Each registration deducts MOLTI from the agent wallet; sum actual deposits.
  const regs = await prisma.arenaRegistration.findMany({
    where: { agentId: agent.id, isActive: true },
    select: { deposit: true },
  });
  const feePerReg = Number(formatEther(args.deposit));
  const totalFees = regs.reduce(
    (s, r) => s + (r.deposit ? Number(r.deposit) / 1e18 : feePerReg),
    0,
  );
  const funded = agent.fundedBalance > 0 ? agent.fundedBalance : feePerReg;
  const available = Math.max(0, funded - totalFees);
  const perArena = regs.length > 0 ? available / regs.length : 0;
  const paperCapital = perArena;
  console.log(
    `${TAG} Portfolio init: agent=${agent.id} arena=${arena.id} capital=${paperCapital} (fundedBalance=${agent.fundedBalance} fees=${totalFees} arenas=${regs.length})`,
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
        initialCapital: paperCapital,
        cashMon: paperCapital,
        tokenUnits: 0,
      },
    });
    // Rebalance existing portfolios for this agent: set initialCapital/cashMon to perArena when tokenUnits=0
    const otherPortfolios = await prisma.portfolio.findMany({
      where: { agentId: agent.id, arenaId: { not: arena.id } },
    });
    for (const p of otherPortfolios) {
      if (p.tokenUnits === 0) {
        await prisma.portfolio.update({
          where: { id: p.id },
          data: { initialCapital: paperCapital, cashMon: paperCapital },
        });
      }
    }
  }
}

// ─── AgentUnregistered ───────────────────────────────────────────────

export interface AgentUnregisteredArgs {
  agentId: bigint;
  arenaId: bigint;
  withdrawn: bigint;
}

export async function handleAgentUnregistered(
  prisma: PrismaClient,
  args: AgentUnregisteredArgs,
): Promise<void> {
  const onChainAgentId = Number(args.agentId);
  const onChainArenaId = Number(args.arenaId);

  console.log(
    `${TAG} AgentUnregistered: agent=${onChainAgentId} arena=${onChainArenaId} withdrawn=${formatEther(args.withdrawn)} MOLTI`,
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
  sizePct: bigint;
  price: bigint;
  cashAfter: bigint;
  tokenUnitsAfter: bigint;
}

export async function handleTradePlaced(
  _prisma: PrismaClient,
  args: TradePlacedArgs,
): Promise<void> {
  const actionNames = ["BUY", "SELL", "HOLD"];
  console.log(
    `${TAG} TradePlaced: agent=${Number(args.agentId)} arena=${Number(args.arenaId)} action=${actionNames[args.action] ?? args.action} sizePct=${formatEther(args.sizePct)} price=${formatEther(args.price)}`,
  );
  // Trade execution is handled by the arena engine off-chain for now.
  // This log is useful for auditing on-chain trades.
}
