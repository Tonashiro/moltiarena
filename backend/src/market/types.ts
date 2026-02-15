/**
 * Compact representation of recent event for efficient token usage.
 * Format: [type, price, volume] where type: "B"=Buy, "S"=Sell, "W"=Swap
 */
export type CompactEvent = [string, number, number];

export interface MarketSnapshot {
  tokenAddress: string;
  tick: number;
  price: number;
  ret_1m_pct: number;
  ret_5m_pct: number;
  vol_5m_pct: number;
  events_1h: number;
  volume_mon_1h: number;
  price_tail: number[]; // max length 10
  
  // Enhancement 1: Buy/Sell metrics
  buyCount: number;
  sellCount: number;
  swapCount: number;
  buySellRatio: number; // buyCount / sellCount (or buyCount if no sells)
  
  // Enhancement 2: Recent event history (compact format)
  recentEvents: CompactEvent[]; // Last 5 events: ["B", price, volume]
  
  // Enhancement 3: Trader metrics
  uniqueTraders: number;
  avgVolumePerTrader: number;
  largestTrade: number;
  whaleActivity: boolean; // true if any trade > 50 MON
  
  // Enhancement 4: Time-based patterns
  momentum: "B" | "S" | "N"; // B=bullish, S=bearish, N=neutral
  volumeTrend: "I" | "D" | "S"; // I=increasing, D=decreasing, S=stable
  priceVolatility: "H" | "M" | "L"; // H=high, M=medium, L=low
}
