-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_purchase_meta" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "purchaseId" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierMobile" TEXT,
    "paymentTerm" TEXT,
    "date" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_purchase_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "purchaseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccount" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banks_tenantId_idx" ON "banks"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "banks_tenantId_name_account_key" ON "banks"("tenantId", "name", "account");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_purchase_meta_purchaseId_key" ON "supplier_purchase_meta"("purchaseId");

-- CreateIndex
CREATE INDEX "supplier_purchase_meta_tenantId_idx" ON "supplier_purchase_meta"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_idx" ON "supplier_payments"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_payments_purchaseId_idx" ON "supplier_payments"("purchaseId");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_name_key" ON "suppliers"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "supplier_purchase_meta" ADD CONSTRAINT "supplier_purchase_meta_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchases"("purchaseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchases"("purchaseId") ON DELETE RESTRICT ON UPDATE CASCADE;
