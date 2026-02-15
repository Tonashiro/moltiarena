import { apiGet, apiPost, type FetchOptions } from "./apiClient";

export type { FetchOptions };
export { fetchOrFallback, getBaseUrl } from "./apiClient";

// --- Arenas ---

export interface ArenaListItem {
  id: number;
  tokenAddress: string;
  name: string | null;
  onChainId: number | null;
  activeAgentsCount: number;
}

export interface ArenasResponse {
  arenas: ArenaListItem[];
}

export function fetchArenas(options?: FetchOptions): Promise<ArenasResponse> {
  return apiGet<ArenasResponse>("/arenas", options);
}

export interface ArenaDetail {
  id: number;
  tokenAddress: string;
  name: string | null;
  onChainId: number | null;
  activeAgentsCount: number;
}

export function fetchArena(
  arenaId: number,
  options?: FetchOptions
): Promise<ArenaDetail> {
  return apiGet<ArenaDetail>(`/arenas/${arenaId}`, options);
}

export interface LeaderboardRanking {
  agentId: number;
  name: string;
  pnlPct: number;
  equity: number;
  cashMon: number;
  tokenUnits: number;
  initialCapital?: number;
  volumeTraded?: number;
  tradeCount?: number;
  points?: number;
  rank?: number;
}

export interface LeaderboardResponse {
  arenaId: number;
  epochId: number | null;
  epochEndAt: string | null;
  tick: number | null;
  createdAt: string | null;
  rankings: LeaderboardRanking[];
}

export function fetchLeaderboard(
  arenaId: number,
  epochId?: number,
  options?: FetchOptions
): Promise<LeaderboardResponse> {
  const qs = epochId != null ? `?epochId=${epochId}` : "";
  return apiGet<LeaderboardResponse>(`/arenas/${arenaId}/leaderboard${qs}`, options);
}

export interface TradeItem {
  agentName: string;
  action: string;
  sizePct: number;
  price: number;
  reason: string;
  onChainTxHash: string | null;
  createdAt: string;
}

export interface TradesResponse {
  arenaId: number;
  trades: TradeItem[];
}

export function fetchTrades(
  arenaId: number,
  options?: FetchOptions
): Promise<TradesResponse> {
  return apiGet<TradesResponse>(`/arenas/${arenaId}/trades`, options);
}

// --- Token trades (on-chain market events) ---

