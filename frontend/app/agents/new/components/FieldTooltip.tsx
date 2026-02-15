"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AGENT_FIELD_TOOLTIPS } from "../../constants";

interface FieldTooltipProps {
  field: string;
}

export function FieldTooltip({ field }: FieldTooltipProps) {
  const tip = AGENT_FIELD_TOOLTIPS[field];
  if (!tip) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] leading-none text-muted-foreground hover:bg-muted-foreground/10 transition-colors cursor-help"
          tabIndex={-1}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-pre-line">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
