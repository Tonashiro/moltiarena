"use client";

import { formatEther } from "viem";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumBrute } from "@/app/lib/formatters";

export interface AgentStatCardsProps {
  tradeCount: number;
  feesPaid: number;
  agentMolti: bigint | undefined;
  hasWallet: boolean;
  arenaCount: number;
  pendingRewardsTotal: number;
  claimedRewards: number;
}

export function AgentStatCards({
  tradeCount,
  feesPaid,
  agentMolti,
  hasWallet,
  arenaCount,
  pendingRewardsTotal,
  claimedRewards,
}: AgentStatCardsProps) {
  return (
    <div className="flex justify-center">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Trades</p>
            <p className="text-2xl font-bold font-mono">{tradeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p
              className="text-xs text-muted-foreground"
              title="Registration (100 per arena) + epoch renewal + trade fees (0.5%)"
            >
              Fees paid
            </p>
            <p className="text-2xl font-bold font-mono overflow-hidden text-ellipsis">
              {formatNumBrute(feesPaid)} MOLTI
            </p>
          </CardContent>
        </Card>
        {hasWallet && (
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p
                className="text-xs text-muted-foreground"
                title="On-chain MOLTI balance — the actual amount available to withdraw."
              >
                Balance
              </p>
              <p className="text-2xl font-bold font-mono text-foreground overflow-hidden text-ellipsis">
                {agentMolti != null
                  ? formatNumBrute(Number(formatEther(agentMolti)))
                  : "--"}{" "}
                MOLTI
              </p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Arenas</p>
            <p className="text-2xl font-bold font-mono text-foreground">
              {arenaCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Pending rewards</p>
            <p className="text-2xl font-bold font-mono text-foreground overflow-hidden text-ellipsis">
              {formatNumBrute(pendingRewardsTotal)} MOLTI
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground">Claimed rewards</p>
            <p className="text-2xl font-bold font-mono text-foreground overflow-hidden text-ellipsis">
              {formatNumBrute(claimedRewards)} MOLTI
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
