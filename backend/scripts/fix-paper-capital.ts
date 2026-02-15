/**
 * One-time fix for paper capital: set initialCapital and cashMon per arena
 * to (fundedBalance - total registration fees) / num arenas.
 *
 * Run: npx tsx scripts/fix-paper-capital.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.agent.findMany({
    include: {
      arenaRegistrations: { where: { isActive: true }, select: { deposit: true } },
      portfolios: true,
    },
  });

  let updated = 0;
  for (const agent of agents) {
    const regs = agent.arenaRegistrations;
    if (regs.length === 0) continue;

    const totalFees = regs.reduce(
      (s, r) => s + (r.deposit ? Number(r.deposit) / 1e18 : 100),
      0,
    );
    const funded = agent.fundedBalance > 0 ? agent.fundedBalance : totalFees;
    const available = Math.max(0, funded - totalFees);
    const perArena = available / regs.length;

    for (const p of agent.portfolios) {
      const currentCap = p.initialCapital;
      if (Math.abs(currentCap - perArena) < 0.01) continue;

      if (p.tokenUnits === 0) {
        await prisma.portfolio.update({
          where: { id: p.id },
          data: { initialCapital: perArena, cashMon: perArena },
        });
        console.log(
          `Agent ${agent.id} arena ${p.arenaId}: ${currentCap} -> ${perArena.toFixed(2)}`,
        );
        updated++;
      } else {
        console.log(
          `Agent ${agent.id} arena ${p.arenaId}: has tokens, skipped (current cap=${currentCap})`,
        );
      }
    }
  }
  console.log(`Updated ${updated} portfolios.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
