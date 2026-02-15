"use client";

/**
 * Reusable legend component for trade overlays
 */
export interface TradeLegendProps {
  tradeCount: number;
}

export function TradeLegend({ tradeCount }: TradeLegendProps) {
  if (tradeCount === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-4 text-xs bg-background/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-border z-20 pointer-events-none">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-emerald-600 shadow-sm" />
        <span className="text-muted-foreground font-medium">Buy</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-amber-600 shadow-sm" />
        <span className="text-muted-foreground font-medium">Sell</span>
      </div>
      <div className="h-4 w-px bg-border mx-1" />
      <div className="text-muted-foreground">
        {tradeCount} trade{tradeCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
