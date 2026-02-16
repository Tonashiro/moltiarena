"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { ArenaListItem } from "@/app/lib/api";
import { useSmartAccountMoltiBalance, useMonBalance } from "@/app/lib/contracts/hooks";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPLORER_URL } from "@/app/lib/contracts/abis";
import type { CreatedAgent } from "../../types";

/** Epoch renewal fee + gas. Agent must have these before registering to an arena. */
const MIN_MOLTI_WEI = BigInt("100000000000000000000"); // 100 MOLTI
const MIN_MON_WEI = BigInt("1000000000000000000"); // 1 MON for gas

interface AgentCreatedViewProps {
  created: CreatedAgent;
  /** Agent's smart account address for balance checks. Required for registration. */
  smartAccountAddress: string | null | undefined;
  arenas: ArenaListItem[];
  arenasLoading: boolean;
  registeringArenaId: number | null;
  isRegistering: boolean;
  registeredArenaIds: Set<number>;
  onRegister: (arena: ArenaListItem) => void;
}

export function AgentCreatedView({
  created,
  smartAccountAddress,
  arenas,
  arenasLoading,
  registeringArenaId,
  isRegistering,
  registeredArenaIds,
  onRegister,
}: AgentCreatedViewProps) {
  const { data: agentMoltiRaw } = useSmartAccountMoltiBalance(smartAccountAddress);
  const { data: agentMonData } = useMonBalance(smartAccountAddress);
  const agentMolti = agentMoltiRaw as bigint | undefined;
  const agentMon = agentMonData?.value;

  const hasSufficientFunding =
    smartAccountAddress != null &&
    agentMolti !== undefined &&
    agentMon !== undefined &&
    agentMolti >= MIN_MOLTI_WEI &&
    agentMon >= MIN_MON_WEI;

  const canCheckFunding = smartAccountAddress != null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Agent created on-chain</CardTitle>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              On-chain ID: <span className="font-mono">{created.onChainId}</span>
            </p>
            <p>
              Hash:{" "}
              <span className="font-mono">
                {created.profileHash.slice(0, 14)}...
              </span>
            </p>
            <p>
              Tx:{" "}
              <a
                href={`${EXPLORER_URL}/tx/${created.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-mono"
              >
                {created.txHash.slice(0, 10)}...{created.txHash.slice(-6)}
              </a>
            </p>
          </div>
          <Button variant="link" className="px-0 mt-2" asChild>
            <Link href={`/agents/${created.agentId}`}>View agent &rarr;</Link>
          </Button>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Register to arenas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Fund your agent with MOLTI (100+ for epoch renewal) and MON (1+ for gas) before registering.
          </p>
        </CardHeader>
        <CardContent>
          {!canCheckFunding && (
            <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 text-sm mb-4">
              <p className="text-muted-foreground text-xs">
                Loading agent wallet... Fund your agent with 100+ MOLTI and 1+ MON from the{" "}
                <Link href={`/agents/${created.agentId}`} className="text-primary hover:underline">
                  agent page
                </Link>{" "}
                before registering.
              </p>
            </div>
          )}
          {canCheckFunding && !hasSufficientFunding && agentMolti !== undefined && agentMon !== undefined && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm mb-4">
              <p className="text-amber-700 dark:text-amber-400 font-medium text-xs">
                Insufficient funding
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Agent needs 100+ MOLTI and 1+ MON for gas. Current:{" "}
                {Number(formatEther(agentMolti)).toLocaleString()} MOLTI, {Number(formatEther(agentMon)).toFixed(4)} MON.{" "}
                <Link href={`/agents/${created.agentId}`} className="text-primary hover:underline">
                  Fund the agent first
                </Link>
                .
              </p>
            </div>
          )}
          {arenasLoading ? (
            <p className="text-muted-foreground text-sm">Loading arenas...</p>
          ) : arenas.length > 0 ? (
            <ul className="divide-y divide-border">
              {arenas.map((arena) => (
                <li
                  key={arena.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0"
                >
                  <div>
                    <span className="font-medium">
                      {arena.name ?? `Arena ${arena.id}`}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground font-mono">
                      {arena.tokenAddress.slice(0, 8)}...
                    </span>
                    {arena.onChainId != null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (chain #{arena.onChainId})
                      </span>
                    )}
                  </div>
                  {registeredArenaIds.has(arena.id) ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      <Check className="h-4 w-4" />
                      Registered
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRegister(arena)}
                      disabled={
                        registeringArenaId === arena.id ||
                        isRegistering ||
                        !arena.onChainId ||
                        (canCheckFunding && !hasSufficientFunding)
                      }
                    >
                      {registeringArenaId === arena.id
                        ? "Registering..."
                        : !arena.onChainId
                          ? "No chain ID"
                          : canCheckFunding && !hasSufficientFunding
                            ? "Fund first"
                            : "Register"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No arenas yet.</p>
          )}
        </CardContent>
      </Card>
      <Button variant="link" asChild>
        <Link href="/agents">&larr; Back to agents</Link>
      </Button>
    </div>
  );
}
