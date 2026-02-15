"use client";

import { cn } from "@/app/lib/utils";

export interface ToggleButtonGroupProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}

/**
 * Reusable toggle button group component
 * Used for timeframe, chart type, and currency selections
 */
export function ToggleButtonGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: ToggleButtonGroupProps<T>) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={cn(
              "px-3 py-1 text-xs rounded transition-colors",
              value === option
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
