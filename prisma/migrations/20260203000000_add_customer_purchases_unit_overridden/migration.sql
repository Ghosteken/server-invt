-- AlterTable
ALTER TABLE "CustomerPurchases" ADD COLUMN     "isOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItems" ADD COLUMN     "isOverridden" BOOLEAN NOT NULL DEFAULT false;


-- CreateIndex
CREATE INDEX "CustomerPurchases_tenantId_timestamp_idx" ON "CustomerPurchases"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "CustomerPurchases_productId_idx" ON "CustomerPurchases"("productId");

-- CreateIndex
CREATE INDEX "InvoiceItems_productId_idx" ON "InvoiceItems"("productId");

-- CreateIndex
CREATE INDEX "Invoices_tenantId_date_idx" ON "Invoices"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Invoices_tenantId_customerId_date_idx" ON "Invoices"("tenantId", "customerId", "date");

-- CreateIndex
CREATE INDEX "Purchases_tenantId_timestamp_idx" ON "Purchases"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "Purchases_productId_idx" ON "Purchases"("productId");

-- CreateIndex
CREATE INDEX "Sales_tenantId_timestamp_idx" ON "Sales"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "Sales_productId_idx" ON "Sales"("productId"); 

-- CreateIndex
CREATE INDEX "supplier_purchase_meta_tenantId_supplierName_idx" ON "supplier_purchase_meta"("tenantId", "supplierName");

-- CreateIndex
CREATE INDEX "supplier_purchase_meta_tenantId_supplierName_date_idx" ON "supplier_purchase_meta"("tenantId", "supplierName", "date");
