"use client";

import type { AgentProfileConfig } from "@/app/lib/agentProfileSchema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldTooltip } from "./FieldTooltip";
import { AGENT_GOAL_OPTIONS, AGENT_STYLE_OPTIONS } from "../../constants";

interface IdentityStrategySectionProps {
  profile: AgentProfileConfig;
  errors: Record<string, string>;
  onProfileChange: (updater: (prev: AgentProfileConfig) => AgentProfileConfig) => void;
}

export function IdentityStrategySection({
  profile,
  errors,
  onProfileChange,
}: IdentityStrategySectionProps) {
  return (
    <Card className="border-muted/50 gap-3">
      <CardHeader>
        <CardTitle className="text-base">Identity & strategy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name" className="inline-flex items-center text-sm">
            Name (3–40 chars)
            <FieldTooltip field="name" />
          </Label>
          <Input
            id="name"
            type="text"
            value={profile.name}
            onChange={(e) => onProfileChange((p) => ({ ...p, name: e.target.value }))}
            maxLength={40}
            placeholder="e.g. Alpha Trader"
            aria-invalid={!!errors.name}
            className="h-9"
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal" className="inline-flex items-center text-sm">
              Goal
              <FieldTooltip field="goal" />
            </Label>
            <Select
              value={profile.goal}
              onValueChange={(v) =>
                onProfileChange((p) => ({ ...p, goal: v as AgentProfileConfig["goal"] }))
              }
            >
              <SelectTrigger id="goal" className="h-9">
                <SelectValue placeholder="Select goal" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_GOAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="style" className="inline-flex items-center text-sm">
              Style
              <FieldTooltip field="style" />
            </Label>
            <Select
              value={profile.style}
              onValueChange={(v) =>
                onProfileChange((p) => ({ ...p, style: v as AgentProfileConfig["style"] }))
              }
            >
              <SelectTrigger id="style" className="h-9">
                <SelectValue placeholder="Select style" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_STYLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
