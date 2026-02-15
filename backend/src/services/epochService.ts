/**
 * Epoch Service
 *
 * Manages 24h epochs per arena: create, auto-renew agents, end.
 * Epoch boundaries: 00:00 UTC daily.
 * Uses operator wallet to call contract: createEpoch, autoRenewEpoch, endEpoch, setPendingReward.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeErrorResult,
  formatEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MOLTI_ARENA_ADDRESS, MOLTI_ARENA_ABI, MOLTI_TOKEN_ADDRESS, MOLTI_TOKEN_ABI } from "../contracts/abis.js";
import { approveMoltiForArena } from "./smartAccount.js";

const MONAD_TESTNET_CHAIN_ID = 10143;
const MONAD_TESTNET_RPC =
  process.env.INDEXER_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const EPOCH_RENEWAL_FEE_WEI = BigInt(Number(process.env.EPOCH_RENEWAL_FEE_MOLTI) || 100) * BigInt(1e18);

const monadTestnet = {
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_TESTNET_RPC] },
  },
} as const;

let _publicClient: ReturnType<typeof createPublicClient> | null = null;
let _walletClient: ReturnType<typeof createWalletClient> | null = null;

function getPublicClient() {
  _publicClient ??= createPublicClient({
    chain: monadTestnet,
    transport: http(MONAD_TESTNET_RPC),
  });
  return _publicClient;
}

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
    chain: monadTestnet,
    transport: http(MONAD_TESTNET_RPC),
  });
  return _walletClient;
}

/** Whether an error is transient and worth retrying (network, nonce, priority). */
function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const s = msg.toLowerCase();
  return (
    s.includes("existing transaction had higher priority") ||
    s.includes("nonce") ||
    s.includes("replacement transaction") ||
    s.includes("internal error") ||
    s.includes("timeout") ||
    s.includes("econnreset") ||
    s.includes("econnrefused") ||
    s.includes("network")
  );
}

