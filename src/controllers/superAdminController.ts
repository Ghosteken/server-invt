import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "inventory-management-secret-key";

export const superAdminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String((req.body || {}).email || "").toLowerCase();
    const password = String((req.body || {}).password || "");
    const configuredEmail = String(process.env.SUPER_ADMIN_EMAIL || "super@inventory.com").toLowerCase();
    const configuredPassword = String(process.env.SUPER_ADMIN_PASSWORD || "super_admin_password");
    if (email === configuredEmail && password === configuredPassword) {
      const token = jwt.sign({ userId: "super-admin", email, role: "super_admin" }, JWT_SECRET, { expiresIn: "24h" });
      res.json({ token, user: { userId: "super-admin", name: "Super Admin", email, role: "super_admin" } });
      return;
    }
    res.status(401).json({ message: "Invalid credentials" });
  } catch {
    res.status(500).json({ message: "Error during super admin login" });
  }
};

function requireSuperAdmin(req: Request, res: Response): { ok: boolean; email?: string } {
  try {
    const token = req.headers.authorization?.split(" ")[1] || "";
    const decoded = jwt.verify(token, JWT_SECRET) as { email: string; role: string };
    if ((decoded.role || "").toLowerCase() !== "super_admin") {
      res.status(403).json({ message: "Forbidden" });
      return { ok: false };
    }
    return { ok: true, email: decoded.email };
  } catch {
    res.status(401).json({ message: "Invalid token" });
    return { ok: false };
  }
}

export const listOrgs = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  let orgs = await prisma.organizations.findMany({ orderBy: { createdAt: "desc" } });
  if (orgs.length === 0) {
    try {
      const admin = await prisma.users.findFirst({ where: { role: "admin" } });
      if (admin) {
        const existingByEmail = await prisma.organizations.findFirst({ where: { adminEmail: admin.email } });
        if (!existingByEmail) {
          const created = await prisma.organizations.create({
            data: {
              id: randomUUID(),
              name: process.env.ORGANIZATION_NAME ? String(process.env.ORGANIZATION_NAME) : "Primary Organization",
              apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || undefined,
              adminEmail: admin.email,
              adminPasswordHash: admin.password,
            },
          });
          orgs = [created];
        }
      }
    } catch {}
  }
  res.json({ orgs: orgs.map((o) => ({ id: o.id, name: o.name, apiBaseUrl: o.apiBaseUrl, adminEmail: o.adminEmail, isBlocked: (o as any).isBlocked ?? false, createdAt: o.createdAt })) });
};

export const createOrg = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  try {
    const body = (req.body || {}) as { name?: string; apiBaseUrl?: string; adminEmail?: string; adminPassword?: string };
    const name = String(body.name || "").trim();
    const apiBaseUrl = body.apiBaseUrl ? String(body.apiBaseUrl) : undefined;
    const adminEmail = String(body.adminEmail || "").toLowerCase();
    const adminPassword = String(body.adminPassword || "");
    if (!name || !adminEmail || !adminPassword) {
      res.status(400).json({ message: "name, adminEmail and adminPassword are required" });
      return;
    }
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    const orgId = randomUUID();
    const org = await prisma.organizations.create({ data: { id: orgId, name, apiBaseUrl, adminEmail, adminPasswordHash: passwordHash } });
    try {
      const existingAdmin = await prisma.orgAdmins.findFirst({ where: { orgId, email: adminEmail } });
      if (!existingAdmin) {
        await prisma.orgAdmins.create({ data: { id: randomUUID(), orgId, name: "Admin", email: adminEmail, passwordHash } });
      }
      const existingUser = await prisma.users.findFirst({ where: { email: adminEmail, tenantId: orgId } });
      if (!existingUser) {
        await prisma.users.create({ data: { userId: randomUUID(), name: "Admin", email: adminEmail, password: passwordHash, role: "admin", tenantId: orgId, isBlocked: false } });
      }
    } catch {}
    res.status(201).json({ org: { id: org.id, name: org.name, apiBaseUrl: org.apiBaseUrl, adminEmail: org.adminEmail } });
  } catch (err) {
    res.status(500).json({ message: "Failed to create organization" });
  }
};

export const listOrgAdmins = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { id } = req.params;
  let admins = await prisma.orgAdmins.findMany({ where: { orgId: id }, orderBy: { createdAt: "desc" } });
  if (admins.length === 0) {
    const tenantAdmins = await prisma.users.findMany({ where: { tenantId: id, role: "admin" } });
    for (const u of tenantAdmins) {
      const existing = await prisma.orgAdmins.findFirst({ where: { orgId: id, email: u.email } });
      if (!existing) {
        await prisma.orgAdmins.create({ data: { id: randomUUID(), orgId: id, name: u.name, email: u.email, passwordHash: u.password } });
      }
    }
    admins = await prisma.orgAdmins.findMany({ where: { orgId: id }, orderBy: { createdAt: "desc" } });
  }
  res.json({ admins: admins.map((a) => ({ id: a.id, name: a.name, email: a.email, isBlocked: (a as any).isBlocked ?? false })) });
};

