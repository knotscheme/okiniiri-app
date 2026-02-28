-- AlterTable
ALTER TABLE "Favorite" ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "RestockRequest" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "convertedPrice" DOUBLE PRECISION,
ADD COLUMN     "isConverted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "variantId" TEXT;

-- CreateTable
CREATE TABLE "AppUsage" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastReset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUsage_shop_key" ON "AppUsage"("shop");
