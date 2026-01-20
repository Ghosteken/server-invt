-- CreateTable
CREATE TABLE "StockResets" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" INTEGER NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "StockResets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockResets_productId_idx" ON "StockResets"("productId");

-- CreateIndex
CREATE INDEX "StockResets_tenantId_idx" ON "StockResets"("tenantId");

-- AddForeignKey
ALTER TABLE "StockResets" ADD CONSTRAINT "StockResets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "balance" DOUBLE PRECISION NOT NULL DEFAULT 0;
