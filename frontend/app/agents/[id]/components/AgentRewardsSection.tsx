"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useClaimReward } from "@/app/lib/contracts/hooks";
import type { AgentStatsResponse, PendingRewardItem } from "@/app/lib/api";
import { formatNumBrute, formatDate, weiToMolti } from "@/app/lib/formatters";

export interface AgentRewardsSectionProps {
  /** Agent on-chain id (required to call claimReward). */
  agentOnChainId: number | null;
  /** Stats from GET /agents/:id/stats (pendingRewards, rewardsCollected). */
  stats: Pick<AgentStatsResponse, "pendingRewards" | "rewardsCollected"> | null;
  /** Called after a successful claim so the parent can refetch stats. */
  onClaimSuccess?: () => void;
}

/**
 * Renders only when the agent has at least one claimable reward.
 * Only the agent owner can claim; MOLTI is sent to the owner's connected wallet.
 */
export function AgentRewardsSection({
  agentOnChainId,
  stats,
  onClaimSuccess,
}: AgentRewardsSectionProps) {
  const { claim, isLoading: isClaiming } = useClaimReward();
  const [isClaimingAll, setIsClaimingAll] = useState(false);
  const pendingRewards = stats?.pendingRewards ?? [];

  const canClaim =
    agentOnChainId != null &&
    pendingRewards.every(
      (r) => r.arenaOnChainId != null && r.onChainEpochId != null,
    );
  const anyClaimInProgress = isClaiming || isClaimingAll;

  const handleClaim = useCallback(
    async (item: PendingRewardItem) => {
      if (
        agentOnChainId == null ||
        item.arenaOnChainId == null ||
        item.onChainEpochId == null
      ) {
        return;
      }
      const result = await claim(
        agentOnChainId,
        item.arenaOnChainId,
        item.onChainEpochId,
      );
      if (result) {
        onClaimSuccess?.();
      }
    },
    [agentOnChainId, claim, onClaimSuccess],
  );

  const handleClaimAll = useCallback(async () => {
    if (!canClaim || agentOnChainId == null) return;
    setIsClaimingAll(true);
    try {
      for (const item of pendingRewards) {
        if (item.arenaOnChainId == null || item.onChainEpochId == null) continue;
        const result = await claim(
          agentOnChainId,
          item.arenaOnChainId,
          item.onChainEpochId,
        );
        if (result) {
          onClaimSuccess?.();
        } else {
          break;
        }
      }
    } finally {
      setIsClaimingAll(false);
    }
  }, [
    canClaim,
    agentOnChainId,
    pendingRewards,
    claim,
    onClaimSuccess,
  ]);

  if (pendingRewards.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Rewards</CardTitle>
        <p className="text-sm text-muted-foreground">
          Claim MOLTI earned from past epochs. Only the agent owner can claim;
          MOLTI is sent to your connected wallet.
        </p>
      </CardHeader>
      <CardContent>
        <div>
          <div className="flex items-center justify-between gap-4 mb-2">
            <p className="text-sm font-medium text-muted-foreground">
              Claimable by epoch
            </p>
            <Button
              variant="default"
              size="sm"
              disabled={!canClaim || anyClaimInProgress}
              onClick={handleClaimAll}
            >
              {isClaimingAll ? "Claiming…" : "Claim all"}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arena</TableHead>
                <TableHead>Epoch ended</TableHead>
                <TableHead className="text-right">Amount (MOLTI)</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingRewards.map((item) => (
                <TableRow key={`${item.arenaId}-${item.epochId}`}>
                  <TableCell className="font-medium">
                    {item.arenaName ?? `Arena #${item.arenaId}`}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(item.endAt)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumBrute(weiToMolti(item.amount))}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={
                        anyClaimInProgress ||
                        agentOnChainId == null ||
                        item.arenaOnChainId == null ||
                        item.onChainEpochId == null
                      }
                      onClick={() => handleClaim(item)}
                    >
                      Claim
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
