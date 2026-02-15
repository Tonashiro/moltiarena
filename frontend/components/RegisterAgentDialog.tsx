"use client";

import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyAgents, useArenas, useInvalidateQueries } from "@/app/lib/queries";
import {
  useRegisterToArenaOnChain,
  useSmartAccountMoltiBalance,
  useMonBalance,
} from "@/app/lib/contracts/hooks";
import { toastError, toastSuccess } from "@/app/lib/toast";
import type { AgentListItem, ArenaListItem } from "@/app/lib/api";
import { formatEther } from "viem";

/* No deposit required for registration — MOLTI is pulled on BUY */

/* ────────────────────────────────────────────────────────────────────
 * Mode A: Register an agent to a specific arena
 * (used on the Arena Detail page)
 * ──────────────────────────────────────────────────────────────────── */

interface RegisterAgentToArenaProps {
  mode: "agentToArena";
  /** The arena to register into */
  arena: { id: number; name: string | null; onChainId: number | null };
  trigger?: React.ReactNode;
}

/* ────────────────────────────────────────────────────────────────────
 * Mode B: Register a specific agent to an arena
 * (used on the Agent Detail page)
 * ──────────────────────────────────────────────────────────────────── */

interface RegisterArenaForAgentProps {
  mode: "arenaForAgent";
  /** The agent to register */
  agent: {
    id: number;
    name: string;
    onChainId: number | null;
    registeredArenaIds: number[];
    walletAddress?: string | null;
    smartAccountAddress?: string | null;
  };
  trigger?: React.ReactNode;
}

type RegisterDialogProps = RegisterAgentToArenaProps | RegisterArenaForAgentProps;

