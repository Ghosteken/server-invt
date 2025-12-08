-- AlterTable
ALTER TABLE "OrgAdmins" ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organizations" ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false;
