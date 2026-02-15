/**
 * Chart-related type definitions
 */

/**
 * Trade marker for displaying agent trades on charts
 */
export interface TradeMarker {
  id: string;
  agentName: string;
  action: "BUY" | "SELL" | "HOLD";
  price: number;
  sizePct: number;
  timestamp: number; // Unix timestamp in ms
  reason?: string;
}

/**
 * Props for TradingViewChart component
 */
export interface TradingViewChartProps {
  tokenAddress: string;
  tokenSymbol?: string;
  /** @deprecated MVP: trade overlay removed; kept for API compatibility */
  trades?: TradeMarker[];
  height?: number;
  /** @deprecated MVP: overlay removed */
  onChartReady?: (timeRange: { min: number; max: number }, priceRange: { min: number; max: number }) => void;
}

/**
 * nad.fun API chart data response format
 */
export interface NadFunChartResponse {
  k: string; // chart type key
  t: number[]; // timestamps (Unix seconds)
  c: string[]; // close prices
  o: string[]; // open prices
  h: string[]; // high prices
  l: string[]; // low prices
  v: string[]; // volumes
  s: string; // status
}

/**
 * Chart type parameter for nad.fun API
 */
export type ChartTypeParam =
  | "price_usd"
  | "market_cap_usd"
  | "market_cap"
  | "price";
