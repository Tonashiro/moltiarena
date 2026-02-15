import { describe, it, expect } from "vitest";
import { applyGuardrails } from "./guardrails.js";
import type { GuardrailsInput, GuardrailsPortfolio } from "./guardrails.js";
import type { AgentProfileConfig } from "../schemas/agentProfile.js";
import type { TradeDecision } from "../ai/decision.js";

const baseSnapshot = {
  tick: 100,
  price: 1.5,
  events_1h: 500,
  volume_mon_1h: 50_000,
};

const basePortfolio: GuardrailsPortfolio = {
  cashMon: 100,
  tokenUnits: 0,
  tradesThisWindow: 2,
  lastTradeTick: 90,
};

const baseProfile: AgentProfileConfig = {
  name: "TestAgent",
  goal: "maximize_pnl",
  style: "moderate",
  constraints: {
    maxTradePct: 0.2,
    maxPositionPct: 0.5,
    cooldownTicks: 5,
    maxTradesPerWindow: 10,
  },
  filters: {
    minEvents1h: 100,
    minVolumeMon1h: 10_000,
  },
};

const buyDecision: TradeDecision = {
  action: "BUY",
  sizePct: 0.15,
  confidence: 0.8,
  reason: "test",
};

function run(input: Partial<GuardrailsInput>): TradeDecision {
  return applyGuardrails({
    snapshot: baseSnapshot,
    portfolio: basePortfolio,
    profileConfig: baseProfile,
    modelDecision: buyDecision,
    ...input,
  });
}

describe("applyGuardrails", () => {
  it("passes through valid BUY when all conditions pass", () => {
    const r = run({
      portfolio: { ...basePortfolio, lastTradeTick: 90 },
      snapshot: { ...baseSnapshot, tick: 96 },
    });
    expect(r.action).toBe("BUY");
    expect(r.sizePct).toBe(0.15);
  });

  it("=> HOLD when events_1h < minEvents1h", () => {
    const r = run({
      snapshot: { ...baseSnapshot, events_1h: 50 },
    });
    expect(r.action).toBe("HOLD");
    expect(r.sizePct).toBe(0);
    expect(r.reason).toContain("events_1h");
  });

  it("=> HOLD when volume_mon_1h < minVolumeMon1h", () => {
    const r = run({
      snapshot: { ...baseSnapshot, volume_mon_1h: 5_000 },
    });
    expect(r.action).toBe("HOLD");
    expect(r.reason).toContain("volume_mon_1h");
  });

  it("=> HOLD when in cooldown (tick - lastTradeTick < cooldownTicks)", () => {
    const r = run({
      snapshot: { ...baseSnapshot, tick: 92 },
      portfolio: { ...basePortfolio, lastTradeTick: 90 },
    });
    expect(r.action).toBe("HOLD");
    expect(r.reason).toContain("cooldown");
  });

  it("allows trade when just past cooldown", () => {
    const r = run({
      snapshot: { ...baseSnapshot, tick: 96 },
      portfolio: { ...basePortfolio, lastTradeTick: 90 },
    });
    expect(r.action).toBe("BUY");
  });

  it("=> HOLD when tradesThisWindow >= maxTradesPerWindow", () => {
    const r = run({
      portfolio: { ...basePortfolio, tradesThisWindow: 10 },
    });
    expect(r.action).toBe("HOLD");
    expect(r.reason).toContain("max trades");
  });

  it("caps sizePct to maxTradePct", () => {
    const r = run({
      modelDecision: { ...buyDecision, sizePct: 0.5 },
    });
    expect(r.action).toBe("BUY");
    expect(r.sizePct).toBe(0.2);
  });

  it("=> HOLD when BUY and positionPct >= maxPositionPct", () => {
    const r = run({
      portfolio: {
        cashMon: 50,
        tokenUnits: 100,
        tradesThisWindow: 0,
        lastTradeTick: null,
      },
      snapshot: { ...baseSnapshot, price: 1 },
      modelDecision: { ...buyDecision, sizePct: 0.1 },
    });
    expect(r.action).toBe("HOLD");
    expect(r.reason).toContain("position");
  });

  it("allows BUY when positionPct below max", () => {
    const r = run({
      portfolio: {
        cashMon: 200,
        tokenUnits: 50,
        tradesThisWindow: 0,
        lastTradeTick: null,
      },
      snapshot: { ...baseSnapshot, price: 1 },
    });
    expect(r.action).toBe("BUY");
  });

  it("=> HOLD when sizePct <= 0", () => {
    const r = run({
      modelDecision: { ...buyDecision, sizePct: 0 },
    });
    expect(r.action).toBe("HOLD");
    expect(r.reason).toContain("sizePct");
  });

  it("=> HOLD when sizePct negative (edge case)", () => {
    const r = run({
      modelDecision: { ...buyDecision, sizePct: -0.1 },
    });
    expect(r.action).toBe("HOLD");
  });

  it("passes through SELL without position cap (only BUY capped by position)", () => {
    const r = run({
      modelDecision: {
        action: "SELL",
        sizePct: 0.3,
        confidence: 0.7,
        reason: "sell",
      },
    });
    expect(r.action).toBe("SELL");
    expect(r.sizePct).toBe(0.2);
  });

  it("passes through HOLD unchanged", () => {
    const r = run({
      modelDecision: {
        action: "HOLD",
        sizePct: 0,
        confidence: 0.5,
        reason: "hold",
      },
    });
    expect(r.action).toBe("HOLD");
    expect(r.sizePct).toBe(0);
  });

  it("no cooldown when lastTradeTick is null", () => {
    const r = run({
      portfolio: { ...basePortfolio, lastTradeTick: null },
    });
    expect(r.action).toBe("BUY");
  });
});
