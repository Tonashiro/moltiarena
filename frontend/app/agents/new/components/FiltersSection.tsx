"use client";

import type { AgentProfileConfig } from "@/app/lib/agentProfileSchema";
import { parseNum } from "@/app/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldTooltip } from "./FieldTooltip";
import { FILTER_LIMITS } from "../../constants";

interface FiltersSectionProps {
  filters: AgentProfileConfig["filters"];
  onFiltersChange: (
    updater: (prev: AgentProfileConfig["filters"]) => AgentProfileConfig["filters"]
  ) => void;
}

export function FiltersSection({ filters, onFiltersChange }: FiltersSectionProps) {
  const { minEvents1h, minVolumeMon1h } = FILTER_LIMITS;
  return (
    <Card className="border-muted/50 gap-3">
      <CardHeader>
        <CardTitle className="text-base">Filters</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="minEvents1h"
              className="text-xs text-muted-foreground inline-flex items-center"
            >
              Min events 1h
              <FieldTooltip field="minEvents1h" />
            </Label>
            <Input
              id="minEvents1h"
              type="number"
              min={minEvents1h.min}
              max={minEvents1h.max}
              value={filters.minEvents1h}
              onChange={(e) =>
                onFiltersChange((f) => ({
                  ...f,
                  minEvents1h: Math.min(
                    minEvents1h.max,
                    Math.max(minEvents1h.min, parseNum(e.target.value))
                  ),
                }))
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="minVolumeMon1h"
              className="text-xs text-muted-foreground inline-flex items-center"
            >
              Min volume 1h
              <FieldTooltip field="minVolumeMon1h" />
            </Label>
            <Input
              id="minVolumeMon1h"
              type="number"
              min={minVolumeMon1h.min}
              value={filters.minVolumeMon1h}
              onChange={(e) =>
                onFiltersChange((f) => ({
                  ...f,
                  minVolumeMon1h: Math.max(minVolumeMon1h.min, parseNum(e.target.value)),
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
