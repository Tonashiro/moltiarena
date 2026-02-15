-- CreateTable
CREATE TABLE "MarketEvent" (
    "id" SERIAL NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "volumeMon" DOUBLE PRECISION,
    "traderAddress" TEXT,
    "poolAddress" TEXT,
    "transactionHash" TEXT,
    "amountIn" TEXT,
    "amountOut" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketEvent_tokenAddress_createdAt_idx" ON "MarketEvent"("tokenAddress", "createdAt");

-- CreateIndex
CREATE INDEX "MarketEvent_createdAt_idx" ON "MarketEvent"("createdAt");
