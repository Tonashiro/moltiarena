import { describe, it, expect } from "vitest";
import { executePaperTrade } from "./execution.js";
import type { ExecutionPortfolio, ExecutionSnapshot } from "./execution.js";
import type { TradeDecision } from "../ai/decision.js";

const snapshot: ExecutionSnapshot = { tick: 10, price: 2 };
const basePortfolio: ExecutionPortfolio = {
  cashMon: 100,
  tokenUnits: 0,
  avgEntryPrice: null,
  tradesThisWindow: 0,
  lastTradeTick: null,
};

function run(
  snap: ExecutionSnapshot,
  port: ExecutionPortfolio,
  decision: TradeDecision
) {
  return executePaperTrade(snap, port, decision);
}

describe("executePaperTrade", () => {
  it("HOLD returns same portfolio and no tradeRecord", () => {
    const r = run(snapshot, basePortfolio, {
      action: "HOLD",
      sizePct: 0,
      confidence: 0.5,
      reason: "wait",
    });
    expect(r.tradeRecord).toBeUndefined();
    expect(r.nextPortfolio.cashMon).toBe(100);
    expect(r.nextPortfolio.tokenUnits).toBe(0);
    expect(r.nextPortfolio.tradesThisWindow).toBe(0);
    expect(r.nextPortfolio.lastTradeTick).toBeNull();
  });

  it("BUY: spend = cashMon * sizePct, units = spend / price", () => {
    const r = run(snapshot, basePortfolio, {
      action: "BUY",
      sizePct: 0.2,
      confidence: 0.8,
      reason: "buy",
    });
    expect(r.tradeRecord).toBeDefined();
    expect(r.tradeRecord!.action).toBe("BUY");
    expect(r.tradeRecord!.price).toBe(2);
    expect(r.tradeRecord!.tick).toBe(10);

    const spend = 100 * 0.2;
    const units = spend / 2;
    expect(r.nextPortfolio.cashMon).toBe(100 - spend);
    expect(r.nextPortfolio.tokenUnits).toBe(units);
    expect(r.tradeRecord!.cashAfter).toBe(r.nextPortfolio.cashMon);
    expect(r.tradeRecord!.tokenAfter).toBe(r.nextPortfolio.tokenUnits);
  });

  it("BUY from zero sets avgEntryPrice to price", () => {
    const r = run(snapshot, basePortfolio, {
      action: "BUY",
      sizePct: 0.5,
      confidence: 0.7,
      reason: "buy",
    });
    expect(r.nextPortfolio.avgEntryPrice).toBe(2);
  });

  it("BUY with existing position updates avgEntryPrice (weighted average)", () => {
    const port: ExecutionPortfolio = {
      cashMon: 80,
      tokenUnits: 10,
      avgEntryPrice: 1.5,
      tradesThisWindow: 1,
      lastTradeTick: 5,
    };
    const r = run({ tick: 10, price: 2 }, port, {
      action: "BUY",
      sizePct: 0.25,
      confidence: 0.8,
      reason: "add",
    });
    const spend = 80 * 0.25;
    const newUnits = spend / 2;
    const totalCost = 1.5 * 10 + spend;
    const totalUnits = 10 + newUnits;
    expect(r.nextPortfolio.avgEntryPrice).toBeCloseTo(totalCost / totalUnits);
  });

  it("SELL: sellUnits = tokenUnits * sizePct, receive = sellUnits * price", () => {
    const port: ExecutionPortfolio = {
      cashMon: 50,
      tokenUnits: 20,
      avgEntryPrice: 1,
      tradesThisWindow: 2,
      lastTradeTick: 8,
    };
    const r = run({ tick: 10, price: 2 }, port, {
      action: "SELL",
      sizePct: 0.5,
      confidence: 0.8,
      reason: "sell",
    });
    const sellUnits = 20 * 0.5;
    const receive = sellUnits * 2;
    expect(r.nextPortfolio.cashMon).toBe(50 + receive);
    expect(r.nextPortfolio.tokenUnits).toBe(20 - sellUnits);
    expect(r.tradeRecord!.action).toBe("SELL");
    expect(r.tradeRecord!.cashAfter).toBe(r.nextPortfolio.cashMon);
    expect(r.tradeRecord!.tokenAfter).toBe(r.nextPortfolio.tokenUnits);
  });

  it("SELL keeps avgEntryPrice when position remains", () => {
    const port: ExecutionPortfolio = {
      cashMon: 50,
      tokenUnits: 20,
      avgEntryPrice: 1.5,
      tradesThisWindow: 0,
      lastTradeTick: null,
    };
    const r = run(snapshot, port, {
      action: "SELL",
      sizePct: 0.25,
      confidence: 0.7,
      reason: "trim",
    });
    expect(r.nextPortfolio.tokenUnits).toBe(20 - 20 * 0.25);
    expect(r.nextPortfolio.avgEntryPrice).toBe(1.5);
  });

  it("SELL to zero sets avgEntryPrice to null", () => {
    const port: ExecutionPortfolio = {
      cashMon: 0,
      tokenUnits: 10,
      avgEntryPrice: 2,
      tradesThisWindow: 0,
      lastTradeTick: null,
    };
    const r = run({ tick: 10, price: 2 }, port, {
      action: "SELL",
      sizePct: 1,
      confidence: 0.9,
      reason: "exit",
    });
    expect(r.nextPortfolio.tokenUnits).toBe(0);
    expect(r.nextPortfolio.avgEntryPrice).toBeNull();
  });

  it("increments tradesThisWindow and sets lastTradeTick on BUY", () => {
    const r = run(snapshot, basePortfolio, {
      action: "BUY",
      sizePct: 0.1,
      confidence: 0.6,
      reason: "buy",
    });
    expect(r.nextPortfolio.tradesThisWindow).toBe(1);
    expect(r.nextPortfolio.lastTradeTick).toBe(10);
  });

  it("increments tradesThisWindow and sets lastTradeTick on SELL", () => {
    const port: ExecutionPortfolio = {
      ...basePortfolio,
      tokenUnits: 10,
    };
    const r = run({ tick: 15, price: 2 }, port, {
      action: "SELL",
      sizePct: 0.2,
      confidence: 0.7,
      reason: "sell",
    });
    expect(r.nextPortfolio.tradesThisWindow).toBe(1);
    expect(r.nextPortfolio.lastTradeTick).toBe(15);
  });

  it("sizePct 0 returns no tradeRecord", () => {
    const r = run(snapshot, basePortfolio, {
      action: "BUY",
      sizePct: 0,
      confidence: 0.5,
      reason: "skip",
    });
    expect(r.tradeRecord).toBeUndefined();
    expect(r.nextPortfolio.cashMon).toBe(100);
    expect(r.nextPortfolio.tradesThisWindow).toBe(0);
  });

  it("tradeRecord includes reason", () => {
    const r = run(snapshot, basePortfolio, {
      action: "BUY",
      sizePct: 0.2,
      confidence: 0.8,
      reason: "momentum up",
    });
    expect(r.tradeRecord!.reason).toBe("momentum up");
  });
});
