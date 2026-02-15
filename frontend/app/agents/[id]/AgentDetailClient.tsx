"use client";

import Link from "next/link";
import { useMemo, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Legend,
  Cell,
} from "recharts";
import type { AgentDetailResponse } from "../../lib/api";
import { fundAgent, withdrawFromAgent, approveMoltiForArena } from "../../lib/api";
import {
  useAgent,
  useArenas,
  useInvalidateQueries,
  useAgentEquityHistory,
  useAgentTrades,
  useAgentStats,
  useAgentDecisions,
} from "../../lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { toastError, toastPending, toastUpdateSuccess, toastUpdateError } from "../../lib/toast";
import { cn } from "@/app/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null) return "--";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
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

const PIE_COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#ec4899", "#10b981"];

// ─── Component ────────────────────────────────────────────────────────

interface AgentDetailClientProps {
  agentId: number;
  initialAgent: AgentDetailResponse;
}

export function AgentDetailClient({ agentId, initialAgent }: AgentDetailClientProps) {
  const { address } = useAccount();
  const { data: agent } = useAgent(agentId);
  const a = agent ?? initialAgent;

  useArenas();
  const { afterAgentFunded } = useInvalidateQueries();

  const isOwner = !!address && a.ownerAddress.toLowerCase() === address.toLowerCase();
  const registeredArenaIds = useMemo(() => a.arenas.map((ar) => ar.arenaId), [a.arenas]);
  const agentWallet = a.smartAccountAddress ?? a.walletAddress;

  const { data: agentMoltiRaw, refetch: refetchAgentMolti } = useSmartAccountMoltiBalance(agentWallet);
  const { data: agentMonData, refetch: refetchAgentMon } = useMonBalance(agentWallet);
  const agentMolti = agentMoltiRaw as bigint | undefined;
  const agentMon = agentMonData?.value;

  const { data: equityData } = useAgentEquityHistory(agentId);
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
  const [isApprovingMolti, setIsApprovingMolti] = useState(false);

  const aWithPnl = a.arenas.filter((ar) => ar.pnlPct != null);
  const totalPnl = useMemo(() => {
    if (aWithPnl.length === 0) return null;
    const totalCapital = aWithPnl.reduce(
      (s, ar) => s + ((ar as { initialCapital?: number }).initialCapital ?? 0),
      0,
    );
    if (totalCapital > 0) {
      const weightedSum = aWithPnl.reduce(
        (s, ar) =>
          s + (ar.pnlPct ?? 0) * ((ar as { initialCapital?: number }).initialCapital ?? 0),
        0,
      );
      return weightedSum / totalCapital;
    }
    return aWithPnl.reduce((s, ar) => s + (ar.pnlPct ?? 0), 0) / aWithPnl.length;
  }, [aWithPnl]);

  const totalTrades = useMemo(() => tradesData?.trades.length ?? 0, [tradesData]);

  const chartData = useMemo(() => {
    if (!equityData?.aggregated.length) return [];
    return equityData.aggregated.map((pt) => ({
      time: formatTime(pt.createdAt),
      equity: Number(pt.equity.toFixed(4)),
      pnl: Number(pt.pnlPct.toFixed(2)),
    }));
  }, [equityData]);

  const allocationData = useMemo(() => {
    return a.arenas
      .filter((ar) => ar.equity != null && ar.equity > 0)
      .map((ar) => ({
        name: ar.arenaName ?? `Arena ${ar.arenaId}`,
        value: ar.equity ?? 0,
      }));
  }, [a.arenas]);

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
    const result = await fundMolti(agentWallet as `0x${string}`, fundMoltiAmount);
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
  }, [agentWallet, a.id, fundMoltiAmount, fundMolti, afterAgentFunded, agentId, address, refetchAgentMolti]);

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
  }, [agentWallet, fundMonAmount, fundMon, afterAgentFunded, agentId, address, refetchAgentMon]);

  const handleApproveMolti = useCallback(async () => {
    setIsApprovingMolti(true);
    const pendingToast = toastPending("Approving MOLTI for arena...");
    try {
      const { txHash } = await approveMoltiForArena(a.id);
      toastUpdateSuccess(pendingToast, `MOLTI approved! Tx: ${txHash.slice(0, 10)}...`);
    } catch (err: unknown) {
      toastUpdateError(pendingToast, err instanceof Error ? err.message : "Approval failed");
    } finally {
      setIsApprovingMolti(false);
    }
  }, [a.id]);

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
    const pendingToast = toastPending(`Withdrawing ${withdrawAmount} ${withdrawToken}...`);
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
      toastUpdateError(pendingToast, err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setIsWithdrawing(false);
    }
  }, [address, a.id, withdrawToken, withdrawAmount, refetchAgentMolti, refetchAgentMon]);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/agents" className="text-muted-foreground hover:text-foreground text-sm">
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
            Use &quot;Fund MON&quot; below to add native MON for transaction fees.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Trades</p>
            <p className="text-2xl font-bold font-mono">
              {statsData?.tradeCount ?? totalTrades}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p
              className="text-xs text-muted-foreground"
              title="Registration (100 per arena) + epoch renewal fees"
            >
              Fees paid
            </p>
            <p className="text-2xl font-bold font-mono">
              {formatNum((a.registrationFeesPaid ?? 0) + (statsData?.feesPaid ?? 0))} MOLTI
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total PnL</p>
            <p
              className={cn(
                "text-2xl font-bold font-mono",
                totalPnl != null && totalPnl >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {formatPct(totalPnl)}
            </p>
          </CardContent>
        </Card>
        {agentWallet != null && (
          <Card>
            <CardContent className="pt-4 pb-3">
              <p
                className="text-xs text-muted-foreground"
                title="On-chain MOLTI balance — the actual amount available to withdraw."
              >
                Withdrawable MOLTI
              </p>
              <p className="text-2xl font-bold font-mono text-foreground">
                {agentMolti != null ? formatNum(Number(formatEther(agentMolti)), 4) : "--"}
              </p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Arenas</p>
            <p className="text-2xl font-bold font-mono text-foreground">
              {a.arenas.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portfolio Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" domain={["auto", "auto"]} />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number | undefined, name: string | undefined) => {
                    const v = value ?? 0;
                    const n = name ?? "";
                    if (n === "equity") return [formatNum(v, 4), "Equity"];
                    if (n === "pnl") return [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, "PnL"];
                    return [v, n];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#6366f1"
                  fill="url(#equityGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No performance data yet. The chart will appear once the agent starts trading.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Arena Performance</CardTitle>
              <RegisterAgentDialog
                mode="arenaForAgent"
                agent={{
                  id: a.id,
                  name: a.name,
                  onChainId: a.onChainId,
                  registeredArenaIds,
                  walletAddress: a.walletAddress,
                  smartAccountAddress: a.smartAccountAddress,
                }}
                trigger={<Button size="sm">+ Join Arena</Button>}
              />
            </div>
          </CardHeader>
          <CardContent>
            {a.arenas.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Arena</TableHead>
                      <TableHead className="text-right">PnL</TableHead>
                      <TableHead className="text-right" title="Simulated value (cash + tokens × price)">
                        Paper Equity
                      </TableHead>
                      <TableHead className="text-right">Cash</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {a.arenas.map((ar) => (
                      <TableRow key={ar.arenaId}>
                        <TableCell>
                          <Link
                            href={`/arenas/${ar.arenaId}`}
                            className="text-sm hover:underline font-medium"
                          >
                            {ar.arenaName ?? `Arena ${ar.arenaId}`}
                          </Link>
                          <p className="text-xs text-muted-foreground font-mono">
                            {ar.tokenAddress.slice(0, 10)}...
                          </p>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono",
                            (ar.pnlPct ?? 0) >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400",
                          )}
                        >
                          {formatPct(ar.pnlPct)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNum(ar.equity, 4)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNum(ar.cashMon, 2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNum(ar.tokenUnits, 4)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not registered in any arena yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            {allocationData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={allocationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {allocationData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <RechartsTooltip
                    formatter={(value: number | undefined) => [formatNum(value ?? 0, 4), "Equity"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No allocation data yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

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
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="min-w-[180px] max-w-[280px]">Reason</TableHead>
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
                        <Link href={`/arenas/${d.arenaId}`} className="text-sm hover:underline">
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
                        {(d.sizePct * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {d.price.toFixed(6)}
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
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between gap-4 mt-3">
              <p className="text-xs text-muted-foreground">
                Page {decisionsData.pagination.page} of {decisionsData.pagination.totalPages} (
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
                      decisionsData.pagination.page >= decisionsData.pagination.totalPages
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
                  <dd className="font-mono text-xs truncate">{a.smartAccountAddress}</dd>
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
                      maxTrade {Math.round((a.profileConfig.constraints.maxTradePct ?? 0) * 100)}%
                      , maxPosition{" "}
                      {Math.round((a.profileConfig.constraints.maxPositionPct ?? 0) * 100)}%
                      , cooldown {a.profileConfig.constraints.cooldownTicks ?? 0} ticks
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

      {isOwner && agentWallet && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fund & Withdraw</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fund the agent wallet with MOLTI or MON. Withdraw back to your wallet.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Fund MOLTI</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Amount"
                    value={fundMoltiAmount}
                    onChange={(e) => setFundMoltiAmount(e.target.value)}
                    className="w-24 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <Button
                    size="sm"Reason
                    onClick={handleFundMolti}
                    disabled={isFundingMolti || !fundMoltiAmount}
                  >
                    Fund MOLTI
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Fund MON</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Amount"
                    value={fundMonAmount}
                    onChange={(e) => setFundMonAmount(e.target.value)}
                    className="w-24 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleFundMon}
                    disabled={isFundingMon || !fundMonAmount}
                  >
                    Fund MON
                  </Button>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleApproveMolti}
                disabled={isApprovingMolti}
              >
                Approve MOLTI for Arena
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 items-end pt-4 border-t border-border">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Withdraw</label>
                <div className="flex gap-2">
                  <select
                    value={withdrawToken}
                    onChange={(e) => setWithdrawToken(e.target.value as "MOLTI" | "MON")}
                    className="px-2 py-1 rounded border border-border bg-background text-sm"
                  >
                    <option value="MOLTI">MOLTI</option>
                    <option value="MON">MON</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Amount"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-24 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleWithdraw}
                    disabled={isWithdrawing || !withdrawAmount || !address}
                  >
                    Withdraw
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
