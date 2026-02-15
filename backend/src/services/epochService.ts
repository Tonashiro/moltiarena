/**
 * Epoch Service
 *
 * Manages 24h epochs per arena: create, auto-renew agents, end.
 * Epoch boundaries: 00:00 UTC daily.
 * Uses operator wallet to call contract: createEpoch, autoRenewEpoch, endEpoch, setPendingReward.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createWalletClient,
  http,
  encodeFunctionData,
  decodeErrorResult,
  decodeEventLog,
  formatEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, RPC_URL, getPublicClient } from "../chains.js";
import { MOLTI_ARENA_ADDRESS, MOLTI_ARENA_ABI, MOLTI_TOKEN_ADDRESS, MOLTI_TOKEN_ABI } from "../contracts/abis.js";
import {
  getEpochPhaseOnChain,
  getEpochOnChain,
  getNextEpochId,
  getRegisteredAgentCountOnChain,
  getAgentsInArenaWithRenewal,
} from "./onChainReader.js";
import { approveMoltiForArena, getMoltiBalance } from "./smartAccount.js";

const EPOCH_RENEWAL_FEE_WEI = BigInt(Number(process.env.EPOCH_RENEWAL_FEE_MOLTI) || 100) * BigInt(1e18);

/** When set to a value < 1440 (24h), use short-epoch demo mode: epochs are this many minutes. */
const EPOCH_DURATION_MINUTES = Number(process.env.EPOCH_DURATION_MINUTES ?? "1440");
const IS_DEMO_EPOCH = EPOCH_DURATION_MINUTES > 0 && EPOCH_DURATION_MINUTES < 1440;
const EPOCH_DURATION_MS = EPOCH_DURATION_MINUTES * 60 * 1000;

let _walletClient: ReturnType<typeof createWalletClient> | null = null;

function getWalletClient() {
  if (_walletClient) return _walletClient;
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) {
    console.warn("[epochService] OPERATOR_PRIVATE_KEY not set; on-chain calls will be skipped");
    return null;
  }
  const account = privateKeyToAccount(pk as Hex);
  _walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });
  return _walletClient;
}

/** Whether an error is transient and worth retrying (network, nonce, priority). */
function isRetryableError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e != null; i++) {
    const msg = e instanceof Error ? e.message : String(e);
    const s = msg.toLowerCase();
    if (
      s.includes("existing transaction had higher priority") ||
      s.includes("nonce") ||
      s.includes("replacement transaction") ||
      s.includes("internal error") ||
      s.includes("an internal error was received") ||
      s.includes("timeout") ||
      s.includes("econnreset") ||
      s.includes("econnrefused") ||
      s.includes("network")
    ) {
      return true;
    }
    e = (e as { cause?: unknown })?.cause;
  }
  return false;
}

/** Sleep for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_TX_RETRIES = 3;
const DEFAULT_TX_RETRY_DELAY_MS = 2000;

/**
 * Retry a critical on-chain operation on transient errors (nonce too low, internal RPC, network).
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_TX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_TX_RETRY_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries - 1 && isRetryableError(err)) {
        const delayMs = baseDelayMs * (attempt + 1);
        console.warn(
          `[epochService] ${label} retry ${attempt + 1}/${maxRetries - 1} in ${delayMs}ms:`,
          err instanceof Error ? err.message : err
        );
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/** Walk error cause chain to find first hex 'data' (revert data). */
function getRevertDataFromError(err: unknown): Hex | undefined {
  let e: unknown = err;
  for (let i = 0; i < 10 && e != null; i++) {
    const o = e as { data?: string; cause?: unknown };
    if (typeof o?.data === "string" && o.data.startsWith("0x")) return o.data as Hex;
    e = o?.cause;
  }
  return undefined;
}

/** Format autoRenewEpoch revert reason for logging. */
function formatAutoRenewRevertReason(
  err: unknown,
  agentOnChainId: number,
  arenaOnChainId: number
): string {
  const msg = err instanceof Error ? err.message : String(err);

  // Try to extract revert data from viem error (ContractFunctionRevertedError)
  let data: Hex | undefined = getRevertDataFromError(err);
  if (!data) {
    const errObj = err as { data?: Hex; cause?: { data?: Hex }; details?: unknown };
    if (typeof errObj?.data === "string" && errObj.data.startsWith("0x")) {
      data = errObj.data as Hex;
    } else if (typeof errObj?.cause?.data === "string" && errObj.cause.data.startsWith("0x")) {
      data = errObj.cause.data as Hex;
    } else if (typeof (errObj?.details as { data?: string })?.data === "string") {
      data = (errObj.details as { data: string }).data as Hex;
    }
  }

  if (data) {
    try {
      const decoded = decodeErrorResult({
        abi: MOLTI_ARENA_ABI,
        data,
      });
      if (decoded.errorName === "InsufficientAgentBalance") {
        const [required, available] = decoded.args as [bigint, bigint];
        return `agent wallet needs ${formatEther(required)} MOLTI for renewal fee, has ${formatEther(available)} MOLTI — fund the agent wallet`;
      }
      if (decoded.errorName === "NotRegistered") {
        return "agent not registered in arena on-chain";
      }
      if (decoded.errorName === "EpochNotFound") {
        return "epoch not found on-chain";
      }
      if (decoded.errorName === "EpochAlreadyEnded") {
        return "epoch already ended";
      }
      if (decoded.errorName === "AgentNotFound" || decoded.errorName === "ArenaNotFound") {
        return decoded.errorName;
      }
      return `${decoded.errorName}(${decoded.args?.join(", ") ?? ""})`;
    } catch {
      // decode failed, fall through to generic msg
    }
  }

  return msg;
}

