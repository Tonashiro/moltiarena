"use client";

import type { AgentDetailResponse } from "@/app/lib/api";
import { shortAddr } from "@/app/lib/formatters";
import { EXPLORER_URL } from "@/app/lib/contracts/abis";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface AgentInfoCardsProps {
  agent: AgentDetailResponse;
}

export function AgentInfoCards({ agent: a }: AgentInfoCardsProps) {
  return (
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
                <dd>{a.profileConfig.goal || "\u2014"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Style</dt>
                <dd>{a.profileConfig.style || "\u2014"}</dd>
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
  );
}