export function RegisterAgentDialog(props: RegisterDialogProps) {
  const [open, setOpen] = useState(false);
  const { address } = useAccount();

  const { afterRegistration } = useInvalidateQueries();
  const { register, isLoading, status } = useRegisterToArenaOnChain();

  // Data fetching depending on mode
  const { data: myAgentsData, isLoading: agentsLoading } = useMyAgents(
    props.mode === "agentToArena" ? address : undefined,
  );
  const { data: arenasData, isLoading: arenasLoading } = useArenas(
    props.mode === "arenaForAgent" ? {} : undefined,
  );

  // Filter out agents already registered to this arena (Mode A)
  const eligibleAgents = useMemo<AgentListItem[]>(() => {
    if (props.mode !== "agentToArena") return [];
    const agents = myAgentsData?.agents ?? [];
    return agents.filter(
      (a) =>
        a.onChainId != null &&
        !a.registeredArenaIds.includes(props.arena.id),
    );
  }, [myAgentsData?.agents, props]);

  // Filter out arenas the agent is already in (Mode B)
  const eligibleArenas = useMemo<ArenaListItem[]>(() => {
    if (props.mode !== "arenaForAgent") return [];
    const arenas = arenasData?.arenas ?? [];
    return arenas.filter(
      (a) =>
        a.onChainId != null &&
        !props.agent.registeredArenaIds.includes(a.id),
    );
  }, [arenasData?.arenas, props]);

  // Balance gating for Mode B (agent → arena)
  const agentWallet = props.mode === "arenaForAgent"
    ? (props.agent.smartAccountAddress ?? props.agent.walletAddress ?? null)
    : null;
  const { data: agentMoltiRaw } = useSmartAccountMoltiBalance(agentWallet);
  const { data: agentMonData } = useMonBalance(agentWallet);
  const agentMolti = agentMoltiRaw as bigint | undefined;
  const agentMon = agentMonData?.value;

  const MIN_MON_FOR_GAS = BigInt("10000000000000000"); // 0.01 MON minimum for gas

  const hasSufficientFunding = props.mode === "arenaForAgent"
    ? (agentMolti !== undefined && agentMolti > BigInt(0)) &&
      (agentMon !== undefined && agentMon >= MIN_MON_FOR_GAS)
    : true; // Mode A: we check per-agent

  const [registeringId, setRegisteringId] = useState<number | null>(null);

  const handleRegister = useCallback(
    async (
      onChainAgentId: number,
      onChainArenaId: number,
      displayLabel: string,
      /** Backend DB IDs for query invalidation */
      dbArenaId: number,
      dbAgentId: number,
    ) => {
      if (!address) {
        toastError("Connect your wallet first");
        return;
      }

      setRegisteringId(onChainAgentId + onChainArenaId);

      const result = await register(
        BigInt(onChainAgentId),
        BigInt(onChainArenaId),
      );

      setRegisteringId(null);

      if (result) {
        toastSuccess(`Registered to ${displayLabel}!`);
        // Invalidate all related queries (leaderboard, arena, agent, agents lists)
        afterRegistration(dbArenaId, dbAgentId, address);
        setOpen(false);
      }
    },
    [address, register, afterRegistration],
  );

  if (!address) return null;

  const defaultTrigger = (
    <Button variant="default" size="sm">
      {props.mode === "agentToArena"
        ? "Register Agent"
        : "Join Arena"}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {props.trigger ?? defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "agentToArena"
              ? `Register to ${props.arena.name ?? `Arena ${props.arena.id}`}`
              : `Join arena with ${props.agent.name}`}
          </DialogTitle>
          <DialogDescription>
            Select below to assign your agent. The agent will use its funded balance as paper trading capital in each arena.
          </DialogDescription>
        </DialogHeader>

        {/* Mode A: Pick an agent */}
        {props.mode === "agentToArena" && (
          <div className="max-h-[300px] overflow-y-auto">
            {agentsLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading your agents...
              </p>
            ) : eligibleAgents.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {(myAgentsData?.agents ?? []).length === 0
                    ? "You don't have any agents yet. Create one first!"
                    : "All your agents are already registered to this arena."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {eligibleAgents.map((agent) => {
                  const thisId =
                    (agent.onChainId ?? 0) + (props.arena.onChainId ?? 0);
                  const isThis = registeringId === thisId && isLoading;
                  return (
                    <li
                      key={agent.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{agent.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          On-chain #{agent.onChainId}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={isLoading}
                        onClick={() =>
                          handleRegister(
                            agent.onChainId!,
                            props.arena.onChainId!,
                            props.arena.name ?? `Arena ${props.arena.id}`,
                            props.arena.id,
                            agent.id,
                          )
                        }
                      >
                        {isThis ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                            {status === "approving"
                              ? "Approving..."
                              : status === "writing"
                                ? "Registering..."
                                : "Confirming..."}
                          </span>
                        ) : (
                          "Register"
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Mode B: Balance warning */}
        {props.mode === "arenaForAgent" && !hasSufficientFunding && agentMolti !== undefined && agentMon !== undefined && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
            <p className="text-amber-700 dark:text-amber-400 font-medium text-xs">
              Insufficient funding
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              Agent needs MOLTI {"> 0"} and MON {">="} 0.01 for gas.
              Current: {Number(formatEther(agentMolti)).toLocaleString()} MOLTI, {Number(formatEther(agentMon)).toFixed(4)} MON.
              Fund the agent from its detail page first.
            </p>
          </div>
        )}

        {/* Mode B: Pick an arena */}
        {props.mode === "arenaForAgent" && (
          <div className="max-h-[300px] overflow-y-auto">
            {arenasLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Loading arenas...
              </p>
            ) : eligibleArenas.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {(arenasData?.arenas ?? []).length === 0
                    ? "No arenas available yet."
                    : (arenasData?.arenas ?? []).every((a) => a.onChainId == null)
                      ? "All arenas need to be activated on-chain first. Go to each arena page to activate."
                      : "This agent is already registered to all available arenas."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {eligibleArenas.map((arena) => {
                  const thisId =
                    (props.agent.onChainId ?? 0) + (arena.onChainId ?? 0);
                  const isThis = registeringId === thisId && isLoading;
                  return (
                    <li
                      key={arena.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {arena.name ?? `Arena ${arena.id}`}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground font-mono">
                            {arena.tokenAddress.slice(0, 8)}...
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {arena.activeAgentsCount} agent
                            {arena.activeAgentsCount !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={isLoading || !hasSufficientFunding}
                        onClick={() =>
                          handleRegister(
                            props.agent.onChainId!,
                            arena.onChainId!,
                            arena.name ?? `Arena ${arena.id}`,
                            arena.id,
                            props.agent.id,
                          )
                        }
                      >
                        {isThis ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                            {status === "approving"
                              ? "Approving..."
                              : status === "writing"
                                ? "Registering..."
                                : "Confirming..."}
                          </span>
                        ) : (
                          "Join"
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
