-- Add openingStock to Products and pcs_inventory to match Prisma schema

-- Alter Products to include openingStock for inventory opening balance
ALTER TABLE "Products"
ADD COLUMN "openingStock" INTEGER NOT NULL DEFAULT 0;

-- Alter pcs_inventory to include openingStock for PCS-level opening balance
ALTER TABLE "pcs_inventory"
ADD COLUMN "openingStock" INTEGER NOT NULL DEFAULT 0;

