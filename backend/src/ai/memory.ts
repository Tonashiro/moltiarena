import type { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { sanitizeString } from "../utils/validation.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2,
});

const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const OPENAI_TIMEOUT_MS = 30000; // 30 seconds

export interface AgentMemoryService {
  /**
   * Get memory summary for an agent in a specific arena.
   * Returns empty string if no memory exists yet.
   */
  getMemory(agentId: number, arenaId: number): Promise<string>;

  /**
   * Update memory for an agent based on recent trades and performance.
   * Generates a concise summary of the agent's trading history and patterns.
   */
  updateMemory(
    agentId: number,
    arenaId: number,
    tick: number,
    recentTrades: Array<{
      tick: number;
      action: string;
      sizePct: number;
      price: number;
      reason: string;
      pnlAfter?: number;
    }>,
    currentPnL: number,
    totalTrades: number
  ): Promise<void>;

  /**
   * AI-powered memory summarization that analyzes all agent data
   * and generates a comprehensive memory summary.
   * Should be called periodically (e.g., every 6 hours).
   */
  summarizeWithAI(
    agentId: number,
    arenaId: number,
    agentName: string,
    agentProfile: unknown
  ): Promise<void>;
}

/**
 * Creates a memory service that stores and retrieves agent memory summaries.
 * Memory is stored per agent per arena to maintain independent contexts.
 */
