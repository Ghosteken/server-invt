
-- AlterTable: Add column with default 'approved' initially so existing records get 'approved'
ALTER TABLE "OrgAdmins" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "OrgAdmins" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable: Same for Users
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Users" ALTER COLUMN "status" SET DEFAULT 'pending';
