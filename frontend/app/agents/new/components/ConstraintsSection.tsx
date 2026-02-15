"use client";

import type { AgentProfileConfig } from "@/app/lib/agentProfileSchema";
import { parseNum } from "@/app/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldTooltip } from "./FieldTooltip";
import { CONSTRAINT_LIMITS, CONSTRAINT_PCT_DISPLAY } from "../../constants";

interface ConstraintsSectionProps {
  constraints: AgentProfileConfig["constraints"];
  onConstraintsChange: (
    updater: (prev: AgentProfileConfig["constraints"]) => AgentProfileConfig["constraints"]
  ) => void;
}

export function ConstraintsSection({
  constraints,
  onConstraintsChange,
}: ConstraintsSectionProps) {
  const { maxTradePct, maxPositionPct, cooldownTicks, maxTradesPerWindow } = CONSTRAINT_LIMITS;
  const pctDisplay = CONSTRAINT_PCT_DISPLAY;
  return (
    <Card className="border-muted/50 gap-3">
      <CardHeader>
        <CardTitle className="text-base">Constraints</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="maxTradePct"
              className="text-xs text-muted-foreground inline-flex items-center"
            >
              Max trade %
              <FieldTooltip field="maxTradePct" />
            </Label>
            <Input
              id="maxTradePct"
              type="number"
              min={pctDisplay.min}
              max={pctDisplay.max}
              step={1}
              value={Math.round(constraints.maxTradePct * 100)}
              onChange={(e) => {
                const pct = parseNum(e.target.value);
                const decimal = Math.min(maxTradePct.max, Math.max(maxTradePct.min, pct / 100));
                onConstraintsChange((c) => ({ ...c, maxTradePct: decimal }));
              }}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="maxPositionPct"
              className="text-xs text-muted-foreground inline-flex items-center"
            >
              Max position %
              <FieldTooltip field="maxPositionPct" />
            </Label>
            <Input
              id="maxPositionPct"
              type="number"
              min={pctDisplay.min}
              max={pctDisplay.max}
              step={1}
              value={Math.round(constraints.maxPositionPct * 100)}
              onChange={(e) => {
                const pct = parseNum(e.target.value);
                const decimal = Math.min(maxPositionPct.max, Math.max(maxPositionPct.min, pct / 100));
                onConstraintsChange((c) => ({ ...c, maxPositionPct: decimal }));
              }}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="cooldownTicks"
              className="text-xs text-muted-foreground inline-flex items-center"
            >
              Cooldown ticks
              <FieldTooltip field="cooldownTicks" />
            </Label>
            <Input
              id="cooldownTicks"
              type="number"
              min={cooldownTicks.min}
              max={cooldownTicks.max}
              value={constraints.cooldownTicks}
              onChange={(e) =>
                onConstraintsChange((c) => ({
                  ...c,
                  cooldownTicks: Math.min(
                    cooldownTicks.max,
                    Math.max(cooldownTicks.min, parseNum(e.target.value))
                  ),
                }))
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="maxTradesPerWindow"
              className="text-xs text-muted-foreground inline-flex items-center"
            >
              Max trades/window
              <FieldTooltip field="maxTradesPerWindow" />
            </Label>
            <Input
              id="maxTradesPerWindow"
              type="number"
              min={maxTradesPerWindow.min}
              max={maxTradesPerWindow.max}
              value={constraints.maxTradesPerWindow}
              onChange={(e) =>
                onConstraintsChange((c) => ({
                  ...c,
                  maxTradesPerWindow: Math.min(
                    maxTradesPerWindow.max,
                    Math.max(maxTradesPerWindow.min, parseNum(e.target.value))
                  ),
                }))
              }
              className="h-8 text-sm"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
