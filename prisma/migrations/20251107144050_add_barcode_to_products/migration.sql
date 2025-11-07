-- AlterTable
ALTER TABLE "Products" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE INDEX "Products_name_idx" ON "Products"("name");

-- CreateIndex
CREATE INDEX "Products_category_idx" ON "Products"("category");

-- CreateIndex
CREATE INDEX "Products_packSize_idx" ON "Products"("packSize");

-- CreateIndex
CREATE INDEX "Products_barcode_idx" ON "Products"("barcode");
