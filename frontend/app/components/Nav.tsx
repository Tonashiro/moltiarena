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
          <div className="flex gap-6">
            <NavLink href="/agents">Agents</NavLink>
            <NavLink href="/arenas">Arenas</NavLink>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
