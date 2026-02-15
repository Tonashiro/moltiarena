-- CreateTable
CREATE TABLE "AgentPersonaMemory" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "memoryText" TEXT NOT NULL,
    "lastUpdatedTick" INTEGER,
    "lastAiSummarizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPersonaMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersonaMemory_agentId_key" ON "AgentPersonaMemory"("agentId");

-- AddForeignKey
ALTER TABLE "AgentPersonaMemory" ADD CONSTRAINT "AgentPersonaMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
