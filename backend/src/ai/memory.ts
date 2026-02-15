import type { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { sanitizeString } from "../utils/validation.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2,
});

const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";

export interface AgentMemoryService {
  /**
   * Get the agent's persona memory (evolving summary of actions and results across all arenas).
   * Returns empty string if no memory exists yet.
   */
  getMemory(agentId: number): Promise<string>;

  /**
   * Backward-compat: same as getMemory(agentId). Arena is ignored; persona is agent-level.
   */
  getMemory(agentId: number, arenaId: number): Promise<string>;

  /**
   * Update the agent's persona memory based on recent trades and performance across all arenas.
   * Call once per agent per tick after processing all arenas.
   */
  updateMemory(agentId: number, tick: number): Promise<void>;

  /**
   * AI-powered persona summarization: analyzes all agent data across arenas
   * and generates one evolving memory summary. Call periodically (e.g. every 6h).
   */
  summarizeWithAI(
    agentId: number,
    agentName: string,
    agentProfile: unknown
  ): Promise<void>;
}

/**
 * Creates a memory service. Memory is stored per agent (persona), not per arena.
 * The persona evolves from the agent's actions and results across all arenas.
 */
export function createMemoryService(
  prisma: PrismaClient
): AgentMemoryService {
  return {
    async getMemory(agentId: number, _arenaId?: number): Promise<string> {
      try {
        const memory = await prisma.agentPersonaMemory.findUnique({
          where: { agentId },
        });
        return memory?.memoryText ?? "";
      } catch (error) {
        console.error(`[memory] Failed to get persona memory for agent ${agentId}:`, error);
        return "";
      }
    },

    async updateMemory(agentId: number, tick: number): Promise<void> {
      try {
        // Load recent trades across all arenas (last 30 by tick desc)
        const recentTrades = await prisma.trade.findMany({
          where: { agentId },
          orderBy: { tick: "desc" },
          take: 30,
          include: { arena: { select: { id: true, name: true, tokenAddress: true } } },
        });
        const reversed = [...recentTrades].reverse();

        // Load current portfolios for this agent (all arenas) for PnL context
        const portfolios = await prisma.portfolio.findMany({
          where: { agentId },
          orderBy: { updatedAt: "desc" },
          include: { arena: { select: { id: true, name: true } } },
        });

        const totalTrades = await prisma.trade.count({ where: { agentId } });

        const memoryParts: string[] = [];

        if (reversed.length > 0) {
          const buyCount = reversed.filter((t) => t.action === "BUY").length;
          const sellCount = reversed.filter((t) => t.action === "SELL").length;
          memoryParts.push(
            `Recent activity across arenas: ${buyCount} buys, ${sellCount} sells.`
          );

          if (reversed.length >= 3) {
            const last3 = reversed.slice(-3);
            const allSame = last3.every((t) => t.action === last3[0]!.action);
            if (allSame) {
              memoryParts.push(
                `Pattern: ${last3[0]!.action} streak (${last3.length} consecutive).`
              );
            }
          }

          // Per-arena PnL hint from portfolios (equity vs initial)
          const pnlParts: string[] = [];
          for (const p of portfolios) {
            if (p.initialCapital != null && p.initialCapital > 0) {
              const equity = p.cashMon + p.tokenUnits * (p.avgEntryPrice ?? 0);
              const pnl = ((equity - p.initialCapital) / p.initialCapital) * 100;
              const label = p.arena?.name ?? `arena ${p.arenaId}`;
              pnlParts.push(`${label}: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`);
            }
          }
          if (pnlParts.length > 0) {
            memoryParts.push(`Performance: ${pnlParts.join("; ")}.`);
          }

          const reasons = reversed.map((t) => t.reason.toLowerCase()).join(" ");
          if (reasons.includes("momentum") || reasons.includes("trend")) {
            memoryParts.push("Strategy: momentum-focused.");
          }
          if (reasons.includes("volatility") || reasons.includes("vol")) {
            memoryParts.push("Strategy: volatility-aware.");
          }
          if (reasons.includes("whale") || reasons.includes("large")) {
            memoryParts.push("Strategy: whale-activity responsive.");
          }

          const avgSize =
            reversed.reduce((sum, t) => sum + t.sizePct, 0) / reversed.length;
          if (avgSize > 0.5) {
            memoryParts.push("Trading style: large positions.");
          } else if (avgSize < 0.2) {
            memoryParts.push("Trading style: conservative positions.");
          }
        } else {
          memoryParts.push("No trades yet. Learning phase.");
        }

        if (totalTrades > 0) {
          memoryParts.push(`Total trades (all arenas): ${totalTrades}.`);
        }

        const memoryText = sanitizeString(memoryParts.join(" "), 600);

        await prisma.agentPersonaMemory.upsert({
          where: { agentId },
          create: {
            agentId,
            memoryText,
            lastUpdatedTick: tick,
          },
          update: {
            memoryText,
            lastUpdatedTick: tick,
          },
        });
      } catch (error) {
        console.error(`[memory] Failed to update persona memory for agent ${agentId}:`, error);
      }
    },

    async summarizeWithAI(
      agentId: number,
      agentName: string,
      agentProfile: unknown
    ): Promise<void> {
      try {
        const [trades, portfolios] = await Promise.all([
          prisma.trade.findMany({
            where: { agentId },
            orderBy: { tick: "asc" },
            include: { arena: { select: { id: true, name: true } } },
          }),
          prisma.portfolio.findMany({
            where: { agentId },
            orderBy: { updatedAt: "desc" },
            include: { arena: { select: { id: true, name: true } } },
          }),
        ]);

        if (trades.length === 0) {
          return;
        }

        const buyTrades = trades.filter((t) => t.action === "BUY");
        const sellTrades = trades.filter((t) => t.action === "SELL");

        const profitableSells = sellTrades.filter((sell) => {
          const buyBefore = buyTrades
            .filter((b) => b.tick < sell.tick)
            .sort((a, b) => b.tick - a.tick)[0];
          if (!buyBefore) return false;
          return sell.price > buyBefore.price;
        });
        const winRate =
          sellTrades.length > 0
            ? (profitableSells.length / sellTrades.length) * 100
            : 0;

        const avgTradeSize =
          trades.length > 0
            ? trades.reduce((sum, t) => sum + t.sizePct, 0) / trades.length
            : 0;

        const perArenaStats = portfolios.map((p) => {
          const equity = p.cashMon + p.tokenUnits * (p.avgEntryPrice ?? 0);
          const pnl =
            p.initialCapital != null && p.initialCapital > 0
              ? ((equity - p.initialCapital) / p.initialCapital) * 100
              : 0;
          return {
            arena: p.arena?.name ?? `arena ${p.arenaId}`,
            cashMon: Math.round(p.cashMon * 100) / 100,
            tokenUnits: Math.round(p.tokenUnits * 100) / 100,
            pnlPct: Math.round(pnl * 100) / 100,
          };
        });

        const agentData = {
          name: agentName,
          profile: agentProfile,
          stats: {
            totalTrades: trades.length,
            buys: buyTrades.length,
            sells: sellTrades.length,
            winRate: Math.round(winRate * 100) / 100,
            avgTradeSize: Math.round(avgTradeSize * 1000) / 1000,
          },
          perArena: perArenaStats,
          recentTrades: trades.slice(-25).map((t) => ({
            arenaId: t.arenaId,
            tick: t.tick,
            action: t.action,
            sizePct: Math.round(t.sizePct * 1000) / 1000,
            price: Math.round(t.price * 1000000) / 1000000,
            reason: t.reason,
          })),
        };

        const systemPrompt = `You are analyzing a trading agent's performance across multiple arenas to generate a concise persona memory (max 300 words).

This memory will be reused by the agent in all arenas to evolve its "persona": style, what worked, what to avoid, and how it reacts to results.

Focus on:
1. Cross-arena patterns (e.g. strong in volatile arenas, cautious elsewhere)
2. What strategies/patterns worked or failed
3. Actionable insights and recommendations for future decisions
4. A consistent persona that improves with experience`;

        const userPrompt = `Agent: ${agentName}
Profile: ${JSON.stringify(agentProfile)}
Stats: ${JSON.stringify(agentData.stats)}
Per-arena state: ${JSON.stringify(agentData.perArena)}
Recent Trades (last 25, any arena): ${JSON.stringify(agentData.recentTrades)}

Generate a concise persona memory that will help this agent make better decisions across all arenas. Focus on one evolving persona, not per-arena.`;

        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_completion_tokens: 1024,
          reasoning_effort: "low",
        });

        const rawMemoryText = completion.choices[0]?.message?.content?.trim() ?? "";
        if (!rawMemoryText) {
          console.warn(`[memory] AI persona summarization returned empty for agent ${agentId}`);
          return;
        }

        const truncatedMemory = sanitizeString(rawMemoryText, 1000);

        await prisma.agentPersonaMemory.upsert({
          where: { agentId },
          create: {
            agentId,
            memoryText: truncatedMemory,
            lastUpdatedTick: trades[trades.length - 1]?.tick ?? null,
            lastAiSummarizedAt: new Date(),
          },
          update: {
            memoryText: truncatedMemory,
            lastAiSummarizedAt: new Date(),
          },
        });

        console.log(`[memory] AI persona summarization completed for agent ${agentId}`);
      } catch (error) {
        console.error(`[memory] Failed to summarize persona for agent ${agentId}:`, error);
      }
    },
  };
}
