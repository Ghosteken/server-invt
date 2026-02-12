import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";
import { z, ZodError } from "zod";
import { readFlags, writeFlags } from "../services/featureFlagsService";
import { createErrorResponse } from "../utils/errorHandler";

const JWT_SECRET = process.env.JWT_SECRET || "inventory-management-secret-key";

export const superAdminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String((req.body || {}).email || "").toLowerCase();
    const password = String((req.body || {}).password || "");
    const configuredEmail = String(process.env.MASTER_ADMIN_EMAIL || "").toLowerCase();
    const configuredPassword = String(process.env.MASTER_ADMIN_PASSWORD || "");
    if (!configuredEmail || !configuredPassword) {
      console.error("Super admin credentials not configured in environment");
      res.status(500).json({ message: "Server configuration error" });
      return;
    }
    if (email === configuredEmail && password === configuredPassword) {
      const token = jwt.sign({ userId: "super-admin", email, role: "super_admin" }, JWT_SECRET, { expiresIn: "7d" });
      res.json({ token, user: { userId: "super-admin", name: "Super Admin", email, role: "super_admin" } });
      return;
    }
    res.status(401).json({ message: "Invalid credentials" });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, undefined, "Error during super admin login"));
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
  res.json({ orgs: orgs.map((o: any) => ({ id: o.id, name: o.name, apiBaseUrl: o.apiBaseUrl, adminEmail: o.adminEmail, isBlocked: (o as any).isBlocked ?? false, createdAt: o.createdAt })) });
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
        const newAdmin = await prisma.orgAdmins.create({ data: { id: randomUUID(), orgId, name: "Admin", email: adminEmail, passwordHash } });
        // Lock AI features by default for new org admins
        const ALL_FEATURES = [
          "reports",
          "storeSales",
          "inventory",
          "productTracker",
          "statements",
          "products",
          "customers",
          "locations",
          "invoices",
          "expenses",
          "expenseApproval",
          "salesAgents",
          "purchases",
          "customerGroups",
          "logistics",
          "purchasingAdvisor",
          "expenseAnomalyDetection"
        ];
        const allFeaturesExceptAI = ALL_FEATURES
          .filter(f => f !== "purchasingAdvisor" && f !== "expenseAnomalyDetection")
          .filter(f => f !== "statements");
        await writeFlags(
          { 
            [newAdmin.id]: allFeaturesExceptAI,
            "__allowed__": allFeaturesExceptAI
          },
          orgId
        );
      }
      const existingUser = await prisma.users.findFirst({ where: { email: adminEmail, tenantId: orgId } });
      if (!existingUser) {
        await prisma.users.create({ data: { userId: randomUUID(), name: "Admin", email: adminEmail, password: passwordHash, role: "admin", tenantId: orgId, isBlocked: false } });
      }
    } catch {}
    res.status(201).json({ org: { id: org.id, name: org.name, apiBaseUrl: org.apiBaseUrl, adminEmail: org.adminEmail } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to create organization"));
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
  res.json({ admins: admins.map((a: any) => ({ id: a.id, name: a.name, email: a.email, isBlocked: (a as any).isBlocked ?? false })) });
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
    res.status(500).json(createErrorResponse(err, "Failed to create org admin"));
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
    await prisma.$transaction(async (tx) => {
      // Robust cleanup: find customers and invoices first to ensure related items are deleted regardless of tenantId on items

      // 1. Identify all Customers belonging to this tenant
      const customers = await tx.customers.findMany({ where: { tenantId: id }, select: { customerId: true } });
      const customerIds = customers.map(c => c.customerId);

      // 2. Identify all Invoices belonging to this tenant OR linked to these customers
      // Note: We use findMany instead of deleteMany directly to get IDs for child cleanup
      const invoices = await tx.invoices.findMany({ 
        where: { 
          OR: [
            { tenantId: id },
            { customerId: { in: customerIds.length > 0 ? customerIds : undefined } }
          ]
        }, 
        select: { invoiceId: true } 
      });
      const invoiceIds = invoices.map(i => i.invoiceId);

      // 3. Delete InvoiceItems (depend on Invoices)
      if (invoiceIds.length > 0) {
        await tx.invoiceItems.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      }
      await tx.invoiceItems.deleteMany({ where: { tenantId: id } }); // Catch any orphans

      // 4. Delete Payments (depend on Invoices and Customers)
      if (invoiceIds.length > 0) {
        await tx.payments.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      }
      if (customerIds.length > 0) {
        await tx.payments.deleteMany({ where: { customerId: { in: customerIds } } });
      }
      await tx.payments.deleteMany({ where: { tenantId: id } });

      // 5. Delete Invoices
      if (invoiceIds.length > 0) {
        await tx.invoices.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      }
      await tx.invoices.deleteMany({ where: { tenantId: id } });

      // 6. Delete CustomerPurchases (depend on Customers)
      if (customerIds.length > 0) {
        await tx.customerPurchases.deleteMany({ where: { customerId: { in: customerIds } } });
      }
      await tx.customerPurchases.deleteMany({ where: { tenantId: id } });

      // 7. Delete Customers
      if (customerIds.length > 0) {
         await tx.customers.deleteMany({ where: { customerId: { in: customerIds } } });
      }
      await tx.customers.deleteMany({ where: { tenantId: id } });

      // Continue with other tables...
      await tx.supplierPurchaseMeta.deleteMany({ where: { tenantId: id } });
      await tx.supplierPayments.deleteMany({ where: { tenantId: id } });
      await tx.purchases.deleteMany({ where: { tenantId: id } });
      await tx.sales.deleteMany({ where: { tenantId: id } });
      await tx.expenseByCategory.deleteMany({ where: { tenantId: id } });
      await tx.expenseSummary.deleteMany({ where: { tenantId: id } });
      await tx.expenses.deleteMany({ where: { tenantId: id } });
      await tx.purchaseSummary.deleteMany({ where: { tenantId: id } });
      await tx.salesSummary.deleteMany({ where: { tenantId: id } });
      await tx.invoiceMeta.deleteMany({ where: { tenantId: id } });
      await tx.featureFlags.deleteMany({ where: { tenantId: id } });
      await tx.pcsInventory.deleteMany({ where: { tenantId: id } });
      await tx.auditLogs.deleteMany({ where: { tenantId: id } });
      await tx.supportMessages.deleteMany({ where: { tenantId: id } });
      await tx.products.deleteMany({ where: { tenantId: id } });
      await tx.customerGroups.deleteMany({ where: { tenantId: id } });
      await tx.salesAgents.deleteMany({ where: { tenantId: id } });
      await tx.locations.deleteMany({ where: { tenantId: id } });
      await tx.branches.deleteMany({ where: { tenantId: id } });
      await tx.stores.deleteMany({ where: { tenantId: id } });
      await tx.expenseCategories.deleteMany({ where: { tenantId: id } });
      await tx.banks.deleteMany({ where: { tenantId: id } });
      await tx.suppliers.deleteMany({ where: { tenantId: id } });
      await tx.users.deleteMany({ where: { tenantId: id } });
      await tx.orgAdmins.deleteMany({ where: { orgId: id } });
      await tx.organizations.delete({ where: { id } });
    }, { timeout: 60000 });
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting organization:", err);
    res.status(500).json(createErrorResponse(err, "Failed to delete organization"));
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

export const getOrgAdminFeatures = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  try {
    const Params = z.object({ orgId: z.string().min(1), adminId: z.string().min(1) });
    const { orgId, adminId } = Params.parse(req.params);
    const flags = await readFlags(orgId);
    const allFeatures = [
      "reports",
      "storeSales",
      "inventory",
      "productTracker",
      "accounts",
      "statements",
      "products",
      "customers",
      "locations",
      "invoices",
      "expenses",
      "salesAgents",
      "purchases",
      "customerGroups",
      "logistics",
      "expenseApproval",
      "purchasingAdvisor",
      "expenseAnomalyDetection",
    ];
    const list = flags[adminId] && Array.isArray(flags[adminId]) ? flags[adminId] : allFeatures;
    res.json({ features: list });
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ message: "Invalid input", errors: err.issues }); return; }
    res.status(500).json(createErrorResponse(err, "Failed to read features"));
  }
};

