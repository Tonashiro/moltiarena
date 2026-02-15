import OpenAI from "openai";
import { z } from "zod";
import type { MarketSnapshot } from "../market/types.js";
import type { AgentProfileConfig } from "../schemas/agentProfile.js";
import { sanitizeString } from "../utils/validation.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2,
});

const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const DEBUG =
  process.env.AI_DECISION_DEBUG === "true" || process.env.AI_DECISION_DEBUG === "1";

/**
 * GPT-5 mini is a reasoning model: it uses tokens for "reasoning" then "output".
 * If max_completion_tokens is too low, all tokens go to reasoning and content is empty (finish_reason: length).
 * Use enough tokens for reasoning + short JSON answer, and low reasoning_effort for this deterministic task.
 */
const MAX_COMPLETION_TOKENS = 1024;

// --- Output schema (strict JSON from model)
const TradeDecisionSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  sizePct: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type TradeDecision = z.infer<typeof TradeDecisionSchema>;

const MODEL_ERROR_DECISION: TradeDecision = {
  action: "HOLD",
  sizePct: 0,
  confidence: 0,
  reason: "model_error",
};

// --- Minimal input for the prompt
export interface DecideTradeInput {
  market: Pick<
    MarketSnapshot,
    | "price"
    | "ret_1m_pct"
    | "ret_5m_pct"
    | "vol_5m_pct"
    | "events_1h"
    | "volume_mon_1h"
    | "price_tail"
    | "buyCount"
    | "sellCount"
    | "swapCount"
    | "buySellRatio"
    | "recentEvents"
    | "uniqueTraders"
    | "avgVolumePerTrader"
    | "largestTrade"
    | "whaleActivity"
    | "momentum"
    | "volumeTrend"
    | "priceVolatility"
  >;
  portfolio: {
    cashMon: number;
    tokenUnits: number;
    avgEntryPrice: number | null;
    tradesThisWindow: number;
    lastTradeTick: number | null;
    /** Current tick (to compute ticks since last trade). */
    currentTick: number;
    /** Total portfolio value (cashMon + tokenUnits * price). */
    equity: number;
    /** Token exposure as % of equity (0–1). */
    positionPct: number;
    /** Initial capital for this arena (for context). */
    initialCapital: number;
  };
  profile: Pick<
    AgentProfileConfig,
    "goal" | "style" | "constraints" | "filters"
  >;
  /** Free-text custom trading rules from agent creator (already sanitized). */
  customRules?: string;
  memory?: string;
}

const SYSTEM_PROMPT = `You are a trading agent. Output only valid JSON, no other text.

Obey the creator's constraints and filters. Respect maxTradePct, maxPositionPct, cooldown, and maxTradesPerWindow. When minEvents1h and minVolumeMon1h are 0, you may trade based on price and strategy alone; otherwise only trade when market activity meets those minimums.

If the creator provides custom rules (Rules section), treat them as high-priority trading guidelines. Apply them alongside the goal and style. If a custom rule conflicts with a hard constraint (maxTradePct, maxPositionPct, cooldown, maxTradesPerWindow), the hard constraint always wins. Custom rules affect strategy, not hard limits.

Portfolio: c=cash (available to BUY), t=tokens held (can SELL), eq=equity, posPct=token exposure % (0=all cash, 1=all tokens), init=initial capital, tsl=ticks since last trade.
- CRITICAL: When posPct exceeds maxPositionPct, you MUST output action=SELL with sizePct > 0 (e.g. 0.09 for 9%) to trim exposure. Do NOT output HOLD when you need to reduce exposure — HOLD means do nothing; use SELL to actually trim.
- Prefer HOLD when tsl is low (1–2 ticks) and little has changed. Avoid overtrading.
- Only BUY/SELL when there is a clear new signal or opportunity. If market data and your position are similar to last tick, HOLD.
- posPct tells you current exposure; if posPct > maxPositionPct, SELL to comply — do not describe trimming in the reason while outputting HOLD.

Market data codes:
- Events: B=Buy, S=Sell, W=Swap
- Momentum: B=bullish, S=bearish, N=neutral
- Volume trend: I=increasing, D=decreasing, S=stable
- Volatility: H=high, M=medium, L=low
- Recent events: [type, price, volume] arrays

Respond with exactly this JSON object (no markdown, no code block):
{"action":"BUY"|"SELL"|"HOLD","sizePct":<0-1>,"confidence":<0-1>,"reason":"<short explanation>"}

When action is BUY or SELL, sizePct MUST be > 0 (e.g. 0.09 for 9% trim). Use 0 only for HOLD.
If posPct > maxPositionPct and you want to trim: action=SELL, sizePct=amount to trim (e.g. 0.09), NOT HOLD.`;

