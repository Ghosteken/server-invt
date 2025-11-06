import { Router } from "express";
import prisma from "../db/prisma";
import { readFlags, writeFlags } from "../services/featureFlagsService";

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
    const email = String(req.body?.email || "");
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

export default router;