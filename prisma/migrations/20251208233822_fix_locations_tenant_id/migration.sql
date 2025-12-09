/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,name]` on the table `Locations` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Locations_name_key";

-- DropIndex
DROP INDEX "public"."Stores_name_idx";

-- AlterTable
ALTER TABLE "Branches" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Locations" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "SalesAgents" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "Stores" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'default';

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_tenantId_name_key" ON "expense_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Branches_tenantId_idx" ON "Branches"("tenantId");

-- CreateIndex
CREATE INDEX "Locations_tenantId_idx" ON "Locations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Locations_tenantId_name_key" ON "Locations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "SalesAgents_tenantId_idx" ON "SalesAgents"("tenantId");

-- CreateIndex
CREATE INDEX "Stores_tenantId_idx" ON "Stores"("tenantId");
