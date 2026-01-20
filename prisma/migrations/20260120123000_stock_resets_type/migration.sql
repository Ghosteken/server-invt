-- AlterTable: add type column to StockResets to distinguish opening vs closing snapshots
ALTER TABLE "StockResets" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'opening';

