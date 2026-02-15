"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/app/lib/utils";

export interface ArenaCardProps {
  id: number;
  name: string | null;
  tokenAddress: string;
  activeAgentsCount: number;
}

// Gradient colors for arena cards (cycled by ID)
const ARENA_GRADIENTS = [
  "from-purple-500/10 via-blue-500/10 to-cyan-500/10",
  "from-pink-500/10 via-rose-500/10 to-orange-500/10",
  "from-emerald-500/10 via-teal-500/10 to-cyan-500/10",
  "from-amber-500/10 via-yellow-500/10 to-lime-500/10",
  "from-indigo-500/10 via-purple-500/10 to-pink-500/10",
] as const;

// Border colors for arena cards (cycled by ID)
const ARENA_BORDER_COLORS = [
  "border-purple-500/20 hover:border-purple-500/40",
  "border-pink-500/20 hover:border-pink-500/40",
  "border-emerald-500/20 hover:border-emerald-500/40",
  "border-amber-500/20 hover:border-amber-500/40",
  "border-indigo-500/20 hover:border-indigo-500/40",
] as const;

/**
 * Get gradient color based on arena ID for visual variety
 */
function getArenaGradient(id: number): string {
  return ARENA_GRADIENTS[id % ARENA_GRADIENTS.length];
}

/**
 * Get border color accent based on arena ID
 */
function getArenaBorderColor(id: number): string {
  return ARENA_BORDER_COLORS[id % ARENA_BORDER_COLORS.length];
}

/**
 * Format token address for display (first 6 + last 4 chars)
 */
function formatTokenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ArenaCard({
  id,
  name,
  tokenAddress,
  activeAgentsCount,
}: ArenaCardProps) {
  const displayName = name ?? `Arena ${id}`;
  const gradient = getArenaGradient(id);
  const borderColor = getArenaBorderColor(id);
  const formattedAddress = formatTokenAddress(tokenAddress);

  return (
    <Link href={`/arenas/${id}`} className="block group">
      <Card
        className={cn(
          "relative overflow-hidden transition-all duration-300",
          "hover:shadow-lg hover:shadow-primary/10",
          "hover:-translate-y-1",
          borderColor,
          "cursor-pointer"
        )}
      >
        {/* Gradient background */}
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity duration-300",
            "group-hover:opacity-70",
            gradient
          )}
        />

        {/* Shine effect on hover */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />

        <CardContent className="relative p-6">
          <div className="flex items-start justify-between gap-4">
            {/* Left side - Arena info */}
            <div className="flex-1 min-w-0">
              {/* Arena name */}
              <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">
                {displayName}
              </h3>

              {/* Token address */}
              <div className="flex items-center gap-2 mb-4">
                <svg
                  className="w-4 h-4 text-muted-foreground shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span className="text-sm font-mono text-muted-foreground truncate">
                  {formattedAddress}
                </span>
              </div>

              {/* Agent count badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={activeAgentsCount > 0 ? "default" : "outline"}
                  className="gap-1.5"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <span>
                    {activeAgentsCount} agent{activeAgentsCount !== 1 ? "s" : ""}
                  </span>
                </Badge>
                {activeAgentsCount > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Active
                  </Badge>
                )}
              </div>
            </div>

            {/* Right side - Arrow icon */}
            <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <svg
                className="w-5 h-5 text-primary group-hover:translate-x-1 transition-transform"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
