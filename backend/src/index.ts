import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db.js";
import { startArenaEngine } from "./engine/arenaEngine.js";
import {
  InMemoryMarketStore,
  startMarketFeed,
  EventStorage,
  CleanupService,
} from "./market/index.js";
import { createMemoryService } from "./ai/memory.js";
import { MemoryScheduler } from "./ai/memoryScheduler.js";
import agentsRouter from "./routes/agents.js";
import arenasRouter from "./routes/arenas.js";
import { seedArenas } from "./services/arenaSeeder.js";
import {
  startEpochScheduler,
  runEpochTransition,
} from "./services/epochService.js";
import { ContractIndexer } from "./indexer/contractIndexer.js";

const app = express();
const PORT = process.env.PORT ?? 3001;
const tickSeconds = Number(process.env.TICK_SECONDS) || 60;
const cleanupIntervalSeconds = Number(process.env.CLEANUP_TIME) || 3600; // Default: 1 hour

const marketStore = new InMemoryMarketStore();
const eventStorage = new EventStorage(prisma);
const memoryService = createMemoryService(prisma);
const memoryScheduler = new MemoryScheduler({
  prisma,
  memoryService,
  summarizationIntervalHours: Number(process.env.MEMORY_SUMMARIZATION_INTERVAL_HOURS) || 6,
});
let cleanupService: CleanupService | undefined;
let epochScheduler: { stop: () => void } | undefined;

const wsUrl = process.env.WS_URL;
const rpcUrl = process.env.RPC_URL ?? "https://testnet-rpc.monad.xyz";
const arenaTokensEnv = process.env.ARENA_TOKENS;

if (!wsUrl || !arenaTokensEnv) {
  console.error(
    "[market] ERROR: WS_URL and ARENA_TOKENS are required. Please set them in your .env file."
  );
  console.error(
    "[market] Example: WS_URL=wss://testnet-rpc.monad.xyz ARENA_TOKENS=0xToken1,0xToken2"
  );
  process.exit(1);
}

let marketFeedHandle: { stop(): void } | undefined;
let contractIndexer: ContractIndexer | undefined;

try {
  const useDexStream = process.env.USE_DEX_STREAM === "true";
  marketFeedHandle = startMarketFeed({
    store: marketStore,
    tickSeconds,
    arenaTokens: arenaTokensEnv,
    rpcUrl,
    wsUrl,
    network:
      (process.env.NAD_NETWORK as "testnet" | "mainnet") ?? "testnet",
    useDexStream,
    eventStorage,
  });
  console.log(
    `[market] nad.fun feed started (${tickSeconds}s tick, ${arenaTokensEnv.split(",").length} tokens, ${useDexStream ? "DEX" : "curve"} stream, event storage enabled)`
  );
  
  // Start cleanup service for event storage
  cleanupService = new CleanupService({
    eventStorage,
    cleanupIntervalSeconds,
  });
  cleanupService.start();

  // Start memory scheduler for AI-powered summarization
  memoryScheduler.start();
} catch (err) {
  console.error("[market] Failed to start nad.fun feed:", err);
  process.exit(1);
}

// Seed arenas from ARENA_TOKENS on startup
seedArenas(prisma, arenaTokensEnv).then(() => {
  console.log("[arenaSeeder] Arena seeding completed");
}).catch((err) => {
  console.error("[arenaSeeder] Arena seeding failed:", err);
});

// Start contract event indexer (HTTP polling — no WebSocket required).
// Uses its own RPC URL since contracts may be on a different network
// (testnet) than the market data feed (mainnet).
const indexerRpcUrl = process.env.INDEXER_RPC_URL ?? "https://testnet-rpc.monad.xyz";
contractIndexer = new ContractIndexer({
  prisma,
  rpcUrl: indexerRpcUrl,
  pollingInterval: 4_000,
});
contractIndexer.start().catch((err) => {
  console.error("[indexer] Failed to start contract indexer:", err);
});

startArenaEngine({
  prisma,
  marketStore,
  tickSeconds,
  memoryService,
});
console.log(`[arenaEngine] Started (tick every ${tickSeconds}s, agent memory enabled)`);

// Bootstrap epochs for today (ensure agents can trade)
runEpochTransition({ prisma }).catch((err) =>
  console.warn("[epochService] Bootstrap epoch transition:", err)
);
epochScheduler = startEpochScheduler({ prisma });

// CORS: allow frontend origin(s). Set CORS_ORIGIN or leave default for local dev.
// Examples: "http://localhost:3000" or "http://localhost:3000,https://myapp.com"
const corsOriginEnv = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const corsOrigins = corsOriginEnv.split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length === 1 ? corsOrigins[0]! : corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/agents", agentsRouter);
app.use("/arenas", arenasRouter);

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Try PORT=3001 or stop the other process.`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

function shutdown(): void {
  memoryScheduler.stop();
  if (epochScheduler) {
    epochScheduler.stop();
    epochScheduler = undefined;
  }
  if (contractIndexer) {
    contractIndexer.stop();
    contractIndexer = undefined;
  }
  if (cleanupService) {
    cleanupService.stop();
    cleanupService = undefined;
    console.log("[cleanup] Service stopped");
  }
  if (marketFeedHandle) {
    marketFeedHandle.stop();
    marketFeedHandle = undefined;
    console.log("[market] Feed stopped");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
