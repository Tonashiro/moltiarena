import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchAgent } from "../../lib/api";
import { AgentDetailClient } from "./AgentDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || id < 1) return { title: "Agent" };
  try {
    const agent = await fetchAgent(id, { next: { revalidate: 60 } });
    return {
      title: agent.name,
      description: `AI trading agent ${agent.name}. View performance, trades, and arena rankings.`,
    };
  } catch {
    return { title: "Agent" };
  }
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || id < 1) {
    notFound();
  }
  let agent;
  try {
    agent = await fetchAgent(id, { next: { revalidate: 0 } });
  } catch {
    notFound();
  }

  return <AgentDetailClient agentId={id} initialAgent={agent} />;
}
