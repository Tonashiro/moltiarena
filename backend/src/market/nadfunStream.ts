import { initSDK, createDexStreamWithTokens, discoverPoolsForTokens } from "@nadfun/sdk";
import { formatEther, isAddress } from "viem";
import type { CurveEvent, SwapEvent } from "@nadfun/sdk";
import type { createAggregator } from "./aggregator.js";
import type { EventStorage } from "./eventStorage.js";
import { getTokenName } from "./tokenNames.js";

const MIN_RECONNECT_MS = 2000;
const MAX_RECONNECT_MS = 60_000;

export type AggregatorInstance = ReturnType<typeof createAggregator>;

/** Dummy key for read-only streaming (SDK requires privateKey in config). */
const DUMMY_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

function parsePriceFromEvent(ev: CurveEvent): number | null {
  try {
    if (ev.type === "Buy" && "amountIn" in ev && "amountOut" in ev) {
      const mon = Number(formatEther(ev.amountIn));
      const tokens = Number(formatEther(ev.amountOut));
      if (tokens > 0 && Number.isFinite(mon / tokens)) return mon / tokens;
    }
    if (ev.type === "Sell" && "amountIn" in ev && "amountOut" in ev) {
      const tokens = Number(formatEther(ev.amountIn));
      const mon = Number(formatEther(ev.amountOut));
      if (tokens > 0 && Number.isFinite(mon / tokens)) return mon / tokens;
    }
    if (
      ev.type === "Sync" &&
      "realMonReserve" in ev &&
      "realTokenReserve" in ev
    ) {
      const mon = Number(formatEther(ev.realMonReserve));
      const tokens = Number(formatEther(ev.realTokenReserve));
      if (tokens > 0 && Number.isFinite(mon / tokens)) return mon / tokens;
    }
    if (
      ev.type === "Create" &&
      "virtualMon" in ev &&
      "virtualToken" in ev
    ) {
      const mon = Number(formatEther(ev.virtualMon));
      const tokens = Number(formatEther(ev.virtualToken));
      if (tokens > 0 && Number.isFinite(mon / tokens)) return mon / tokens;
    }
  } catch {
    // ignore
  }
  return null;
}

function volumeMonFromEvent(ev: CurveEvent): number {
  try {
    if (ev.type === "Buy" && "amountIn" in ev) {
      return Number(formatEther(ev.amountIn));
    }
    if (ev.type === "Sell" && "amountOut" in ev) {
      return Number(formatEther(ev.amountOut));
    }
  } catch {
    // ignore
  }
  return 0;
}

function senderFromEvent(ev: CurveEvent): string | null {
  if ("sender" in ev && ev.sender) return ev.sender;
  if ("creator" in ev && ev.creator) return ev.creator;
  return null;
}

function tokenFromEvent(ev: CurveEvent): string | null {
  if ("token" in ev && ev.token) return ev.token;
  return null;
}

export interface NadfunStreamDeps {
  rpcUrl: string;
  wsUrl: string;
  network: "testnet" | "mainnet";
  tokens: string[];
  aggregator: AggregatorInstance;
  /** Use DEX stream for graduated tokens (default: false, uses curve stream) */
  useDexStream?: boolean;
  /** Optional event storage for persisting events to database */
  eventStorage?: EventStorage;
}

/**
 * Parse price from DEX swap event.
 * Uses sqrtPriceX96 to derive price (more accurate than amount ratios).
 */
function parsePriceFromSwap(swap: SwapEvent): number | null {
  try {
    // sqrtPriceX96 = sqrt(price) * 2^96
    // price = (sqrtPriceX96 / 2^96)^2
    // For token0/token1: if token0 is WMON and token1 is token, price = token1/token0
    const sqrtPriceX96 = swap.sqrtPriceX96;
    const Q96 = 2n ** 96n;
    const priceRatio = Number(sqrtPriceX96) / Number(Q96);
    const price = priceRatio ** 2;
    if (Number.isFinite(price) && price > 0) {
      return price;
    }
    // Fallback: use amount ratio if sqrtPrice fails
    const amount0 = Number(formatEther(swap.amount0));
    const amount1 = Number(formatEther(swap.amount1));
    if (amount0 > 0 && amount1 > 0) {
      return amount1 / amount0;
    }
  } catch {
    // ignore
  }
  return null;
}

