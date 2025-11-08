-- AlterTable
ALTER TABLE "Invoices" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "salesAgentId" TEXT;

-- CreateTable
CREATE TABLE "SalesAgents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesAgents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesAgents_name_idx" ON "SalesAgents"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Locations_name_key" ON "Locations"("name");

-- CreateIndex
CREATE INDEX "Locations_name_idx" ON "Locations"("name");

-- CreateIndex
CREATE INDEX "Invoices_salesAgentId_idx" ON "Invoices"("salesAgentId");

-- CreateIndex
CREATE INDEX "Invoices_locationId_idx" ON "Invoices"("locationId");

-- AddForeignKey
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