export function createMemoryService(
  prisma: PrismaClient
): AgentMemoryService {
  return {
    async getMemory(agentId: number, arenaId: number): Promise<string> {
      try {
        const memory = await prisma.agentMemory.findUnique({
          where: {
            agentId_arenaId: { agentId, arenaId },
          },
        });
        return memory?.memoryText ?? "";
      } catch (error) {
        console.error(
          `[memory] Failed to get memory for agent ${agentId} arena ${arenaId}:`,
          error
        );
        return "";
      }
    },

    async updateMemory(
      agentId: number,
      arenaId: number,
      tick: number,
      recentTrades: Array<{
        tick: number;
        action: string;
        sizePct: number;
        price: number;
        reason: string;
        pnlAfter?: number;
      }>,
      currentPnL: number,
      totalTrades: number
    ): Promise<void> {
      try {
        // Generate memory summary from recent trades
        // Keep it concise to save tokens (max ~200 words)
        const memoryParts: string[] = [];

        if (recentTrades.length > 0) {
          // Analyze recent trading patterns
          const buyCount = recentTrades.filter((t) => t.action === "BUY").length;
          const sellCount = recentTrades.filter((t) => t.action === "SELL").length;
          const holdCount = recentTrades.filter((t) => t.action === "HOLD").length;

          memoryParts.push(
            `Recent activity: ${buyCount} buys, ${sellCount} sells, ${holdCount} holds.`
          );

          // Identify patterns
          if (recentTrades.length >= 3) {
            const last3 = recentTrades.slice(-3);
            const allSame = last3.every((t) => t.action === last3[0]!.action);
            if (allSame) {
              memoryParts.push(
                `Pattern: ${last3[0]!.action} streak (${last3.length} consecutive).`
              );
            }
          }

          // Performance summary
          if (currentPnL > 0) {
            memoryParts.push(`Current PnL: +${currentPnL.toFixed(2)}%.`);
          } else if (currentPnL < 0) {
            memoryParts.push(`Current PnL: ${currentPnL.toFixed(2)}%.`);
          }

          // Common reasons (to identify strategy patterns)
          const reasons = recentTrades
            .map((t) => t.reason.toLowerCase())
            .join(" ");
          if (reasons.includes("momentum") || reasons.includes("trend")) {
            memoryParts.push("Strategy: momentum-focused.");
          }
          if (reasons.includes("volatility") || reasons.includes("vol")) {
            memoryParts.push("Strategy: volatility-aware.");
          }
          if (reasons.includes("whale") || reasons.includes("large")) {
            memoryParts.push("Strategy: whale-activity responsive.");
          }

          // Average trade size
          const avgSize =
            recentTrades.reduce((sum, t) => sum + t.sizePct, 0) /
            recentTrades.length;
          if (avgSize > 0.5) {
            memoryParts.push("Trading style: large positions.");
          } else if (avgSize < 0.2) {
            memoryParts.push("Trading style: conservative positions.");
          }
        } else {
          memoryParts.push("No trades yet. Learning phase.");
        }

        // Add total trade count for context
        if (totalTrades > 0) {
          memoryParts.push(`Total trades: ${totalTrades}.`);
        }

        // Sanitize and limit memory text
        const memoryText = sanitizeString(
          memoryParts.join(" "),
          500 // Max 500 chars
        );

        // Upsert memory (rule-based update, doesn't change lastAiSummarizedAt)
        await prisma.agentMemory.upsert({
          where: {
            agentId_arenaId: { agentId, arenaId },
          },
          create: {
            agentId,
            arenaId,
            memoryText,
            tick,
          },
          update: {
            memoryText,
            tick,
            // Don't update lastAiSummarizedAt - only AI summarization does that
          },
        });
      } catch (error) {
        console.error(
          `[memory] Failed to update memory for agent ${agentId} arena ${arenaId}:`,
          error
        );
      }
    },

    async summarizeWithAI(
      agentId: number,
      arenaId: number,
      agentName: string,
      agentProfile: unknown
    ): Promise<void> {
      try {
        // Gather comprehensive agent data
        const [trades, portfolio, leaderboardSnapshots] = await Promise.all([
          // All trades for this agent in this arena
          prisma.trade.findMany({
            where: { agentId, arenaId },
            orderBy: { tick: "asc" },
          }),
          // Current portfolio state (latest by updatedAt)
          prisma.portfolio.findFirst({
            where: { agentId, arenaId },
            orderBy: { updatedAt: "desc" },
          }),
          // Recent leaderboard snapshots to track performance over time
          prisma.leaderboardSnapshot.findMany({
            where: { arenaId },
            orderBy: { tick: "desc" },
            take: 20, // Last 20 snapshots
          }),
        ]);

        if (trades.length === 0) {
          // No trades yet, skip AI summarization
          return;
        }

        // Calculate performance metrics
        const buyTrades = trades.filter((t) => t.action === "BUY");
        const sellTrades = trades.filter((t) => t.action === "SELL");
        const holdTrades = trades.filter((t) => t.action === "HOLD");

        // Get current PnL from latest leaderboard
        let currentPnL = 0;
        if (leaderboardSnapshots.length > 0) {
          const latest = leaderboardSnapshots[0]!;
          const rankings = latest.rankingsJson as Array<{
            agentId: number;
            pnlPct: number;
          }>;
          const entry = rankings.find((r) => r.agentId === agentId);
          if (entry) {
            currentPnL = entry.pnlPct;
          }
        }

        // Calculate win rate (simplified: profitable sells)
        const profitableSells = sellTrades.filter((sell, idx) => {
          // Find the buy that preceded this sell
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

        // Average trade size
        const avgTradeSize =
          trades.length > 0
            ? trades.reduce((sum, t) => sum + t.sizePct, 0) / trades.length
            : 0;

        // Build comprehensive data for AI analysis
        const agentData = {
          name: agentName,
          profile: agentProfile,
          stats: {
            totalTrades: trades.length,
            buys: buyTrades.length,
            sells: sellTrades.length,
            holds: holdTrades.length,
            winRate: Math.round(winRate * 100) / 100,
            avgTradeSize: Math.round(avgTradeSize * 1000) / 1000,
            currentPnL: Math.round(currentPnL * 100) / 100,
          },
          recentTrades: trades.slice(-20).map((t) => ({
            tick: t.tick,
            action: t.action,
            sizePct: Math.round(t.sizePct * 1000) / 1000,
            price: Math.round(t.price * 1000000) / 1000000,
            reason: t.reason,
          })),
          portfolio: portfolio
            ? {
                cashMon: Math.round(portfolio.cashMon * 100) / 100,
                tokenUnits: Math.round(portfolio.tokenUnits * 100) / 100,
                avgEntryPrice: portfolio.avgEntryPrice
                  ? Math.round(portfolio.avgEntryPrice * 1000000) / 1000000
                  : null,
              }
            : null,
        };

        // AI prompt for memory summarization
        const systemPrompt = `You are analyzing a trading agent's performance to generate a concise memory summary (max 300 words) that will help the agent learn and improve.

Focus on:
1. What strategies/patterns worked well
2. What mistakes or patterns to avoid
3. Key insights about the agent's trading style
4. Recommendations for future decisions

Be specific and actionable. Use the agent's profile to understand their goals.`;

        const userPrompt = `Agent: ${agentName}
Profile: ${JSON.stringify(agentProfile)}
Stats: ${JSON.stringify(agentData.stats)}
Recent Trades (last 20): ${JSON.stringify(agentData.recentTrades)}
Current Portfolio: ${JSON.stringify(agentData.portfolio)}

Generate a concise memory summary that will help this agent make better decisions. Focus on actionable insights and patterns.`;

        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_completion_tokens: 1024, // Enough for reasoning + 400-word summary
          reasoning_effort: "low", // Keep reasoning minimal for this summarization task
        });

        const rawMemoryText = completion.choices[0]?.message?.content?.trim() ?? "";

        if (!rawMemoryText) {
          console.warn(
            `[memory] AI summarization returned empty for agent ${agentId} arena ${arenaId}`
          );
          return;
        }

        // Sanitize and truncate to max 1000 chars to save tokens in future prompts
        const truncatedMemory = sanitizeString(rawMemoryText, 1000);

        // Update memory with AI-generated summary
        await prisma.agentMemory.upsert({
          where: {
            agentId_arenaId: { agentId, arenaId },
          },
          create: {
            agentId,
            arenaId,
            memoryText: truncatedMemory,
            tick: trades[trades.length - 1]?.tick ?? 0,
            lastAiSummarizedAt: new Date(),
          },
          update: {
            memoryText: truncatedMemory,
            lastAiSummarizedAt: new Date(),
          },
        });

        console.log(
          `[memory] AI summarization completed for agent ${agentId} arena ${arenaId}`
        );
      } catch (error) {
        console.error(
          `[memory] Failed to summarize with AI for agent ${agentId} arena ${arenaId}:`,
          error
        );
      }
    },
  };
}
