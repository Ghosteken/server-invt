import { Router } from "express";
import prisma from "../db/prisma";
import { readFlags, writeFlags } from "../services/featureFlagsService";
import { readInvoiceLayout, writeInvoiceLayout } from "../services/invoiceLayoutService";
import { readFinancialLayout, writeFinancialLayout } from "../services/financialLayoutService";

const router = Router();
// Use shared Prisma client

// Get features for a user by ID
router.get("/features/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const flags = readFlags();
    res.json({ features: flags[userId] || [] });
  } catch (err) {
    res.status(500).json({ message: "Failed to read features" });
  }
});

// Set features for a user by ID
router.put("/features/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const features: string[] = Array.isArray(req.body?.features) ? req.body.features : [];
    const flags = readFlags();
    flags[userId] = features;
    writeFlags(flags);
    res.json({ features });
  } catch (err) {
    res.status(500).json({ message: "Failed to write features" });
  }
});

// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const features: string[] = Array.isArray(req.body?.features) ? req.body.features : [];
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    const flags = readFlags();
    flags[user.userId] = features;
    writeFlags(flags);
    res.json({ userId: user.userId, features });
  } catch (err) {
    res.status(500).json({ message: "Failed to set features" });
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
    const layout = req.body || {};
    writeInvoiceLayout(layout);
    res.json(readInvoiceLayout());
  } catch (err) {
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
    const layout = req.body || {};
    writeFinancialLayout(layout);
    res.json(readFinancialLayout());
  } catch (err) {
    res.status(500).json({ message: "Failed to save financial layout" });
  }
});

export default router;