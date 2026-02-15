"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

const STATUS_LABELS: Record<string, string> = {
  approving: "Waiting for MOLTI approval...",
  "confirming-approval": "Confirming approval...",
  writing: "Creating agent on-chain...",
  confirming: "Confirming transaction...",
};

function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Processing...";
}

interface AgentFormActionsProps {
  isCreating: boolean;
  createStatus: string;
  creationFeeFormatted: string;
  hasEnoughBalance: boolean;
}

export function AgentFormActions({
  isCreating,
  createStatus,
  creationFeeFormatted,
  hasEnoughBalance,
}: AgentFormActionsProps) {
  return (
    <>
      {isCreating && (
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>{getStatusLabel(createStatus)}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-center gap-4">
        <Button type="button" variant="outline" size="lg" asChild>
          <Link href="/agents">Cancel</Link>
        </Button>
        <Button
          type="submit"
          size="lg"
          disabled={isCreating || !hasEnoughBalance}
        >
          {isCreating ? "Creating..." : "Create agent (" + creationFeeFormatted + " MOLTI)"}
        </Button>
      </div>
    </>
  );
}
