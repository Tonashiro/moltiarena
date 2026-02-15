/*
  Warnings:

  - A unique constraint covering the columns `[onChainId]` on the table `Agent` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[onChainId]` on the table `Arena` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[agentId,arenaId,epochId]` on the table `Portfolio` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Portfolio_agentId_arenaId_key";

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "creationTxHash" TEXT,
ADD COLUMN     "encryptedSignerKey" TEXT,
ADD COLUMN     "fundedBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "onChainId" INTEGER,
ADD COLUMN     "smartAccountAddress" TEXT,
ADD COLUMN     "walletAddress" TEXT;

-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "onChainId" INTEGER;

-- AlterTable
ALTER TABLE "ArenaRegistration" ADD COLUMN     "deposit" TEXT,
ADD COLUMN     "registrationTxHash" TEXT;

-- AlterTable
ALTER TABLE "LeaderboardSnapshot" ADD COLUMN     "epochId" INTEGER;

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "epochId" INTEGER,
ADD COLUMN     "initialCapital" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "moltiLocked" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "epochId" INTEGER,
ADD COLUMN     "onChainTxHash" TEXT,
ADD COLUMN     "tradeValueMon" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Epoch" (
    "id" SERIAL NOT NULL,
    "arenaId" INTEGER NOT NULL,
    "onChainEpochId" INTEGER,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rewardPoolAmount" TEXT,
    "burnedAmount" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Epoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpochRegistration" (
    "id" SERIAL NOT NULL,
    "epochId" INTEGER NOT NULL,
    "agentId" INTEGER NOT NULL,
    "depositAmount" TEXT,
    "feesPaid" TEXT,
    "principalClaimed" BOOLEAN NOT NULL DEFAULT false,
    "rewardClaimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpochRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpochPointsSnapshot" (
    "id" SERIAL NOT NULL,
    "epochId" INTEGER NOT NULL,
    "agentId" INTEGER NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "volumeTraded" DOUBLE PRECISION NOT NULL,
    "pnlPct" DOUBLE PRECISION NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpochPointsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "arenaId" INTEGER NOT NULL,
    "tick" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "sizePct" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "price" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "onChainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Epoch_arenaId_status_idx" ON "Epoch"("arenaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EpochRegistration_epochId_agentId_key" ON "EpochRegistration"("epochId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "EpochPointsSnapshot_epochId_agentId_key" ON "EpochPointsSnapshot"("epochId", "agentId");

-- CreateIndex
CREATE INDEX "AgentDecision_agentId_createdAt_idx" ON "AgentDecision"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_onChainId_key" ON "Agent"("onChainId");

-- CreateIndex
CREATE UNIQUE INDEX "Arena_onChainId_key" ON "Arena"("onChainId");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_arenaId_epochId_idx" ON "LeaderboardSnapshot"("arenaId", "epochId");

-- CreateIndex
CREATE INDEX "Portfolio_agentId_arenaId_idx" ON "Portfolio"("agentId", "arenaId");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_agentId_arenaId_epochId_key" ON "Portfolio"("agentId", "arenaId", "epochId");

-- CreateIndex
CREATE INDEX "Trade_agentId_arenaId_epochId_idx" ON "Trade"("agentId", "arenaId", "epochId");

-- AddForeignKey
ALTER TABLE "Epoch" ADD CONSTRAINT "Epoch_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpochRegistration" ADD CONSTRAINT "EpochRegistration_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "Epoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpochRegistration" ADD CONSTRAINT "EpochRegistration_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpochPointsSnapshot" ADD CONSTRAINT "EpochPointsSnapshot_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "Epoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpochPointsSnapshot" ADD CONSTRAINT "EpochPointsSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "Epoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "Epoch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_epochId_fkey" FOREIGN KEY ("epochId") REFERENCES "Epoch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
