-- AlterTable
ALTER TABLE "CustomerPurchases" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Customers" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "ExpenseByCategory" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "ExpenseSummary" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Expenses" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "InvoiceItems" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Invoices" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Payments" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Products" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "PurchaseSummary" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Purchases" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Sales" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "SalesSummary" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- CreateTable
CREATE TABLE "Organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiBaseUrl" TEXT,
    "adminEmail" TEXT NOT NULL,
    "adminPasswordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAdmins" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgAdmins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organizations_name_key" ON "Organizations"("name");

-- CreateIndex
CREATE INDEX "Organizations_name_idx" ON "Organizations"("name");

-- CreateIndex
CREATE INDEX "OrgAdmins_orgId_idx" ON "OrgAdmins"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgAdmins_orgId_email_key" ON "OrgAdmins"("orgId", "email");

-- CreateIndex
CREATE INDEX "Customers_tenantId_idx" ON "Customers"("tenantId");

-- CreateIndex
CREATE INDEX "Invoices_tenantId_idx" ON "Invoices"("tenantId");

-- CreateIndex
CREATE INDEX "Payments_tenantId_idx" ON "Payments"("tenantId");

-- CreateIndex
CREATE INDEX "Products_tenantId_idx" ON "Products"("tenantId");

-- AddForeignKey
ALTER TABLE "OrgAdmins" ADD CONSTRAINT "OrgAdmins_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
