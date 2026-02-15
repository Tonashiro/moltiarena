"use client";

import Link from "next/link";
import { useMemo, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import type { AgentDetailResponse } from "../../lib/api";
import { fundAgent, withdrawFromAgent } from "../../lib/api";
import {
  useAgent,
  useArenas,
  useInvalidateQueries,
  useAgentPointsHistory,
  useAgentTrades,
  useAgentStats,
  useAgentDecisions,
} from "../../lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RegisterAgentDialog } from "@/components/RegisterAgentDialog";
import { EXPLORER_URL } from "../../lib/contracts/abis";
import {
  useFundAgent,
  useFundAgentMon,
  useSmartAccountMoltiBalance,
  useMonBalance,
} from "../../lib/contracts/hooks";
import {
  toastError,
  toastPending,
  toastUpdateSuccess,
  toastUpdateError,
} from "../../lib/toast";
import { cn } from "@/app/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null) return "--";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Component ────────────────────────────────────────────────────────

interface AgentDetailClientProps {
  agentId: number;
  initialAgent: AgentDetailResponse;
}

export function AgentDetailClient({
  agentId,
  initialAgent,
}: AgentDetailClientProps) {
  const { address } = useAccount();
  const { data: agent } = useAgent(agentId);
  const a = agent ?? initialAgent;

  useArenas();
  const { afterAgentFunded } = useInvalidateQueries();

  const isOwner =
    !!address && a.ownerAddress.toLowerCase() === address.toLowerCase();
  const registeredArenaIds = useMemo(
    () => a.arenas.map((ar) => ar.arenaId),
    [a.arenas],
  );
  const agentWallet = a.smartAccountAddress ?? a.walletAddress;

  const { data: agentMoltiRaw, refetch: refetchAgentMolti } =
    useSmartAccountMoltiBalance(agentWallet);
  const { data: agentMonData, refetch: refetchAgentMon } =
    useMonBalance(agentWallet);
  const agentMolti = agentMoltiRaw as bigint | undefined;
  const agentMon = agentMonData?.value;

  const { data: pointsHistoryData } = useAgentPointsHistory(agentId);
  const { data: tradesData } = useAgentTrades(agentId);
  const { data: statsData } = useAgentStats(agentId);
  const [decisionsPage, setDecisionsPage] = useState(1);
  const { data: decisionsData } = useAgentDecisions(agentId, decisionsPage, 20);

  const { fund: fundMolti, isLoading: isFundingMolti } = useFundAgent();
  const [fundMoltiAmount, setFundMoltiAmount] = useState("");
  const { fund: fundMon, isLoading: isFundingMon } = useFundAgentMon();
  const [fundMonAmount, setFundMonAmount] = useState("");
  const [withdrawToken, setWithdrawToken] = useState<"MOLTI" | "MON">("MOLTI");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const totalTrades = useMemo(
    () => tradesData?.trades.length ?? 0,
    [tradesData],
  );

  const pointsChartData = useMemo(() => {
    if (!pointsHistoryData?.days?.length) return [];
    return pointsHistoryData.days.map((d) => ({
      date: d.date,
      label: new Date(d.date).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      totalPoints: d.totalPoints,
      displayPoints: Number((d.totalPoints * 100).toFixed(1)), // Match leaderboard 0-100 scale
      byArena: d.byArena,
    }));
  }, [pointsHistoryData]);

  const handleFundMolti = useCallback(async () => {
    if (!agentWallet) {
      toastError("Agent has no wallet");
      return;
    }
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
        await fundAgent(a.id, { amount: result.amount, txHash: result.txHash });
      } catch {
        /* ok */
      }
      afterAgentFunded(agentId, address ?? undefined);
      setFundMoltiAmount("");
      setTimeout(() => refetchAgentMolti(), 2000);
    }
  }, [
    agentWallet,
    a.id,
    fundMoltiAmount,
    fundMolti,
    afterAgentFunded,
    agentId,
    address,
    refetchAgentMolti,
  ]);

  const handleFundMon = useCallback(async () => {
    if (!agentWallet) {
      toastError("Agent has no wallet");
      return;
    }
    const amt = Number(fundMonAmount);
    if (!amt || amt <= 0) {
      toastError("Enter a valid amount");
      return;
    }
    const result = await fundMon(agentWallet as `0x${string}`, fundMonAmount);
    if (result) {
      afterAgentFunded(agentId, address ?? undefined);
      setFundMonAmount("");
      setTimeout(() => refetchAgentMon(), 2000);
    }
  }, [
    agentWallet,
    fundMonAmount,
    fundMon,
    afterAgentFunded,
    agentId,
    address,
    refetchAgentMon,
  ]);

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
      const result = await withdrawFromAgent(a.id, {
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
      setTimeout(() => {
        refetchAgentMolti();
        refetchAgentMon();
      }, 3000);
    } catch (err: unknown) {
      toastUpdateError(
        pendingToast,
        err instanceof Error ? err.message : "Withdrawal failed",
      );
    } finally {
      setIsWithdrawing(false);
    }
  }, [
    address,
    a.id,
    withdrawToken,
    withdrawAmount,
    refetchAgentMolti,
    refetchAgentMon,
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href="/agents"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          &larr; Agents
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{a.name}</h1>
        {a.onChainId != null && (
          <Badge variant="outline" className="font-mono text-xs">
            #{a.onChainId}
          </Badge>
        )}
        {a.smartAccountAddress && (
          <Badge variant="secondary" className="text-xs">
            ERC-4337
          </Badge>
        )}
      </div>

      {agentWallet && agentMon != null && agentMon < BigInt(0.1 * 1e18) && (
        <div className="rounded-lg border-2 border-amber-500/50 bg-amber-500/10 px-4 py-3">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            Agent is out of MON for gas. Fund your agent to resume trading.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Use &quot;Fund MON&quot; below to add native MON for transaction
            fees.
          </p>
        </div>
      )}

      <div className="flex justify-center">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 max-w-4xl">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground">Trades</p>
              <p className="text-2xl font-bold font-mono">
                {statsData?.tradeCount ?? totalTrades}
              </p>
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
                {formatNum(
                  (a.registrationFeesPaid ?? 0) + (statsData?.feesPaid ?? 0),
                )}{" "}
                MOLTI
              </p>
            </CardContent>
          </Card>
          {agentWallet != null && (
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
                    ? formatNum(Number(formatEther(agentMolti)), 4)
                    : "--"}{" "}
                  MOLTI
                </p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground">Pending rewards</p>
              <p className="text-2xl font-bold font-mono text-foreground overflow-hidden text-ellipsis">
                {formatNum(
                  (statsData?.pendingRewards ?? []).reduce(
                    (s, r) => s + Number(r.amount || "0") / 1e18,
                    0,
                  ),
                  4,
                )}{" "}
                MOLTI
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground">Arenas</p>
              <p className="text-2xl font-bold font-mono text-foreground">
                {a.arenas.length}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {isOwner && agentWallet && (
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
                    : "—"}
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
                    : "—"}
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
                        {isFundingMolti ? "Funding…" : "Fund"}
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
                        {isFundingMon ? "Funding…" : "Fund"}
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
                        {isWithdrawing ? "Withdrawing…" : "Withdraw"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Points by Day</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Daily points (50% volume, 35% PnL, 15% trades) — hover for arena
            breakdown
          </p>
        </CardHeader>
        <CardContent>
          {pointsChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={pointsChartData}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  domain={[0, "auto"]}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    if (!d?.byArena?.length) {
                      return (
                        <div className="px-3 py-2">
                          <p className="font-medium">{d?.label}</p>
                          <p className="text-muted-foreground text-xs">
                            Total: {(d?.displayPoints ?? 0).toFixed(1)} pts
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="px-3 py-2 space-y-1 min-w-[180px]">
                        <p className="font-medium">{d.label}</p>
                        <p className="text-muted-foreground text-xs border-b border-border pb-1">
                          Total: {(d.displayPoints ?? 0).toFixed(1)} pts
                        </p>
                        <p className="text-xs font-medium pt-1">By arena:</p>
                        {d.byArena.map(
                          (a: { arenaName: string; points: number }) => (
                            <p
                              key={a.arenaName}
                              className="text-xs text-muted-foreground"
                            >
                              {a.arenaName}:{" "}
                              {((a.points ?? 0) * 100).toFixed(1)} pts
                            </p>
                          ),
                        )}
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="displayPoints"
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                  name="Points"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No points data yet. The chart will appear once the agent starts
              trading.
            </p>
          )}
        </CardContent>
      </Card>

      {decisionsData && decisionsData.decisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decision Audit Log</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Every tick: BUY / SELL / HOLD with reasoning and status
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Arena</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">MOLTI</TableHead>
                    <TableHead className="min-w-[180px] max-w-[280px]">
                      Reason
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisionsData.decisions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(d.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/arenas/${d.arenaId}`}
                          className="text-sm hover:underline"
                        >
                          {d.arenaName ?? `Arena ${d.arenaId}`}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded-full",
                            d.action === "BUY"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : d.action === "SELL"
                                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {d.action}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {d.moltiAmount != null
                          ? `${formatNum(d.moltiAmount, 2)} MOLTI`
                          : "--"}
                      </TableCell>
                      <TableCell
                        className="min-w-[180px] max-w-[280px] text-xs text-muted-foreground truncate"
                        title={d.reason ?? undefined}
                      >
                        {d.reason}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            d.status === "success"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : d.status === "failed"
                                ? "text-red-600 dark:text-red-400"
                                : d.status === "skipped_no_gas"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-muted-foreground",
                          )}
                        >
                          {d.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {d.onChainTxHash ? (
                          <a
                            href={`${EXPLORER_URL}/tx/${d.onChainTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline font-mono"
                          >
                            {shortAddr(d.onChainTxHash)}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            --
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between gap-4 mt-3">
              <p className="text-xs text-muted-foreground">
                Page {decisionsData.pagination.page} of{" "}
                {decisionsData.pagination.totalPages} (
                {decisionsData.pagination.total} total)
              </p>
              {decisionsData.pagination.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDecisionsPage((p) => Math.max(1, p - 1))}
                    disabled={decisionsData.pagination.page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDecisionsPage((p) =>
                        Math.min(decisionsData.pagination.totalPages, p + 1),
                      )
                    }
                    disabled={
                      decisionsData.pagination.page >=
                      decisionsData.pagination.totalPages
                    }
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd className="font-mono text-xs truncate">{a.ownerAddress}</dd>
              </div>
              {a.smartAccountAddress && (
                <div>
                  <dt className="text-muted-foreground">Smart Account</dt>
                  <dd className="font-mono text-xs truncate">
                    {a.smartAccountAddress}
                  </dd>
                </div>
              )}
              {a.creationTxHash && (
                <div>
                  <dt className="text-muted-foreground">Creation Tx</dt>
                  <dd>
                    <a
                      href={`${EXPLORER_URL}/tx/${a.creationTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline font-mono"
                    >
                      {shortAddr(a.creationTxHash)}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            {a.profileConfig ? (
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Goal</dt>
                  <dd>{a.profileConfig.goal || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Style</dt>
                  <dd>{a.profileConfig.style || "—"}</dd>
                </div>
                {a.profileConfig.constraints && (
                  <div>
                    <dt className="text-muted-foreground">Constraints</dt>
                    <dd className="font-mono text-xs">
                      maxTrade{" "}
                      {Math.round(
                        (a.profileConfig.constraints.maxTradePct ?? 0) * 100,
                      )}
                      % , maxPosition{" "}
                      {Math.round(
                        (a.profileConfig.constraints.maxPositionPct ?? 0) * 100,
                      )}
                      % , cooldown{" "}
                      {a.profileConfig.constraints.cooldownTicks ?? 0} ticks
                    </dd>
                  </div>
                )}
                {a.profileConfig.customRules && (
                  <div>
                    <dt className="text-muted-foreground">Custom Rules</dt>
                    <dd className="text-xs">{a.profileConfig.customRules}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No config loaded.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
