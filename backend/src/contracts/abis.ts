/**
 * Contract ABIs and addresses for MoltiArena platform.
 * Extracted from Foundry build artifacts.
 *
 * MoltiToken: 0xe2954c50Aa4ccB153198c007E427a98d9Ba3ab57
 * MoltiArena: 0x22C9701b199FF9B43bC7eAdccCb46257482607B8
 * Chain: Monad Testnet (10143)
 */

// ─── Addresses ───────────────────────────────────────────────────────
export const MOLTI_TOKEN_ADDRESS =
  (process.env.MOLTI_TOKEN_ADDRESS as `0x${string}`) ??
  "0xe2954c50Aa4ccB153198c007E427a98d9Ba3ab57";

export const MOLTI_ARENA_ADDRESS =
  (process.env.MOLTI_ARENA_ADDRESS as `0x${string}`) ??
  "0x22C9701b199FF9B43bC7eAdccCb46257482607B8";

// ─── MoltiToken ABI (ERC-20) ─────────────────────────────────────────
export const MOLTI_TOKEN_ABI = [
  {
    type: "constructor",
    inputs: [{ name: "_recipient", type: "address" }],
    stateMutability: "nonpayable",
  },
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
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
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
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "INITIAL_SUPPLY",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
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
  {
    type: "constructor",
    inputs: [
      { name: "_moltiToken", type: "address" },
      { name: "_creationFee", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
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
  {
    type: "function",
    name: "setArenaActive",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
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
    name: "getAgentsInArenaWithRenewal",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [
      { name: "agentIds", type: "uint256[]" },
      { name: "renewedForEpoch", type: "bool[]" },
    ],
    stateMutability: "view",
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
  // ── Trade execution ──
  {
    type: "function",
    name: "executeTrade",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
      { name: "action", type: "uint8" },
      { name: "sizePct", type: "uint256" },
      { name: "buyAmountWei", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "tick", type: "uint32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
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
    name: "moltiToken",
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
    name: "operator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
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
    name: "collectedFees",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  // ── Admin ──
  {
    type: "function",
    name: "setOperator",
    inputs: [{ name: "_operator", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAgentCreationFee",
    inputs: [{ name: "newFee", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawFees",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
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
  {
    type: "event",
    name: "OperatorUpdated",
    inputs: [
      { name: "oldOperator", type: "address", indexed: true },
      { name: "newOperator", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AgentCreationFeeUpdated",
    inputs: [
      { name: "oldFee", type: "uint256", indexed: false },
      { name: "newFee", type: "uint256", indexed: false },
    ],
  },
  // ── Epoch management ──
  {
    type: "function",
    name: "createEpoch",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
    ],
    outputs: [{ name: "epochId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "autoRenewEpoch",
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
    name: "endEpoch",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPendingReward",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
      { name: "amountWei", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPendingRewardsBatch",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
      { name: "agentIds", type: "uint256[]" },
      { name: "amountWeis", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sweepUnclaimedRewards",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
      { name: "agentIds", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "epochs",
    inputs: [
      { name: "arenaId", type: "uint256" },
      { name: "epochId", type: "uint256" },
    ],
    outputs: [
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "rewardPoolWei", type: "uint256" },
      { name: "burnedWei", type: "uint256" },
      { name: "ended", type: "bool" },
    ],
    stateMutability: "view",
  },
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
  {
    type: "function",
    name: "epochRenewalFee",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextEpochId",
    inputs: [{ name: "arenaId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "EpochCreated",
    inputs: [
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
      { name: "startTime", type: "uint256", indexed: false },
      { name: "endTime", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AgentEpochRenewed",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EpochEnded",
    inputs: [
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "RewardClaimed",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RewardsDistributed",
    inputs: [
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
      { name: "winnerCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnclaimedRewardsSwept",
    inputs: [
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
      { name: "amountBurned", type: "uint256", indexed: false },
    ],
  },
  // ── Custom errors (for decoding revert reasons) ──
  { type: "error", name: "AgentNotFound", inputs: [{ name: "agentId", type: "uint256" }] },
  { type: "error", name: "ArenaNotFound", inputs: [{ name: "arenaId", type: "uint256" }] },
  { type: "error", name: "NotRegistered", inputs: [{ name: "agentId", type: "uint256" }, { name: "arenaId", type: "uint256" }] },
  { type: "error", name: "EpochNotFound", inputs: [{ name: "arenaId", type: "uint256" }, { name: "epochId", type: "uint256" }] },
  { type: "error", name: "EpochAlreadyEnded", inputs: [{ name: "arenaId", type: "uint256" }, { name: "epochId", type: "uint256" }] },
  { type: "error", name: "InvalidBatchLength", inputs: [] },
  { type: "error", name: "ClaimWindowNotEnded", inputs: [] },
  { type: "error", name: "InsufficientAgentBalance", inputs: [{ name: "required", type: "uint256" }, { name: "available", type: "uint256" }] },
  {
    type: "event",
    name: "TradeFeeRecorded",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "arenaId", type: "uint256", indexed: true },
      { name: "epochId", type: "uint256", indexed: true },
      { name: "feePool", type: "uint256", indexed: false },
      { name: "feeTreasury", type: "uint256", indexed: false },
      { name: "feeBurn", type: "uint256", indexed: false },
    ],
  },
] as const;
