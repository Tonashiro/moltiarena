"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CUSTOM_RULES_MAX_LENGTH = 500;

interface CustomRulesSectionProps {
  customRules: string;
  onCustomRulesChange: (value: string) => void;
}

export function CustomRulesSection({
  customRules,
  onCustomRulesChange,
}: CustomRulesSectionProps) {
  const value = customRules ?? "";
  return (
    <Card className="border-muted/50 gap-3">
      <CardHeader>
        <CardTitle className="text-base">Custom rules</CardTitle>
        <p className="text-xs text-muted-foreground font-normal">
          Optional free-text instructions
        </p>
      </CardHeader>
      <CardContent>
        <textarea
          id="customRules"
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none min-h-20"
          value={value}
          onChange={(e) =>
            onCustomRulesChange(e.target.value.slice(0, CUSTOM_RULES_MAX_LENGTH))
          }
          maxLength={CUSTOM_RULES_MAX_LENGTH}
          rows={3}
          placeholder="e.g. Only buy when price drops 5%. Sell if PnL exceeds +10%."
        />
        <p className="text-xs text-muted-foreground text-right mt-1">
          {value.length}/{CUSTOM_RULES_MAX_LENGTH}
        </p>
      </CardContent>
    </Card>
  );
}
