-- CreateTable
CREATE TABLE "Stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branches" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Stores_name_key" ON "Stores"("name");

-- CreateIndex
CREATE INDEX "Stores_name_idx" ON "Stores"("name");

-- CreateIndex
CREATE INDEX "Branches_storeId_idx" ON "Branches"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Branches_storeId_name_key" ON "Branches"("storeId", "name");

-- AddForeignKey
ALTER TABLE "Branches" ADD CONSTRAINT "Branches_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