/** Sleep for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format autoRenewEpoch revert reason for logging. */
function formatAutoRenewRevertReason(
  err: unknown,
  agentOnChainId: number,
  arenaOnChainId: number
): string {
  const msg = err instanceof Error ? err.message : String(err);

  // Try to extract revert data from viem error (ContractFunctionRevertedError)
  let data: Hex | undefined;
  const errObj = err as { data?: Hex; cause?: { data?: Hex }; details?: unknown };
  if (typeof errObj?.data === "string" && errObj.data.startsWith("0x")) {
    data = errObj.data as Hex;
  } else if (typeof errObj?.cause?.data === "string" && errObj.cause.data.startsWith("0x")) {
    data = errObj.cause.data as Hex;
  } else if (typeof (errObj?.details as { data?: string })?.data === "string") {
    data = (errObj.details as { data: string }).data as Hex;
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
 * @param utcDateStr UTC date string (YYYY-MM-DD).
 */
export async function startEpoch(
  deps: EpochServiceDeps,
  arenaId: number,
  arenaOnChainId: number,
  utcDateStr: string
): Promise<EpochInfo> {
  const { startAt, endAt } = getEpochBounds(utcDateStr);

  const existing = await deps.prisma.epoch.findFirst({
    where: { arenaId, startAt },
  });
  if (existing) {
    return existing as EpochInfo;
  }

  const startSec = Math.floor(startAt.getTime() / 1000);
  const endSec = Math.floor(endAt.getTime() / 1000);

  let onChainEpochId: number | undefined;
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  if (walletClient && publicClient) {
    try {
      const hash = await walletClient.sendTransaction({
        to: MOLTI_ARENA_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: MOLTI_ARENA_ABI,
          functionName: "createEpoch",
          args: [BigInt(arenaOnChainId), BigInt(startSec), BigInt(endSec)],
        }),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        const nextId = await publicClient.readContract({
          address: MOLTI_ARENA_ADDRESS as `0x${string}`,
          abi: MOLTI_ARENA_ABI,
          functionName: "nextEpochId",
          args: [BigInt(arenaOnChainId)],
        });
        onChainEpochId = Number(nextId) - 1;
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

        await publicClient.simulateContract({
          address: MOLTI_ARENA_ADDRESS as `0x${string}`,
          abi: MOLTI_ARENA_ABI,
          functionName: "autoRenewEpoch",
          args: [BigInt(reg.agent.onChainId), BigInt(arenaOnChainId), BigInt(onChainEpochId)],
          account,
        });

        const sendTx = () =>
          walletClient.sendTransaction({
            to: MOLTI_ARENA_ADDRESS as `0x${string}`,
            data: encodeFunctionData({
              abi: MOLTI_ARENA_ABI,
              functionName: "autoRenewEpoch",
              args: [BigInt(reg.agent.onChainId), BigInt(arenaOnChainId), BigInt(onChainEpochId)],
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
 * End an epoch. Call contract endEpoch and update DB.
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
      await walletClient.sendTransaction({
        to: MOLTI_ARENA_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: MOLTI_ARENA_ABI,
          functionName: "endEpoch",
          args: [BigInt(arenaOnChainId), BigInt(onChainEpochId)],
        }),
      });
      console.log(`[epochService] endEpoch arena=${arenaOnChainId} epochId=${onChainEpochId}`);
    } catch (err) {
      console.error("[epochService] endEpoch on-chain failed:", err);
    }
  }

  await deps.prisma.epoch.update({
    where: { id: epochId },
    data: { status: "ended" },
  });
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

let _lastEpochTransitionDate: string | null = null;

/**
 * Run epoch transition: end current epoch, start next, auto-renew agents.
 * Called by cron at 00:00 UTC.
 */
export async function runEpochTransition(deps: EpochServiceDeps): Promise<void> {
  const today = todayUtc();
  if (_lastEpochTransitionDate === today) return;
  _lastEpochTransitionDate = today;

  const arenas = await deps.prisma.arena.findMany({
    where: { onChainId: { not: null } },
    select: { id: true, onChainId: true },
  });

  for (const arena of arenas) {
    const arenaOnChainId = arena.onChainId;
    if (arenaOnChainId == null) continue;

    try {
      const previousDay = new Date(today);
      previousDay.setUTCDate(previousDay.getUTCDate() - 1);
      const prevDateStr = previousDay.toISOString().slice(0, 10);

      const prevEpoch = await deps.prisma.epoch.findFirst({
        where: {
          arenaId: arena.id,
          status: "active",
          startAt: { lte: new Date(`${prevDateStr}T00:00:00.000Z`) },
        },
        orderBy: { startAt: "desc" },
      });

      if (prevEpoch && prevEpoch.status === "active") {
        const prevOnChainId = prevEpoch.onChainEpochId ?? prevEpoch.id;
        await endEpoch(
          deps,
          arena.id,
          arenaOnChainId,
          prevEpoch.id,
          prevOnChainId
        );
      }

      const newEpoch = await startEpoch(deps, arena.id, arenaOnChainId, today);
      const onChainId = newEpoch.onChainEpochId;
      if (onChainId == null) {
        console.warn(
          `[epochService] Skipping auto-renew arena=${arena.id} (on-chain #${arenaOnChainId}): ` +
            `epoch ${newEpoch.id} has no on-chain epoch ID (createEpoch may have failed)`
        );
      } else {
        await autoRenewAgentsForEpoch(
          deps,
          arena.id,
          arenaOnChainId,
          newEpoch.id,
          onChainId
        );
      }

      console.log(
        `[epochService] Transition complete arena=${arena.id} (on-chain #${arenaOnChainId}) date=${today}`
      );
    } catch (err) {
      console.error(`[epochService] Transition failed arena=${arena.id}:`, err);
    }
  }
}

/**
 * Start the epoch scheduler. Checks every minute; runs transition at 00:00 UTC.
 */
export function startEpochScheduler(deps: EpochServiceDeps): { stop: () => void } {
  const intervalMs = 60 * 1000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const check = (): void => {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    if (hour === 0 && minute < 2) {
      runEpochTransition(deps).catch((err) =>
        console.error("[epochService] runEpochTransition error:", err)
      );
    }
    timeoutId = setTimeout(check, intervalMs);
  };

  timeoutId = setTimeout(check, intervalMs);
  console.log("[epochService] Epoch scheduler started (00:00 UTC daily)");

  return {
    stop() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    },
  };
}
