-- CreateIndex
CREATE INDEX "Customers_tenantId_name_idx" ON "Customers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Customers_tenantId_mobile_idx" ON "Customers"("tenantId", "mobile");

