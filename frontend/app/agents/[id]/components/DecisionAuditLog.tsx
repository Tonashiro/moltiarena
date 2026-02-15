"use client";

import { useState } from "react";
import Link from "next/link";
import { useAgentDecisions } from "@/app/lib/queries";
import { formatDate, formatNum, shortAddr } from "@/app/lib/formatters";
import { EXPLORER_URL } from "@/app/lib/contracts/abis";
import { cn } from "@/app/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DecisionAuditLogProps {
  agentId: number;
}

export function DecisionAuditLog({ agentId }: DecisionAuditLogProps) {
  const [page, setPage] = useState(1);
  const { data: decisionsData } = useAgentDecisions(agentId, page, 20);

  if (!decisionsData || decisionsData.decisions.length === 0) {
    return null;
  }

  return (
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={decisionsData.pagination.page <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPage((p) =>
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
  );
}
