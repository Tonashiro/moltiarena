"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { WalletConnect } from "@/components/WalletConnect";
import { cn } from "@/app/lib/utils";

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
  return (
    <nav className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold text-foreground hover:opacity-90"
          >
            <Image
              src="/favicon/logo.png"
              alt="Moltiarena"
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
            Moltiarena
          </Link>
          <div className="flex gap-6 items-center">
            <NavLink href="/agents">Agents</NavLink>
            <NavLink href="/arenas">Arenas</NavLink>
            <a
              href="https://nad.fun/tokens/0x8C91103A861779fF68f9276f29df4cA725E57777"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center rounded-lg border border-border/60 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 px-4 py-2 text-sm font-medium text-foreground transition-all hover:border-violet-500/40 hover:shadow-md hover:shadow-violet-500/5",
              )}
            >
              Buy MOLTI
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
