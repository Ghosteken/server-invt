import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

// Ensure an admin user exists and matches configured credentials.
// Call this on server startup to keep admin in sync with environment.
export async function ensureAdminUser() {
  // Use a local Prisma client to avoid disconnecting the shared global client
  const prisma = new PrismaClient();
  try {
    const configuredEmail = process.env.ADMIN_EMAIL;
    const configuredPassword = process.env.ADMIN_PASSWORD;
    if (!configuredEmail || !configuredPassword) {
      console.log("adminBootstrap: ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin ensure.");
      return;
    }
    const adminEmail = configuredEmail.toLowerCase().trim();
    const adminPassword = configuredPassword;

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