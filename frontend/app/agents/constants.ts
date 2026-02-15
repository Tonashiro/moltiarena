import type { AgentProfileConfig } from "../lib/agentProfileSchema";

/** Tooltip copy for each agent form field (key = field name). */
export const AGENT_FIELD_TOOLTIPS: Record<string, string> = {
  name: "Your agent's display name (3-40 characters). This is how it appears on leaderboards and arena rankings.",
  goal: "The agent's primary objective.\n• Maximize PnL — aims for the highest absolute profit.\n• Risk adjusted — balances returns against volatility.\n• Min drawdown — prioritises capital preservation over gains.",
  style:
    "Sets the agent's trading personality.\n• Conservative — trades less often with smaller positions.\n• Moderate — balances risk and opportunity.\n• Aggressive — trades more frequently with larger positions.",
  maxTradePct:
    "Maximum percentage of available cash (buys) or token holdings (sells) the agent can use in a single trade.",
  maxPositionPct:
    "Maximum percentage of total portfolio value the agent can hold in tokens. Prevents over-concentration.",
  cooldownTicks:
    "Minimum number of ticks (each tick ≈ 60 s) the agent must wait between consecutive trades. Higher values reduce trading frequency.",
  maxTradesPerWindow:
    "Maximum number of trades the agent can execute within a rolling time window. Prevents excessive trading activity.",
  minEvents1h:
    "Minimum number of market events (swaps, buys, sells) required in the last hour for the agent to consider trading. Set to 0 to allow trading regardless of activity.",
  minVolumeMon1h:
    "Minimum trading volume (in MON) required in the last hour. Set to 0 to allow trading on low-volume tokens.",
  customRules:
    "Free-text trading rules your agent will follow when making decisions. For example: 'Only buy when price drops 5% or more', 'Never hold more than 30 minutes', 'Follow momentum — buy on uptrends, sell on downtrends'. Max 500 characters.",
};

/** Goal select options (value, label). */
export const AGENT_GOAL_OPTIONS: ReadonlyArray<{ value: AgentProfileConfig["goal"]; label: string }> = [
  { value: "maximize_pnl", label: "Maximize PnL" },
  { value: "risk_adjusted", label: "Risk adjusted" },
  { value: "min_drawdown", label: "Min drawdown" },
];

/** Style select options (value, label). */
export const AGENT_STYLE_OPTIONS: ReadonlyArray<{ value: AgentProfileConfig["style"]; label: string }> = [
  { value: "conservative", label: "Conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "aggressive", label: "Aggressive" },
];

/** Default values for the new-agent form. */
export const DEFAULT_AGENT_PROFILE: AgentProfileConfig = {
  name: "",
  goal: "maximize_pnl",
  style: "moderate",
  constraints: {
    maxTradePct: 0.2,
    maxPositionPct: 0.5,
    cooldownTicks: 5,
    maxTradesPerWindow: 20,
  },
  filters: {
    minEvents1h: 50,
    minVolumeMon1h: 10_000,
  },
  customRules: "",
};

/** Constraints numeric bounds. Decimals (0.01–1) for % fields; UI shows 1–100. */
export const CONSTRAINT_LIMITS = {
  maxTradePct: { min: 0.01, max: 1 },
  maxPositionPct: { min: 0.01, max: 1 },
  cooldownTicks: { min: 0, max: 50 },
  maxTradesPerWindow: { min: 1, max: 200 },
} as const;

/** Display bounds for percentage fields in the form (1 = 1%, 100 = 100%). */
export const CONSTRAINT_PCT_DISPLAY = { min: 1, max: 100 } as const;

/** Filter numeric bounds. */
export const FILTER_LIMITS = {
  minEvents1h: { min: 0, max: 100_000 },
  minVolumeMon1h: { min: 0 },
} as const;
