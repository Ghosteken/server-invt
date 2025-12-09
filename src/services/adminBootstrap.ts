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

// Sync org admin records into Users table for visibility in tenant-scoped views
export async function syncOrgAdminsToUsers() {
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organizations.findMany();
    for (const org of orgs) {
      const adminEmail = String(org.adminEmail || '').toLowerCase();
      if (adminEmail) {
        const existingUser = await prisma.users.findFirst({ where: { email: adminEmail } });
        const hashed = org.adminPasswordHash || bcrypt.hashSync('changeme', 10);
        if (!existingUser) {
          await prisma.users.create({ data: { userId: randomUUID(), name: 'Admin', email: adminEmail, password: hashed, role: 'admin', tenantId: org.id } });
        } else {
          const next: any = { role: 'admin', tenantId: org.id };
          // Keep password hash in sync if it differs
          if (existingUser.password !== hashed) next.password = hashed;
          await prisma.users.update({ where: { userId: existingUser.userId }, data: next });
        }
      }
      // Ensure all orgAdmins are represented in Users
      const admins = await prisma.orgAdmins.findMany({ where: { orgId: org.id } });
      for (const a of admins) {
        const email = String(a.email || '').toLowerCase();
        const existingUser = await prisma.users.findFirst({ where: { email } });
        const hashed = a.passwordHash || bcrypt.hashSync('changeme', 10);
        if (!existingUser) {
          await prisma.users.create({ data: { userId: randomUUID(), name: a.name || 'Admin', email, password: hashed, role: 'admin', tenantId: org.id } });
        } else {
          const next: any = { role: 'admin', tenantId: org.id };
          if (existingUser.password !== hashed) next.password = hashed;
          await prisma.users.update({ where: { userId: existingUser.userId }, data: next });
        }
      }
    }
    console.log('adminBootstrap: synced org admins to users across organizations');
  } catch (e) {
    console.warn('adminBootstrap: failed syncing org admins to users', e);
  } finally {
    await prisma.$disconnect();
  }
}
