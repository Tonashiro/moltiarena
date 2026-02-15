import type { PrismaClient } from "@prisma/client";
import { getTokenName } from "../market/tokenNames.js";
import { normalizeTokenAddress } from "../utils/validation.js";

/**
 * Seeds arenas from ARENA_TOKENS environment variable.
 * Creates arenas for each token address if they don't exist.
 * Uses token names from tokenNames.ts for friendly names.
 */
export async function seedArenas(
  prisma: PrismaClient,
  arenaTokens: string
): Promise<void> {
  try {
    const tokenAddresses = arenaTokens
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tokenAddresses.length === 0) {
      console.warn("[arenaSeeder] No token addresses provided");
      return;
    }

    console.log(`[arenaSeeder] Seeding ${tokenAddresses.length} arena(s)...`);

    let created = 0;
    let existing = 0;

    for (const tokenAddress of tokenAddresses) {
      // Validate and normalize address
      const normalizedAddress = normalizeTokenAddress(tokenAddress);
      if (!normalizedAddress) {
        console.warn(
          `[arenaSeeder] Invalid token address: ${tokenAddress}, skipping`
        );
        continue;
      }

      // Get friendly name from tokenNames.ts
      const tokenName = getTokenName(normalizedAddress);
      const arenaName = tokenName !== normalizedAddress ? tokenName : null;

      // Check if arena already exists (either from seeder or from on-chain indexer)
      const existingArena = await prisma.arena.findUnique({
        where: { tokenAddress: normalizedAddress },
      });

      if (existingArena) {
        // Update name if missing and we have one
        if (!existingArena.name && arenaName) {
          await prisma.arena.update({
            where: { id: existingArena.id },
            data: { name: arenaName },
          });
          console.log(
            `[arenaSeeder] ✓ Arena ${existingArena.id} (${arenaName}) - updated name`
          );
        } else {
          console.log(
            `[arenaSeeder] ✓ Arena ${existingArena.id} (${existingArena.name ?? normalizedAddress.slice(0, 10) + "..."}) - already exists${existingArena.onChainId != null ? ` (on-chain #${existingArena.onChainId})` : ""}`
          );
        }
        existing++;
      } else {
        await prisma.arena.create({
          data: {
            tokenAddress: normalizedAddress,
            name: arenaName,
          },
        });
        console.log(
          `[arenaSeeder] ✓ Created arena (${arenaName ?? normalizedAddress.slice(0, 10) + "..."})`
        );
        created++;
      }
    }

    console.log(
      `[arenaSeeder] Complete: ${created} created, ${existing} existing`
    );
  } catch (error) {
    console.error("[arenaSeeder] Failed to seed arenas:", error);
    // Don't throw - allow server to start even if seeding fails
  }
}