/** Get start and end timestamps for an epoch anchored at 00:00 UTC for a given UTC date string (YYYY-MM-DD). */
function getEpochBounds(utcDateStr: string): { startAt: Date; endAt: Date } {
  const startAt = new Date(`${utcDateStr}T00:00:00.000Z`);
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
  return { startAt, endAt };
}

/** For demo mode: epoch that starts now and ends in EPOCH_DURATION_MINUTES. */
function getEpochBoundsDemo(): { startAt: Date; endAt: Date } {
  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + EPOCH_DURATION_MS);
  return { startAt, endAt };
}

/** Current UTC date string (YYYY-MM-DD). */
function todayUtc(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

export interface EpochServiceDeps {
  prisma: PrismaClient;
}

export interface EpochInfo {
  id: number;
  arenaId: number;
  startAt: Date;
  endAt: Date;
  status: string;
  onChainEpochId?: number;
}

/**
 * Create a new epoch for an arena. Writes to DB and optionally on-chain.
 * @param arenaId DB arena ID.
 * @param arenaOnChainId On-chain arena ID (for contract call).
 * @param utcDateStr UTC date string (YYYY-MM-DD); ignored when overrideBounds is set.
 * @param overrideBounds When set (e.g. demo mode), use these bounds and do not match existing by date.
 */
export async function startEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  utcDateStr: string,
  overrideBounds?: { startAt: Date; endAt: Date }
): Promise<EpochInfo> {
  const { startAt, endAt } = overrideBounds ?? getEpochBounds(utcDateStr);

  if (!overrideBounds) {
    const existing = await deps.prisma.epoch.findFirst({
      where: { arenaId, startAt },
    });
    if (existing) {
    // Backfill onChainEpochId if missing (e.g. createEpoch succeeded but backend failed to store it)
    if (existing.onChainEpochId == null) {
      const publicClient = getPublicClient();
      if (publicClient) {
        try {
          const nextId = await publicClient.readContract({
            address: MOLTI_ARENA_ADDRESS as `0x${string}`,
            abi: MOLTI_ARENA_ABI,
            functionName: "nextEpochId",
            args: [BigInt(arenaOnChainId)],
          });
          const lastEpochId = Number(nextId) - 1;
          if (lastEpochId >= 0) {
            await deps.prisma.epoch.update({
              where: { id: existing.id },
              data: { onChainEpochId: lastEpochId },
            });
            console.log(
              `[epochService] Backfilled onChainEpochId=${lastEpochId} for epoch=${existing.id} arena=${arenaId}`
            );
            return { ...existing, onChainEpochId: lastEpochId } as EpochInfo;
          }
        } catch (err) {
          console.warn("[epochService] Backfill onChainEpochId failed:", err);
        }
      }
    }
    return existing as EpochInfo;
    }
  }

  const startSec = Math.floor(startAt.getTime() / 1000);
  const endSec = Math.floor(endAt.getTime() / 1000);

  let onChainEpochId: number | undefined;
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  if (walletClient && publicClient) {
    try {
      const hash = await withRetry("createEpoch", () =>
        walletClient.sendTransaction({
          account: walletClient.account!,
          chain,
          to: MOLTI_ARENA_ADDRESS as `0x${string}`,
          data: encodeFunctionData({
            abi: MOLTI_ARENA_ABI,
            functionName: "createEpoch",
            args: [BigInt(arenaOnChainId), BigInt(startSec), BigInt(endSec)],
          }),
        })
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        // Parse EpochCreated from receipt logs (exact epoch ID)
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: MOLTI_ARENA_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "EpochCreated" && decoded.args.arenaId === BigInt(arenaOnChainId)) {
              onChainEpochId = Number(decoded.args.epochId);
              break;
            }
          } catch {
            /* skip non-EpochCreated logs */
          }
        }
        if (onChainEpochId == null) {
          const nextId = await publicClient.readContract({
            address: MOLTI_ARENA_ADDRESS as `0x${string}`,
            abi: MOLTI_ARENA_ABI,
            functionName: "nextEpochId",
            args: [BigInt(arenaOnChainId)],
          });
          onChainEpochId = Number(nextId) - 1;
        }
        console.log(`[epochService] createEpoch on-chain arena=${arenaOnChainId} epochId=${onChainEpochId} tx=${hash}`);
      }
    } catch (err) {
      console.error("[epochService] createEpoch on-chain failed:", err);
    }
  }

  const epoch = await deps.prisma.epoch.create({
    data: {
      arenaId,
      onChainEpochId: onChainEpochId ?? null,
      startAt,
      endAt,
      status: "active",
      rewardPoolAmount: null,
      burnedAmount: null,
    },
  });

  return { ...epoch, onChainEpochId } as EpochInfo;
}

/**
 * Auto-renew agents for an epoch: call contract autoRenewEpoch for each registered agent.
 * Creates EpochRegistration in DB on success.
 */