export const createOrgAdmin = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  try {
    const { id } = req.params;
    const body = (req.body || {}) as { name?: string; email?: string; password?: string };
    const name = String(body.name || "").trim() || "Admin";
    const email = String(body.email || "").toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      res.status(400).json({ message: "email and password are required" });
      return;
    }
    const org = await prisma.organizations.findUnique({ where: { id } });
    if (!org) {
      res.status(404).json({ message: "Organization not found" });
      return;
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    const admin = await prisma.orgAdmins.create({ data: { id: randomUUID(), orgId: id, name, email, passwordHash } });
    try {
      const existingUser = await prisma.users.findFirst({ where: { email, tenantId: id } });
      if (!existingUser) {
        await prisma.users.create({ data: { userId: randomUUID(), name, email, password: passwordHash, role: "admin", tenantId: id, isBlocked: false } });
      }
    } catch {}
    res.status(201).json({ admin: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (err) {
    res.status(500).json({ message: "Failed to create org admin" });
  }
};

export const getOrg = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { id } = req.params;
  const org = await prisma.organizations.findUnique({ where: { id } });
  if (!org) { res.status(404).json({ message: "Organization not found" }); return; }
  res.json({ org: { id: org.id, name: org.name, apiBaseUrl: org.apiBaseUrl, adminEmail: org.adminEmail, isBlocked: (org as any).isBlocked ?? false } });
};

export const deleteOrg = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { id } = req.params;
  try {
    // Ensure org exists
    const org = await prisma.organizations.findUnique({ where: { id } });
    if (!org) { res.status(404).json({ message: "Organization not found" }); return; }

    // Cascade delete tenant data
    await prisma.invoiceItems.deleteMany({ where: { tenantId: id } });
    await prisma.payments.deleteMany({ where: { tenantId: id } });
    await prisma.invoices.deleteMany({ where: { tenantId: id } });
    await prisma.customerPurchases.deleteMany({ where: { tenantId: id } });
    await prisma.customers.deleteMany({ where: { tenantId: id } });
    await prisma.purchases.deleteMany({ where: { tenantId: id } });
    await prisma.sales.deleteMany({ where: { tenantId: id } });
    await prisma.expenseByCategory.deleteMany({ where: { tenantId: id } });
    await prisma.expenseSummary.deleteMany({ where: { tenantId: id } });
    await prisma.expenses.deleteMany({ where: { tenantId: id } });
    await prisma.purchaseSummary.deleteMany({ where: { tenantId: id } });
    await prisma.salesSummary.deleteMany({ where: { tenantId: id } });
    await prisma.invoiceMeta.deleteMany({ where: { tenantId: id } });
    await prisma.featureFlags.deleteMany({ where: { tenantId: id } });
    await prisma.pcsInventory.deleteMany({ where: { tenantId: id } });
    await prisma.auditLogs.deleteMany({ where: { tenantId: id } });
    await prisma.supportMessages.deleteMany({ where: { tenantId: id } });
    await prisma.products.deleteMany({ where: { tenantId: id } });

    // Delete org admins and organization itself
    await prisma.orgAdmins.deleteMany({ where: { orgId: id } });
    await prisma.organizations.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete organization" });
  }
};

export const blockOrg = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { id } = req.params;
  const updated = await prisma.organizations.update({ where: { id }, data: { isBlocked: true } });
  res.json({ org: { id: updated.id, name: updated.name, isBlocked: true } });
};

export const unblockOrg = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { id } = req.params;
  const updated = await prisma.organizations.update({ where: { id }, data: { isBlocked: false } });
  res.json({ org: { id: updated.id, name: updated.name, isBlocked: false } });
};

export const blockOrgAdmin = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { orgId, adminId } = req.params as { orgId: string; adminId: string };
  const admin = await prisma.orgAdmins.update({ where: { id: adminId }, data: { isBlocked: true } });
  res.json({ admin: { id: admin.id, name: admin.name, email: admin.email, isBlocked: true } });
};

export const unblockOrgAdmin = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  const { orgId, adminId } = req.params as { orgId: string; adminId: string };
  const admin = await prisma.orgAdmins.update({ where: { id: adminId }, data: { isBlocked: false } });
  res.json({ admin: { id: admin.id, name: admin.name, email: admin.email, isBlocked: false } });
};
