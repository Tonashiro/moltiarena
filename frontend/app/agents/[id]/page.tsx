import { notFound } from "next/navigation";
import { fetchAgent } from "../../lib/api";
import { AgentDetailClient } from "./AgentDetailClient";

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