export async function autoRenewAgentsForEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  epochId: number,
  onChainEpochId: number
): Promise<{ renewed: number; skipped: number }> {
  const registrations = await deps.prisma.arenaRegistration.findMany({
    where: { arenaId, isActive: true },
    include: {
      agent: {
        select: { id: true, onChainId: true, smartAccountAddress: true, encryptedSignerKey: true },
      },
    },
  });

  let renewed = 0;
  let skipped = 0;
  const walletClient = getWalletClient();

  for (const reg of registrations) {
    if (!reg.agent.onChainId || !reg.agent.smartAccountAddress || !reg.agent.encryptedSignerKey) {
      skipped++;
      continue;
    }

    const existing = await deps.prisma.epochRegistration.findUnique({
      where: { epochId_agentId: { epochId, agentId: reg.agentId } },
    });
    if (existing) {
      renewed++;
      continue;
    }

    if (walletClient) {
      const publicClient = getPublicClient();
      const account = walletClient.account;
      if (!account) continue;

      try {
        const agentWallet = reg.agent.smartAccountAddress as `0x${string}`;
        const balance = await getMoltiBalance(agentWallet);
        if (balance < EPOCH_RENEWAL_FEE_WEI) {
          skipped++;
          console.warn(
            `[epochService] autoRenewEpoch skipped agent=${reg.agent.onChainId} arena=${arenaOnChainId}: ` +
              `insufficient MOLTI (need ${formatEther(EPOCH_RENEWAL_FEE_WEI)}, have ${formatEther(balance)})`
          );
          continue;
        }

        const allowance = await publicClient.readContract({
          address: MOLTI_TOKEN_ADDRESS as `0x${string}`,
          abi: MOLTI_TOKEN_ABI,
          functionName: "allowance",
          args: [agentWallet, MOLTI_ARENA_ADDRESS as `0x${string}`],
        });
        if (allowance < EPOCH_RENEWAL_FEE_WEI) {
          const approved = await approveMoltiForArena({
            encryptedSignerKey: reg.agent.encryptedSignerKey,
          });
          if (!approved) {
            skipped++;
            console.warn(
              `[epochService] autoRenewEpoch skipped agent=${reg.agent.onChainId} arena=${arenaOnChainId}: ` +
                `MOLTI approval failed (allowance=${allowance}, needed=${EPOCH_RENEWAL_FEE_WEI})`
            );
            continue;
          }
        }

        const agentOnChainId = reg.agent.onChainId;
        if (agentOnChainId == null) continue;
        await publicClient.simulateContract({
          address: MOLTI_ARENA_ADDRESS as `0x${string}`,
          abi: MOLTI_ARENA_ABI,
          functionName: "autoRenewEpoch",
          args: [BigInt(agentOnChainId), BigInt(arenaOnChainId), BigInt(onChainEpochId)],
          account,
        });
        const sendTx = () =>
          walletClient.sendTransaction({
            account: walletClient.account!,
            chain,
            to: MOLTI_ARENA_ADDRESS as `0x${string}`,
            data: encodeFunctionData({
              abi: MOLTI_ARENA_ABI,
              functionName: "autoRenewEpoch",
              args: [BigInt(agentOnChainId), BigInt(arenaOnChainId), BigInt(onChainEpochId)],
            }),
          });

        const maxRetries = 3;
        let sent = false;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            await sendTx();
            sent = true;
            break;
          } catch (err: unknown) {
            lastErr = err;
            if (attempt < maxRetries - 1 && isRetryableError(err)) {
              const delayMs = 2000 * (attempt + 1);
              console.warn(
                `[epochService] autoRenewEpoch retry ${attempt + 1}/${maxRetries} agent=${reg.agent.onChainId} arena=${arenaOnChainId} in ${delayMs}ms:`,
                err instanceof Error ? err.message : err
              );
              await sleep(delayMs);
            } else {
              break;
            }
          }
        }

        if (sent) {
          await deps.prisma.epochRegistration.create({
            data: {
              epochId,
              agentId: reg.agentId,
              depositAmount: "0",
              feesPaid: "0",
              principalClaimed: false,
              rewardClaimed: false,
            },
          });
          renewed++;
          console.log(`[epochService] autoRenewEpoch agent=${reg.agent.onChainId} arena=${arenaOnChainId} epoch=${onChainEpochId}`);
        } else {
          skipped++;
          const reason = formatAutoRenewRevertReason(lastErr, reg.agent.onChainId, arenaOnChainId);
          console.warn(`[epochService] autoRenewEpoch failed agent=${reg.agent.onChainId} arena=${arenaOnChainId}:`, reason);
        }

        await sleep(500);
      } catch (err: unknown) {
        skipped++;
        const reason = formatAutoRenewRevertReason(err, reg.agent.onChainId, arenaOnChainId);
        console.warn(`[epochService] autoRenewEpoch failed agent=${reg.agent.onChainId} arena=${arenaOnChainId}:`, reason);
      }
    } else {
      // No operator wallet: create DB records only (for local dev)
      await deps.prisma.epochRegistration.create({
        data: {
          epochId,
          agentId: reg.agentId,
          depositAmount: "0",
          feesPaid: "0",
          principalClaimed: false,
          rewardClaimed: false,
        },
      });
      renewed++;
    }
  }

  return { renewed, skipped };
}

/**
 * Auto-renew agents for an epoch using on-chain registered agent IDs (source of truth).
 * Resolves agentOnChainIds to DB agents for credentials; only renews agents we have in DB.
 */
