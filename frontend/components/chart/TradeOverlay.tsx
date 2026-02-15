"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/app/lib/utils";
import type { TradeMarker } from "./types";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

export interface TradeOverlayProps {
  trades: TradeMarker[];
  chartApi: IChartApi;
  seriesApi: ISeriesApi<"Candlestick">;
  hoveredTrade: string | null;
  onTradeHover: (tradeId: string | null) => void;
}

/**
 * Reusable trade overlay component for displaying agent trade markers on charts
 * Uses lightweight-charts API to convert time/price coordinates to pixel positions
 */
export function TradeOverlay({
  trades,
  chartApi,
  seriesApi,
  hoveredTrade,
  onTradeHover,
}: TradeOverlayProps) {
  if (trades.length === 0) return null;

  // Pre-compute positions for all trades using useMemo to avoid recalculating on every render
  const positionedTrades = useMemo(() => {
    return trades
      .map((trade) => {
        try {
          // Try both seconds and milliseconds format
          const timeInSeconds = Math.floor(trade.timestamp / 1000) as Time;
          const timeInMs = trade.timestamp as Time;
          
          // Convert time to X pixel coordinate
          let xPixel = chartApi.timeScale().timeToCoordinate(timeInSeconds);
          if (xPixel === null) {
            xPixel = chartApi.timeScale().timeToCoordinate(timeInMs);
          }
          
          // Convert price to Y pixel coordinate
          const yPixel = seriesApi.priceToCoordinate(trade.price);
          
          // Debug logging in development
          if (process.env.NODE_ENV === 'development' && (xPixel === null || yPixel === null)) {
            const visibleRange = chartApi.timeScale().getVisibleRange();
            const priceRange = seriesApi.priceScale().getVisibleRange();
            console.log(`[TradeOverlay] Trade ${trade.id} outside visible range:`, {
              timestamp: trade.timestamp,
              timeInSeconds,
              timeInMs,
              price: trade.price,
              xPixel,
              yPixel,
              visibleTimeRange: visibleRange,
              visiblePriceRange: priceRange,
            });
          }
          
          // Return null if coordinates are invalid
          if (xPixel === null || yPixel === null || !Number.isFinite(xPixel) || !Number.isFinite(yPixel) || xPixel < 0 || yPixel < 0) {
            return null;
          }
          
          return {
            trade,
            xPixel: Number(xPixel),
            yPixel: Number(yPixel),
          };
        } catch (error) {
          console.warn(`[TradeOverlay] Failed to position trade ${trade.id}:`, error);
          return null;
        }
      })
      .filter((item) => item !== null) as Array<{ trade: TradeMarker; xPixel: number; yPixel: number }>;
  }, [trades, chartApi, seriesApi]);

  if (positionedTrades.length === 0) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[TradeOverlay] No trades could be positioned on chart');
    }
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      {positionedTrades.map(({ trade, xPixel, yPixel }) => {
        const isBuy = trade.action === "BUY";
        const isHovered = hoveredTrade === trade.id;

        return (
          <div
            key={trade.id}
            className="absolute pointer-events-auto group"
            style={{
              left: `${xPixel}px`,
              top: `${yPixel}px`,
              transform: "translate(-50%, -50%)",
            }}
            onMouseEnter={() => onTradeHover(trade.id)}
            onMouseLeave={() => onTradeHover(null)}
          >
            {/* Trade Bubble */}
            <div
              className={cn(
                "relative flex items-center justify-center rounded-full transition-all duration-200",
                "shadow-lg border-2",
                isBuy
                  ? "bg-emerald-500/90 border-emerald-600 hover:bg-emerald-500 hover:scale-125"
                  : "bg-amber-500/90 border-amber-600 hover:bg-amber-500 hover:scale-125",
                isHovered ? "scale-125 z-20" : "scale-100",
                // Size based on trade size
                trade.sizePct > 0.5
                  ? "w-6 h-6"
                  : trade.sizePct > 0.2
                    ? "w-5 h-5"
                    : "w-4 h-4"
              )}
            >
              {/* Icon */}
              <svg
                className={cn(
                  "w-3 h-3 text-white",
                  trade.sizePct > 0.5 ? "w-4 h-4" : ""
                )}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isBuy ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 10l7-7m0 0l7 7m-7-7v18"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                )}
              </svg>

              {/* Tooltip on hover */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-popover border border-border rounded-lg shadow-lg min-w-[200px] z-30 pointer-events-none">
                  <div className="text-xs font-medium text-foreground mb-1">
                    {trade.agentName}
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant={isBuy ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {trade.action}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {(trade.sizePct * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-xs font-mono text-foreground">
                    {trade.price.toFixed(6)} MON
                  </div>
                  {trade.reason && (
                    <div className="text-xs text-muted-foreground mt-1 pt-1 border-t border-border">
                      {trade.reason}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              )}

              {/* Pulse animation */}
              <div
                className={cn(
                  "absolute inset-0 rounded-full animate-ping opacity-20",
                  isBuy ? "bg-emerald-500" : "bg-amber-500"
                )}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
