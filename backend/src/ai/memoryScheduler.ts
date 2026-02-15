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
 * Scheduler that periodically runs AI-powered persona summarization for all agents.
 * One summarization per agent (across all arenas). Runs every summarizationIntervalHours.
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

    this.runSummarization().catch((err) => {
      console.error("[memoryScheduler] Initial summarization error:", err);
    });

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
      console.log("[memoryScheduler] Starting AI persona summarization for all agents...");

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
        },
      });

      const summarizationIntervalMs =
        (this.deps.summarizationIntervalHours ?? 6) * 60 * 60 * 1000;
      const cutoffTime = new Date(Date.now() - summarizationIntervalMs);

      const agentIds = [...new Set(registrations.map((r) => r.agentId))];
      let processed = 0;
      let skipped = 0;

      for (const agentId of agentIds) {
        const reg = registrations.find((r) => r.agentId === agentId);
        if (!reg) continue;

        try {
          const personaMemory = await this.deps.prisma.agentPersonaMemory.findUnique({
            where: { agentId },
          });

          if (
            personaMemory?.lastAiSummarizedAt &&
            personaMemory.lastAiSummarizedAt > cutoffTime
          ) {
            skipped++;
            continue;
          }

          const tradeCount = await this.deps.prisma.trade.count({
            where: { agentId },
          });

          if (tradeCount < 5) {
            skipped++;
            continue;
          }

          const profileParsed = AgentProfileConfigSchema.safeParse(
            reg.agent.profileJson
          );
          if (!profileParsed.success) {
            console.warn(
              `[memoryScheduler] Agent ${agentId} has invalid profile, skipping`
            );
            skipped++;
            continue;
          }

          const summarizationPromise = this.deps.memoryService.summarizeWithAI(
            agentId,
            reg.agent.name,
            profileParsed.data
          );

          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error("Summarization timeout")), 60000);
          });

          try {
            await Promise.race([summarizationPromise, timeoutPromise]);
            processed++;
          } catch (error) {
            console.error(
              `[memoryScheduler] Summarization timeout/failed for agent ${agentId}:`,
              error
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(
            `[memoryScheduler] Failed to summarize agent ${agentId}:`,
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
