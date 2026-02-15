import type { TradeDecision } from "../ai/decision.js";

export interface ExecutionPortfolio {
  cashMon: number;
  tokenUnits: number;
  avgEntryPrice: number | null;
  tradesThisWindow: number;
  lastTradeTick: number | null;
}

export interface ExecutionSnapshot {
  tick: number;
  price: number;
}

export interface TradeRecord {
  action: "BUY" | "SELL";
  sizePct: number;
  price: number;
  tradeValueMon: number; // Trade notional for volume aggregation
  cashAfter: number;
  tokenAfter: number;
  reason: string;
  tick: number;
}

export interface ExecutionResult {
  nextPortfolio: ExecutionPortfolio;
  tradeRecord?: TradeRecord;
}

/**
 * Executes a paper trade from the given decision. Returns updated portfolio
 * and an optional trade record when BUY or SELL is executed.
 */
export function executePaperTrade(
  snapshot: ExecutionSnapshot,
  portfolio: ExecutionPortfolio,
  decision: TradeDecision
): ExecutionResult {
  const { action, sizePct, reason } = decision;
  const { tick, price } = snapshot;

  if (action === "HOLD" || sizePct <= 0) {
    return { nextPortfolio: { ...portfolio } };
  }

  let cashMon = portfolio.cashMon;
  let tokenUnits = portfolio.tokenUnits;
  let avgEntryPrice = portfolio.avgEntryPrice;

  if (action === "BUY") {
    const spend = cashMon * sizePct;
    const units = spend / price;
    cashMon -= spend;
    tokenUnits += units;
    if (portfolio.tokenUnits > 0) {
      const totalCost =
        (portfolio.avgEntryPrice ?? 0) * portfolio.tokenUnits + spend;
      avgEntryPrice = tokenUnits > 0 ? totalCost / tokenUnits : null;
    } else {
      avgEntryPrice = price;
    }
  } else {
    // SELL
    const sellUnits = tokenUnits * sizePct;
    const receive = sellUnits * price;
    cashMon += receive;
    tokenUnits -= sellUnits;
    if (tokenUnits <= 0) {
      avgEntryPrice = null;
    }
  }

  const nextPortfolio: ExecutionPortfolio = {
    cashMon,
    tokenUnits,
    avgEntryPrice,
    tradesThisWindow: portfolio.tradesThisWindow + 1,
    lastTradeTick: tick,
  };

  const tradeValueMon =
    action === "BUY"
      ? portfolio.cashMon * sizePct
      : portfolio.tokenUnits * sizePct * price;
  const tradeRecord: TradeRecord = {
    action,
    sizePct,
    price,
    tradeValueMon,
    cashAfter: cashMon,
    tokenAfter: tokenUnits,
    reason,
    tick,
  };

  return { nextPortfolio, tradeRecord };
}
