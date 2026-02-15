import { z } from "zod";

const constraintsSchema = z.object({
  maxTradePct: z.number().min(0.01).max(1),
  maxPositionPct: z.number().min(0.01).max(1),
  cooldownTicks: z.number().int().min(0).max(50),
  maxTradesPerWindow: z.number().int().min(1).max(200),
});

const filtersSchema = z.object({
  minEvents1h: z.number().int().min(0).max(100_000),
  minVolumeMon1h: z.number().min(0).max(1e12),
});

export const agentProfileConfigSchema = z.object({
  name: z.string().min(3, "Name 3–40 chars").max(40),
  goal: z.enum(["maximize_pnl", "risk_adjusted", "min_drawdown"]),
  style: z.enum(["conservative", "moderate", "aggressive"]),
  constraints: constraintsSchema,
  filters: filtersSchema,
  /** Free-text custom trading rules supplied by the agent creator (max 500 chars). */
  customRules: z.string().max(500, "Max 500 characters").optional().default(""),
});

export type AgentProfileConfig = z.infer<typeof agentProfileConfigSchema>;
