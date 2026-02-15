-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "arenaId" INTEGER NOT NULL,
    "memoryText" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_arenaId_idx" ON "AgentMemory"("agentId", "arenaId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemory_agentId_arenaId_key" ON "AgentMemory"("agentId", "arenaId");

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
