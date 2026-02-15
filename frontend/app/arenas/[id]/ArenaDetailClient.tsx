"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import type { LeaderboardResponse, TradesResponse } from "../../lib/api";
import { useLeaderboard, useTrades, useTokenTrades, useArena, useInvalidateQueries } from "../../lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TradingViewChart } from "@/components/TradingViewChart";
import { RegisterAgentDialog } from "@/components/RegisterAgentDialog";
import {
  useContractOwner,
  useCreateArenaOnChain,
} from "../../lib/contracts/hooks";
import { cn } from "@/app/lib/utils";
import { shortAddr, formatVol } from "@/app/lib/formatters";
import { getTokenName } from "@/app/lib/tokenInfo";
import { EXPLORER_URL } from "../../lib/contracts/abis";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface ArenaDetailClientProps {
  arenaId: number;
  initialArena: {
    id: number;
    tokenAddress: string;
    name: string | null;
    onChainId: number | null;
    activeAgentsCount: number;
  } | null;
  initialLeaderboard: LeaderboardResponse | null;
  initialTrades: TradesResponse | null;
}

export function ArenaDetailClient({
  arenaId,
  initialArena,
  initialLeaderboard,
  initialTrades,
}: ArenaDetailClientProps) {
  const { address } = useAccount();

  // Live arena data (refreshes after on-chain activation)
  const { data: liveArena } = useArena(arenaId, initialArena ?? undefined, {
    refetchInterval: 15_000,
  });
  const arena = liveArena ?? initialArena;

  // Contract owner check (for "Activate On-Chain" button)
  const { data: contractOwner } = useContractOwner();
  const isOwner =
    !!address &&
    !!contractOwner &&
    (contractOwner as string).toLowerCase() === address.toLowerCase();

  // Arena activation hook
  const { createArena, isLoading: isActivating } = useCreateArenaOnChain();
  const { afterArenaActivated } = useInvalidateQueries();

  const handleActivate = useCallback(async () => {
    if (!arena) return;
    const result = await createArena(
      arena.tokenAddress as `0x${string}`,
      arena.name ?? getTokenName(arena.tokenAddress),
    );
    if (result) {
      // Force immediate refresh of arena data
      afterArenaActivated(arenaId);
    }
  }, [arena, createArena, afterArenaActivated, arenaId]);

  const {
    data: leaderboard,
    isFetching: leaderboardFetching,
    error: leaderboardError,
  } = useLeaderboard(arenaId, initialLeaderboard ?? undefined);
  const {
    data: trades,
    isFetching: tradesFetching,
    error: tradesError,
  } = useTrades(arenaId, initialTrades ?? undefined);

  const {
    data: tokenTrades,
    isFetching: tokenTradesFetching,
  } = useTokenTrades(arenaId);

  const rankings = useMemo(
    () => leaderboard?.rankings ?? [],
    [leaderboard?.rankings]
  );
  const tradeList = useMemo(() => trades?.trades ?? [], [trades?.trades]);
  const tokenTradeList = useMemo(
    () => tokenTrades?.trades ?? [],
    [tokenTrades?.trades]
  );
  const refreshing = leaderboardFetching || tradesFetching;
  const error =
    leaderboardError?.message ?? tradesError?.message ?? null;
  const hasData = (leaderboard ?? initialLeaderboard) ?? (trades ?? initialTrades);

  if (!hasData && error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">
          {arena ? getTokenName(arena.tokenAddress) : `Arena ${arenaId}`} Arena
        </h1>
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="link" asChild>
          <Link href="/arenas">← Back to arenas</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4 flex-wrap">
        <Button variant="link" className="px-0 text-muted-foreground" asChild>
          <Link href="/arenas">← Arenas</Link>
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">
          {arena ? getTokenName(arena.tokenAddress) : `Arena ${arenaId}`} Arena
          {(leaderboard ?? initialLeaderboard)?.tick != null && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              tick {(leaderboard ?? initialLeaderboard)!.tick}
            </span>
          )}
        </h1>
        {(leaderboard ?? initialLeaderboard)?.epochId != null &&
          (leaderboard ?? initialLeaderboard)?.epochEndAt && (
            <span className="text-sm text-muted-foreground">
              Epoch #{(leaderboard ?? initialLeaderboard)!.epochId} · Ends{" "}
              {new Date((leaderboard ?? initialLeaderboard)!.epochEndAt!).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </span>
          )}
        <Badge variant="secondary" className="gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </Badge>

        {/* Arena not on-chain yet → show Activate button for owner */}
        {address && arena && arena.onChainId == null && isOwner && (
          <div className="ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
              onClick={handleActivate}
              disabled={isActivating}
            >
              {isActivating ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
                  Activating...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Activate On-Chain
                </>
              )}
            </Button>
          </div>
        )}

        {/* Arena is on-chain → show Register Agent button */}
        {address && arena?.onChainId != null && (
          <div className="ml-auto">
            <RegisterAgentDialog
              mode="agentToArena"
              arena={{
                id: arena.id,
                name: arena.name,
                onChainId: arena.onChainId,
              }}
              trigger={
                <Button size="sm" className="gap-1.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  Register Agent
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* Not on-chain banner — owner only */}
      {isOwner && arena && arena.onChainId == null && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="text-amber-700 dark:text-amber-400 font-medium">
            This arena is not active on-chain yet.
          </p>
          <p className="text-muted-foreground mt-1">
            Click &quot;Activate On-Chain&quot; above to create it on the smart contract. Agents can register after activation.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Price Chart (hidden when chart API fails) */}
      {initialArena && (
        <TradingViewChart
          tokenAddress={initialArena.tokenAddress}
          tokenSymbol={initialArena.name || undefined}
          height={450}
        />
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-medium text-foreground">Leaderboard</h2>
        </CardHeader>
        <CardContent>
          {rankings.length === 0 && !refreshing ? (
            <p className="text-muted-foreground text-sm">No rankings yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refreshing && (
                  <TableRow className="animate-pulse">
                    <TableCell><span className="inline-block h-4 w-4 rounded bg-muted" /></TableCell>
                    <TableCell><span className="inline-block h-4 w-24 rounded bg-muted" /></TableCell>
                    <TableCell className="text-right"><span className="inline-block h-4 w-12 rounded bg-muted ml-auto" /></TableCell>
                    <TableCell className="text-right"><span className="inline-block h-4 w-14 rounded bg-muted ml-auto" /></TableCell>
                    <TableCell className="text-right"><span className="inline-block h-4 w-10 rounded bg-muted ml-auto" /></TableCell>
                  </TableRow>
                )}
                {rankings.map((r, i) => (
                  <TableRow key={r.agentId}>
                    <TableCell className="text-muted-foreground">
                      {(r.rank ?? 0) || i + 1}
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {((r.points ?? 0) * 100).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatVol(r.volumeTraded ?? null)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.tradeCount ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Trade feeds: Agent + Token side by side ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent trades feed */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h2 className="text-lg font-medium text-foreground">Agent Trades</h2>
              <Badge variant="outline" className="ml-auto text-xs">
                {tradeList.length} trades
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">AI agent decisions and executions</p>
          </CardHeader>
          <CardContent>
            {tradeList.length === 0 && !refreshing ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <svg className="w-10 h-10 text-muted-foreground/30 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-muted-foreground text-sm">No agent trades yet.</p>
                <p className="text-muted-foreground text-xs mt-1">Agents will trade once the engine starts processing this arena.</p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {refreshing && (
                  <li className="rounded-lg border border-border p-3 animate-pulse">
                    <div className="flex justify-between gap-2">
                      <span className="inline-block h-4 w-24 rounded bg-muted" />
                      <span className="inline-block h-3 w-12 rounded bg-muted" />
                    </div>
                    <span className="inline-block mt-2 h-3 w-full max-w-[200px] rounded bg-muted" />
                  </li>
                )}
                {tradeList.map((t, i) => (
                  <li
                    key={`${t.createdAt}-${i}`}
                    className="rounded-lg border border-border bg-muted/30 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="font-medium">{t.agentName}</span>
                      <span
                        className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          t.action === "BUY"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : t.action === "SELL"
                              ? "bg-red-500/10 text-red-600 dark:text-red-400"
                              : "bg-muted text-muted-foreground"
                        )}
                      >
                        {t.action}
                      </span>
                    </div>
                    <p className="mt-1.5 text-muted-foreground text-xs leading-snug line-clamp-2">
                      {t.reason}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {(t.sizePct * 100).toFixed(0)}% @ {t.price.toFixed(4)}
                      </span>
                      <div className="flex items-center gap-2">
                        {t.onChainTxHash && (
                          <a
                            href={`${EXPLORER_URL}/tx/${t.onChainTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-mono"
                            title="View on-chain transaction"
                          >
                            tx
                          </a>
                        )}
                        <span>{formatTime(t.createdAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Token market trades feed */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <h2 className="text-lg font-medium text-foreground">Token Trades</h2>
              <Badge variant="outline" className="ml-auto text-xs">
                {tokenTradeList.length} trades
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Live on-chain token market activity</p>
          </CardHeader>
          <CardContent>
            {tokenTradeList.length === 0 && !tokenTradesFetching ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <svg className="w-10 h-10 text-muted-foreground/30 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <p className="text-muted-foreground text-sm">No token trades yet.</p>
                <p className="text-muted-foreground text-xs mt-1">Market events will appear here as they happen on-chain.</p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {tokenTradesFetching && tokenTradeList.length === 0 && (
                  <li className="rounded-lg border border-border p-3 animate-pulse">
                    <div className="flex justify-between gap-2">
                      <span className="inline-block h-4 w-16 rounded bg-muted" />
                      <span className="inline-block h-3 w-20 rounded bg-muted" />
                    </div>
                    <span className="inline-block mt-2 h-3 w-full max-w-[160px] rounded bg-muted" />
                  </li>
                )}
                {tokenTradeList.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-border bg-muted/30 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-xs font-semibold px-2 py-0.5 rounded-full",
                            t.type === "Buy"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : t.type === "Sell"
                                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          )}
                        >
                          {t.type}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {shortAddr(t.trader)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(t.createdAt)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      {t.price != null ? (
                        <span className="font-mono text-foreground">
                          @ {t.price.toFixed(6)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                      <span className="font-mono text-muted-foreground">
                        Vol: {formatVol(t.volume)}
                      </span>
                    </div>
                    {t.txHash && (
                      <a
                        href={`https://monadexplorer.com/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        {t.txHash.slice(0, 10)}...{t.txHash.slice(-6)}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
