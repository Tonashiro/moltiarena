"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

interface AgentFormHeaderProps {
  balanceFormatted: string;
  creationFeeFormatted: string;
  hasEnoughBalance: boolean;
  showInsufficientBalance: boolean;
}

export function AgentFormHeader({
  balanceFormatted,
  creationFeeFormatted,
  hasEnoughBalance,
  showInsufficientBalance,
}: AgentFormHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/agents" className="text-muted-foreground hover:text-foreground">
            &larr; Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">New agent</h1>
      </div>
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Balance:</span>
          <span
            className={cn(
              "font-mono font-medium",
              hasEnoughBalance ? "text-foreground" : "text-destructive"
            )}
          >
            {balanceFormatted} MOLTI
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Fee:</span>
          <span className="font-mono font-medium">{creationFeeFormatted} MOLTI</span>
        </div>
        {showInsufficientBalance && (
          <span className="text-destructive text-xs">Insufficient balance</span>
        )}
      </div>
    </div>
  );
}