async function autoRenewAgentsForEpochFromOnChain(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  epochId: number,
  onChainEpochId: number,
  agentOnChainIds: number[]
): Promise<{ renewed: number; skipped: number }> {
  if (agentOnChainIds.length === 0) return { renewed: 0, skipped: 0 };

  const agents = await deps.prisma.agent.findMany({
    where: {
      onChainId: { in: agentOnChainIds },
      smartAccountAddress: { not: null },
      encryptedSignerKey: { not: null },
    },
    select: { id: true, onChainId: true, smartAccountAddress: true, encryptedSignerKey: true },
  });

  let renewed = 0;
  let skipped = 0;
  const walletClient = getWalletClient();

  for (const agent of agents) {
    const agentOnChainId = agent.onChainId;
    if (agentOnChainId == null || !agent.smartAccountAddress || !agent.encryptedSignerKey) {
      skipped++;
      continue;
    }

    const existing = await deps.prisma.epochRegistration.findUnique({
      where: { epochId_agentId: { epochId, agentId: agent.id } },
    });
    if (existing) {
      renewed++;
      continue;
    }

    if (walletClient) {
      const publicClient = getPublicClient();
      const account = walletClient.account;
      if (!account) continue;

      try {
        const agentWallet = agent.smartAccountAddress as `0x${string}`;
        const balance = await getMoltiBalance(agentWallet);
        if (balance < EPOCH_RENEWAL_FEE_WEI) {
          skipped++;
          console.warn(
            `[epochService] autoRenewEpoch skipped agent=${agentOnChainId} arena=${arenaOnChainId}: ` +
              `insufficient MOLTI (need ${formatEther(EPOCH_RENEWAL_FEE_WEI)}, have ${formatEther(balance)})`
          );
          continue;
        }

        const allowance = await publicClient.readContract({
          address: MOLTI_TOKEN_ADDRESS as `0x${string}`,
          abi: MOLTI_TOKEN_ABI,
          functionName: "allowance",
          args: [agentWallet, MOLTI_ARENA_ADDRESS as `0x${string}`],
        });
        if (allowance < EPOCH_RENEWAL_FEE_WEI) {
          const approved = await approveMoltiForArena({
            encryptedSignerKey: agent.encryptedSignerKey,
          });
          if (!approved) {
            skipped++;
            console.warn(
              `[epochService] autoRenewEpoch skipped agent=${agentOnChainId} arena=${arenaOnChainId}: MOLTI approval failed`
            );
            continue;
          }
        }

        await publicClient.simulateContract({
          address: MOLTI_ARENA_ADDRESS as `0x${string}`,
          abi: MOLTI_ARENA_ABI,
          functionName: "autoRenewEpoch",
          args: [BigInt(agentOnChainId), BigInt(arenaOnChainId), BigInt(onChainEpochId)],
          account,
        });

        const sendTx = () =>
          walletClient.sendTransaction({
            account: walletClient.account!,
            chain,
            to: MOLTI_ARENA_ADDRESS as `0x${string}`,
            data: encodeFunctionData({
              abi: MOLTI_ARENA_ABI,
              functionName: "autoRenewEpoch",
              args: [BigInt(agentOnChainId), BigInt(arenaOnChainId), BigInt(onChainEpochId)],
            }),
          });

        const maxRetries = 3;
        let sent = false;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            await sendTx();
            sent = true;
            break;
          } catch (err: unknown) {
            lastErr = err;
            if (attempt < maxRetries - 1 && isRetryableError(err)) {
              await sleep(2000 * (attempt + 1));
            } else break;
          }
        }

        if (sent) {
          await deps.prisma.epochRegistration.create({
            data: {
              epochId,
              agentId: agent.id,
              depositAmount: "0",
              feesPaid: "0",
              principalClaimed: false,
              rewardClaimed: false,
            },
          });
          renewed++;
          console.log(`[epochService] autoRenewEpoch agent=${agentOnChainId} arena=${arenaOnChainId} epoch=${onChainEpochId}`);
        } else {
          skipped++;
          const reason = formatAutoRenewRevertReason(lastErr, agentOnChainId, arenaOnChainId);
          console.warn(`[epochService] autoRenewEpoch failed agent=${agentOnChainId} arena=${arenaOnChainId}:`, reason);
        }
        await sleep(500);
      } catch (err: unknown) {
        skipped++;
        const reason = formatAutoRenewRevertReason(err, agentOnChainId, arenaOnChainId);
        console.warn(`[epochService] autoRenewEpoch failed agent=${agentOnChainId} arena=${arenaOnChainId}:`, reason);
      }
    } else {
      await deps.prisma.epochRegistration.create({
        data: {
          epochId,
          agentId: agent.id,
          depositAmount: "0",
          feesPaid: "0",
          principalClaimed: false,
          rewardClaimed: false,
        },
      });
      renewed++;
    }
  }

  return { renewed, skipped };
}

/** Final ranking entry (agentId = DB id, rank 1 = top). */
export interface FinalRankingEntry {
  agentId: number;
  rank: number;
  points: number;
}

/**
 * Get the final leaderboard for an arena+epoch (latest snapshot by tick).
 */
export async function getFinalRankings(
  deps: EpochServiceDeps,
  arenaId: number,
  epochId: number
): Promise<FinalRankingEntry[]> {
  const snapshot = await deps.prisma.leaderboardSnapshot.findFirst({
    where: { arenaId, epochId },
    orderBy: { tick: "desc" },
  });
  if (!snapshot) return [];
  const rankings = (snapshot.rankingsJson as Array<{ agentId: number; rank?: number; points?: number }>) ?? [];
  return rankings.map((r) => ({
    agentId: r.agentId,
    rank: r.rank ?? 0,
    points: r.points ?? 0,
  }));
}

