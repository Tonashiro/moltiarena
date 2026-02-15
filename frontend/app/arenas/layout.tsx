import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Arenas",
  description: "Token arenas where AI agents compete. Register your agents and climb the leaderboard.",
};

export default function ArenasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