const MULTI_ARENA_SYSTEM_PROMPT = `You are a trading agent managing positions across MULTIPLE arenas (tokens) in one go.

Same rules as single-arena: obey creator constraints and filters (maxTradePct, maxPositionPct, cooldown, maxTradesPerWindow, minEvents1h, minVolumeMon1h). Custom rules apply to all arenas. When posPct > maxPositionPct for an arena, you MUST output SELL with sizePct > 0 for that arena to trim exposure.

You will receive data for N arenas in order (Arena 0, Arena 1, ...). Output a JSON array of exactly N decision objects in the SAME order: one object per arena.

Each object: {"action":"BUY"|"SELL"|"HOLD","sizePct":<0-1>,"confidence":<0-1>,"reason":"<short explanation>"}

Respond with ONLY a JSON array (no markdown, no code block), e.g.:
[{"action":"HOLD","sizePct":0,"confidence":0.5,"reason":"no signal"},{"action":"SELL","sizePct":0.1,"confidence":0.7,"reason":"trim exposure"}]

When action is BUY or SELL, sizePct MUST be > 0 for that arena. Use 0 only for HOLD.`;

/** One arena's market + portfolio for multi-arena decision. */
export interface ArenaContextForDecision {
  arenaLabel: string;
  market: DecideTradeInput["market"];
  portfolio: DecideTradeInput["portfolio"];
}

/** Input for one AI call that returns decisions for all arenas an agent is in. */
export interface DecideTradeMultiArenaInput {
  profile: DecideTradeInput["profile"];
  customRules?: string;
  memory?: string;
  arenas: ArenaContextForDecision[];
}

const TradeDecisionArraySchema = z.array(TradeDecisionSchema);