const DEFAULT_WINNER_PCT = 0.3;

/**
 * Compute winner amounts: top winnerPct by rank, linear weights (rank 1 gets most).
 * Remainder wei assigned to rank 1 so total exactly equals poolWei.
 */
export function computeWinnerAmounts(
  poolWei: bigint,
  rankings: FinalRankingEntry[],
  winnerPct: number = DEFAULT_WINNER_PCT
): { agentId: number; amountWei: bigint }[] {
  if (rankings.length === 0 || poolWei === BigInt(0)) return [];
  const numWinners = Math.max(1, Math.ceil(winnerPct * rankings.length));
  const winners = rankings.slice(0, numWinners);
  const k = winners.length;
  const sumWeights = (k * (k + 1)) / 2;
  const amounts: bigint[] = [];
  let total = BigInt(0);
  for (let i = 0; i < k; i++) {
    const weight = k - i; // rank 1 -> k, rank k -> 1
    const amount = (poolWei * BigInt(weight)) / BigInt(sumWeights);
    amounts.push(amount);
    total += amount;
  }
  const remainder = poolWei - total;
  if (remainder > BigInt(0) && amounts.length > 0) {
    amounts[0] += remainder;
  }
  return winners.map((w, i) => ({ agentId: w.agentId, amountWei: amounts[i]! }));
}

/**
 * Distribute rewards for an ended epoch: one setPendingRewardsBatch call, then persist amounts and tx hash.
 * Idempotent: if rewardsDistributedAt is set, skips.
 */
export async function distributeRewardsForEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  epochId: number
): Promise<{ distributed: boolean; txHash?: string; error?: string }> {
  const epoch = await deps.prisma.epoch.findUnique({
    where: { id: epochId },
    include: { arena: { select: { id: true, onChainId: true } } },
  });
  if (!epoch || epoch.arenaId !== arenaId) {
    return { distributed: false, error: "Epoch not found or arena mismatch" };
  }
  if (epoch.rewardsDistributedAt != null) {
    return { distributed: false, error: "Already distributed" };
  }
  if (epoch.status !== "ended") {
    return { distributed: false, error: "Epoch not ended" };
  }
  const arenaOnChainId = epoch.arena.onChainId;
  const onChainEpochId = epoch.onChainEpochId ?? epochId;
  if (arenaOnChainId == null) {
    return { distributed: false, error: "Arena has no on-chain ID" };
  }

  const publicClient = getPublicClient();
  let rewardPoolWei: bigint;
  try {
    const ep = await publicClient.readContract({
      address: MOLTI_ARENA_ADDRESS as `0x${string}`,
      abi: MOLTI_ARENA_ABI,
      functionName: "epochs",
      args: [BigInt(arenaOnChainId), BigInt(onChainEpochId)],
    });
    rewardPoolWei = ep[2]; // rewardPoolWei is third field
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { distributed: false, error: `Failed to read reward pool: ${msg}` };
  }

  const rankings = await getFinalRankings(deps, arenaId, epochId);
  const winnerAmounts = computeWinnerAmounts(rewardPoolWei, rankings, DEFAULT_WINNER_PCT);
  if (winnerAmounts.length === 0) {
    await deps.prisma.epoch.update({
      where: { id: epochId },
      data: { rewardsDistributedAt: new Date(), distributionTxHash: null },
    });
    return { distributed: true };
  }

  const agents = await deps.prisma.agent.findMany({
    where: { id: { in: winnerAmounts.map((w) => w.agentId) } },
    select: { id: true, onChainId: true },
  });
  const agentIdToOnChain = new Map(agents.map((a) => [a.id, a.onChainId]));
  const onChainIds: number[] = [];
  const amountWeis: bigint[] = [];
  const sentWinnerAmounts: { agentId: number; amountWei: bigint }[] = [];
  for (const w of winnerAmounts) {
    const onChainId = agentIdToOnChain.get(w.agentId);
    if (onChainId == null) continue;
    onChainIds.push(onChainId);
    amountWeis.push(w.amountWei);
    sentWinnerAmounts.push({ agentId: w.agentId, amountWei: w.amountWei });
  }
  if (onChainIds.length === 0) {
    await deps.prisma.epoch.update({
      where: { id: epochId },
      data: { rewardsDistributedAt: new Date(), distributionTxHash: null },
    });
    return { distributed: true };
  }

  const walletClient = getWalletClient();
  if (!walletClient) {
    return { distributed: false, error: "No operator wallet (OPERATOR_PRIVATE_KEY)" };
  }
  try {
    const hash = await withRetry("setPendingRewardsBatch", () =>
      walletClient.sendTransaction({
        account: walletClient.account!,
        chain,
        to: MOLTI_ARENA_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: MOLTI_ARENA_ABI,
          functionName: "setPendingRewardsBatch",
          args: [
            BigInt(arenaOnChainId),
            BigInt(onChainEpochId),
            onChainIds.map((id) => BigInt(id)),
            amountWeis,
          ],
        }),
      })
    );
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    const txHash = receipt.transactionHash;

    for (const { agentId, amountWei } of sentWinnerAmounts) {
      await deps.prisma.epochRegistration.updateMany({
        where: { epochId, agentId },
        data: { pendingRewardAmountWei: amountWei.toString() },
      });
    }
    await deps.prisma.epoch.update({
      where: { id: epochId },
      data: { rewardsDistributedAt: new Date(), distributionTxHash: txHash },
    });
    console.log(
      `[epochService] setPendingRewardsBatch arena=${arenaOnChainId} epoch=${onChainEpochId} winners=${onChainIds.length} tx=${txHash}`
    );
    return { distributed: true, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { distributed: false, error: `setPendingRewardsBatch failed: ${msg}` };
  }
}

