import { notFound } from "next/navigation";
import { fetchArena, fetchLeaderboard, fetchTrades } from "../../lib/api";
import { ArenaDetailClient } from "./ArenaDetailClient";

export default async function ArenaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isInteger(id) || id < 1) {
    notFound();
  }
  let initialArena = null;
  let initialLeaderboard = null;
  let initialTrades = null;
  try {
    [initialArena, initialLeaderboard, initialTrades] = await Promise.all([
      fetchArena(id, { next: { revalidate: 0 } }),
      fetchLeaderboard(id, undefined, { next: { revalidate: 0 } }),
      fetchTrades(id, { next: { revalidate: 0 } }),
    ]);
  } catch (error) {
    console.error(`[ArenaDetailPage] Error fetching arena ${id}:`, error);
    // Check if it's a 404 error (arena not found)
    const is404 = 
      (error instanceof Error && 
       ((error as Error & { status?: number }).status === 404 || 
        error.message.includes("404") || 
        error.message.toLowerCase().includes("not found")));
    
    if (is404) {
      notFound();
    }
    // For other errors, continue but with null data (will show error in client)
  }
  
  // If arena doesn't exist, show 404
  if (!initialArena) {
    notFound();
  }

  return (
    <ArenaDetailClient
      arenaId={id}
      initialArena={initialArena}
      initialLeaderboard={initialLeaderboard}
      initialTrades={initialTrades}
    />
  );
}
