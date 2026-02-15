/**
 * MoltiArena Contract Event Indexer
 *
 * Watches for live contract events using HTTP polling (no WebSocket required).
 * This is a safety net — the primary data path is the frontend calling
 * POST /agents/sync after each on-chain transaction.
 *
 * Uses viem's watchContractEvent with HTTP transport, which internally polls
 * for new events every `pollingInterval` milliseconds.
 */
import type { PrismaClient } from "@prisma/client";
import {
  createPublicClient,
  http,
  type PublicClient,
  type WatchContractEventReturnType,
} from "viem";
import { monadTestnet } from "viem/chains";
import {
  MOLTI_ARENA_ABI,
  MOLTI_ARENA_ADDRESS,
} from "../contracts/abis.js";
import {
  handleAgentCreated,
  handleArenaCreated,
  handleAgentRegistered,
  handleAgentUnregistered,
  handleAgentEpochRenewed,
  handleTradePlaced,
  type AgentCreatedArgs,
  type ArenaCreatedArgs,
  type AgentRegisteredArgs,
  type AgentUnregisteredArgs,
  type AgentEpochRenewedArgs,
  type TradePlacedArgs,
} from "./eventHandlers.js";

const TAG = "[indexer]";

export interface ContractIndexerOptions {
  prisma: PrismaClient;
  /** HTTP RPC URL for polling. Should point to the chain where contracts are deployed. */
  rpcUrl?: string;
  /** Polling interval in ms. Default: 4000 (4 seconds). */
  pollingInterval?: number;
}

export class ContractIndexer {
  private readonly prisma: PrismaClient;
  private readonly client: PublicClient;
  private unwatchers: WatchContractEventReturnType[] = [];
  private running = false;

  constructor(opts: ContractIndexerOptions) {
    this.prisma = opts.prisma;

    const rpcUrl = opts.rpcUrl ?? "https://testnet-rpc.monad.xyz";
    const pollingInterval = opts.pollingInterval ?? 4_000;

    this.client = createPublicClient({
      chain: monadTestnet,
      transport: http(rpcUrl),
      pollingInterval,
    }) as PublicClient;

    console.log(`${TAG} HTTP polling: ${rpcUrl} (every ${pollingInterval}ms)`);
  }

  /**
   * Start watching for live contract events.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`${TAG} Starting event watcher for ${MOLTI_ARENA_ADDRESS}`);
    this.watchLiveEvents();
    console.log(`${TAG} Watching live contract events via polling`);
  }

  /**
   * Stop all watchers.
   */
  stop(): void {
    this.running = false;
    for (const unwatch of this.unwatchers) {
      unwatch();
    }
    this.unwatchers = [];
    console.log(`${TAG} Stopped`);
  }

  // ─── Live event watchers ─────────────────────────────────────────

  private watchLiveEvents(): void {
    const contractAddress = MOLTI_ARENA_ADDRESS as `0x${string}`;
    const contractConfig = {
      address: contractAddress,
      abi: MOLTI_ARENA_ABI,
    } as const;

    const makeHandler = (eventName: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (logs: any[]) => {
        for (const log of logs) {
          this.handleLog(eventName, log).catch((err) =>
            console.error(`${TAG} Error handling ${eventName}:`, err),
          );
        }
      };
    };

    this.unwatchers.push(
      this.client.watchContractEvent({
        ...contractConfig,
        eventName: "AgentCreated",
        onLogs: makeHandler("AgentCreated"),
      }),
      this.client.watchContractEvent({
        ...contractConfig,
        eventName: "ArenaCreated",
        onLogs: makeHandler("ArenaCreated"),
      }),
      this.client.watchContractEvent({
        ...contractConfig,
        eventName: "AgentRegistered",
        onLogs: makeHandler("AgentRegistered"),
      }),
      this.client.watchContractEvent({
        ...contractConfig,
        eventName: "AgentUnregistered",
        onLogs: makeHandler("AgentUnregistered"),
      }),
      this.client.watchContractEvent({
        ...contractConfig,
        eventName: "TradePlaced",
        onLogs: makeHandler("TradePlaced"),
      }),
      this.client.watchContractEvent({
        ...contractConfig,
        eventName: "AgentEpochRenewed",
        onLogs: makeHandler("AgentEpochRenewed"),
      }),
    );
  }

  // ─── Log processing ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleLog(eventName: string, log: any): Promise<void> {
    const txHash = log.transactionHash ?? "";
    const args = log.args;
    if (!args) return;

    switch (eventName) {
      case "AgentCreated":
        await handleAgentCreated(
          this.prisma,
          args as unknown as AgentCreatedArgs,
          txHash,
        );
        break;
      case "ArenaCreated":
        await handleArenaCreated(
          this.prisma,
          args as unknown as ArenaCreatedArgs,
        );
        break;
      case "AgentRegistered":
        await handleAgentRegistered(
          this.prisma,
          args as unknown as AgentRegisteredArgs,
          txHash,
        );
        break;
      case "AgentUnregistered":
        await handleAgentUnregistered(
          this.prisma,
          args as unknown as AgentUnregisteredArgs,
        );
        break;
      case "TradePlaced":
        await handleTradePlaced(
          this.prisma,
          args as unknown as TradePlacedArgs,
        );
        break;
      case "AgentEpochRenewed":
        await handleAgentEpochRenewed(
          this.prisma,
          args as unknown as AgentEpochRenewedArgs,
        );
        break;
    }
  }
}
