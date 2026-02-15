/**
 * Mock trade data generator for testing TradeOverlay visualization
 */

import type { TradeMarker } from "./types";

/**
 * Generate mock trades for testing
 * Creates trades from different agents at various times and prices
 * @param timeRange - Time range in milliseconds {min, max}
 * @param priceRange - Price range {min, max}
 */
export function generateMockTrades(
  timeRange: { min: number; max: number },
  priceRange: { min: number; max: number }
): TradeMarker[] {
  const { min: startTime, max: endTime } = timeRange;
  const { min: minPrice, max: maxPrice } = priceRange;
  
  const agents = [
    "AlphaBot",
    "BetaTrader",
    "GammaAI",
    "DeltaStrategy",
    "EpsilonBot",
  ];

  const reasons = [
    "Strong upward momentum detected",
    "Price consolidation pattern identified",
    "Volume spike indicates potential breakout",
    "Support level reached, buying opportunity",
    "Resistance level hit, taking profits",
    "RSI oversold, expecting bounce",
    "RSI overbought, selling pressure",
    "MACD crossover signal",
    "Moving average convergence",
    "Market sentiment shift detected",
  ];

  const trades: TradeMarker[] = [];

  // Generate trades spread across the time range
  const numTrades = 25;
  const timeSpan = endTime - startTime;
  const priceSpan = maxPrice - minPrice;

  for (let i = 0; i < numTrades; i++) {
    // Distribute trades across the time range
    const timeProgress = i / (numTrades - 1);
    const timestamp = startTime + timeProgress * timeSpan;

    // Vary prices within the price range (with some margin to stay visible)
    const priceMargin = priceSpan * 0.1; // 10% margin from edges
    const effectiveMinPrice = minPrice + priceMargin;
    const effectiveMaxPrice = maxPrice - priceMargin;
    const price = effectiveMinPrice + Math.random() * (effectiveMaxPrice - effectiveMinPrice);

    // Alternate between buy and sell, with slight bias toward buys
    const action = Math.random() > 0.45 ? "BUY" : "SELL";

    // Random agent
    const agentName = agents[Math.floor(Math.random() * agents.length)];

    // Random size (10% to 80%)
    const sizePct = 0.1 + Math.random() * 0.7;

    // Random reason
    const reason = reasons[Math.floor(Math.random() * reasons.length)];

    trades.push({
      id: `mock-${i}-${timestamp}`,
      agentName,
      action: action as "BUY" | "SELL",
      price,
      sizePct,
      timestamp,
      reason,
    });
  }

  // Sort by timestamp
  return trades.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Generate mock trades with specific pattern for better visualization
 * Creates clusters of trades at different price levels
 * @param timeRange - Time range in milliseconds {min, max}
 * @param priceRange - Price range {min, max}
 */
export function generatePatternMockTrades(
  timeRange: { min: number; max: number },
  priceRange: { min: number; max: number }
): TradeMarker[] {
  const { min: startTime, max: endTime } = timeRange;
  const { min: minPrice, max: maxPrice } = priceRange;
  const priceSpan = maxPrice - minPrice;
  
  const agents = [
    "AlphaBot",
    "BetaTrader",
    "GammaAI",
    "DeltaStrategy",
    "EpsilonBot",
  ];

  const trades: TradeMarker[] = [];

  // Create price clusters within the visible price range
  // Use percentages of the price range to create clusters
  const priceLevels = [
    { pricePercent: 0.15, action: "BUY" as const, count: 5 }, // Lower range - buys
    { pricePercent: 0.35, action: "BUY" as const, count: 4 },
    { pricePercent: 0.50, action: "BUY" as const, count: 3 }, // Middle
    { pricePercent: 0.65, action: "SELL" as const, count: 4 },
    { pricePercent: 0.85, action: "SELL" as const, count: 5 }, // Upper range - sells
  ];

  let tradeIndex = 0;
  const totalTrades = priceLevels.reduce((sum, level) => sum + level.count, 0);

  const timeSpan = endTime - startTime;
  
  priceLevels.forEach((level, levelIndex) => {
    for (let i = 0; i < level.count; i++) {
      const timeProgress = tradeIndex / (totalTrades - 1);
      const timestamp = startTime + timeProgress * timeSpan;
      
      // Calculate price based on percentage of price range
      const basePriceAtLevel = minPrice + (level.pricePercent * priceSpan);
      
      // Add small random variation to price and time (±5% of span)
      const priceVariation = priceSpan * 0.05 * (Math.random() - 0.5);
      const timeVariation = timeSpan * 0.05 * (Math.random() - 0.5);
      
      const agentName = agents[Math.floor(Math.random() * agents.length)];
      const sizePct = 0.2 + Math.random() * 0.6;

      trades.push({
        id: `mock-pattern-${levelIndex}-${i}-${timestamp}`,
        agentName,
        action: level.action,
        price: Math.max(minPrice, Math.min(maxPrice, basePriceAtLevel + priceVariation)),
        sizePct,
        timestamp: Math.max(startTime, Math.min(endTime, timestamp + timeVariation)),
        reason: level.action === "BUY" 
          ? "Buying at support level"
          : "Selling at resistance level",
      });

      tradeIndex++;
    }
  });

  // Sort by timestamp
  return trades.sort((a, b) => a.timestamp - b.timestamp);
}
