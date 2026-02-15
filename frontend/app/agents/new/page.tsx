"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import type { ArenaListItem } from "@/app/lib/api";
import { useArenas, useInvalidateQueries } from "@/app/lib/queries";
import {
  useCreateAgentOnChain,
  useAgentCreationFee,
  useMoltiBalance,
  useRegisterToArenaOnChain,
} from "@/app/lib/contracts/hooks";
import { toastError, toastSuccess } from "@/app/lib/toast";
import { monadTestnet } from "../../wagmi/config";
import { Button } from "@/components/ui/button";
import {
  AgentFormHeader,
  AgentFormActions,
  AgentCreatedView,
  IdentityStrategySection,
  CustomRulesSection,
  ConstraintsSection,
  FiltersSection,
} from "./components";
import { useAgentCreationForm } from "./useAgentCreationForm";

export default function NewAgentPage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const isWrongChain = !!address && chainId !== monadTestnet.id;

  const { data: creationFee } = useAgentCreationFee();
  const { data: moltiBalance } = useMoltiBalance(address);
  const {
    createAgent,
    isLoading: isCreating,
    status: createStatus,
  } = useCreateAgentOnChain();
  const { register: registerOnChain, isLoading: isRegistering } =
    useRegisterToArenaOnChain();
  const { afterAgentCreated, afterRegistration } = useInvalidateQueries();

  const { data: arenasData, isLoading: arenasLoading } = useArenas();
  const arenas = useMemo<ArenaListItem[]>(
    () => arenasData?.arenas ?? [],
    [arenasData?.arenas]
  );

  const form = useAgentCreationForm({
    address: address ?? undefined,
    creationFee: creationFee as bigint | undefined,
    moltiBalance: moltiBalance as bigint | undefined,
    createAgent,
    afterAgentCreated,
  });

  const [registeringArenaId, setRegisteringArenaId] = useState<number | null>(null);

  const handleRegister = async (arena: ArenaListItem) => {
    if (!form.created || !address || !arena.onChainId) {
      toastError("Arena has no on-chain ID yet. Please try again later.");
      return;
    }
    setRegisteringArenaId(arena.id);
    const result = await registerOnChain(
      BigInt(form.created.onChainId),
      BigInt(arena.onChainId),
      BigInt(0)
    );
    setRegisteringArenaId(null);
    if (result) {
      toastSuccess("Registered to " + (arena.name ?? "Arena " + arena.id) + "!");
      afterRegistration(arena.id, form.created.agentId, address);
    }
  };

  if (!address) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">New agent</h1>
        <p className="text-muted-foreground">
          Connect your wallet to create an agent.
        </p>
        <Button variant="link" asChild>
          <Link href="/agents">&larr; Back to agents</Link>
        </Button>
      </div>
    );
  }

  if (isWrongChain) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">New agent</h1>
        <p className="text-muted-foreground">
          You are connected to the wrong network. Please switch to Monad Testnet
          to create an agent.
        </p>
        <Button onClick={() => switchChain({ chainId: monadTestnet.id })}>
          Switch to Monad Testnet
        </Button>
        <Button variant="link" asChild>
          <Link href="/agents">&larr; Back to agents</Link>
        </Button>
      </div>
    );
  }

  if (form.created) {
    return (
      <AgentCreatedView
        created={form.created}
        arenas={arenas}
        arenasLoading={arenasLoading}
        registeringArenaId={registeringArenaId}
        isRegistering={isRegistering}
        onRegister={handleRegister}
      />
    );
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col w-full max-w-3xl mx-auto px-4">
      <AgentFormHeader
        balanceFormatted={form.balanceFormatted}
        creationFeeFormatted={form.creationFeeFormatted}
        hasEnoughBalance={form.hasEnoughBalance}
        showInsufficientBalance={
          !form.hasEnoughBalance && moltiBalance !== undefined
        }
      />

      <form onSubmit={form.handleSubmit} className="flex-1 flex flex-col gap-6">
        <IdentityStrategySection
          profile={form.profile}
          errors={form.errors}
          onProfileChange={form.setProfile}
        />
        <CustomRulesSection
          customRules={form.profile.customRules ?? ""}
          onCustomRulesChange={(value) =>
            form.setProfile((p) => ({ ...p, customRules: value }))
          }
        />
        <ConstraintsSection
          constraints={form.profile.constraints}
          onConstraintsChange={(updater) =>
            form.setProfile((p) => ({ ...p, constraints: updater(p.constraints) }))
          }
        />
        <FiltersSection
          filters={form.profile.filters}
          onFiltersChange={(updater) =>
            form.setProfile((p) => ({ ...p, filters: updater(p.filters) }))
          }
        />
        <AgentFormActions
          isCreating={isCreating}
          createStatus={createStatus}
          creationFeeFormatted={form.creationFeeFormatted}
          hasEnoughBalance={form.hasEnoughBalance}
        />
      </form>
    </div>
  );
}
