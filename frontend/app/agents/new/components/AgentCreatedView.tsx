"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { ArenaListItem } from "@/app/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPLORER_URL } from "@/app/lib/contracts/abis";
import type { CreatedAgent } from "../../types";

interface AgentCreatedViewProps {
  created: CreatedAgent;
  arenas: ArenaListItem[];
  arenasLoading: boolean;
  registeringArenaId: number | null;
  isRegistering: boolean;
  registeredArenaIds: Set<number>;
  onRegister: (arena: ArenaListItem) => void;
}

export function AgentCreatedView({
  created,
  arenas,
  arenasLoading,
  registeringArenaId,
  isRegistering,
  registeredArenaIds,
  onRegister,
}: AgentCreatedViewProps) {
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
            Fund your agent first, then assign it to arenas from the agent
            detail page.
          </p>
        </CardHeader>
        <CardContent>
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
                        !arena.onChainId
                      }
                    >
                      {registeringArenaId === arena.id
                        ? "Registering..."
                        : !arena.onChainId
                          ? "No chain ID"
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
