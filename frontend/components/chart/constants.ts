/**
 * Shared constants for chart components
 */

export const TIMEFRAMES = ["1h", "6h", "24h", "7d"] as const;
export type Timeframe = typeof TIMEFRAMES[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * nad.fun API resolution mapping
 * Allowed resolutions: "1", "5", "15", "30", "60", "1H", "240", "4H", "D", "1D", "W", "1W", "M", "1M"
 */
export const TIMEFRAME_RESOLUTIONS: Record<Timeframe, string> = {
  "1h": "60", // 1-minute bars
  "6h": "5", // 5-minute bars
  "24h": "1H", // 1-hour bars
  "7d": "1D", // 1-day bars
};

/**
 * Chart type options
 */
export const CHART_TYPES = ["price", "mcap"] as const;
export type ChartType = typeof CHART_TYPES[number];

export const CURRENCIES = ["usd", "mon"] as const;
export type Currency = typeof CURRENCIES[number];

/**
 * Map chart type and currency to nad.fun API chart_type parameter
 */
export function getChartTypeParam(
  chartType: ChartType,
  currency: Currency
): "price_usd" | "market_cap_usd" | "market_cap" | "price" {
  if (chartType === "price") {
    return currency === "usd" ? "price_usd" : "price";
  }
  return currency === "usd" ? "market_cap_usd" : "market_cap";
}

/**
 * Chart color constants (TradingView doesn't support CSS variables)
 */
export const CHART_COLORS = {
  text: "#71717a", // muted-foreground equivalent
  border: "#27272a", // border equivalent (dark theme)
  up: "#10b981", // emerald-500
  down: "#ef4444", // red-500
} as const;

/**
 * Chart configuration constants
 */
export const CHART_CONFIG = {
  priceFormat: {
    precision: 8,
    minMove: 0.00000001,
  },
  scaleMargins: {
    top: 0.1,
    bottom: 0.1,
  },
  /**
   * Polling interval for chart data updates (in milliseconds)
   * Set to 30 seconds to balance freshness with API rate limits
   */
  pollInterval: 30000, // 30 seconds
} as const;
