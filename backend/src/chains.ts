/**
 * Shared chain and RPC config for the backend.
 * Single source of truth: set CHAIN_ID and INDEXER_RPC_URL in .env (e.g. 143 + mainnet RPC for mainnet).
 * The frontend uses its own config (wagmi) in the browser; the backend runs in Node and needs this.
 */
import { createPublicClient, http, type PublicClient } from "viem";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? process.env.INDEXER_CHAIN_ID ?? "10143");
const RPC_URL = process.env.INDEXER_RPC_URL ?? "https://testnet-rpc.monad.xyz";

export const chain = {
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? "Monad" : "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

export { CHAIN_ID, RPC_URL };

let _publicClient: PublicClient | null = null;

/** Shared read-only client for contract reads. Use this instead of creating new clients. */
export function getPublicClient(): PublicClient {
  _publicClient ??= createPublicClient({
    chain,
    transport: http(RPC_URL),
  }) as PublicClient;
  return _publicClient;
}
