"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../db/prisma"));
const featureFlagsService_1 = require("../services/featureFlagsService");
const router = (0, express_1.Router)();
// Use shared Prisma client
// Get features for a user by ID
router.get("/features/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const flags = (0, featureFlagsService_1.readFlags)();
        res.json({ features: flags[userId] || [] });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read features" });
    }
});
// Set features for a user by ID
router.put("/features/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const features = Array.isArray(req.body?.features) ? req.body.features : [];
        const flags = (0, featureFlagsService_1.readFlags)();
        flags[userId] = features;
        (0, featureFlagsService_1.writeFlags)(flags);
        res.json({ features });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to write features" });
    }
});
// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
    try {
        const email = String(req.body?.email || "");
        const features = Array.isArray(req.body?.features) ? req.body.features : [];
        const user = await prisma_1.default.users.findUnique({ where: { email } });
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const flags = (0, featureFlagsService_1.readFlags)();
        flags[user.userId] = features;
        (0, featureFlagsService_1.writeFlags)(flags);
        res.json({ userId: user.userId, features });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to set features" });
    }
});
exports.default = router;
