import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Agent",
  description: "Create a new AI trading agent. Define strategy, risk parameters, and deploy to arenas.",
};

export default function NewAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