function round(n: number, decimals: number): number {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function formatMarketAndPortfolio(
  market: DecideTradeInput["market"],
  portfolio: DecideTradeInput["portfolio"],
): string {
  const marketData = {
    p: round(market.price, 6),
    r1: round(market.ret_1m_pct, 2),
    r5: round(market.ret_5m_pct, 2),
    v: round(market.vol_5m_pct, 2),
    e: market.events_1h,
    vol: round(market.volume_mon_1h, 2),
    pt: market.price_tail.map((p) => round(p, 6)),
    bc: market.buyCount,
    sc: market.sellCount,
    wc: market.swapCount,
    bsr: round(market.buySellRatio, 2),
    re: market.recentEvents,
    ut: market.uniqueTraders,
    avpt: round(market.avgVolumePerTrader, 2),
    lt: round(market.largestTrade, 2),
    wh: market.whaleActivity,
    m: market.momentum,
    vt: market.volumeTrend,
    pv: market.priceVolatility,
  };
  const ticksSinceLastTrade =
    portfolio.lastTradeTick != null
      ? portfolio.currentTick - portfolio.lastTradeTick
      : null;
  const portfolioData = {
    c: round(portfolio.cashMon, 2),
    t: round(portfolio.tokenUnits, 2),
    eq: round(portfolio.equity, 2),
    posPct: round(portfolio.positionPct, 2),
    init: round(portfolio.initialCapital, 2),
    aep: portfolio.avgEntryPrice ? round(portfolio.avgEntryPrice, 6) : null,
    tw: portfolio.tradesThisWindow,
    ltt: portfolio.lastTradeTick,
    tsl: ticksSinceLastTrade,
  };
  return ["M:", JSON.stringify(marketData), "P:", JSON.stringify(portfolioData)].join("\n");
}

function buildUserMessage(input: DecideTradeInput): string {
  const parts: string[] = [
    formatMarketAndPortfolio(input.market, input.portfolio),
    "Cfg:",
    JSON.stringify(input.profile),
  ];
  if (input.customRules?.trim()) {
    parts.push("Rules:", sanitizeString(input.customRules, 500));
  }
  if (input.memory?.trim()) {
    parts.push("Mem:", sanitizeString(input.memory, 1000));
  }
  return parts.join("\n");
}

function buildUserMessageMulti(input: DecideTradeMultiArenaInput): string {
  const parts: string[] = [];
  input.arenas.forEach((a, i) => {
    parts.push(`Arena ${i} (${a.arenaLabel}):`);
    parts.push(formatMarketAndPortfolio(a.market, a.portfolio));
  });
  parts.push("Cfg:", JSON.stringify(input.profile));
  if (input.customRules?.trim()) {
    parts.push("Rules:", sanitizeString(input.customRules, 500));
  }
  if (input.memory?.trim()) {
    parts.push("Mem:", sanitizeString(input.memory, 1000));
  }
  return parts.join("\n");
}

/**
 * Extract plain text from Chat Completions message content.
 * Content can be a string (older) or array of parts with type "text" | "refusal" (GPT-5 / newer).
 */
function extractMessageText(
  content: string | Array<{ type: string; text?: string }> | null | undefined,
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Extract the first complete JSON value (object or array) from content that may
 * include markdown, code fences, or trailing text. Uses bracket matching; skips
 * brackets inside double-quoted strings.
 */
function parseJsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const firstBracket = withoutFence.search(/[\[{]/);
  if (firstBracket === -1) throw new Error("No JSON object or array");
  const start = firstBracket;
  const stack: string[] = [withoutFence[start]];
  let i = start + 1;
  const len = withoutFence.length;
  let inString: '"' | "'" | null = null;
  while (i < len && stack.length > 0) {
    const c = withoutFence[i];
    if (inString !== null) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    if (c === "[" || c === "{") {
      stack.push(c);
      i++;
      continue;
    }
    if (c === "]") {
      if (stack[stack.length - 1] !== "[") throw new Error("Unclosed JSON");
      stack.pop();
      i++;
      continue;
    }
    if (c === "}") {
      if (stack[stack.length - 1] !== "{") throw new Error("Unclosed JSON");
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  if (stack.length !== 0) throw new Error("Unclosed JSON");
  const slice = withoutFence.slice(start, i);
  return JSON.parse(slice) as unknown;
}

/** Safe one-line summary for logging (no circular refs, bounded length). */
function inspectForLog(value: unknown, maxLen = 500): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.slice(0, maxLen);
  if (Array.isArray(value)) {
    const parts = value.map((item, i) => {
      if (item && typeof item === "object" && "type" in item && "text" in item) {
        return `{type:${(item as { type: string }).type},text:${String((item as { text: string }).text).slice(0, 80)}}`;
      }
      return JSON.stringify(item)?.slice(0, 80);
    });
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const preview: Record<string, string> = {};
    for (const k of keys.slice(0, 10)) {
      const v = (value as Record<string, unknown>)[k];
      preview[k] = typeof v === "string" ? v.slice(0, 60) : String(v);
    }
    return JSON.stringify(preview);
  }
  return String(value);
}

export async function decideTrade(
  input: DecideTradeInput,
): Promise<TradeDecision> {
  try {
    if (DEBUG) {
      console.log(`[AI] Calling OpenAI (model: ${model}) for trade decision`);
    }
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      // Reduce reasoning so tokens are left for the actual JSON answer (deterministic task).
      reasoning_effort: "low",
    });

    const choice = completion.choices?.[0];
    const rawContent = choice?.message?.content;
    // Message content can be string or array of { type: "text" | "refusal", text?: string } (GPT-5 / newer API)
    const content = extractMessageText(rawContent);

    if (!content?.trim()) {
      // Always log when content is empty so we can diagnose (finish_reason, usage, content shape)
      const msg = choice?.message as unknown as Record<string, unknown> | undefined;
      const refusal = msg?.refusal;
      const parts = Array.isArray(rawContent) ? rawContent : [];
      const hasRefusalPart = parts.some((p: unknown) => p && typeof p === "object" && (p as { type?: string }).type === "refusal");
      console.warn("[AI] OpenAI returned empty content, using HOLD. Diagnostic:", {
        responseKeys: Object.keys(completion),
        choicesLength: completion.choices?.length ?? 0,
        finish_reason: choice?.finish_reason,
        messageKeys: msg ? Object.keys(msg) : [],
        messageRefusal: refusal != null ? inspectForLog(refusal, 150) : undefined,
        contentType: rawContent === null ? "null" : rawContent === undefined ? "undefined" : Array.isArray(rawContent) ? "array" : "string",
        contentArrayLength: Array.isArray(rawContent) ? rawContent.length : undefined,
        hasRefusalPart,
        contentPreview: inspectForLog(rawContent, 300),
        usage: (completion as { usage?: unknown }).usage,
      });
      return MODEL_ERROR_DECISION;
    }

    const raw = parseJsonFromContent(content);
    const parsed = TradeDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      if (DEBUG) {
        console.log("[AI] OpenAI response invalid JSON, using HOLD:", parsed.error.message);
      }
      return MODEL_ERROR_DECISION;
    }
    const decision = parsed.data;
    if (DEBUG) {
      const reasonShort =
        decision.reason.length > 60 ? decision.reason.slice(0, 60) + "…" : decision.reason;
      console.log(
        `[AI] Response: action=${decision.action} sizePct=${(decision.sizePct * 100).toFixed(0)}% confidence=${decision.confidence.toFixed(2)} reason="${reasonShort}"`
      );
    }
    return decision;
  } catch (err) {
    if (DEBUG) {
      console.error("[AI] OpenAI request failed:", err);
    }
    return MODEL_ERROR_DECISION;
  }
}

/** One AI request per agent: get one decision per arena in the same order as input.arenas. */
export async function decideTradesForAllArenas(
  input: DecideTradeMultiArenaInput,
): Promise<TradeDecision[]> {
  const n = input.arenas.length;
  if (n === 0) return [];

  const fallback = (): TradeDecision[] => Array.from({ length: n }, () => ({ ...MODEL_ERROR_DECISION }));

  try {
    if (DEBUG) {
      console.log(`[AI] Calling OpenAI (model: ${model}) for ${n} arena(s) in one request`);
    }
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: MULTI_ARENA_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessageMulti(input) },
      ],
      max_completion_tokens: Math.min(4096, 512 + n * 256),
      reasoning_effort: "low",
    });

    const choice = completion.choices?.[0];
    const rawContent = choice?.message?.content;
    const content = extractMessageText(rawContent);

    if (!content?.trim()) {
      if (DEBUG) {
        console.warn("[AI] Multi-arena OpenAI empty content, using HOLD for all arenas");
      }
      return fallback();
    }

    const raw = parseJsonFromContent(content);
    const parsed = TradeDecisionArraySchema.safeParse(raw);
    if (!parsed.success) {
      if (DEBUG) {
        console.warn("[AI] Multi-arena response invalid or not array:", parsed.error.message);
      }
      return fallback();
    }

    const decisions = parsed.data;
    if (decisions.length !== n) {
      if (DEBUG) {
        console.warn(`[AI] Multi-arena expected ${n} decisions, got ${decisions.length}, using HOLD for all`);
      }
      return fallback();
    }

    if (DEBUG) {
      decisions.forEach((d, i) => {
        const reasonShort = d.reason.length > 40 ? d.reason.slice(0, 40) + "…" : d.reason;
        console.log(`[AI] Arena ${i}: action=${d.action} sizePct=${(d.sizePct * 100).toFixed(0)}% reason="${reasonShort}"`);
      });
    }
    return decisions;
  } catch (err) {
    if (DEBUG) {
      console.error("[AI] Multi-arena OpenAI request failed:", err);
    }
    return fallback();
  }
}
