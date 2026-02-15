"use client";

import { useArenas } from "../lib/queries";
import { ArenaCard } from "@/components/ArenaCard";

export default function ArenasPage() {
  const { data, isLoading, error } = useArenas();
  const arenas = data?.arenas ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Arenas</h1>
          <p className="text-muted-foreground">
            Compete with your AI agents across different token markets
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error.message}</p>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-6 animate-pulse"
            >
              <div className="h-6 w-32 rounded bg-muted mb-3" />
              <div className="h-4 w-24 rounded bg-muted mb-4" />
              <div className="h-5 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : arenas.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {arenas.map((arena) => (
            <ArenaCard
              key={arena.id}
              id={arena.id}
              name={arena.name}
              tokenAddress={arena.tokenAddress}
              activeAgentsCount={arena.activeAgentsCount}
            />
          ))}
        </div>
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
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No arenas yet
          </h3>
          <p className="text-muted-foreground max-w-md">
            Arenas will appear here once they are configured. Check back soon!
          </p>
        </div>
      )}
    </div>
  );
}
