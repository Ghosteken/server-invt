import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

// Ensure an admin user exists and matches configured credentials.
// Call this on server startup to keep admin in sync with environment.
export async function ensureAdminUser() {
  const prisma = new PrismaClient();
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@inventory.com").toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "admin2@12ad";

    const existing = await prisma.users.findFirst({ where: { email: adminEmail } });
    const hashedPassword = bcrypt.hashSync(String(adminPassword), 10);

    if (!existing) {
      await prisma.users.create({
        data: {
          userId: randomUUID(),
          name: "Admin User",
          email: adminEmail,
          password: hashedPassword,
          role: "admin",
        },
      });
      console.log(`adminBootstrap: created admin ${adminEmail}`);
    } else {
      const passwordMatches = bcrypt.compareSync(String(adminPassword), existing.password);
      if (existing.role !== "admin" || !passwordMatches) {
        await prisma.users.update({
          where: { userId: existing.userId },
          data: { role: "admin", password: hashedPassword },
        });
        console.log(`adminBootstrap: updated admin ${adminEmail}`);
      } else {
        console.log(`adminBootstrap: admin already up-to-date: ${adminEmail}`);
      }
    }
  } catch (e) {
    console.error("adminBootstrap: failed ensuring admin user", e);
  } finally {
    await prisma.$disconnect();
  }
}