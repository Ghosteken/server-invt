-- CreateTable
CREATE TABLE "Customers" (
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customers_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "CustomerPurchases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CustomerPurchases_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CustomerPurchases" ADD CONSTRAINT "CustomerPurchases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customers"("customerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchases" ADD CONSTRAINT "CustomerPurchases_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("productId") ON DELETE RESTRICT ON UPDATE CASCADE;
