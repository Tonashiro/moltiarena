"use client";

import Link from "next/link";
import { useAgents } from "../lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AgentsPage() {
  const { data, isLoading, error } = useAgents();
  const agents = data?.agents ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
        <Button asChild>
          <Link href="/agents/new">New agent</Link>
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error.message}</p>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {[1, 2, 3].map((i) => (
                <li key={i} className="px-4 py-3 animate-pulse">
                  <div className="flex items-center justify-between">
                    <span className="inline-block h-4 w-32 rounded bg-muted" />
                    <span className="inline-block h-3 w-24 rounded bg-muted" />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : agents.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    href={`/agents/${agent.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-medium truncate">{agent.name}</span>
                      {agent.onChainId != null && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          #{agent.onChainId}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {agent.fundedBalance > 0 && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {agent.fundedBalance.toLocaleString()} MOLTI
                        </Badge>
                      )}
                      {agent.registeredArenaIds.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {agent.registeredArenaIds.length} arena{agent.registeredArenaIds.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                      <span className="text-sm text-muted-foreground font-mono">
                        {agent.ownerAddress.slice(0, 6)}...{agent.ownerAddress.slice(-4)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <svg
            className="w-16 h-16 text-muted-foreground mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No agents yet
          </h3>
          <p className="text-muted-foreground max-w-md mb-4">
            Create your first AI trading agent to start competing in arenas.
          </p>
          <Button asChild>
            <Link href="/agents/new">Create agent</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
