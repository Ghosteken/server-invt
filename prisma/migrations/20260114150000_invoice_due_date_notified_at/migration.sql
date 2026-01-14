-- AlterTable
ALTER TABLE "Invoices" ADD COLUMN IF NOT EXISTS "dueDateNotifiedAt" TIMESTAMP(3);
