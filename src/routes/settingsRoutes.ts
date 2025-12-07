import { Router } from "express";
import { z, ZodError } from "zod";
import prisma from "../db/prisma";
import { readFlags, writeFlags } from "../services/featureFlagsService";
import { readInvoiceLayout, writeInvoiceLayout } from "../services/invoiceLayoutService";
import { readFinancialLayout, writeFinancialLayout } from "../services/financialLayoutService";

const router = Router();
// Use shared Prisma client

// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
  try {
    const Body = z.object({ email: z.string().email(), features: z.array(z.string()).default([]) });
    const { email, features } = Body.parse(req.body);
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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

// Get features by email (diagnostic/fallback)
router.get("/features/by-email", async (req, res) => {
  try {
    const Query = z.object({ email: z.string().email() });
    const { email } = Query.parse(req.query);
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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

// Get features for a user by ID
router.get("/features/:userId", async (req, res) => {
  try {
    const Params = z.object({ userId: z.string().min(1) });
    const { userId } = Params.parse(req.params);
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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

// Invoice layout settings (global)
router.get("/invoice-layout", async (_req, res) => {
  try {
    const layout = readInvoiceLayout();
    res.json(layout);
  } catch (err) {
    res.status(500).json({ message: "Failed to read invoice layout" });
  }
});

router.put("/invoice-layout", async (req, res) => {
  try {
    const Body = z.object({}).passthrough();
    const layout = Body.parse(req.body);
    writeInvoiceLayout(layout);
    res.json(readInvoiceLayout());
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to save invoice layout" });
  }
});

// Financial report layout settings (global)
router.get("/financial-layout", async (_req, res) => {
  try {
    const layout = readFinancialLayout();
    res.json(layout);
  } catch (err) {
    res.status(500).json({ message: "Failed to read financial layout" });
  }
});

router.put("/financial-layout", async (req, res) => {
  try {
    const Body = z.object({}).passthrough();
    const layout = Body.parse(req.body);
    writeFinancialLayout(layout);
    res.json(readFinancialLayout());
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to save financial layout" });
  }
});

export default router;
