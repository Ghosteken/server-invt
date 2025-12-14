import { PrismaClient } from "@prisma/client";

export async function purgeDefaultAdminEmail() {
  const prisma = new PrismaClient();
  try {
    const legacyEmail = "admin@inventory.com";
    const normalized = legacyEmail.toLowerCase();
    const usersDeleted = await prisma.users.deleteMany({ where: { email: normalized } });
    const orgAdminsDeleted = await prisma.orgAdmins.deleteMany({ where: { email: normalized } });
    if (usersDeleted.count || orgAdminsDeleted.count) {
      console.log(`legacyCleanup: removed legacy admin accounts (users=${usersDeleted.count}, orgAdmins=${orgAdminsDeleted.count})`);
    }
  } catch (e) {
    console.warn("legacyCleanup: failed to purge default admin email", e);
  } finally {
    await prisma.$disconnect();
  }
}

