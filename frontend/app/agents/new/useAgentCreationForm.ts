"use client";

import { useCallback, useMemo, useState } from "react";
import { formatEther } from "viem";
import type { AgentProfileConfig } from "@/app/lib/agentProfileSchema";
import { agentProfileConfigSchema } from "@/app/lib/agentProfileSchema";
import { syncAgent, createAgentWallet } from "@/app/lib/api";
import { hashProfileConfig } from "@/app/lib/contracts/profileHash";
import { toastError, toastInfo, toastSuccess } from "@/app/lib/toast";
import { DEFAULT_AGENT_PROFILE } from "../constants";
import type { CreatedAgent } from "../types";

interface UseAgentCreationFormArgs {
  address: string | undefined;
  creationFee: bigint | undefined;
  moltiBalance: bigint | undefined;
  createAgent: (
    profileHash: `0x${string}`,
    wallet: `0x${string}`,
    fee: bigint
  ) => Promise<{ agentId?: number; txHash: string } | null>;
  afterAgentCreated: (owner: string) => void;
}

export function useAgentCreationForm({
  address,
  creationFee,
  moltiBalance,
  createAgent,
  afterAgentCreated,
}: UseAgentCreationFormArgs) {
  const [profile, setProfile] = useState<AgentProfileConfig>(DEFAULT_AGENT_PROFILE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedAgent | null>(null);

  const creationFeeFormatted = creationFee
    ? formatEther(creationFee)
    : "...";
  const balanceFormatted = moltiBalance ? formatEther(moltiBalance) : "0";
  const hasEnoughBalance =
    creationFee != null &&
    moltiBalance != null &&
    moltiBalance >= creationFee;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErrors({});

      const parsed = agentProfileConfigSchema.safeParse(profile);
      if (!parsed.success) {
        const map: Record<string, string> = {};
        const flat = parsed.error.flatten().fieldErrors;
        Object.entries(flat).forEach(([k, v]) => {
          map[k] = Array.isArray(v) ? (v[0] ?? "") : "";
        });
        setErrors(map);
        return;
      }

      if (!address) {
        setErrors({ name: "Connect your wallet first." });
        return;
      }

      if (!creationFee) {
        setErrors({ name: "Unable to read creation fee from contract." });
        return;
      }

      if (!hasEnoughBalance) {
        setErrors({
          name: `Insufficient MOLTI balance. You need ${creationFeeFormatted} MOLTI, but have ${balanceFormatted} MOLTI.`,
        });
        return;
      }

      const profileHash = hashProfileConfig(parsed.data);

      let wallet: Awaited<ReturnType<typeof createAgentWallet>>;
      try {
        wallet = await createAgentWallet();
        toastInfo("Smart wallet: " + wallet.smartAccountAddress.slice(0, 8) + "...");
      } catch {
        toastError("Failed to create agent wallet. Please try again.");
        return;
      }

      const result = await createAgent(
        profileHash,
        wallet.smartAccountAddress as `0x${string}`,
        creationFee
      );

      if (!result?.agentId) {
        return;
      }

      try {
        const syncResult = await syncAgent({
          onChainId: result.agentId,
          profile: parsed.data,
          ownerAddress: address,
          walletAddress: wallet.smartAccountAddress,
          smartAccountAddress: wallet.smartAccountAddress,
          encryptedSignerKey: wallet.encryptedKey,
          txHash: result.txHash,
        });

        setCreated({
          agentId: syncResult.agentId,
          onChainId: syncResult.onChainId,
          profileHash: syncResult.profileHash,
          txHash: result.txHash,
        });

        afterAgentCreated(address);
        toastSuccess("Agent profile synced to backend!");
      } catch {
        setCreated({
          agentId: result.agentId,
          onChainId: result.agentId,
          profileHash,
          txHash: result.txHash,
        });
        toastError(
          "Agent created on-chain but profile sync failed. It will sync automatically."
        );
      }
    },
    [
      profile,
      address,
      createAgent,
      creationFee,
      hasEnoughBalance,
      creationFeeFormatted,
      balanceFormatted,
      afterAgentCreated,
    ]
  );

  return useMemo(
    () => ({
      profile,
      setProfile,
      errors,
      created,
      setCreated,
      handleSubmit,
      creationFeeFormatted,
      balanceFormatted,
      hasEnoughBalance,
    }),
    [
      profile,
      errors,
      created,
      handleSubmit,
      creationFeeFormatted,
      balanceFormatted,
      hasEnoughBalance,
    ]
  );
}
