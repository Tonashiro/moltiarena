import type { EventStorage } from "./eventStorage.js";

export interface CleanupServiceDeps {
  eventStorage: EventStorage;
  cleanupIntervalSeconds: number;
}

/**
 * Service that periodically cleans up old market events from the database.
 * Runs every cleanupIntervalSeconds and deletes events older than that interval.
 */
export class CleanupService {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private deps: CleanupServiceDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const { cleanupIntervalSeconds, eventStorage } = this.deps;

    // Run cleanup immediately on start
    this.runCleanup();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, cleanupIntervalSeconds * 1000);

    console.log(
      `[cleanupService] Started cleanup service (interval: ${cleanupIntervalSeconds}s)`
    );
  }

  stop(): void {
    this.running = false;
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log("[cleanupService] Stopped cleanup service");
  }

  private async runCleanup(): Promise<void> {
    try {
      const cutoffTime = new Date(
        Date.now() - this.deps.cleanupIntervalSeconds * 1000
      );
      const deletedCount = await this.deps.eventStorage.cleanupOlderThan(
        cutoffTime
      );
      if (deletedCount > 0) {
        console.log(
          `[cleanupService] Cleaned up ${deletedCount} event(s) older than ${cutoffTime.toISOString()}`
        );
      }
    } catch (error) {
      console.error("[cleanupService] Cleanup error:", error);
    }
  }
}
