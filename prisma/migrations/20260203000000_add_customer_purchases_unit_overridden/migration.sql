-- AlterTable
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CustomerPurchases' AND column_name='isOverridden') THEN
        ALTER TABLE "CustomerPurchases" ADD COLUMN "isOverridden" BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CustomerPurchases' AND column_name='unit') THEN
        ALTER TABLE "CustomerPurchases" ADD COLUMN "unit" TEXT;
    END IF;
END $$;

-- AlterTable
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='InvoiceItems' AND column_name='isOverridden') THEN
        ALTER TABLE "InvoiceItems" ADD COLUMN "isOverridden" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomerPurchases_tenantId_timestamp_idx" ON "CustomerPurchases"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomerPurchases_productId_idx" ON "CustomerPurchases"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InvoiceItems_productId_idx" ON "InvoiceItems"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoices_tenantId_date_idx" ON "Invoices"("tenantId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoices_tenantId_customerId_date_idx" ON "Invoices"("tenantId", "customerId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Purchases_tenantId_timestamp_idx" ON "Purchases"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Purchases_productId_idx" ON "Purchases"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Sales_tenantId_timestamp_idx" ON "Sales"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Sales_productId_idx" ON "Sales"("productId"); 

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supplier_purchase_meta_tenantId_supplierName_idx" ON "supplier_purchase_meta"("tenantId", "supplierName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supplier_purchase_meta_tenantId_supplierName_date_idx" ON "supplier_purchase_meta"("tenantId", "supplierName", "date");
