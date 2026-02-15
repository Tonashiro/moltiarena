import type { MarketSnapshot } from "./types.js";

export class InMemoryMarketStore {
  private byToken = new Map<string, MarketSnapshot>();

  /** Normalize token address to lowercase for consistent lookups */
  private normalize(tokenAddress: string): string {
    return tokenAddress.toLowerCase();
  }

  set(snapshot: MarketSnapshot): void {
    // Store with normalized key, but preserve original case in snapshot
    this.byToken.set(this.normalize(snapshot.tokenAddress), { ...snapshot });
  }

  get(tokenAddress: string): MarketSnapshot | undefined {
    const s = this.byToken.get(this.normalize(tokenAddress));
    return s === undefined ? undefined : { ...s };
  }

  list(): MarketSnapshot[] {
    return Array.from(this.byToken.values()).map((s) => ({ ...s }));
  }
}