function volumeMonFromSwap(swap: SwapEvent): number {
  try {
    // For nad.fun pools: token0 is usually WMON, token1 is the token
    // So amount0 is MON volume (negative = out, positive = in)
    const vol = Number(formatEther(swap.amount0 < 0n ? -swap.amount0 : swap.amount0));
    return vol > 0 ? vol : 0;
  } catch {
    return 0;
  }
}

/**
 * Determine if a DEX swap is a Buy or Sell from the user's perspective.
 * In Uniswap V3 style pools (nad.fun uses similar):
 *   - token0 = WMON, token1 = token
 *   - amount0 > 0 (WMON flows INTO pool, user pays MON) → user is BUYING the token
 *   - amount0 < 0 (WMON flows OUT of pool, user receives MON) → user is SELLING the token
 */
function swapDirection(swap: SwapEvent): "Buy" | "Sell" {
  return swap.amount0 > 0n ? "Buy" : "Sell";
}

/**
 * Start curve stream (for non-graduated tokens) or DEX stream (for graduated tokens).
 * On each event update aggregator (lightweight).
 * On error: log and retry with exponential backoff.
 * Returns handle with stop() for clean shutdown.
 */
export function startNadfunStream(deps: NadfunStreamDeps): { stop: () => void } {
  const { rpcUrl, wsUrl, network, tokens, aggregator, useDexStream = false, eventStorage } = deps;
  
  // Validate token addresses
  const validTokens = tokens.filter((token) => {
    try {
      return isAddress(token);
    } catch {
      return false;
    }
  });
  
  if (validTokens.length === 0) {
    throw new Error("No valid token addresses provided");
  }
  
  if (validTokens.length < tokens.length) {
    console.warn(
      `[nadfunStream] Filtered out ${tokens.length - validTokens.length} invalid token addresses`
    );
  }
  let stream: { onEvent?: (cb: (e: CurveEvent) => void) => () => void; onSwap?: (cb: (e: SwapEvent) => void) => () => void; onError: (cb: (e: Error) => void) => () => void; start: () => void; stop: () => void } | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = MIN_RECONNECT_MS;
  let stopped = false;

  async function connect(): Promise<void> {
    if (stopped) return;
    try {
      if (useDexStream) {
        // Discover pools for tokens and create pool->token mapping
        const pools = await discoverPoolsForTokens(
          rpcUrl,
          validTokens as `0x${string}`[],
          network
        );
        const poolToToken = new Map<string, string>();
        for (let i = 0; i < validTokens.length; i++) {
          if (pools[i]) {
            poolToToken.set(pools[i]!.toLowerCase(), validTokens[i]!.toLowerCase());
          }
        }
        if (poolToToken.size === 0) {
          throw new Error(
            `No DEX pools found for tokens: ${tokens.join(", ")}. Make sure tokens are graduated.`
          );
        }
        
        console.log(
          `[nadfunStream] Discovered ${poolToToken.size} DEX pool(s):`
        );
        for (const [pool, token] of poolToToken.entries()) {
          console.log(
            `  • Token ${token.slice(0, 10)}...${token.slice(-8)} → Pool ${pool.slice(0, 10)}...${pool.slice(-8)}`
          );
        }

        // Use DEX stream for graduated tokens
        const dexStream = await createDexStreamWithTokens(
          wsUrl,
          rpcUrl,
          validTokens as `0x${string}`[],
          network
        );
        stream = dexStream;

        dexStream.onSwap((swap: SwapEvent) => {
          const poolAddr = swap.pool.toLowerCase();
          const token = poolToToken.get(poolAddr);
          if (!token) {
            // Pool not in our list, skip
            return;
          }
          const price = parsePriceFromSwap(swap);
          const volumeMon = volumeMonFromSwap(swap);
          const tokenName = getTokenName(token);
          const direction = swapDirection(swap);
          
          // Log received swap event
          const txHash = swap.transactionHash ?? null;
          const txShort = txHash ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : "N/A";
          console.log(
            `[nadfunStream] ${direction === "Buy" ? "📗" : "📕"} DEX ${direction} | Token: ${tokenName} (${token.slice(0, 10)}...${token.slice(-8)}) | ` +
            `Pool: ${poolAddr.slice(0, 10)}...${poolAddr.slice(-8)} | ` +
            `Price: ${price?.toFixed(6) ?? "N/A"} MON | ` +
            `Volume: ${volumeMon.toFixed(4)} MON | ` +
            `Sender: ${swap.sender?.slice(0, 8) ?? "N/A"}...${swap.sender?.slice(-6) ?? "N/A"} | ` +
            `TX: ${txShort}`
          );
          
          // Store event in database — classified as Buy or Sell based on amount direction
          // Store MON/token (priceMonPerToken) for consistency with execution and display
          if (eventStorage) {
            const priceMonPerToken =
              price != null && price > 0 ? 1 / price : undefined;
            eventStorage.storeEvent({
              tokenAddress: token,
              eventType: direction,
              price: priceMonPerToken,
              volumeMon: volumeMon > 0 ? volumeMon : undefined,
              traderAddress: swap.sender ?? undefined,
              poolAddress: poolAddr,
              transactionHash: swap.transactionHash ?? undefined,
              amountIn: swap.amount0 ? formatEther(swap.amount0 < 0n ? -swap.amount0 : swap.amount0) : undefined,
              amountOut: swap.amount1 ? formatEther(swap.amount1 < 0n ? -swap.amount1 : swap.amount1) : undefined,
            }).catch((err) => {
              console.error("[nadfunStream] Failed to store swap event:", err);
            });
          }
          
          // DEX sqrtPriceX96 gives token/MON; we need MON/token for execution and display
          const priceMonPerToken =
            price != null && price > 0 ? 1 / price : undefined;
          aggregator.applyEvent(token, {
            price: priceMonPerToken,
            volumeMon: volumeMon > 0 ? volumeMon : undefined,
            trader: swap.sender ?? undefined,
          });
        });

        dexStream.onError((err: Error) => {
          console.error("[nadfunStream] DEX stream error:", err.message);
          if (stream) {
            try {
              stream.stop();
            } catch {
              // ignore
            }
            stream = null;
          }
          if (stopped) return;
          reconnectTimeout = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, MAX_RECONNECT_MS);
            console.log(
              `[nadfunStream] reconnecting DEX stream in ${backoffMs / 1000}s...`
            );
            connect();
          }, backoffMs);
        });

        dexStream.start();
        backoffMs = MIN_RECONNECT_MS;
        console.log("[nadfunStream] connected, receiving DEX swap events");
      } else {
        // Use curve stream for non-graduated tokens
        const sdk = initSDK({
          rpcUrl,
          privateKey: DUMMY_PRIVATE_KEY,
          network,
          wsUrl,
        });
        const curveStream = sdk.createCurveStream({
          tokens: validTokens as `0x${string}`[],
          eventTypes: ["Create", "Buy", "Sell"] as const,
        });
        stream = curveStream;

        curveStream.onEvent((event: CurveEvent) => {
          const token = tokenFromEvent(event);
          if (!token) return;
          const price = parsePriceFromEvent(event);
          const volumeMon = volumeMonFromEvent(event);
          const trader = senderFromEvent(event);
          const tokenName = getTokenName(token);
          
          // Log received curve event
          const tokenShort = `${tokenName} (${token.slice(0, 10)}...${token.slice(-8)})`;
          const traderShort = trader ? `${trader.slice(0, 8)}...${trader.slice(-6)}` : "N/A";
          const txHash = "transactionHash" in event && event.transactionHash ? event.transactionHash : null;
          const txShort = txHash ? `${txHash.slice(0, 10)}...${txHash.slice(-8)}` : "N/A";
          
          if (event.type === "Buy" || event.type === "Sell") {
            const amountIn = "amountIn" in event ? formatEther(event.amountIn) : "N/A";
            const amountOut = "amountOut" in event ? formatEther(event.amountOut) : "N/A";
            console.log(
              `[nadfunStream] 📈 Curve ${event.type} | Token: ${tokenShort} | ` +
              `Price: ${price?.toFixed(6) ?? "N/A"} MON | ` +
              `Volume: ${volumeMon.toFixed(4)} MON | ` +
              `In: ${amountIn} | Out: ${amountOut} | ` +
              `Trader: ${traderShort} | TX: ${txShort}`
            );
          } else if (event.type === "Create") {
            console.log(
              `[nadfunStream] 🆕 Curve Create | Token: ${tokenShort} | ` +
              `Name: ${"name" in event ? event.name : "N/A"} | ` +
              `Symbol: ${"symbol" in event ? event.symbol : "N/A"} | ` +
              `Creator: ${traderShort} | TX: ${txShort}`
            );
          } else if (event.type === "Sync") {
            const monReserve = "realMonReserve" in event ? formatEther(event.realMonReserve) : "N/A";
            const tokenReserve = "realTokenReserve" in event ? formatEther(event.realTokenReserve) : "N/A";
            console.log(
              `[nadfunStream] 🔄 Curve Sync | Token: ${tokenShort} | ` +
              `Price: ${price?.toFixed(6) ?? "N/A"} MON | ` +
              `MON Reserve: ${monReserve} | Token Reserve: ${tokenReserve} | TX: ${txShort}`
            );
          } else {
            console.log(
              `[nadfunStream] 📋 Curve ${event.type} | Token: ${tokenShort} | TX: ${txShort}`
            );
          }
          
          // Store event in database if storage is available
          if (eventStorage && (event.type === "Buy" || event.type === "Sell" || event.type === "Create" || event.type === "Sync")) {
            const amountIn = "amountIn" in event ? formatEther(event.amountIn) : undefined;
            const amountOut = "amountOut" in event ? formatEther(event.amountOut) : undefined;
            eventStorage.storeEvent({
              tokenAddress: token,
              eventType: event.type as "Buy" | "Sell" | "Create" | "Sync",
              price: price ?? undefined,
              volumeMon: volumeMon > 0 ? volumeMon : undefined,
              traderAddress: trader ?? undefined,
              transactionHash: txHash ?? undefined,
              amountIn,
              amountOut,
            }).catch((err: unknown) => {
              console.error("[nadfunStream] Failed to store curve event:", err);
            });
          }
          
          aggregator.applyEvent(token, {
            price: price ?? undefined,
            volumeMon: volumeMon > 0 ? volumeMon : undefined,
            trader: trader ?? undefined,
          });
        });

        curveStream.onError((err: Error) => {
          console.error("[nadfunStream] curve stream error:", err.message);
          if (stream) {
            try {
              stream.stop();
            } catch {
              // ignore
            }
            stream = null;
          }
          if (stopped) return;
          reconnectTimeout = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, MAX_RECONNECT_MS);
            console.log(
              `[nadfunStream] reconnecting curve stream in ${backoffMs / 1000}s...`
            );
            connect();
          }, backoffMs);
        });

        curveStream.start();
        backoffMs = MIN_RECONNECT_MS;
        console.log("[nadfunStream] connected, receiving curve events");
      }
    } catch (err) {
      console.error("[nadfunStream] connection error:", err);
      if (stopped) return;
      reconnectTimeout = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, MAX_RECONNECT_MS);
        console.log(
          `[nadfunStream] retrying connection in ${backoffMs / 1000}s...`
        );
        connect();
      }, backoffMs);
    }
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimeout !== undefined) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }
      if (stream) {
        try {
          stream.stop();
        } catch (e) {
          console.error("[nadfunStream] stop error:", e);
        }
        stream = null;
      }
    },
  };
}
