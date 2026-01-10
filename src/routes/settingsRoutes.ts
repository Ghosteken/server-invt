import { Router } from "express";
import { z, ZodError } from "zod";
import prisma from "../db/prisma";
import { readFlags, writeFlags } from "../services/featureFlagsService";
import { readInvoiceLayout, writeInvoiceLayout } from "../services/invoiceLayoutService";
import { readFinancialLayout, writeFinancialLayout } from "../services/financialLayoutService";
import { Request, Response } from "express";
import { readBanks, addBank, updateBank, removeBank } from "../services/banksService";
import { appendNotification } from "../services/notificationService";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = Router();
// Use shared Prisma client

const ALL_FEATURES = [
  "reports",
  "storeSales",
  "inventory",
  "productTracker",
  "products",
  "customers",
  "invoices",
  "expenses",
  "expenseApproval",
  "salesAgents",
  "purchases",
  "customerGroups",
  "logistics",
  "purchasingAdvisor",
  "expenseAnomalyDetection",
];

// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
  try {
    const Body = z.object({ email: z.string().email(), features: z.array(z.string()).default([]) });
    const { email, features } = Body.parse(req.body);
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const user = await prisma.users.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    const flags = await readFlags(tenantId);
    flags[user.userId] = features;
    await writeFlags(flags, tenantId);
    res.json({ userId: user.userId, features });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to set features" });
  }
});

// Update organization display name for current tenant
router.put("/org", async (req, res) => {
  try {
    const Body = z.object({ name: z.string().min(1) });
    const { name } = Body.parse(req.body || {});
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.organizations.findUnique({ where: { id: tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Organization not found" });
      return;
    }
    const updated = await prisma.organizations.update({ where: { id: tenantId }, data: { name } });
    res.json({ org: { id: updated.id, name: updated.name } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to save organization name" });
  }
});

// Get features by email (diagnostic/fallback)
router.get("/features/by-email", async (req, res) => {
  try {
    const Query = z.object({ email: z.string().email() });
    const { email } = Query.parse(req.query);
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const user = await prisma.users.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    const flags = await readFlags(tenantId);
    res.json({ userId: user.userId, features: flags[user.userId] || [] });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to read features" });
  }
});

// Get tenant-allowed features (set by Super Admin)
router.get("/features/allowed", async (req, res) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const flags = await readFlags(tenantId);
    const allowed = Array.isArray(flags["__allowed__"]) ? flags["__allowed__"] : ALL_FEATURES;
    res.json({ features: allowed });
  } catch (err) {
    res.status(500).json({ message: "Failed to read tenant allowed features" });
  }
});

// Get features for a user by ID
router.get("/features/:userId", async (req, res) => {
  try {
    const Params = z.object({ userId: z.string().min(1) });
    const { userId } = Params.parse(req.params);
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const flags = await readFlags(tenantId);
    res.json({ features: flags[userId] || [] });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to read features" });
  }
});

// Set features for a user by ID
router.put("/features/:userId", async (req, res) => {
  try {
    const Params = z.object({ userId: z.string().min(1) });
    const { userId } = Params.parse(req.params);
    const Body = z.object({ features: z.array(z.string()).default([]) });
    const { features } = Body.parse(req.body);
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const flags = await readFlags(tenantId);
    flags[userId] = features;
    await writeFlags(flags, tenantId);
    res.json({ features });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to write features" });
  }
});

// Invoice layout settings (tenant-aware)
router.get("/invoice-layout", async (req, res) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || (req as any).user?.tenantId || "default";
    const layout = await readInvoiceLayout(tenantId);
    res.json(layout);
  } catch (err) {
    res.status(500).json({ message: "Failed to read invoice layout" });
  }
});

router.put("/invoice-layout", async (req, res) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || (req as any).user?.tenantId || "default";
    const Body = z.object({}).passthrough();
    const layout = Body.parse(req.body);
    writeInvoiceLayout(tenantId, layout);
    res.json(await readInvoiceLayout(tenantId));
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to save invoice layout" });
  }
});

// Financial report layout settings (tenant-aware)
router.get("/financial-layout", async (req, res) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || (req as any).user?.tenantId || "default";
    const layout = readFinancialLayout(tenantId);
    res.json(layout);
  } catch (err) {
    res.status(500).json({ message: "Failed to read financial layout" });
  }
});

router.put("/financial-layout", async (req, res) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || (req as any).user?.tenantId || "default";
    const Body = z.object({}).passthrough();
    const layout = Body.parse(req.body);
    writeFinancialLayout(tenantId, layout);
    res.json(readFinancialLayout(tenantId));
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to save financial layout" });
  }
});

// Tenant-scoped bank accounts list
router.get("/banks", authenticateToken, async (req: Request, res: Response) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const tenantBanks = await readBanks(tenantId);
    const list = tenantBanks;
    res.json({ banks: list });
  } catch {
    res.status(500).json({ banks: [] });
  }
});

router.post("/banks", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const Body = z.object({ name: z.string().min(1), account: z.string().min(1) });
    const { name, account } = Body.parse(req.body || {});
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const list = await addBank(tenantId, { name, account });
    try { appendNotification({ type: "bank", message: `Bank account created: ${name} - ${account}`, actorUserId: req.user?.userId, tenantId }); } catch {}
    res.status(201).json({ banks: list });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to create bank account" });
  }
});

router.put("/banks", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const Body = z.object({
      oldName: z.string().min(1),
      oldAccount: z.string().min(1),
      name: z.string().min(1),
      account: z.string().min(1),
    });
    const { oldName, oldAccount, name, account } = Body.parse(req.body || {});
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const list = await updateBank(tenantId, { name: oldName, account: oldAccount }, { name, account });
    try { appendNotification({ type: "bank", message: `Bank account updated: ${oldName} - ${oldAccount} → ${name} - ${account}`, actorUserId: req.user?.userId, tenantId }); } catch {}
    res.json({ banks: list });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to update bank account" });
  }
});

router.delete("/banks", authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  try {
    const Body = z.object({ name: z.string().min(1), account: z.string().min(1) });
    const { name, account } = Body.parse(req.body || {});
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const list = await removeBank(tenantId, { name, account });
    try { appendNotification({ type: "bank", message: `Bank account removed: ${name} - ${account}`, actorUserId: req.user?.userId, tenantId }); } catch {}
    res.json({ banks: list });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to delete bank account" });
  }
});

export default router;
