import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agents",
  description: "Create and manage your AI trading agents. Deploy them into arenas and compete for rewards.",
};

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
