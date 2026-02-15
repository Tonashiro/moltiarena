export type { MarketSnapshot } from "./types.js";
export { InMemoryMarketStore } from "./store.js";
export { createAggregator } from "./aggregator.js";
export type { TokenState } from "./aggregator.js";
export { startNadfunStream } from "./nadfunStream.js";
export { EventStorage } from "./eventStorage.js";
export { CleanupService } from "./cleanup.js";

import type { InMemoryMarketStore } from "./store.js";
import { createAggregator } from "./aggregator.js";
import { startNadfunStream } from "./nadfunStream.js";
import type { EventStorage } from "./eventStorage.js";

export interface StartMarketFeedDeps {
  store: InMemoryMarketStore;
  tickSeconds: number;
  /** Comma-separated token addresses or array. */
  arenaTokens: string | string[];
  rpcUrl: string;
  wsUrl: string;
  network?: "testnet" | "mainnet";
  /** Use DEX stream for graduated tokens (default: false, uses curve stream) */
  useDexStream?: boolean;
  /** Optional event storage for persisting events to database */
  eventStorage?: EventStorage;
}

export interface MarketFeedHandle {
  stop(): void;
}

/**
 * Start the nad.fun WebSocket market feed: curve stream + aggregator tick.
 * Updates store with MarketSnapshot for each arena token every tickSeconds.
 */
export function startMarketFeed(deps: StartMarketFeedDeps): MarketFeedHandle {
  const raw = deps.arenaTokens;
  const tokens: string[] =
    typeof raw === "string"
      ? raw.split(",").map((s: string) => s.trim()).filter(Boolean)
      : raw;
  if (tokens.length === 0) {
    throw new Error("startMarketFeed: arenaTokens is empty");
  }

  const aggregator = createAggregator({
    store: deps.store,
    tickMs: deps.tickSeconds * 1000,
    tokens,
    eventStorage: deps.eventStorage,
  });
  aggregator.start();

  const streamHandle = startNadfunStream({
    rpcUrl: deps.rpcUrl,
    wsUrl: deps.wsUrl,
    network: deps.network ?? "testnet",
    tokens,
    aggregator,
    useDexStream: deps.useDexStream,
    eventStorage: deps.eventStorage,
  });

  return {
    stop() {
      streamHandle.stop();
      aggregator.stop();
    },
  };
}
