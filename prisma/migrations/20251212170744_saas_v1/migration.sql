-- CreateTable
CREATE TABLE "CustomerGroups" (
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroups_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "_CustomerGroupMembership" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CustomerGroupMembership_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "CustomerGroups_tenantId_idx" ON "CustomerGroups"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroups_tenantId_name_key" ON "CustomerGroups"("tenantId", "name");

-- CreateIndex
CREATE INDEX "_CustomerGroupMembership_B_index" ON "_CustomerGroupMembership"("B");

-- AddForeignKey
ALTER TABLE "_CustomerGroupMembership" ADD CONSTRAINT "_CustomerGroupMembership_A_fkey" FOREIGN KEY ("A") REFERENCES "CustomerGroups"("groupId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CustomerGroupMembership" ADD CONSTRAINT "_CustomerGroupMembership_B_fkey" FOREIGN KEY ("B") REFERENCES "Customers"("customerId") ON DELETE CASCADE ON UPDATE CASCADE;
