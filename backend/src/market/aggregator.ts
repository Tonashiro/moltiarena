import type { InMemoryMarketStore } from "./store.js";
import type { MarketSnapshot } from "./types.js";
import type { EventStorage } from "./eventStorage.js";

const PRICE_TAIL_MAX_LEN = 10;

/** Per-token state aggregated from curve events (MVP: last-tick window; names suggest 1h for engine compatibility). */
export interface TokenState {
  lastPrice: number;
  priceTail: number[];
  /** Approx events in window (MVP: last tick window). */
  events1hCount: number;
  /** Approx volume MON in window (MVP: last tick window). */
  volumeMon1h: number;
  uniqueTraders1h: Set<string>;
  lastTickPrice: number;
  tick: number;
  /** Previous tick volume for trend calculation */
  prevVolumeMon: number;
}

function clampTail(tail: number[]): number[] {
  if (tail.length <= PRICE_TAIL_MAX_LEN) return tail;
  return tail.slice(-PRICE_TAIL_MAX_LEN);
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Returns simple realized vol % from returns (e.g. last 5 returns). */
function volPctFromReturns(returns: number[]): number {
  if (returns.length < 2) return 0;
  const s = stdDev(returns);
  return Number.isFinite(s) ? s * 100 : 0;
}

export interface AggregatorDeps {
  store: InMemoryMarketStore;
  tickMs: number;
  tokens: string[];
  /** Optional event storage for querying database events for more precise aggregation */
  eventStorage?: EventStorage;
}

/**
 * Creates per-token state and a tick loop that computes MarketSnapshot from
 * TokenState and writes to the store. Call start() and stop() for lifecycle.
 */
export function createAggregator(deps: AggregatorDeps) {
  const { store, tickMs, tokens, eventStorage } = deps;
  const stateByToken = new Map<string, TokenState>();
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let lastTickTime = Date.now();

  for (const token of tokens) {
    const t = token.toLowerCase();
    if (stateByToken.has(t)) continue;
    stateByToken.set(t, {
      lastPrice: 1,
      priceTail: [1],
      events1hCount: 0,
      volumeMon1h: 0,
      uniqueTraders1h: new Set(),
      lastTickPrice: 1,
      tick: 0,
      prevVolumeMon: 0,
    });
  }

  function getState(tokenAddress: string): TokenState | undefined {
    return stateByToken.get(tokenAddress.toLowerCase());
  }

  /** Called from stream handler (must be lightweight). */
  function applyEvent(
    tokenAddress: string,
    update: {
      price?: number;
      volumeMon?: number;
      trader?: string;
    }
  ): void {
    const key = tokenAddress.toLowerCase();
    let state = stateByToken.get(key);
    if (!state) {
      state = {
        lastPrice: 1,
        priceTail: [1],
        events1hCount: 0,
        volumeMon1h: 0,
        uniqueTraders1h: new Set(),
        lastTickPrice: 1,
        tick: 0,
        prevVolumeMon: 0,
      };
      stateByToken.set(key, state);
    }
    if (update.price != null && Number.isFinite(update.price)) {
      state.lastPrice = update.price;
      state.priceTail = clampTail([...state.priceTail, update.price]);
    }
    if (update.volumeMon != null) {
      state.volumeMon1h += update.volumeMon;
    }
    if (update.trader != null) {
      state.uniqueTraders1h.add(update.trader.toLowerCase());
    }
    state.events1hCount += 1;
  }

  const ONE_HOUR_MS = 60 * 60 * 1000;

  /** Tick: compute snapshot. events_1h and volume_mon_1h use last 1 hour; guardrails expect this. */
  async function tick(): Promise<void> {
    const now = Date.now();
    const windowStart = new Date(now - ONE_HOUR_MS);
    const windowEnd = new Date(now);
    for (const token of tokens) {
      const key = token.toLowerCase();
      const state = stateByToken.get(key);
      if (!state) continue;

      // If eventStorage is available, query database for precise stats within tick window
      let dbStats = null;
      let recentEvents: import("./types.js").CompactEvent[] = [];
      let traderMetrics = {
        uniqueTraders: 0,
        avgVolumePerTrader: 0,
        largestTrade: 0,
        whaleActivity: false,
      };

      if (eventStorage) {
        try {
          dbStats = await eventStorage.getAggregatedStats(
            token,
            windowStart,
            windowEnd
          );
          recentEvents = await eventStorage.getRecentEvents(token, 5);
          traderMetrics = await eventStorage.getTraderMetrics(
            token,
            windowStart,
            windowEnd,
            50
          );
        } catch (err) {
          console.error(`[aggregator] Failed to get DB stats for ${token}:`, err);
        }
      }

      // Use DB stats if available, otherwise fall back to in-memory state
      const eventsCount = dbStats?.totalEvents ?? state.events1hCount;
      const volumeMon = dbStats?.totalVolumeMon ?? state.volumeMon1h;
      const buyCount = dbStats?.buyCount ?? 0;
      const sellCount = dbStats?.sellCount ?? 0;
      const swapCount = dbStats?.swapCount ?? 0;
      const buySellRatio =
        sellCount > 0 ? buyCount / sellCount : buyCount || 1;

      // Prefer live stream price; fall back to most recent DB event when still at default (1)
      const priceFromStream = state.lastPrice;
      const lastEvent = recentEvents.at(-1) as [string, number, number] | undefined;
      const priceFromDb = lastEvent != null ? lastEvent[1] : null;
      const priceNow =
        priceFromStream > 1 || priceFromDb == null
          ? priceFromStream
          : priceFromDb;
      const tail = state.priceTail;
      const price1m = tail.length >= 2 ? tail[tail.length - 2]! : priceNow;
      const price5m = tail.length >= 5 ? tail[tail.length - 5]! : price1m;

      const ret1m =
        price1m > 0 ? ((priceNow - price1m) / price1m) * 100 : 0;
      const ret5m =
        price5m > 0 ? ((priceNow - price5m) / price5m) * 100 : 0;

      const returns: number[] = [];
      for (let i = 1; i < tail.length; i++) {
        const p0 = tail[i - 1]!;
        const p1 = tail[i]!;
        if (p0 > 0) returns.push(((p1 - p0) / p0) * 100);
      }
      const vol5m = volPctFromReturns(returns);

      // Compute patterns (moved here to use vol5m)
      // Momentum: based on buy/sell ratio
      const momentum: "B" | "S" | "N" =
        buySellRatio > 1.5 ? "B" : buySellRatio < 0.67 ? "S" : "N";

      // Volume trend: compare current vs previous volume
      const volumeChange = state.prevVolumeMon > 0
        ? (volumeMon - state.prevVolumeMon) / state.prevVolumeMon
        : 0;
      const volumeTrend: "I" | "D" | "S" =
        volumeChange > 0.1 ? "I" : volumeChange < -0.1 ? "D" : "S";

      // Price volatility: based on vol_5m_pct
      const priceVolatility: "H" | "M" | "L" =
        vol5m > 5 ? "H" : vol5m > 2 ? "M" : "L";

      // Fallback trader metrics if DB not available
      const finalTraderMetrics = eventStorage
        ? traderMetrics
        : {
            uniqueTraders: state.uniqueTraders1h.size,
            avgVolumePerTrader:
              state.uniqueTraders1h.size > 0
                ? volumeMon / state.uniqueTraders1h.size
                : 0,
            largestTrade: volumeMon, // Approximation
            whaleActivity: volumeMon >= 50,
          };

      const snapshot: MarketSnapshot = {
        tokenAddress: token.toLowerCase(), // Normalize for consistent lookups
        tick: state.tick,
        price: priceNow,
        ret_1m_pct: ret1m,
        ret_5m_pct: ret5m,
        vol_5m_pct: vol5m,
        events_1h: eventsCount,
        volume_mon_1h: volumeMon,
        price_tail: [...tail],
        // Enhancement 1: Buy/Sell metrics
        buyCount,
        sellCount,
        swapCount,
        buySellRatio: Math.round(buySellRatio * 100) / 100,
        // Enhancement 2: Recent events
        recentEvents: recentEvents.length > 0 ? recentEvents : [],
        // Enhancement 3: Trader metrics
        uniqueTraders: finalTraderMetrics.uniqueTraders,
        avgVolumePerTrader: Math.round(finalTraderMetrics.avgVolumePerTrader * 100) / 100,
        largestTrade: Math.round(finalTraderMetrics.largestTrade * 100) / 100,
        whaleActivity: finalTraderMetrics.whaleActivity,
        // Enhancement 4: Patterns
        momentum,
        volumeTrend,
        priceVolatility,
      };
      store.set(snapshot);

      state.lastTickPrice = priceNow;
      state.tick += 1;
      state.events1hCount = 0;
      state.volumeMon1h = 0;
      state.uniqueTraders1h = new Set();
      state.prevVolumeMon = volumeMon; // Store for next tick comparison
    }
    
    lastTickTime = now;
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTickTime = Date.now();
    void tick().catch((err: unknown) => {
      console.error("[aggregator] Tick error:", err);
    });
    intervalId = setInterval(() => {
      void tick().catch((err: unknown) => {
        console.error("[aggregator] Tick error:", err);
      });
    }, tickMs);
  }

  function stop(): void {
    running = false;
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  }

  return {
    getState,
    applyEvent,
    start,
    stop,
  };
}
