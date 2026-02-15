/**
 * Contract ABIs and addresses for MoltiArena platform.
 * Monad Testnet (chain 10143).
 */

// ─── Addresses ───────────────────────────────────────────────────────
// Use NEXT_PUBLIC_* env vars or fallback to defaults (Monad Testnet)
export const MOLTI_TOKEN_ADDRESS = ((typeof process !== "undefined" &&
  process.env?.NEXT_PUBLIC_MOLTI_TOKEN_ADDRESS) ||
  "0xe2954c50Aa4ccB153198c007E427a98d9Ba3ab57") as `0x${string}`;

export const MOLTI_ARENA_ADDRESS = ((typeof process !== "undefined" &&
  process.env?.NEXT_PUBLIC_MOLTI_ARENA_ADDRESS) ||
  "0x22C9701b199FF9B43bC7eAdccCb46257482607B8") as `0x${string}`;

// ─── Monad Testnet Explorer ──────────────────────────────────────────
export const EXPLORER_URL =
  process.env?.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.monadexplorer.com";

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

// ─── MoltiToken ABI (ERC-20 subset used by frontend) ─────────────────
export const MOLTI_TOKEN_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// ─── MoltiArena ABI ──────────────────────────────────────────────────
export const MOLTI_ARENA_ABI = [
  // ── Agent management ──
  {
    type: "function",
    name: "createAgent",
    inputs: [
      { name: "profileHash", type: "bytes32" },
      { name: "wallet", type: "address" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getAgent",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "wallet", type: "address" },
          { name: "profileHash", type: "bytes32" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  // ── Arena management ──
  {
    type: "function",
    name: "createArena",
    inputs: [
      { name: "tokenAddress", type: "address" },
      { name: "name", type: "string" },
    ],
    outputs: [{ name: "arenaId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getArena",
    inputs: [{ name: "arenaId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "tokenAddress", type: "address" },
          { name: "name", type: "string" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  // ── Registration ──
  {
    type: "function",
    name: "registerToArena",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unregisterFromArena",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isRegistered",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  // ── View helpers ──
  {
    type: "function",
    name: "getPortfolio",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "moltiLocked", type: "uint256" },
          { name: "tokenUnits", type: "uint256" },
          { name: "avgEntryPrice", type: "uint256" },
          { name: "tradeCount", type: "uint32" },
          { name: "lastTradeTick", type: "uint32" },
          { name: "initialized", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "computeEquity",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // ── Public state getters ──
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "agentCreationFee",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextAgentId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextArenaId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "moltiToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // ── Rewards ──
  {
    type: "function",
    name: "claimReward",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getPendingReward",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // ── Events ──
  {
    type: "event",
    name: "AgentCreated",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "wallet", type: "address", indexed: false },
      { name: "profileHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ArenaCreated",
    inputs: [
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "tokenAddress", type: "address", indexed: false },
      { name: "name", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "arenaId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AgentUnregistered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "arenaId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "TradePlaced",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "action", type: "uint8", indexed: false },
      { name: "sizePctOrAmount", type: "uint256", indexed: false },
      { name: "price", type: "uint256", indexed: false },
      { name: "moltiLockedAfter", type: "uint256", indexed: false },
      { name: "tokenUnitsAfter", type: "uint256", indexed: false },
    ],
  },
] as const;
