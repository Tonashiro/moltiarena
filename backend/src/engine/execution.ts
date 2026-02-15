import type { TradeDecision } from "../ai/decision.js";

/** Fee rate: 0.5% (matching contract TRADE_FEE_BPS = 50 / 10000). */
const TRADE_FEE_RATE = 0.005;

export interface ExecutionPortfolio {
  cashMon: number;          // wallet MOLTI balance
  tokenUnits: number;       // virtual token position
  moltiLocked: number;      // MOLTI staked in this arena (after BUY fees)
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
  tradeValueMon: number; // Trade notional / MOLTI amount
  avgEntryPriceBefore: number | null; // For SELL: avg entry price before trade (PnL)
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
 *
 * BUY: spend = cashMon * sizePct. Fee deducted from spend. Net buys virtual tokens.
 *      moltiLocked increases by netSpend.
 * SELL: moltiBack = moltiLocked * sizePct. Fee deducted from moltiBack.
 *      Net returned to cashMon. tokenUnits reduced proportionally.
 *      PnL is paper-only — SELL returns proportional original deposit, not price-based.
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
  let moltiLocked = portfolio.moltiLocked;
  let avgEntryPrice = portfolio.avgEntryPrice;

  if (action === "BUY") {
    const spend = cashMon * sizePct;        // gross MOLTI from wallet
    const fee = spend * TRADE_FEE_RATE;
    const netSpend = spend - fee;
    const units = netSpend / price;         // virtual tokens bought

    cashMon -= spend;
    moltiLocked += netSpend;
    tokenUnits += units;

    if (portfolio.tokenUnits > 0) {
      const totalCost =
        (portfolio.avgEntryPrice ?? 0) * portfolio.tokenUnits + netSpend;
      avgEntryPrice = tokenUnits > 0 ? totalCost / tokenUnits : null;
    } else {
      avgEntryPrice = price;
    }
  } else {
    // SELL: return proportional moltiLocked (cost-basis, NOT price-based)
    const moltiBack = moltiLocked * sizePct;
    const fee = moltiBack * TRADE_FEE_RATE;
    const netReturn = moltiBack - fee;

    moltiLocked -= moltiBack;
    cashMon += netReturn;

    // Reduce virtual token position proportionally
    const sellUnits = tokenUnits * sizePct;
    tokenUnits -= sellUnits;

    if (tokenUnits <= 0) {
      avgEntryPrice = null;
    }
  }

  const nextPortfolio: ExecutionPortfolio = {
    cashMon,
    tokenUnits,
    moltiLocked,
    avgEntryPrice,
    tradesThisWindow: portfolio.tradesThisWindow + 1,
    lastTradeTick: tick,
  };

  // Trade value for volume tracking
  const tradeValueMon =
    action === "BUY"
      ? portfolio.cashMon * sizePct
      : portfolio.moltiLocked * sizePct;

  const tradeRecord: TradeRecord = {
    action,
    sizePct,
    price,
    tradeValueMon,
    avgEntryPriceBefore: action === "SELL" ? portfolio.avgEntryPrice : null,
    cashAfter: cashMon,
    tokenAfter: tokenUnits,
    reason,
    tick,
  };

  return { nextPortfolio, tradeRecord };
}
