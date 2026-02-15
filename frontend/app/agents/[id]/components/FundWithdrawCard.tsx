"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { fundAgent, withdrawFromAgent } from "@/app/lib/api";
import { formatNum } from "@/app/lib/formatters";
import {
  toastError,
  toastPending,
  toastUpdateSuccess,
  toastUpdateError,
} from "@/app/lib/toast";
import { useInvalidateQueries } from "@/app/lib/queries";
import {
  useFundAgent,
  useFundAgentMon,
} from "@/app/lib/contracts/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface FundWithdrawCardProps {
  agentId: number;
  agentWallet: string;
  agentMolti: bigint | undefined;
  agentMon: bigint | undefined;
  refetchBalances: () => void;
}

export function FundWithdrawCard({
  agentId,
  agentWallet,
  agentMolti,
  agentMon,
  refetchBalances,
}: FundWithdrawCardProps) {
  const { address } = useAccount();
  const { afterAgentFunded } = useInvalidateQueries();

  const { fund: fundMolti, isLoading: isFundingMolti } = useFundAgent();
  const [fundMoltiAmount, setFundMoltiAmount] = useState("");

  const { fund: fundMon, isLoading: isFundingMon } = useFundAgentMon();
  const [fundMonAmount, setFundMonAmount] = useState("");

  const [withdrawToken, setWithdrawToken] = useState<"MOLTI" | "MON">("MOLTI");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const handleFundMolti = useCallback(async () => {
    const amt = Number(fundMoltiAmount);
    if (!amt || amt <= 0) {
      toastError("Enter a valid amount");
      return;
    }
    const result = await fundMolti(
      agentWallet as `0x${string}`,
      fundMoltiAmount,
    );
    if (result) {
      try {
        await fundAgent(agentId, { amount: result.amount, txHash: result.txHash });
      } catch {
        /* ok */
      }
      afterAgentFunded(agentId, address ?? undefined);
      setFundMoltiAmount("");
      setTimeout(() => refetchBalances(), 2000);
    }
  }, [agentWallet, agentId, fundMoltiAmount, fundMolti, afterAgentFunded, address, refetchBalances]);

  const handleFundMon = useCallback(async () => {
    const amt = Number(fundMonAmount);
    if (!amt || amt <= 0) {
      toastError("Enter a valid amount");
      return;
    }
    const result = await fundMon(agentWallet as `0x${string}`, fundMonAmount);
    if (result) {
      afterAgentFunded(agentId, address ?? undefined);
      setFundMonAmount("");
      setTimeout(() => refetchBalances(), 2000);
    }
  }, [agentWallet, fundMonAmount, fundMon, afterAgentFunded, agentId, address, refetchBalances]);

  const handleWithdraw = useCallback(async () => {
    if (!address) {
      toastError("Connect your wallet");
      return;
    }
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      toastError("Enter a valid amount");
      return;
    }
    setIsWithdrawing(true);
    const pendingToast = toastPending(
      `Withdrawing ${withdrawAmount} ${withdrawToken}...`,
    );
    try {
      const result = await withdrawFromAgent(agentId, {
        token: withdrawToken,
        amount: withdrawAmount,
        toAddress: address,
        ownerAddress: address,
      });
      toastUpdateSuccess(
        pendingToast,
        `Withdrew ${withdrawAmount} ${withdrawToken}! Tx: ${result.txHash.slice(0, 10)}...`,
      );
      setWithdrawAmount("");
      setTimeout(() => refetchBalances(), 3000);
    } catch (err: unknown) {
      toastUpdateError(
        pendingToast,
        err instanceof Error ? err.message : "Withdrawal failed",
      );
    } finally {
      setIsWithdrawing(false);
    }
  }, [address, agentId, withdrawToken, withdrawAmount, refetchBalances]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Fund & Withdraw</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Fund the agent wallet with MOLTI or MON for trading and gas.
          Withdraw back to your wallet anytime.
        </p>
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border/60">
          <div className="flex items-center gap-1.5 text-sm">
            <Badge
              variant="secondary"
              className="font-mono text-xs font-medium"
            >
              MOLTI
            </Badge>
            <span className="text-muted-foreground overflow-hidden text-ellipsis">
              {agentMolti != null
                ? formatNum(Number(formatEther(agentMolti)), 2)
                : "\u2014"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Badge
              variant="secondary"
              className="font-mono text-xs font-medium"
            >
              MON
            </Badge>
            <span className="text-muted-foreground">
              {agentMon != null
                ? formatNum(Number(formatEther(agentMon)), 4)
                : "\u2014"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
            <h4 className="text-sm font-medium">Deposit</h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label
                  htmlFor="fund-molti"
                  className="text-xs text-muted-foreground"
                >
                  MOLTI
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="fund-molti"
                    type="number"
                    placeholder="0"
                    min="0"
                    step="any"
                    value={fundMoltiAmount}
                    onChange={(e) => setFundMoltiAmount(e.target.value)}
                    className="h-9 w-28 font-mono"
                  />
                  <Button
                    size="sm"
                    onClick={handleFundMolti}
                    disabled={isFundingMolti || !fundMoltiAmount}
                    className="shrink-0"
                  >
                    {isFundingMolti ? "Funding\u2026" : "Fund"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="fund-mon"
                  className="text-xs text-muted-foreground"
                >
                  MON (gas)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="fund-mon"
                    type="number"
                    placeholder="0"
                    min="0"
                    step="any"
                    value={fundMonAmount}
                    onChange={(e) => setFundMonAmount(e.target.value)}
                    className="h-9 w-28 font-mono"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleFundMon}
                    disabled={isFundingMon || !fundMonAmount}
                    className="shrink-0"
                  >
                    {isFundingMon ? "Funding\u2026" : "Fund"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
            <h4 className="text-sm font-medium">Withdraw</h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label
                  htmlFor="withdraw-token"
                  className="text-xs text-muted-foreground"
                >
                  Token
                </Label>
                <select
                  id="withdraw-token"
                  value={withdrawToken}
                  onChange={(e) =>
                    setWithdrawToken(e.target.value as "MOLTI" | "MON")
                  }
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="MOLTI">MOLTI</option>
                  <option value="MON">MON</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="withdraw-amount"
                  className="text-xs text-muted-foreground"
                >
                  Amount
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="withdraw-amount"
                    type="number"
                    placeholder="0"
                    min="0"
                    step="any"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="h-9 w-28 font-mono"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleWithdraw}
                    disabled={isWithdrawing || !withdrawAmount || !address}
                    className="shrink-0"
                  >
                    {isWithdrawing ? "Withdrawing\u2026" : "Withdraw"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
