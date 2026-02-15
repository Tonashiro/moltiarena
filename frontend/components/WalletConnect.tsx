"use client";

import { useAppKit } from "@reown/appkit/react";
import { useAccount, useDisconnect, useSwitchChain, useChainId } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export interface WalletConnectProps {
  className?: string;
}

/**
 * Connect / account / switch-network controls using AppKit modal.
 * Uses the same wagmi config (single client, Monad Testnet).
 */
export function WalletConnect({ className }: WalletConnectProps) {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const isWrongNetwork =
    isConnected &&
    address &&
    chainId !== Number(process.env.NEXT_PUBLIC_CHAIN_ID);

  if (isWrongNetwork) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className={cn(className)}
        onClick={() =>
          switchChain({ chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID) })
        }
      >
        Switch to Monad Testnet
      </Button>
    );
  }

  if (isConnected && address) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Monad Testnet
        </span>
        <span className="text-sm font-mono text-muted-foreground">
          {formatAddress(address)}
        </span>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button className={cn(className)} onClick={() => open({ view: "Connect" })}>
      Connect
    </Button>
  );
}