export const setOrgAdminFeatures = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  try {
    const Params = z.object({ orgId: z.string().min(1), adminId: z.string().min(1) });
    const { orgId, adminId } = Params.parse(req.params);
    const Body = z.object({ features: z.array(z.string()).default([]) });
    const { features } = Body.parse(req.body || {});
    const flags = await readFlags(orgId);
    flags[adminId] = features;
    flags["__allowed__"] = features;
    try {
      const admin = await prisma.orgAdmins.findFirst({ where: { id: adminId, orgId } });
      if (admin) {
        const user = await prisma.users.findFirst({ where: { email: admin.email, tenantId: orgId } });
        if (user) {
          flags[user.userId] = features;
        }
      }
    } catch {}
    await writeFlags(flags, orgId);
    res.json({ features });
  } catch (err) {
    if (err instanceof ZodError) { res.status(400).json({ message: "Invalid input", errors: err.issues }); return; }
    res.status(500).json(createErrorResponse(err, "Failed to write features"));
  }
};

export const listPendingUsers = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  try {
    const users = await prisma.users.findMany({
      where: { status: "pending" },
      orderBy: { userId: "desc" },
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to list pending users"));
  }
};

export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  const auth = requireSuperAdmin(req, res);
  if (!auth.ok) return;
  try {
    const { userId } = req.params;
    const { status } = req.body as { status: string };
    
    if (!["approved", "declined", "pending"].includes(status)) {
      res.status(400).json({ message: "Invalid status" });
      return;
    }

    const user = await prisma.users.update({
      where: { userId },
      data: { status },
    });

    // If the user is an org admin (linked via email), update the OrgAdmin status too
    try {
      const orgAdmin = await prisma.orgAdmins.findFirst({
        where: { email: user.email, orgId: user.tenantId || "default" }
      });
      if (orgAdmin) {
        await prisma.orgAdmins.update({
          where: { id: orgAdmin.id },
          data: { status }
        });

        // Initialize features if approved
        if (status === "approved") {
          const ALL_FEATURES = [
            "reports", "storeSales", "inventory", "productTracker", "accounts", 
            "statements", "products", "customers", "locations", "invoices", 
            "expenses", "salesAgents", "purchases", "customerGroups", "logistics",
            "expenseApproval", "purchasingAdvisor", "expenseAnomalyDetection"
          ];
          // Filter out AI features by default for new orgs if you want, 
          // but usually approval is the time to grant them.
          const initialFeatures = ALL_FEATURES.filter(
            f => f !== "purchasingAdvisor" && f !== "expenseAnomalyDetection"
          );
          await writeFlags(
            { 
              [orgAdmin.id]: initialFeatures,
              "__allowed__": initialFeatures
            },
            user.tenantId || "default"
          );
        }
      }
    } catch (e) {
      console.error("Error updating related org admin status/features:", e);
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to update user status"));
  }
};
