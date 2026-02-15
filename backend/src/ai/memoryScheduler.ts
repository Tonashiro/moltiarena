import type { PrismaClient } from "@prisma/client";
import type { AgentMemoryService } from "./memory.js";
import { AgentProfileConfigSchema } from "../schemas/agentProfile.js";

export interface MemorySchedulerDeps {
  prisma: PrismaClient;
  memoryService: AgentMemoryService;
  /** Interval in hours for AI summarization (default: 6) */
  summarizationIntervalHours?: number;
}

/**
 * Scheduler that periodically runs AI-powered memory summarization for all agents.
 * Runs every summarizationIntervalHours and only processes agents that haven't been
 * summarized recently or have accumulated enough new trades.
 */
export class MemoryScheduler {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private deps: MemorySchedulerDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const intervalMs =
      (this.deps.summarizationIntervalHours ?? 6) * 60 * 60 * 1000;

    // Run immediately on start
    this.runSummarization().catch((err) => {
      console.error("[memoryScheduler] Initial summarization error:", err);
    });

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runSummarization().catch((err) => {
        console.error("[memoryScheduler] Summarization error:", err);
      });
    }, intervalMs);

    console.log(
      `[memoryScheduler] Started (interval: ${this.deps.summarizationIntervalHours ?? 6}h)`
    );
  }

  stop(): void {
    this.running = false;
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log("[memoryScheduler] Stopped");
  }

  private async runSummarization(): Promise<void> {
    try {
      console.log("[memoryScheduler] Starting AI summarization for all agents...");

      // Get all active agent-arena pairs
      const registrations = await this.deps.prisma.arenaRegistration.findMany({
        where: { isActive: true },
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              profileJson: true,
            },
          },
          arena: {
            select: {
              id: true,
            },
          },
        },
      });

      const summarizationIntervalMs =
        (this.deps.summarizationIntervalHours ?? 6) * 60 * 60 * 1000;
      const cutoffTime = new Date(Date.now() - summarizationIntervalMs);

      let processed = 0;
      let skipped = 0;

      for (const reg of registrations) {
        try {
          // Check if summarization is needed
          const memory = await this.deps.prisma.agentMemory.findUnique({
            where: {
              agentId_arenaId: {
                agentId: reg.agentId,
                arenaId: reg.arenaId,
              },
            },
          });

          // Skip if summarized recently
          if (
            memory?.lastAiSummarizedAt &&
            memory.lastAiSummarizedAt > cutoffTime
          ) {
            skipped++;
            continue;
          }

          // Check if agent has enough trades to summarize (at least 5)
          const tradeCount = await this.deps.prisma.trade.count({
            where: {
              agentId: reg.agentId,
              arenaId: reg.arenaId,
            },
          });

          if (tradeCount < 5) {
            skipped++;
            continue;
          }

          // Parse agent profile
          const profileParsed = AgentProfileConfigSchema.safeParse(
            reg.agent.profileJson
          );
          if (!profileParsed.success) {
            console.warn(
              `[memoryScheduler] Agent ${reg.agentId} has invalid profile, skipping`
            );
            skipped++;
            continue;
          }

          // Run AI summarization with timeout protection
          const summarizationPromise = this.deps.memoryService.summarizeWithAI(
            reg.agentId,
            reg.arenaId,
            reg.agent.name,
            profileParsed.data
          );
          
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error("Summarization timeout")), 60000); // 60s timeout
          });
          
          try {
            await Promise.race([summarizationPromise, timeoutPromise]);
            processed++;
          } catch (error) {
            console.error(
              `[memoryScheduler] Summarization timeout/failed for agent ${reg.agentId} arena ${reg.arenaId}:`,
              error
            );
            // Continue with next agent
          }

          // Small delay to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(
            `[memoryScheduler] Failed to summarize agent ${reg.agentId} arena ${reg.arenaId}:`,
            error
          );
        }
      }

      console.log(
        `[memoryScheduler] Completed: ${processed} agents summarized, ${skipped} skipped`
      );
    } catch (error) {
      console.error("[memoryScheduler] Summarization run failed:", error);
    }
  }
}
