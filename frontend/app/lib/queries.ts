"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useCallback } from "react";
import {
  createAgent,
  fetchAgent,
  fetchArena,
  fetchAgents,
  fetchArenas,
  fetchLeaderboard,
  fetchMyAgents,
  fetchTrades,
  fetchTokenTrades,
  fetchEquityHistory,
  fetchAgentTrades,
  fetchAgentStats,
  fetchAgentDecisions,
  fetchAgentMemory,
  registerArena,
  type CreateAgentBody,
  type LeaderboardResponse,
  type RegisterArenaBody,
  type TradesResponse,
} from "./api";

/** Query key factory for consistent keys and deduplication */
export const queryKeys = {
  all: ["moltiarena"] as const,
  arenas: () => [...queryKeys.all, "arenas"] as const,
  arena: (id: number | null) => [...queryKeys.all, "arena", id] as const,
  leaderboard: (arenaId: number, epochId?: number) =>
    [...queryKeys.arena(arenaId), "leaderboard", epochId ?? "latest"] as const,
  trades: (arenaId: number) => [...queryKeys.arena(arenaId), "trades"] as const,
  tokenTrades: (arenaId: number) =>
    [...queryKeys.arena(arenaId), "tokenTrades"] as const,
  agents: () => [...queryKeys.all, "agents"] as const,
  agent: (id: number) => [...queryKeys.all, "agent", id] as const,
  agentEquity: (id: number) => [...queryKeys.all, "agent", id, "equity"] as const,
  agentTrades: (id: number) => [...queryKeys.all, "agent", id, "trades"] as const,
  agentStats: (id: number) => [...queryKeys.all, "agent", id, "stats"] as const,
  agentDecisions: (id: number, page?: number, limit?: number) =>
    [...queryKeys.all, "agent", id, "decisions", page ?? 1, limit ?? 20] as const,
  agentMemory: (id: number) => [...queryKeys.all, "agent", id, "memory"] as const,
  myAgents: (owner: string) => [...queryKeys.all, "myAgents", owner] as const,
};

/**
 * Short stale time for list queries — data is treated as fresh for only 5 seconds
 * so navigating back to a page after a mutation shows updated data almost immediately.
 */
const STALE_TIME_MS = 5_000;

/** Live data (leaderboard, trades) polls every 30s for a snappier feel */
const LIVE_POLL_INTERVAL_MS = 30_000;

// ─── Arenas ──────────────────────────────────────────────────────────

export function useArenas(
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof fetchArenas>>>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: queryKeys.arenas(),
    queryFn: () => fetchArenas(),
    staleTime: STALE_TIME_MS,
    ...options,
  });
}

export function useArena(
  arenaId: number | null,
  initialData?: Awaited<ReturnType<typeof fetchArena>>,
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof fetchArena>>>,
    "queryKey" | "queryFn" | "initialData"
  >
) {
  return useQuery({
    queryKey: queryKeys.arena(arenaId ?? 0),
    queryFn: () => fetchArena(arenaId!),
    enabled: arenaId !== null,
    staleTime: STALE_TIME_MS,
    initialData,
    ...options,
  });
}

// ─── Agents ──────────────────────────────────────────────────────────

export function useAgents(
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof fetchAgents>>>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: () => fetchAgents(),
    staleTime: STALE_TIME_MS,
    ...options,
  });
}

export function useMyAgents(ownerAddress: string | undefined) {
  return useQuery({
    queryKey: queryKeys.myAgents(ownerAddress ?? ""),
    queryFn: () => fetchMyAgents(ownerAddress!),
    enabled: !!ownerAddress,
    staleTime: STALE_TIME_MS,
  });
}

export function useAgent(
  agentId: number | null,
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof fetchAgent>>>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: queryKeys.agent(agentId ?? 0),
    queryFn: () => fetchAgent(agentId!),
    enabled: Number.isInteger(agentId) && (agentId ?? 0) > 0,
    staleTime: STALE_TIME_MS,
    ...options,
  });
}

export function useAgentEquityHistory(agentId: number | null) {
  return useQuery({
    queryKey: queryKeys.agentEquity(agentId ?? 0),
    queryFn: () => fetchEquityHistory(agentId!),
    enabled: Number.isInteger(agentId) && (agentId ?? 0) > 0,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: STALE_TIME_MS,
  });
}

export function useAgentTrades(agentId: number | null) {
  return useQuery({
    queryKey: queryKeys.agentTrades(agentId ?? 0),
    queryFn: () => fetchAgentTrades(agentId!),
    enabled: Number.isInteger(agentId) && (agentId ?? 0) > 0,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: STALE_TIME_MS,
  });
}

export function useAgentStats(agentId: number | null) {
  return useQuery({
    queryKey: queryKeys.agentStats(agentId ?? 0),
    queryFn: () => fetchAgentStats(agentId!),
    enabled: Number.isInteger(agentId) && (agentId ?? 0) > 0,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: STALE_TIME_MS,
  });
}

