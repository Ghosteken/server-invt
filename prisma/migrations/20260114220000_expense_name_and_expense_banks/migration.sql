-- CreateTable
CREATE TABLE "expense_banks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_banks_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Expenses" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Expenses" ADD COLUMN     "expenseBankId" TEXT;

-- CreateIndex
CREATE INDEX "expense_banks_tenantId_idx" ON "expense_banks"("tenantId");
CREATE UNIQUE INDEX "expense_banks_tenantId_name_account_key" ON "expense_banks"("tenantId", "name", "account");

-- CreateIndex
CREATE INDEX "Expenses_tenantId_idx" ON "Expenses"("tenantId");
CREATE INDEX "Expenses_tenantId_expenseBankId_idx" ON "Expenses"("tenantId", "expenseBankId");

-- AddForeignKey
ALTER TABLE "Expenses" ADD CONSTRAINT "Expenses_expenseBankId_fkey" FOREIGN KEY ("expenseBankId") REFERENCES "expense_banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

