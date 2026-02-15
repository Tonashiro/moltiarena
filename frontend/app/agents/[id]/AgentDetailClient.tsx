"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import type { AgentDetailResponse } from "../../lib/api";
import {
  useAgent,
  useArenas,
  useAgentPointsHistory,
  useAgentTrades,
  useAgentStats,
} from "../../lib/queries";
import {
  useSmartAccountMoltiBalance,
  useMonBalance,
} from "../../lib/contracts/hooks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentStatCards } from "./components/AgentStatCards";
import { AgentRewardsSection } from "./components/AgentRewardsSection";
import { FundWithdrawCard } from "./components/FundWithdrawCard";
import { DecisionAuditLog } from "./components/DecisionAuditLog";
import { AgentInfoCards } from "./components/AgentInfoCards";
import type { PointsChartData } from "./components/PointsChart";

const PointsChart = dynamic(
  () =>
    import("./components/PointsChart").then((m) => ({ default: m.PointsChart })),
  {
    ssr: false,
    loading: () => (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Points by Day</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    ),
  },
);

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

  const isOwner =
    !!address && a.ownerAddress.toLowerCase() === address.toLowerCase();
  const agentWallet = a.smartAccountAddress ?? a.walletAddress;

  // Balances (shared by stat cards, fund/withdraw, and low-gas warning)
  const { data: agentMoltiRaw, refetch: refetchAgentMolti } =
    useSmartAccountMoltiBalance(agentWallet);
  const { data: agentMonData, refetch: refetchAgentMon } =
    useMonBalance(agentWallet);
  const agentMolti = agentMoltiRaw as bigint | undefined;
  const agentMon = agentMonData?.value;

  // Data for stats + chart
  const { data: pointsHistoryData } = useAgentPointsHistory(agentId);
  const { data: tradesData } = useAgentTrades(agentId);
  const { data: statsData, refetch: refetchAgentStats } =
    useAgentStats(agentId);

  const totalTrades = useMemo(
    () => tradesData?.trades.length ?? 0,
    [tradesData],
  );

  const pendingRewardsTotal = useMemo(
    () =>
      (statsData?.pendingRewards ?? []).reduce(
        (s, r) => s + Number(r.amount || "0") / 1e18,
        0,
      ),
    [statsData?.pendingRewards],
  );

  const pointsChartData: PointsChartData[] = useMemo(() => {
    const now = new Date();
    const todayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const last7Dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayUtc);
      d.setUTCDate(d.getUTCDate() - i);
      last7Dates.push(d.toISOString().slice(0, 10));
    }
    const daysMap = new Map(
      (pointsHistoryData?.days ?? []).map((d) => [d.date, d])
    );
    return last7Dates.map((date) => {
      const d = daysMap.get(date);
      if (d) {
        return {
          date: d.date,
          label: new Date(d.date + "T12:00:00").toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
          totalPoints: d.totalPoints,
          displayPoints: Number((d.totalPoints * 100).toFixed(1)),
          byArena: d.byArena,
        };
      }
      return {
        date,
        label: new Date(date + "T12:00:00").toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        totalPoints: 0,
        displayPoints: 0,
        byArena: [],
      };
    });
  }, [pointsHistoryData]);

  const refetchBalances = useCallback(() => {
    refetchAgentMolti();
    refetchAgentMon();
  }, [refetchAgentMolti, refetchAgentMon]);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Header */}
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

      {/* Low-gas warning */}
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

      <AgentStatCards
        tradeCount={statsData?.tradeCount ?? totalTrades}
        feesPaid={(a.registrationFeesPaid ?? 0) + (statsData?.feesPaid ?? 0)}
        agentMolti={agentMolti}
        hasWallet={agentWallet != null}
        arenaCount={a.arenas.length}
        pendingRewardsTotal={pendingRewardsTotal}
        claimedRewards={statsData?.rewardsCollected ?? 0}
      />

      <AgentRewardsSection
        agentOnChainId={a.onChainId ?? null}
        stats={statsData ?? null}
        onClaimSuccess={() => void refetchAgentStats()}
      />

      {isOwner && agentWallet && (
        <FundWithdrawCard
          agentId={a.id}
          agentWallet={agentWallet}
          agentMolti={agentMolti}
          agentMon={agentMon}
          refetchBalances={refetchBalances}
        />
      )}

      <PointsChart chartData={pointsChartData} />

      <DecisionAuditLog agentId={agentId} />

      <AgentInfoCards agent={a} />
    </div>
  );
}
