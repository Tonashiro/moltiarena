import { PrismaClient } from "@prisma/client";
import type { CompactEvent } from "./types.js";
import { normalizeTokenAddress, normalizeTransactionHash, sanitizeString, validateNumber } from "../utils/validation.js";

export interface MarketEventData {
  tokenAddress: string;
  eventType: "Buy" | "Sell" | "Swap" | "Create" | "Sync";
  price?: number;
  volumeMon?: number;
  traderAddress?: string;
  poolAddress?: string;
  transactionHash?: string;
  amountIn?: string;
  amountOut?: string;
}

export class EventStorage {
  constructor(private prisma: PrismaClient) {}

  /**
   * Store a market event in the database.
   * Validates and sanitizes input data for security.
   */
  async storeEvent(event: MarketEventData): Promise<void> {
    try {
      // Validate token address
      const tokenAddress = normalizeTokenAddress(event.tokenAddress);
      if (!tokenAddress) {
        console.warn("[eventStorage] Invalid token address, skipping event");
        return;
      }

      // Validate event type
      const validEventTypes = ["Buy", "Sell", "Swap", "Create", "Sync"];
      if (!validEventTypes.includes(event.eventType)) {
        console.warn(`[eventStorage] Invalid event type: ${event.eventType}`);
        return;
      }

      // Validate and sanitize addresses
      const traderAddress = event.traderAddress
        ? normalizeTokenAddress(event.traderAddress)
        : null;
      const poolAddress = event.poolAddress
        ? normalizeTokenAddress(event.poolAddress)
        : null;
      const transactionHash = event.transactionHash
        ? normalizeTransactionHash(event.transactionHash) // TX hash is 32-byte hex string, not address
        : null;

      // Validate numeric values
      const price = event.price !== undefined
        ? validateNumber(event.price, 0, 1e12) // Max reasonable price
        : null;
      const volumeMon = event.volumeMon !== undefined
        ? validateNumber(event.volumeMon, 0, 1e15) // Max reasonable volume
        : null;

      // Sanitize string fields
      const amountIn = event.amountIn
        ? sanitizeString(event.amountIn, 100)
        : null;
      const amountOut = event.amountOut
        ? sanitizeString(event.amountOut, 100)
        : null;

      await this.prisma.marketEvent.create({
        data: {
          tokenAddress,
          eventType: event.eventType,
          price,
          volumeMon,
          traderAddress,
          poolAddress,
          transactionHash,
          amountIn,
          amountOut,
        },
      });
    } catch (error) {
      // Log but don't throw - we don't want to break the stream if DB write fails
      console.error("[eventStorage] Failed to store event:", error);
    }
  }

