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

function buildUserMessage(input: DecideTradeInput): string {
  // Round numbers to reduce token usage (price to 6 decimals, others to 2)
  const round = (n: number, decimals: number) =>
    Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);

  // Compact market data format
  const marketData = {
    p: round(input.market.price, 6), // price
    r1: round(input.market.ret_1m_pct, 2), // ret_1m_pct
    r5: round(input.market.ret_5m_pct, 2), // ret_5m_pct
    v: round(input.market.vol_5m_pct, 2), // vol_5m_pct
    e: input.market.events_1h, // events_1h
    vol: round(input.market.volume_mon_1h, 2), // volume_mon_1h
    pt: input.market.price_tail.map((p) => round(p, 6)), // price_tail (compact)
    // Enhancement 1: Buy/Sell metrics
    bc: input.market.buyCount, // buyCount
    sc: input.market.sellCount, // sellCount
    wc: input.market.swapCount, // swapCount
    bsr: round(input.market.buySellRatio, 2), // buySellRatio
    // Enhancement 2: Recent events (already compact format)
    re: input.market.recentEvents, // recentEvents: [["B", price, volume], ...]
    // Enhancement 3: Trader metrics
    ut: input.market.uniqueTraders, // uniqueTraders
    avpt: round(input.market.avgVolumePerTrader, 2), // avgVolumePerTrader
    lt: round(input.market.largestTrade, 2), // largestTrade
    wh: input.market.whaleActivity, // whaleActivity (boolean)
    // Enhancement 4: Patterns
    m: input.market.momentum, // momentum: "B"|"S"|"N"
    vt: input.market.volumeTrend, // volumeTrend: "I"|"D"|"S"
    pv: input.market.priceVolatility, // priceVolatility: "H"|"M"|"L"
  };

  // ticksSinceLastTrade: null if never traded, else currentTick - lastTradeTick
  const ticksSinceLastTrade =
    input.portfolio.lastTradeTick != null
      ? input.portfolio.currentTick - input.portfolio.lastTradeTick
      : null;

  // Compact portfolio format (c=cash to buy, t=tokens held, eq=equity, posPct=token exposure %, tsl=ticks since last trade)
  const portfolioData = {
    c: round(input.portfolio.cashMon, 2), // cash available to BUY
    t: round(input.portfolio.tokenUnits, 2), // tokens held (can SELL)
    eq: round(input.portfolio.equity, 2), // total portfolio value
    posPct: round(input.portfolio.positionPct, 2), // token exposure % (0=all cash, 1=all tokens)
    init: round(input.portfolio.initialCapital, 2), // initial capital
    aep: input.portfolio.avgEntryPrice
      ? round(input.portfolio.avgEntryPrice, 6)
      : null, // avg entry price
    tw: input.portfolio.tradesThisWindow, // trades this window
    ltt: input.portfolio.lastTradeTick, // tick of last trade
    tsl: ticksSinceLastTrade, // ticks since last trade (null if never)
  };

  const parts: string[] = [
    "M:", // Market (shortened)
    JSON.stringify(marketData),
    "P:", // Portfolio (shortened)
    JSON.stringify(portfolioData),
    "Cfg:", // Profile Config (shortened)
    JSON.stringify(input.profile),
  ];
  if (input.customRules?.trim()) {
    // Sanitize custom rules before including in prompt
    const sanitizedRules = sanitizeString(input.customRules, 500);
    parts.push("Rules:", sanitizedRules);
  }
  if (input.memory?.trim()) {
    // Sanitize memory before including in prompt
    const sanitizedMemory = sanitizeString(input.memory, 1000);
    parts.push("Mem:", sanitizedMemory); // Memory (shortened)
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

function parseJsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}") + 1;
  if (start === -1 || end <= start) throw new Error("No JSON object");
  return JSON.parse(trimmed.slice(start, end)) as unknown;
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
      const msg = choice?.message as Record<string, unknown> | undefined;
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
