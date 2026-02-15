/**
 * On-chain data reader. Source of truth for epochs, registrations, etc.
 * All decisions (should we end epoch? create new? who is registered?) use these reads.
 */
import { getPublicClient } from "../chains.js";
import { MOLTI_ARENA_ADDRESS, MOLTI_ARENA_ABI } from "../contracts/abis.js";

/** Next epoch ID for arena (0 = no epochs yet). */
export async function getNextEpochId(arenaOnChainId: number): Promise<number> {
  const next = await getPublicClient().readContract({
    address: MOLTI_ARENA_ADDRESS as `0x${string}`,
    abi: MOLTI_ARENA_ABI,
    functionName: "nextEpochId",
    args: [BigInt(arenaOnChainId)],
  });
  return Number(next);
}

/** Epoch info from contract: [startTime, endTime, rewardPoolWei, burnedWei, ended]. */
export async function getEpochOnChain(
  arenaOnChainId: number,
  epochId: number
): Promise<{ startTime: number; endTime: number; ended: boolean }> {
  const ep = await getPublicClient().readContract({
    address: MOLTI_ARENA_ADDRESS as `0x${string}`,
    abi: MOLTI_ARENA_ABI,
    functionName: "epochs",
    args: [BigInt(arenaOnChainId), BigInt(epochId)],
  });
  // viem returns a tuple: [startTime, endTime, rewardPoolWei, burnedWei, ended]
  const startTime = Number(ep[0] ?? 0);
  const endTime = Number(ep[1] ?? 0);
  const ended = Boolean(ep[4]);
  return { startTime, endTime, ended };
}

/** Whether an agent is registered in an arena (on-chain). */
export async function isRegisteredOnChain(
  agentOnChainId: number,
  arenaOnChainId: number
): Promise<boolean> {
  return getPublicClient().readContract({
    address: MOLTI_ARENA_ADDRESS as `0x${string}`,
    abi: MOLTI_ARENA_ABI,
    functionName: "isRegistered",
    args: [BigInt(agentOnChainId), BigInt(arenaOnChainId)],
  });
}

/** Next agent ID (agents use IDs 1 .. nextAgentId-1). */
export async function getNextAgentId(): Promise<number> {
  const next = await getPublicClient().readContract({
    address: MOLTI_ARENA_ADDRESS as `0x${string}`,
    abi: MOLTI_ARENA_ABI,
    functionName: "nextAgentId",
    args: [],
  });
  return Number(next);
}

/**
 * All agents in an arena and whether each has renewed for an epoch (one RPC call).
 * Uses contract getAgentsInArenaWithRenewal(arenaId, epochId).
 */
export async function getAgentsInArenaWithRenewal(
  arenaOnChainId: number,
  epochId: number
): Promise<{ agentIds: number[]; renewedForEpoch: boolean[] }> {
  const [agentIds, renewedForEpoch] = await getPublicClient().readContract({
    address: MOLTI_ARENA_ADDRESS as `0x${string}`,
    abi: MOLTI_ARENA_ABI,
    functionName: "getAgentsInArenaWithRenewal",
    args: [BigInt(arenaOnChainId), BigInt(epochId)],
  });
  return {
    agentIds: agentIds.map((id) => Number(id)),
    renewedForEpoch: [...renewedForEpoch],
  };
}

/**
 * Count agents registered in arena (on-chain). One RPC via getAgentsInArenaWithRenewal.
 */
export async function getRegisteredAgentCountOnChain(
  arenaOnChainId: number
): Promise<number> {
  const { agentIds } = await getAgentsInArenaWithRenewal(arenaOnChainId, 0);
  return agentIds.length;
}

export type EpochPhase = {
  /** Epoch ID that should be ended (endTime <= now, !ended). At most one. */
  toEnd: number | null;
  /** Epoch ID that is currently active (startTime <= now < endTime, !ended). At most one. */
  active: number | null;
};

/**
 * Scan on-chain epochs for arena and return which (if any) to end and which is active.
 * Uses contract as source of truth. Sequential readContract (no multicall3 on Monad Testnet).
 */
export async function getEpochPhaseOnChain(
  arenaOnChainId: number,
  nowSec: number
): Promise<EpochPhase> {
  const next = await getNextEpochId(arenaOnChainId);
  if (next === 0) return { toEnd: null, active: null };

  let toEnd: number | null = null;
  let active: number | null = null;
  for (let epochId = 0; epochId < next; epochId++) {
    const ep = await getEpochOnChain(arenaOnChainId, epochId);
    const { startTime, endTime, ended } = ep;
    if (startTime === 0) continue; // not created
    if (!ended && endTime <= nowSec) {
      if (toEnd == null || epochId > toEnd) toEnd = epochId;
    }
    if (!ended && startTime <= nowSec && endTime > nowSec) {
      active = epochId;
    }
  }
  return { toEnd, active };
}

/**
 * List agent on-chain IDs registered in the arena (on-chain). One RPC via getAgentsInArenaWithRenewal.
 */
export async function getRegisteredAgentIdsOnChain(
  arenaOnChainId: number
): Promise<number[]> {
  const { agentIds } = await getAgentsInArenaWithRenewal(arenaOnChainId, 0);
  return agentIds;
}
