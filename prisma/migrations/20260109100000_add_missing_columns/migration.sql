-- AlterTable
ALTER TABLE "Products" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "pcs_inventory" ADD COLUMN     "purchasePrice" DOUBLE PRECISION,
ADD COLUMN     "salesPrice" DOUBLE PRECISION;