/**
 * End an epoch. Call contract endEpoch and update DB.
 * Idempotent: EpochAlreadyEnded is treated as success.
 */
export async function endEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  epochId: number,
  onChainEpochId: number
): Promise<void> {
  const walletClient = getWalletClient();
  if (walletClient) {
    try {
      await withRetry("endEpoch", () =>
        walletClient.sendTransaction({
          account: walletClient.account!,
          chain,
          to: MOLTI_ARENA_ADDRESS as `0x${string}`,
          data: encodeFunctionData({
            abi: MOLTI_ARENA_ABI,
            functionName: "endEpoch",
            args: [BigInt(arenaOnChainId), BigInt(onChainEpochId)],
          }),
        })
      );
      console.log(`[epochService] endEpoch arena=${arenaOnChainId} epochId=${onChainEpochId}`);
    } catch (err) {
      const data = getRevertDataFromError(err);
      if (data) {
        try {
          const decoded = decodeErrorResult({ abi: MOLTI_ARENA_ABI, data });
          if (decoded.errorName === "EpochAlreadyEnded") {
            console.log(`[epochService] endEpoch already ended arena=${arenaOnChainId} epochId=${onChainEpochId}`);
          } else {
            console.error(
              `[epochService] endEpoch reverted: ${decoded.errorName}(${[...decoded.args].join(", ")})`
            );
            throw err;
          }
        } catch (decodeErr) {
          if (decodeErr !== err) throw decodeErr;
          console.error("[epochService] endEpoch on-chain failed:", err);
          throw err;
        }
      } else {
        console.error(
          "[epochService] endEpoch on-chain failed (no revert data; RPC may not return it):",
          err instanceof Error ? err.message : err
        );
        throw err;
      }
    }
  }

  await deps.prisma.epoch.update({
    where: { id: epochId },
    data: { status: "ended" },
  });
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sweep unclaimed rewards for an epoch (only when claim window has passed: 30 days after end).
 * Idempotent: if rewardsSweptAt is set, skips.
 */
export async function sweepUnclaimedForEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  epochId: number
): Promise<{ swept: boolean; txHash?: string; error?: string }> {
  const epoch = await deps.prisma.epoch.findUnique({
    where: { id: epochId },
    include: { arena: { select: { onChainId: true } } },
  });
  if (!epoch || epoch.arenaId !== arenaId) {
    return { swept: false, error: "Epoch not found or arena mismatch" };
  }
  if (epoch.rewardsSweptAt != null) {
    return { swept: false, error: "Already swept" };
  }
  if (epoch.status !== "ended") {
    return { swept: false, error: "Epoch not ended" };
  }
  const claimWindowEnd = epoch.endAt.getTime() + THIRTY_DAYS_MS;
  if (Date.now() < claimWindowEnd) {
    return { swept: false, error: "Claim window not ended (30 days after epoch end)" };
  }
  const arenaOnChainId = epoch.arena.onChainId;
  const onChainEpochId = epoch.onChainEpochId ?? epochId;
  if (arenaOnChainId == null) {
    return { swept: false, error: "Arena has no on-chain ID" };
  }

  const regs = await deps.prisma.epochRegistration.findMany({
    where: { epochId, pendingRewardAmountWei: { not: null } },
    include: { agent: { select: { onChainId: true } } },
  });
  const agentIds = regs
    .map((r) => r.agent.onChainId)
    .filter((id): id is number => id != null);
  if (agentIds.length === 0) {
    await deps.prisma.epoch.update({
      where: { id: epochId },
      data: { rewardsSweptAt: new Date() },
    });
    return { swept: true };
  }

  const walletClient = getWalletClient();
  if (!walletClient) {
    return { swept: false, error: "No operator wallet (OPERATOR_PRIVATE_KEY)" };
  }
  const publicClient = getPublicClient();
  try {
    const hash = await withRetry("sweepUnclaimedRewards", () =>
      walletClient.sendTransaction({
        account: walletClient.account!,
        chain,
        to: MOLTI_ARENA_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: MOLTI_ARENA_ABI,
          functionName: "sweepUnclaimedRewards",
          args: [
            BigInt(arenaOnChainId),
            BigInt(onChainEpochId),
            agentIds.map((id) => BigInt(id)),
          ],
        }),
      })
    );
    const receipt = await publicClient!.waitForTransactionReceipt({ hash });
    await deps.prisma.epoch.update({
      where: { id: epochId },
      data: { rewardsSweptAt: new Date() },
    });
    console.log(
      `[epochService] sweepUnclaimedRewards arena=${arenaOnChainId} epoch=${onChainEpochId} tx=${receipt.transactionHash}`
    );
    return { swept: true, txHash: receipt.transactionHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { swept: false, error: `sweepUnclaimedRewards failed: ${msg}` };
  }
}

