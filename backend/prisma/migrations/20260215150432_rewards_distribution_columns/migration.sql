-- AlterTable
ALTER TABLE "Epoch" ADD COLUMN     "distributionTxHash" TEXT,
ADD COLUMN     "rewardsDistributedAt" TIMESTAMP(3),
ADD COLUMN     "rewardsSweptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EpochRegistration" ADD COLUMN     "pendingRewardAmountWei" TEXT;
