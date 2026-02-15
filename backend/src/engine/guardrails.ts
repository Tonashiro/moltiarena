import type { MarketSnapshot } from "../market/types.js";
import type { AgentProfileConfig } from "../schemas/agentProfile.js";
import type { TradeDecision } from "../ai/decision.js";

export interface GuardrailsPortfolio {
  cashMon: number;
  tokenUnits: number;
  tradesThisWindow: number;
  lastTradeTick: number | null;
}

export interface GuardrailsInput {
  snapshot: Pick<MarketSnapshot, "tick" | "price" | "events_1h" | "volume_mon_1h">;
  portfolio: GuardrailsPortfolio;
  profileConfig: AgentProfileConfig;
  modelDecision: TradeDecision;
}

/**
 * When guardrails override to HOLD, we keep the model's reason but append the
 * override cause so the stored decision clearly shows why action is HOLD.
 */
function reasonForHold(decision: TradeDecision, overrideReason: string): string {
  const r = decision.reason ?? "";
  const modelReason =
    r.length > 0 && r !== "model_error" ? r : "model chose no trade";
  return `${modelReason} [${overrideReason}]`;
}

function toHold(decision: TradeDecision, overrideReason: string): TradeDecision {
  return {
    action: "HOLD",
    sizePct: 0,
    confidence: decision.confidence,
    reason: reasonForHold(decision, overrideReason),
  };
}

function positionPct(portfolio: GuardrailsPortfolio, price: number): number {
  const tokenValue = portfolio.tokenUnits * price;
  const total = portfolio.cashMon + tokenValue;
  if (total <= 0) return 0;
  return tokenValue / total;
}

/**
 * Returns the agent's market filters unchanged. User config is always respected.
 */
export function getEffectiveFilters(filters: {
  minEvents1h: number;
  minVolumeMon1h: number;
}): { minEvents1h: number; minVolumeMon1h: number } {
  return { minEvents1h: filters.minEvents1h, minVolumeMon1h: filters.minVolumeMon1h };
}

/**
 * Applies guardrails to the model decision. Returns a final decision that may
 * be overridden to HOLD or have sizePct capped.
 */
export function applyGuardrails(input: GuardrailsInput): TradeDecision {
  const { snapshot, portfolio, profileConfig, modelDecision } = input;
  const { constraints, filters } = profileConfig;

  const { minEvents1h: minEvents, minVolumeMon1h: minVolume } = getEffectiveFilters(filters);

  if (snapshot.events_1h < minEvents) {
    return toHold(modelDecision, "guardrail: events_1h below minimum");
  }
  if (snapshot.volume_mon_1h < minVolume) {
    return toHold(modelDecision, "guardrail: volume_mon_1h below minimum");
  }

  if (portfolio.lastTradeTick !== null) {
    const ticksSince = snapshot.tick - portfolio.lastTradeTick;
    if (ticksSince < constraints.cooldownTicks) {
      return toHold(modelDecision, "guardrail: cooldown");
    }
  }

  if (portfolio.tradesThisWindow >= constraints.maxTradesPerWindow) {
    return toHold(modelDecision, "guardrail: max trades per window");
  }

  let { action, sizePct, confidence, reason } = modelDecision;

  if (sizePct <= 0) {
    return toHold(modelDecision, "guardrail: sizePct <= 0");
  }

  sizePct = Math.min(sizePct, constraints.maxTradePct);

  if (action === "BUY") {
    const currentPositionPct = positionPct(portfolio, snapshot.price);
    if (currentPositionPct >= constraints.maxPositionPct) {
      return toHold(modelDecision, "guardrail: position at or above max");
    }
  }

  return { action, sizePct, confidence, reason };
}