/**
 * Read pending reward for (agent, arena, epoch) from the contract. Returns "0" if not on-chain or error.
 */
export async function getPendingRewardFromContract(
  agentOnChainId: number,
  arenaOnChainId: number,
  epochOnChainId: number
): Promise<string> {
  const publicClient = getPublicClient();
  try {
    const wei = await publicClient.readContract({
      address: MOLTI_ARENA_ADDRESS as `0x${string}`,
      abi: MOLTI_ARENA_ABI,
      functionName: "getPendingReward",
      args: [BigInt(agentOnChainId), BigInt(arenaOnChainId), BigInt(epochOnChainId)],
    });
    return wei.toString();
  } catch {
    return "0";
  }
}

/**
 * Get the current (active) epoch for an arena.
 */
export async function getCurrentEpoch(
  deps: EpochServiceDeps,
  arenaId: number
): Promise<EpochInfo | null> {
  const now = new Date();
  const epoch = await deps.prisma.epoch.findFirst({
    where: {
      arenaId,
      status: "active",
      startAt: { lte: now },
      endAt: { gt: now },
    },
    orderBy: { startAt: "desc" },
  });
  return epoch as EpochInfo | null;
}

/**
 * Get the latest epoch for an arena (active or ended).
 */
export async function getLatestEpoch(
  deps: EpochServiceDeps,
  arenaId: number
): Promise<EpochInfo | null> {
  const epoch = await deps.prisma.epoch.findFirst({
    where: { arenaId },
    orderBy: { startAt: "desc" },
  });
  return epoch as EpochInfo | null;
}

/**
 * Find or create a DB Epoch row for an on-chain epoch (source of truth: contract).
 * Used when we end an epoch we only know from chain (e.g. toEnd from getEpochPhaseOnChain).
 */
async function ensureEpochRowForOnChainEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  onChainEpochId: number,
  status: "active" | "ended"
): Promise<{ id: number; onChainEpochId: number }> {
  const existing = await deps.prisma.epoch.findFirst({
    where: { arenaId, onChainEpochId },
  });
  if (existing) return { id: existing.id, onChainEpochId: existing.onChainEpochId ?? onChainEpochId };

  const ep = await getEpochOnChain(arenaOnChainId, onChainEpochId);
  const startAt = new Date(ep.startTime * 1000);
  const endAt = new Date(ep.endTime * 1000);
  const created = await deps.prisma.epoch.create({
    data: {
      arenaId,
      onChainEpochId,
      startAt,
      endAt,
      status,
      rewardPoolAmount: null,
      burnedAmount: null,
    },
  });
  return { id: created.id, onChainEpochId: created.onChainEpochId ?? onChainEpochId };
}

let _lastEpochTransitionDate: string | null = null;
let _transitionInProgress = false;

/**
 * Run epoch transition: end current epoch, start next, auto-renew agents.
 * Called by cron at 00:00 UTC (or every minute in demo mode when EPOCH_DURATION_MINUTES < 1440).
 * @param force If true, run even if already ran today (for manual trigger or demo).
 */
export async function runEpochTransition(
  deps: EpochServiceDeps,
  force = false
): Promise<void> {
  if (_transitionInProgress) {
    console.log("[epochService] runEpochTransition skipped (previous run still in progress)");
    return;
  }
  _transitionInProgress = true;
  try {
    const today = todayUtc();
    if (!IS_DEMO_EPOCH && !force && _lastEpochTransitionDate === today) {
      console.log(`[epochService] runEpochTransition skipped (already ran today=${today})`);
      return;
    }
    _lastEpochTransitionDate = today;

    const arenas = await deps.prisma.arena.findMany({
      where: { onChainId: { not: null } },
      select: { id: true, onChainId: true },
    });

    console.log(
      `[epochService] runEpochTransition started ${IS_DEMO_EPOCH ? `(demo ${EPOCH_DURATION_MINUTES}min)` : `date=${today}`} arenas=${arenas.length}`
    );

    for (const arena of arenas) {
      const arenaOnChainId = arena.onChainId;
      if (arenaOnChainId == null) continue;

      try {
        if (IS_DEMO_EPOCH) {
          await runEpochTransitionDemo(deps, arena.id, arenaOnChainId);
        } else {
          await runEpochTransitionDaily(deps, arena.id, arenaOnChainId, today);
        }
        console.log(
          `[epochService] Transition complete arena=${arena.id} (on-chain #${arenaOnChainId})`
        );
      } catch (err) {
        console.error(`[epochService] Transition failed arena=${arena.id}:`, err);
      }
    }
  } finally {
    _transitionInProgress = false;
  }
}

