"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../db/prisma"));
const featureFlagsService_1 = require("../services/featureFlagsService");
const invoiceLayoutService_1 = require("../services/invoiceLayoutService");
const financialLayoutService_1 = require("../services/financialLayoutService");
const router = (0, express_1.Router)();
// Use shared Prisma client
// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
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
// Get features by email (diagnostic/fallback)
router.get("/features/by-email", async (req, res) => {
    try {
        const email = String(req.query?.email || "").trim().toLowerCase();
        if (!email) {
            res.status(400).json({ message: "email is required" });
            return;
        }
        const user = await prisma_1.default.users.findUnique({ where: { email } });
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const flags = (0, featureFlagsService_1.readFlags)();
        res.json({ userId: user.userId, features: flags[user.userId] || [] });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read features" });
    }
});
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
// Invoice layout settings (global)
router.get("/invoice-layout", async (_req, res) => {
    try {
        const layout = (0, invoiceLayoutService_1.readInvoiceLayout)();
        res.json(layout);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read invoice layout" });
    }
});
router.put("/invoice-layout", async (req, res) => {
    try {
        const layout = req.body || {};
        (0, invoiceLayoutService_1.writeInvoiceLayout)(layout);
        res.json((0, invoiceLayoutService_1.readInvoiceLayout)());
    }
    catch (err) {
        res.status(500).json({ message: "Failed to save invoice layout" });
    }
});
// Financial report layout settings (global)
router.get("/financial-layout", async (_req, res) => {
    try {
        const layout = (0, financialLayoutService_1.readFinancialLayout)();
        res.json(layout);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read financial layout" });
    }
});
router.put("/financial-layout", async (req, res) => {
    try {
        const layout = req.body || {};
        (0, financialLayoutService_1.writeFinancialLayout)(layout);
        res.json((0, financialLayoutService_1.readFinancialLayout)());
    }
    catch (err) {
        res.status(500).json({ message: "Failed to save financial layout" });
    }
});
exports.default = router;
