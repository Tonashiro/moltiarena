"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { monadTestnet } from "@/app/wagmi/config";

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "text-sm font-medium transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function Nav() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const isWrongChain = isConnected && chainId !== monadTestnet.id;

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const handleConnect = useCallback(() => {
    if (connectors[0]) connect({ connector: connectors[0] });
  }, [connect, connectors]);

  const handleSwitchChain = useCallback(() => {
    switchChain({ chainId: monadTestnet.id });
  }, [switchChain]);

  return (
    <nav className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="text-lg font-semibold text-foreground hover:opacity-90"
          >
            Moltiarena
          </Link>
          <div className="flex gap-6">
            <NavLink href="/agents">Agents</NavLink>
            <NavLink href="/arenas">Arenas</NavLink>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isConnected && address ? (
            <>
              {isWrongChain ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleSwitchChain}
                >
                  Switch to Monad Testnet
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Monad Testnet
                </span>
              )}
              <span className="text-sm text-muted-foreground font-mono">
                {address.slice(0, 6)}...{address.slice(-4)}
              </span>
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={isPending || connectors.length === 0}
            >
              {isPending ? "Connecting..." : "Connect wallet"}
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