/** Demo mode: end current epoch if endAt < now, then start new short epoch. Uses on-chain as source of truth. */
async function runEpochTransitionDemo(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const phase = await getEpochPhaseOnChain(arenaOnChainId, nowSec);

  if (phase.toEnd != null) {
    const dbEpoch = await ensureEpochRowForOnChainEpoch(
      deps,
      arenaId,
      arenaOnChainId,
      phase.toEnd,
      "ended"
    );
    await endEpoch(deps, arenaId, arenaOnChainId, dbEpoch.id, phase.toEnd);
    try {
      const dist = await distributeRewardsForEpoch(deps, arenaId, dbEpoch.id);
      if (dist.error && !dist.distributed) {
        console.warn(`[epochService] distributeRewardsForEpoch arena=${arenaId} epoch=${dbEpoch.id}:`, dist.error);
      }
    } catch (err) {
      console.warn("[epochService] distributeRewardsForEpoch failed:", err);
    }
  }

  const needNewEpoch = phase.active == null;
  if (needNewEpoch) {
    const nextId = await getNextEpochId(arenaOnChainId);
    if (nextId > 0) {
      const prev = await getEpochOnChain(arenaOnChainId, nextId - 1);
      if (!prev.ended) {
        const endTimeMs = prev.endTime != null && Number.isFinite(prev.endTime) ? prev.endTime * 1000 : NaN;
        const endStr = Number.isFinite(endTimeMs) ? new Date(endTimeMs).toISOString() : "?";
        console.log(
          `[epochService] Skip new epoch arena=${arenaId}: previous epoch ${nextId - 1} not ended yet (end in ${endStr})`
        );
        return;
      }
    }
    const registeredCount = await getRegisteredAgentCountOnChain(arenaOnChainId);
    if (registeredCount === 0) {
      console.log(`[epochService] Skip new epoch arena=${arenaId}: no agents registered (on-chain)`);
      return;
    }
    const { startAt, endAt } = getEpochBoundsDemo();
    const newEpoch = await startEpoch(
      deps,
      arenaId,
      arenaOnChainId,
      todayUtc(),
      { startAt, endAt }
    );
    const onChainId = newEpoch.onChainEpochId;
    if (onChainId != null) {
      const { agentIds, renewedForEpoch } = await getAgentsInArenaWithRenewal(arenaOnChainId, onChainId);
      const toRenew = agentIds.filter((_, i) => !renewedForEpoch[i]);
      await autoRenewAgentsForEpochFromOnChain(
        deps,
        arenaId,
        arenaOnChainId,
        newEpoch.id,
        onChainId,
        toRenew
      );
    }
  }
}

/** Daily mode: end previous day's epoch (from chain), start today's, auto-renew. Uses on-chain as source of truth. */
async function runEpochTransitionDaily(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  today: string
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const phase = await getEpochPhaseOnChain(arenaOnChainId, nowSec);

  if (phase.toEnd != null) {
    const dbEpoch = await ensureEpochRowForOnChainEpoch(
      deps,
      arenaId,
      arenaOnChainId,
      phase.toEnd,
      "ended"
    );
    await endEpoch(deps, arenaId, arenaOnChainId, dbEpoch.id, phase.toEnd);
    try {
      const dist = await distributeRewardsForEpoch(deps, arenaId, dbEpoch.id);
      if (dist.error && !dist.distributed) {
        console.warn(`[epochService] distributeRewardsForEpoch arena=${arenaId} epoch=${dbEpoch.id}:`, dist.error);
      }
    } catch (err) {
      console.warn("[epochService] distributeRewardsForEpoch failed:", err);
    }
  }

  const nextId = await getNextEpochId(arenaOnChainId);
  if (nextId > 0) {
    const prev = await getEpochOnChain(arenaOnChainId, nextId - 1);
    if (!prev.ended) {
      console.log(
        `[epochService] Skip new epoch arena=${arenaId}: previous epoch ${nextId - 1} not ended yet`
      );
      return;
    }
  }
  const registeredCount = await getRegisteredAgentCountOnChain(arenaOnChainId);
  if (registeredCount === 0) {
    console.log(`[epochService] Skip new epoch arena=${arenaId}: no agents registered (on-chain)`);
    return;
  }

  const newEpoch = await startEpoch(deps, arenaId, arenaOnChainId, today);
  const onChainId = newEpoch.onChainEpochId;
  if (onChainId == null) {
    console.warn(
      `[epochService] Skipping auto-renew arena=${arenaId} (on-chain #${arenaOnChainId}): ` +
        `epoch ${newEpoch.id} has no on-chain epoch ID (createEpoch may have failed)`
    );
  } else {
    const { agentIds, renewedForEpoch } = await getAgentsInArenaWithRenewal(arenaOnChainId, onChainId);
    const toRenew = agentIds.filter((_, i) => !renewedForEpoch[i]);
    await autoRenewAgentsForEpochFromOnChain(
      deps,
      arenaId,
      arenaOnChainId,
      newEpoch.id,
      onChainId,
      toRenew
    );
  }
}

/**
 * Start the epoch scheduler. Checks every minute; runs transition at 00:00 UTC (or every minute in demo mode).
 */
export function startEpochScheduler(deps: EpochServiceDeps): { stop: () => void } {
  const intervalMs = 60 * 1000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const check = (): void => {
    if (IS_DEMO_EPOCH) {
      runEpochTransition(deps, true).catch((err) =>
        console.error("[epochService] runEpochTransition error:", err)
      );
    } else {
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      if (hour === 0 && minute < 2) {
        runEpochTransition(deps).catch((err) =>
          console.error("[epochService] runEpochTransition error:", err)
        );
      }
    }
    timeoutId = setTimeout(check, intervalMs);
  };

  timeoutId = setTimeout(check, intervalMs);
  console.log(
    IS_DEMO_EPOCH
      ? `[epochService] Epoch scheduler started (demo: every ${intervalMs / 1000}s, ${EPOCH_DURATION_MINUTES}min epochs)`
      : "[epochService] Epoch scheduler started (00:00 UTC daily)"
  );

  return {
    stop() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    },
  };
}