export interface TokenTradeItem {
  id: number;
  type: string;  // "Buy" | "Sell" | "Swap"
  price: number | null;
  volume: number | null;
  trader: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface TokenTradesResponse {
  arenaId: number;
  tokenAddress: string;
  trades: TokenTradeItem[];
}

export function fetchTokenTrades(
  arenaId: number,
  options?: FetchOptions,
): Promise<TokenTradesResponse> {
  return apiGet<TokenTradesResponse>(`/arenas/${arenaId}/token-trades`, options);
}

// --- Agents ---

export interface AgentListItem {
  id: number;
  name: string;
  ownerAddress: string;
  profileHash: string;
  onChainId: number | null;
  walletAddress: string | null;
  smartAccountAddress: string | null;
  creationTxHash: string | null;
  fundedBalance: number;
  createdAt: string;
  registeredArenaIds: number[];
}

export interface AgentsResponse {
  agents: AgentListItem[];
}

export function fetchAgents(options?: FetchOptions): Promise<AgentsResponse> {
  return apiGet<AgentsResponse>("/agents", options);
}

export function fetchMyAgents(
  ownerAddress: string,
  options?: FetchOptions,
): Promise<AgentsResponse> {
  return apiGet<AgentsResponse>(
    `/agents?owner=${encodeURIComponent(ownerAddress)}`,
    options,
  );
}

export interface CreateAgentBody {
  ownerAddress: string;
  profile: {
    name: string;
    goal: string;
    style: string;
    constraints: {
      maxTradePct: number;
      maxPositionPct: number;
      cooldownTicks: number;
      maxTradesPerWindow: number;
    };
    filters: {
      minEvents1h: number;
      minVolumeMon1h: number;
    };
    customRules?: string;
  };
}

export interface CreateAgentResponse {
  agentId: number;
  profileHash: string;
}

export function createAgent(
  body: CreateAgentBody
): Promise<CreateAgentResponse> {
  return apiPost<CreateAgentResponse>("/agents", body, "Failed to create agent");
}

export interface AgentArenaEntry {
  arenaId: number;
  tokenAddress: string;
  arenaName: string | null;
  pnlPct: number | null;
  equity: number | null;
  cashMon: number | null;
  tokenUnits: number | null;
  memory: {
    text: string;
    tick: number;
    lastAiSummarizedAt: string | null;
    updatedAt: string;
  } | null;
}

export interface AgentDetailResponse {
  id: number;
  name: string;
  ownerAddress: string;
  profileHash: string;
  onChainId: number | null;
  walletAddress: string | null;
  smartAccountAddress: string | null;
  creationTxHash: string | null;
  fundedBalance: number;
  registrationFeesPaid: number;
  createdAt: string;
  profileConfig: {
    goal: string;
    style: string;
    customRules?: string;
    constraints?: {
      maxTradePct: number;
      maxPositionPct: number;
      cooldownTicks: number;
      maxTradesPerWindow: number;
    };
  } | null;
  arenas: AgentArenaEntry[];
}

export function fetchAgent(
  agentId: number,
  options?: FetchOptions
): Promise<AgentDetailResponse> {
  return apiGet<AgentDetailResponse>(`/agents/${agentId}`, options);
}

// --- Agent wallet creation (ERC-4337 smart account) ---

export interface CreateWalletResponse {
  smartAccountAddress: string;
  signerAddress: string;
  encryptedKey: string;
}

export function createAgentWallet(): Promise<CreateWalletResponse> {
  return apiPost<CreateWalletResponse>(
    "/agents/create-wallet",
    {},
    "Failed to create agent wallet",
  );
}

// --- Agent withdraw ---

export interface WithdrawBody {
  token: "MOLTI" | "MON";
  amount: string;
  toAddress: string;
  ownerAddress: string;
}

export interface WithdrawResponse {
  txHash: string;
  token: string;
  amount: string;
}

export function withdrawFromAgent(
  agentId: number,
  body: WithdrawBody,
): Promise<WithdrawResponse> {
  return apiPost<WithdrawResponse>(
    `/agents/${agentId}/withdraw`,
    body,
    "Failed to withdraw from agent",
  );
}

// --- Agent equity history ---

export interface EquityPoint {
  tick: number;
  equity: number;
  pnlPct: number;
  cashMon: number;
  tokenUnits: number;
  createdAt: string;
}

export interface ArenaEquityData {
  arenaId: number;
  arenaName: string | null;
  tokenAddress: string;
  initialCapital: number;
  points: EquityPoint[];
}

export interface EquityHistoryResponse {
  agentId: number;
  totalInitialCapital: number;
  arenas: ArenaEquityData[];
  aggregated: Array<{
    tick: number;
    equity: number;
    pnlPct: number;
    createdAt: string;
  }>;
}

export function fetchEquityHistory(
  agentId: number,
  options?: FetchOptions,
): Promise<EquityHistoryResponse> {
  return apiGet<EquityHistoryResponse>(`/agents/${agentId}/equity-history`, options);
}

// --- Agent trade history ---

export interface AgentTradeItem {
  id: number;
  arenaId: number;
  arenaName: string | null;
  tick: number;
  action: string;
  sizePct: number;
  price: number;
  cashAfter: number;
  tokenAfter: number;
  reason: string;
  onChainTxHash: string | null;
  createdAt: string;
}

export interface AgentTradesResponse {
  agentId: number;
  trades: AgentTradeItem[];
}

export function fetchAgentTrades(
  agentId: number,
  options?: FetchOptions,
): Promise<AgentTradesResponse> {
  return apiGet<AgentTradesResponse>(`/agents/${agentId}/trades`, options);
}

// --- Agent stats ---

export interface AgentStatsResponse {
  agentId: number;
  tradeCount: number;
  feesPaid: number;
  rewardsCollected: number;
  pendingRewards: Array<{ epochId: number; arenaId: number; amount: string; endAt: string }>;
}

export function fetchAgentStats(
  agentId: number,
  options?: FetchOptions
): Promise<AgentStatsResponse> {
  return apiGet<AgentStatsResponse>(`/agents/${agentId}/stats`, options);
}

// --- Agent decisions (audit log) ---

export interface AgentDecisionItem {
  id: number;
  arenaId: number;
  arenaName: string | null;
  tick: number;
  action: string;
  sizePct: number;
  price: number;
  reason: string;
  confidence: number | null;
  status: string;
  onChainTxHash: string | null;
  createdAt: string;
}

export interface AgentDecisionsResponse {
  agentId: number;
  decisions: AgentDecisionItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function fetchAgentDecisions(
  agentId: number,
  page?: number,
  limit?: number,
  options?: FetchOptions
): Promise<AgentDecisionsResponse> {
  const params = new URLSearchParams();
  if (page != null) params.set("page", String(page));
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString() ? `?${params}` : "";
  return apiGet<AgentDecisionsResponse>(`/agents/${agentId}/decisions${qs}`, options);
}

// --- Agent memory ---

export interface AgentMemoryResponse {
  agentId: number;
  memories: Array<{
    arenaId: number;
    arenaName: string | null;
    memoryText: string;
    tick: number;
    lastAiSummarizedAt: string | null;
    updatedAt: string;
  }>;
}

export function fetchAgentMemory(
  agentId: number,
  options?: FetchOptions
): Promise<AgentMemoryResponse> {
  return apiGet<AgentMemoryResponse>(`/agents/${agentId}/memory`, options);
}

// --- Agent sync (on-chain → backend) ---

export interface SyncAgentBody {
  onChainId: number;
  profile: CreateAgentBody["profile"];
  ownerAddress?: string;
  walletAddress?: string;
  smartAccountAddress?: string;
  encryptedSignerKey?: string;
  txHash?: string;
}

export interface SyncAgentResponse {
  agentId: number;
  onChainId: number;
  profileHash: string;
}

export function syncAgent(body: SyncAgentBody): Promise<SyncAgentResponse> {
  return apiPost<SyncAgentResponse>(
    "/agents/sync",
    body,
    "Failed to sync agent",
  );
}

// --- Arena registration ---

export interface RegisterArenaBody {
  ownerAddress: string;
  agentId: number;
  tokenAddress: string;
  arenaName?: string;
}

export interface RegisterArenaResponse {
  arenaId: number;
  registrationId: number;
}

export function registerArena(
  body: RegisterArenaBody
): Promise<RegisterArenaResponse> {
  return apiPost<RegisterArenaResponse>(
    "/arenas/register",
    body,
    "Failed to register"
  );
}

// --- Agent funding ---

export interface FundAgentBody {
  amount: number; // MOLTI amount (human readable, e.g. 5000)
  txHash?: string;
}

export interface FundAgentResponse {
  agentId: number;
  fundedBalance: number;
  txHash: string | null;
}

export function fundAgent(
  agentId: number,
  body: FundAgentBody,
): Promise<FundAgentResponse> {
  return apiPost<FundAgentResponse>(
    `/agents/${agentId}/fund`,
    body,
    "Failed to record agent funding",
  );
}

// --- Approve MOLTI for arena (epoch renewal) ---

export interface ApproveMoltiResponse {
  txHash: string;
}

export function approveMoltiForArena(agentId: number): Promise<ApproveMoltiResponse> {
  return apiPost<ApproveMoltiResponse>(
    `/agents/${agentId}/approve-molti`,
    {},
    "Failed to approve MOLTI for arena",
  );
}