  /**
   * Store multiple events in a batch (more efficient).
   * Validates all events before storing.
   */
  async storeEvents(events: MarketEventData[]): Promise<void> {
    if (events.length === 0) return;
    try {
      const validEvents = events
        .map((event) => {
          const tokenAddress = normalizeTokenAddress(event.tokenAddress);
          if (!tokenAddress) return null;

          const validEventTypes = ["Buy", "Sell", "Swap", "Create", "Sync"];
          if (!validEventTypes.includes(event.eventType)) return null;

          return {
            tokenAddress,
            eventType: event.eventType,
            price: event.price !== undefined
              ? validateNumber(event.price, 0, 1e12)
              : null,
            volumeMon: event.volumeMon !== undefined
              ? validateNumber(event.volumeMon, 0, 1e15)
              : null,
            traderAddress: event.traderAddress
              ? normalizeTokenAddress(event.traderAddress)
              : null,
            poolAddress: event.poolAddress
              ? normalizeTokenAddress(event.poolAddress)
              : null,
            transactionHash: event.transactionHash
              ? normalizeTransactionHash(event.transactionHash)
              : null,
            amountIn: event.amountIn
              ? sanitizeString(event.amountIn, 100)
              : null,
            amountOut: event.amountOut
              ? sanitizeString(event.amountOut, 100)
              : null,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (validEvents.length === 0) return;

      await this.prisma.marketEvent.createMany({
        data: validEvents,
        skipDuplicates: true,
      });
    } catch (error) {
      console.error("[eventStorage] Failed to store events batch:", error);
    }
  }

  /**
   * Delete all events older than the specified timestamp.
   */
  async cleanupOlderThan(beforeTimestamp: Date): Promise<number> {
    try {
      const result = await this.prisma.marketEvent.deleteMany({
        where: {
          createdAt: {
            lt: beforeTimestamp,
          },
        },
      });
      return result.count;
    } catch (error) {
      console.error("[eventStorage] Failed to cleanup events:", error);
      return 0;
    }
  }

  /**
   * Get aggregated statistics for a token within a time window.
   */
  async getAggregatedStats(
    tokenAddress: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    totalEvents: number;
    totalVolumeMon: number;
    buyCount: number;
    sellCount: number;
    swapCount: number;
    uniqueTraders: number;
    avgPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
  }> {
    try {
      const events = await this.prisma.marketEvent.findMany({
        where: {
          tokenAddress: tokenAddress.toLowerCase(),
          createdAt: {
            gte: startTime,
            lt: endTime,
          },
        },
      });

      const buyCount = events.filter((e: { eventType: string }) => e.eventType === "Buy").length;
      const sellCount = events.filter((e: { eventType: string }) => e.eventType === "Sell").length;
      const swapCount = events.filter((e: { eventType: string }) => e.eventType === "Swap").length;

      const totalVolumeMon = events.reduce(
        (sum: number, e: { volumeMon: number | null }) => sum + (e.volumeMon ?? 0),
        0
      );

      const traders = new Set<string>();
      events.forEach((e: { traderAddress: string | null }) => {
        if (e.traderAddress) traders.add(e.traderAddress);
      });

      const prices = events
        .map((e: { price: number | null }) => e.price)
        .filter((p: number | null): p is number => p !== null && Number.isFinite(p));

      const avgPrice =
        prices.length > 0
          ? prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length
          : null;
      const minPrice = prices.length > 0 ? Math.min(...prices) : null;
      const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

      return {
        totalEvents: events.length,
        totalVolumeMon,
        buyCount,
        sellCount,
        swapCount,
        uniqueTraders: traders.size,
        avgPrice,
        minPrice,
        maxPrice,
      };
    } catch (error) {
      console.error("[eventStorage] Failed to get aggregated stats:", error);
      return {
        totalEvents: 0,
        totalVolumeMon: 0,
        buyCount: 0,
        sellCount: 0,
        swapCount: 0,
        uniqueTraders: 0,
        avgPrice: null,
        minPrice: null,
        maxPrice: null,
      };
    }
  }

  /**
   * Get recent events in compact format for efficient token usage.
   * Returns last N events as [type, price, volume] tuples.
   */
  async getRecentEvents(
    tokenAddress: string,
    limit: number = 5
  ): Promise<CompactEvent[]> {
    try {
      const events = await this.prisma.marketEvent.findMany({
        where: {
          tokenAddress: tokenAddress.toLowerCase(),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return events
        .map((e) => {
          const typeCode =
            e.eventType === "Buy"
              ? "B"
              : e.eventType === "Sell"
                ? "S"
                : e.eventType === "Swap"
                  ? "W"
                  : null;
          if (!typeCode || e.price === null || e.volumeMon === null) {
            return null;
          }
          // Round to 6 decimals for price, 2 for volume to save tokens
          return [
            typeCode,
            Math.round(e.price * 1e6) / 1e6,
            Math.round(e.volumeMon * 100) / 100,
          ] as CompactEvent;
        })
        .filter((e): e is CompactEvent => e !== null)
        .reverse(); // Reverse to show chronological order (oldest first)
    } catch (error) {
      console.error("[eventStorage] Failed to get recent events:", error);
      return [];
    }
  }

  /**
   * Get trader metrics for a token within a time window.
   */
  async getTraderMetrics(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    whaleThreshold: number = 50
  ): Promise<{
    uniqueTraders: number;
    avgVolumePerTrader: number;
    largestTrade: number;
    whaleActivity: boolean;
  }> {
    try {
      const events = await this.prisma.marketEvent.findMany({
        where: {
          tokenAddress: tokenAddress.toLowerCase(),
          createdAt: {
            gte: startTime,
            lt: endTime,
          },
          volumeMon: { not: null },
        },
      });

      if (events.length === 0) {
        return {
          uniqueTraders: 0,
          avgVolumePerTrader: 0,
          largestTrade: 0,
          whaleActivity: false,
        };
      }

      const traders = new Set<string>();
      const volumes: number[] = [];
      let largestTrade = 0;

      events.forEach((e) => {
        if (e.traderAddress) {
          traders.add(e.traderAddress);
        }
        if (e.volumeMon !== null) {
          const vol = e.volumeMon;
          volumes.push(vol);
          if (vol > largestTrade) {
            largestTrade = vol;
          }
        }
      });

      const uniqueTraders = traders.size;
      const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
      const avgVolumePerTrader =
        uniqueTraders > 0 ? totalVolume / uniqueTraders : 0;

      return {
        uniqueTraders,
        avgVolumePerTrader: Math.round(avgVolumePerTrader * 100) / 100,
        largestTrade: Math.round(largestTrade * 100) / 100,
        whaleActivity: largestTrade >= whaleThreshold,
      };
    } catch (error) {
      console.error("[eventStorage] Failed to get trader metrics:", error);
      return {
        uniqueTraders: 0,
        avgVolumePerTrader: 0,
        largestTrade: 0,
        whaleActivity: false,
      };
    }
  }
}