export function useAgentDecisions(
  agentId: number | null,
  page = 1,
  limit = 20
) {
  return useQuery({
    queryKey: queryKeys.agentDecisions(agentId ?? 0, page, limit),
    queryFn: () => fetchAgentDecisions(agentId!, page, limit),
    enabled: Number.isInteger(agentId) && (agentId ?? 0) > 0,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: STALE_TIME_MS,
  });
}

export function useAgentMemory(agentId: number | null) {
  return useQuery({
    queryKey: queryKeys.agentMemory(agentId ?? 0),
    queryFn: () => fetchAgentMemory(agentId!),
    enabled: Number.isInteger(agentId) && (agentId ?? 0) > 0,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: STALE_TIME_MS,
  });
}

// ─── Live data (polling) ─────────────────────────────────────────────

export function useLeaderboard(
  arenaId: number | null,
  initialData?: LeaderboardResponse,
  options?: Omit<
    UseQueryOptions<LeaderboardResponse>,
    "queryKey" | "queryFn" | "initialData"
  > & { epochId?: number }
) {
  const { epochId, ...rest } = options ?? {};
  return useQuery({
    queryKey: queryKeys.leaderboard(arenaId ?? 0, epochId),
    queryFn: () => fetchLeaderboard(arenaId!, epochId),
    enabled: Number.isInteger(arenaId) && (arenaId ?? 0) > 0,
    initialData: initialData ?? undefined,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: 0,
    ...rest,
  });
}

export function useTrades(
  arenaId: number | null,
  initialData?: TradesResponse,
  options?: Omit<
    UseQueryOptions<TradesResponse>,
    "queryKey" | "queryFn" | "initialData"
  >
) {
  return useQuery({
    queryKey: queryKeys.trades(arenaId ?? 0),
    queryFn: () => fetchTrades(arenaId!),
    enabled: Number.isInteger(arenaId) && (arenaId ?? 0) > 0,
    initialData: initialData ?? undefined,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: 0,
    ...options,
  });
}

export function useTokenTrades(arenaId: number | null) {
  return useQuery({
    queryKey: queryKeys.tokenTrades(arenaId ?? 0),
    queryFn: () => fetchTokenTrades(arenaId!),
    enabled: Number.isInteger(arenaId) && (arenaId ?? 0) > 0,
    refetchInterval: LIVE_POLL_INTERVAL_MS,
    staleTime: 0,
  });
}

// ─── Invalidation helpers ────────────────────────────────────────────

/**
 * Hook that returns helpers to invalidate groups of queries after mutations.
 * Call the relevant function after a successful transaction.
 */
export function useInvalidateQueries() {
  const queryClient = useQueryClient();

  /** After creating a new agent */
  const afterAgentCreated = useCallback(
    (ownerAddress?: string) => {
      const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
        if (ownerAddress) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.myAgents(ownerAddress),
          });
        }
      };
      invalidateAll();
      setTimeout(invalidateAll, 2000);
    },
    [queryClient],
  );

  /** After registering an agent to an arena */
  const afterRegistration = useCallback(
    (arenaId: number, agentId: number, ownerAddress?: string) => {
      const invalidateAll = () => {
        // Arena-side: leaderboard, arena detail, arenas list
        queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(arenaId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.trades(arenaId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.arena(arenaId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.arenas() });
        // Agent-side: agent detail, agents list
        queryClient.invalidateQueries({ queryKey: queryKeys.agent(agentId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
        if (ownerAddress) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.myAgents(ownerAddress),
          });
        }
      };

      // Immediate invalidation
      invalidateAll();
      // Re-invalidate after a short delay to give the backend indexer time to process the event
      setTimeout(invalidateAll, 2000);
      setTimeout(invalidateAll, 5000);
    },
    [queryClient],
  );

  /** After activating an arena on-chain */
  const afterArenaActivated = useCallback(
    (arenaId: number) => {
      const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.arena(arenaId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.arenas() });
      };
      invalidateAll();
      setTimeout(invalidateAll, 2000);
      setTimeout(invalidateAll, 5000);
    },
    [queryClient],
  );

  /** After funding an agent */
  const afterAgentFunded = useCallback(
    (agentId: number, ownerAddress?: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
      if (ownerAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.myAgents(ownerAddress),
        });
      }
    },
    [queryClient],
  );

  return { afterAgentCreated, afterRegistration, afterArenaActivated, afterAgentFunded };
}

// ─── Legacy mutation hooks (kept for compatibility) ──────────────────

export function useCreateAgentMutation() {
  const queryClient = useQueryClient();
  const invalidateAgents = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
  }, [queryClient]);
  return useMutation({
    mutationFn: (body: CreateAgentBody) => createAgent(body),
    onSuccess: invalidateAgents,
  });
}

export function useRegisterArenaMutation() {
  const queryClient = useQueryClient();
  const invalidateArenas = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.arenas() });
  }, [queryClient]);
  return useMutation({
    mutationFn: (body: RegisterArenaBody) => registerArena(body),
    onSuccess: invalidateArenas,
  });
}
