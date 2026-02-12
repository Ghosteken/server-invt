/*
  Warnings:

  - You are about to drop the `notifications` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable: Add column with default 'approved' initially so existing records get 'approved'
ALTER TABLE "OrgAdmins" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "OrgAdmins" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable: Same for Users
ALTER TABLE "Users" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Users" ALTER COLUMN "status" SET DEFAULT 'pending';

-- DropTable
DROP TABLE "public"."notifications";
