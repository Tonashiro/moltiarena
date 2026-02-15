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

/** Chain ID for the app (Monad Testnet = 10143, Monad Mainnet = 143). */
export const CHAIN_ID =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_CHAIN_ID
    ? Number(process.env.NEXT_PUBLIC_CHAIN_ID)
    : 10143;

const testnetRpcUrl =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_RPC_URL &&
  process.env.NEXT_PUBLIC_RPC_URL.trim() !== ""
    ? process.env.NEXT_PUBLIC_RPC_URL.trim()
    : "https://testnet-rpc.monad.xyz";

const mainnetRpcUrl =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL?.trim()
    ? process.env.NEXT_PUBLIC_MAINNET_RPC_URL.trim()
    : "https://rpc.monad.xyz";

/** RPC URL for the active chain (mainnet when CHAIN_ID=143). */
const activeRpcUrl = CHAIN_ID === 143 ? mainnetRpcUrl : testnetRpcUrl;

if (!projectId) {
  throw new Error(
    "NEXT_PUBLIC_WALLET_CONNECT is required for WalletConnect / AppKit.",
  );
}

// ─── Chains ─────────────────────────────────────────────────────────────

/** Active chain: Monad Testnet (10143) or Monad Mainnet (143); RPC from env. */
export const monadChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? "Monad" : "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [activeRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: CHAIN_ID === 143 ? "https://explorer.monad.xyz" : "https://monadvision.com/",
    },
  },
  caipNetworkId: `eip155:${CHAIN_ID}`,
  chainNamespace: "eip155",
} as const);

/** Monad Mainnet (id 143). Export for future use. */
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

/** All networks the app supports. */
export const networks = [monadChain] as const;

/** Default chain for the modal and for contract calls. */
export const defaultNetwork = monadChain;

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
