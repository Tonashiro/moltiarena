/**
 * Utility functions for chart components
 */

import type { CandlestickData } from "lightweight-charts";
import { TIMEFRAME_MS, type Timeframe } from "./constants";
import type { NadFunChartResponse } from "./types";

/**
 * Filter trades by timeframe
 */
export function filterTradesByTimeframe<T extends { timestamp: number }>(
  trades: T[],
  timeframe: Timeframe
): T[] {
  const now = Date.now();
  const cutoff = now - TIMEFRAME_MS[timeframe];
  return trades.filter((t) => t.timestamp >= cutoff);
}

/**
 * Calculate price range from chart data or trades
 */
export function calculatePriceRange(
  chartData: CandlestickData[],
  trades: Array<{ price: number }>
): { min: number; max: number; range: number } {
  let prices: number[];

  if (chartData.length > 0) {
    prices = chartData.flatMap((d) => [d.high, d.low, d.open, d.close]);
  } else {
    prices = trades.map((t) => t.price);
  }

  const min = prices.length > 0 ? Math.min(...prices) : 0;
  const max = prices.length > 0 ? Math.max(...prices) : 0;
  const range = max - min || 1;

  return { min, max, range };
}

/**
 * Calculate time range from chart data or trades
 */
export function calculateTimeRange(
  chartData: CandlestickData[],
  trades: Array<{ timestamp: number }>
): { min: number; max: number; range: number } {
  let timestamps: number[];

  if (chartData.length > 0) {
    timestamps = chartData.map((d) => Number(d.time));
  } else {
    timestamps = trades.map((t) => t.timestamp);
  }

  const min =
    timestamps.length > 0
      ? Math.min(...timestamps)
      : Date.now() - 24 * 60 * 60 * 1000;
  const max = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  const range = max - min || 1;

  return { min, max, range };
}

/**
 * Get timeframe configuration for API calls
 */
export function getTimeframeConfig(timeframe: Timeframe): {
  resolution: string;
  from: number;
} {
  const now = Math.floor(Date.now() / 1000); // Unix seconds
  const resolutions: Record<Timeframe, string> = {
    "1h": "60",
    "6h": "5",
    "24h": "1H",
    "7d": "1D",
  };
  const fromTimes: Record<Timeframe, number> = {
    "1h": now - 3600,
    "6h": now - 21600,
    "24h": now - 86400,
    "7d": now - 604800,
  };

  return {
    resolution: resolutions[timeframe],
    from: fromTimes[timeframe],
  };
}

/**
 * Convert wei (18 decimals) to MON
 */
export function weiToMon(wei: string): number {
  return parseFloat(wei) / 1e18;
}

/**
 * Convert nad.fun chart data to TradingView candlestick format
 * Handles different chart types: price_usd (already decimal), market_cap (wei format)
 */
export function convertToCandlestickData(
  data: NadFunChartResponse,
): CandlestickData[] {
  const result: CandlestickData[] = [];
  const { t, o, h, l, c, k } = data;

  // Determine if data is in wei format (market_cap) or already decimal (price_usd)
  const isWeiFormat = k === "market_cap_usd" || k === "market_cap";

  for (let i = 0; i < t.length; i++) {
    const convert = (val: string) => {
      if (isWeiFormat) {
        return weiToMon(val);
      }
      return parseFloat(val);
    };

    result.push({
      time: (t[i] * 1000) as CandlestickData["time"], // Convert to milliseconds
      open: convert(o[i]),
      high: convert(h[i]),
      low: convert(l[i]),
      close: convert(c[i]),
    } as CandlestickData);
  }

  return result;
}
