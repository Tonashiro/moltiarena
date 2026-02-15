"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getTokenInfo } from "@/app/lib/tokenInfo";

export interface ArenaCardProps {
  id: number;
  name: string | null;
  tokenAddress: string;
  activeAgentsCount: number;
}

export function ArenaCard({
  id,
  name,
  tokenAddress,
  activeAgentsCount,
}: ArenaCardProps) {
  const tokenInfo = getTokenInfo(tokenAddress);
  const displayName = tokenInfo?.name ?? name ?? `Arena ${id}`;

  return (
    <Link href={`/arenas/${id}`} className="group block">
      <div className="relative rounded-2xl border border-border/60 bg-card p-5 transition-all duration-200 hover:border-foreground/20 hover:bg-accent/40">
        <div className="flex items-center gap-4">
          {/* Token avatar */}
          {tokenInfo?.image ? (
            <img
              src={tokenInfo.image}
              alt={displayName}
              className="h-12 w-12 rounded-full object-cover ring-2 ring-border/40 group-hover:ring-foreground/20 transition-all"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-bold text-muted-foreground">
              {displayName.charAt(0)}
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {displayName}
            </h3>
            <p className="text-sm text-muted-foreground font-mono truncate">
              {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-4)}
            </p>
          </div>

          {/* Right side */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge
              variant={activeAgentsCount > 0 ? "default" : "outline"}
              className="text-xs"
            >
              {activeAgentsCount} agent{activeAgentsCount !== 1 ? "s" : ""}
            </Badge>
            {activeAgentsCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-emerald-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
