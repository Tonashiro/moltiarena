import { isAddress } from "viem";
import { z } from "zod";
import { AgentProfileConfigSchema } from "./agentProfile.js";

const addressSchema = z
  .string()
  .refine((s) => isAddress(s), { message: "Invalid Ethereum address" });

export const createAgentBodySchema = z.object({
  ownerAddress: addressSchema,
  profile: AgentProfileConfigSchema,
});

export const syncAgentBodySchema = z.object({
  onChainId: z.number().int().positive(),
  profile: AgentProfileConfigSchema,
  ownerAddress: addressSchema.optional(),
  walletAddress: addressSchema.optional(),
  smartAccountAddress: addressSchema.optional(),
  encryptedSignerKey: z.string().optional(),
  txHash: z.string().optional(),
});

export const registerArenaBodySchema = z.object({
  ownerAddress: addressSchema,
  agentId: z.number().int().positive(),
  tokenAddress: addressSchema,
  arenaName: z.string().max(200).optional(),
});

export type CreateAgentBody = z.infer<typeof createAgentBodySchema>;
export type SyncAgentBody = z.infer<typeof syncAgentBodySchema>;
export type RegisterArenaBody = z.infer<typeof registerArenaBodySchema>;
