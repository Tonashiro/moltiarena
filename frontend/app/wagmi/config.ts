"use client";

/**
 * Single Wagmi + AppKit config for Moltiarena.
 * Uses one RPC (env) and one chain (Monad Testnet by default).
 * All reads/writes use this config so you can plug a custom RPC for latency and throughput.
 */
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import { defineChain } from "@reown/appkit/networks";
import { createStorage, cookieStorage } from "wagmi";

// ─── Env ───────────────────────────────────────────────────────────────

const projectId =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_WALLET_CONNECT
    : undefined;

/** Optional: override Monad Testnet RPC (default: public testnet RPC). */
const testnetRpcUrl =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_RPC_URL &&
  process.env.NEXT_PUBLIC_RPC_URL.trim() !== ""
    ? process.env.NEXT_PUBLIC_RPC_URL.trim()
    : "https://testnet-rpc.monad.xyz";

/** Chain ID for the app (Monad Testnet = 10143). Use env to switch later if needed. */
export const CHAIN_ID =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_CHAIN_ID
    ? Number(process.env.NEXT_PUBLIC_CHAIN_ID)
    : 10143;

const mainnetRpcUrl =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL?.trim()
    ? process.env.NEXT_PUBLIC_MAINNET_RPC_URL.trim()
    : "https://rpc.monad.xyz";

if (!projectId) {
  throw new Error(
    "NEXT_PUBLIC_WALLET_CONNECT is required for WalletConnect / AppKit.",
  );
}

// ─── Chains ─────────────────────────────────────────────────────────────

/** Monad Testnet: single chain for the app; RPC from env for custom endpoints. */
export const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: "Monad",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [testnetRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://monadvision.com/",
    },
  },
  caipNetworkId: `eip155:${CHAIN_ID}`,
  chainNamespace: "eip155",
} as const);

/** Monad Mainnet (id 143). Export for future use; not in networks for now. */
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [mainnetRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://explorer.monad.xyz",
    },
  },
  caipNetworkId: "eip155:143",
  chainNamespace: "eip155",
} as const);

/** All networks the app supports (testnet only for now). */
export const networks = [monadTestnet] as const;

/** Default chain for the modal and for contract calls. */
export const defaultNetwork = monadTestnet;

// ─── Wagmi adapter (single config used by all wagmi hooks) ───────────────

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  networks: [...networks],
  projectId,
});

/** Wagmi config: use this everywhere (hooks use it via WagmiProvider). */
export const config = wagmiAdapter.wagmiConfig;

// ─── AppKit modal (Connect / Network switch) ───────────────────────────

const metadata = {
  name: "Moltiarena",
  description: "AI agent trading arena on Monad",
  url: typeof process !== "undefined" ? process.env.NEXT_PUBLIC_APP_URL ?? "https://moltiarena.com" : "https://moltiarena.com",
  icons: ["https://moltiarena.com/icon.png"],
};

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [...networks],
  defaultNetwork,
  metadata,
  features: {
    analytics: true,
    socials: false,
    email: false,
  },
});
