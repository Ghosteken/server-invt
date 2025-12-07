"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../db/prisma"));
const featureFlagsService_1 = require("../services/featureFlagsService");
const invoiceLayoutService_1 = require("../services/invoiceLayoutService");
const financialLayoutService_1 = require("../services/financialLayoutService");
const router = (0, express_1.Router)();
// Use shared Prisma client
// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
    try {
        const Body = zod_1.z.object({ email: zod_1.z.string().email(), features: zod_1.z.array(zod_1.z.string()).default([]) });
        const { email, features } = Body.parse(req.body);
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const user = await prisma_1.default.users.findUnique({ where: { email: email.toLowerCase() } });
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const flags = await (0, featureFlagsService_1.readFlags)(tenantId);
        flags[user.userId] = features;
        await (0, featureFlagsService_1.writeFlags)(flags, tenantId);
        res.json({ userId: user.userId, features });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to set features" });
    }
});
// Get features by email (diagnostic/fallback)
router.get("/features/by-email", async (req, res) => {
    try {
        const Query = zod_1.z.object({ email: zod_1.z.string().email() });
        const { email } = Query.parse(req.query);
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const user = await prisma_1.default.users.findUnique({ where: { email: String(email).toLowerCase() } });
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const flags = await (0, featureFlagsService_1.readFlags)(tenantId);
        res.json({ userId: user.userId, features: flags[user.userId] || [] });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to read features" });
    }
});
// Get features for a user by ID
router.get("/features/:userId", async (req, res) => {
    try {
        const Params = zod_1.z.object({ userId: zod_1.z.string().min(1) });
        const { userId } = Params.parse(req.params);
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const flags = await (0, featureFlagsService_1.readFlags)(tenantId);
        res.json({ features: flags[userId] || [] });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to read features" });
    }
});
// Set features for a user by ID
router.put("/features/:userId", async (req, res) => {
    try {
        const Params = zod_1.z.object({ userId: zod_1.z.string().min(1) });
        const { userId } = Params.parse(req.params);
        const Body = zod_1.z.object({ features: zod_1.z.array(zod_1.z.string()).default([]) });
        const { features } = Body.parse(req.body);
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const flags = await (0, featureFlagsService_1.readFlags)(tenantId);
        flags[userId] = features;
        await (0, featureFlagsService_1.writeFlags)(flags, tenantId);
        res.json({ features });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
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
        const Body = zod_1.z.object({}).passthrough();
        const layout = Body.parse(req.body);
        (0, invoiceLayoutService_1.writeInvoiceLayout)(layout);
        res.json((0, invoiceLayoutService_1.readInvoiceLayout)());
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
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
        const Body = zod_1.z.object({}).passthrough();
        const layout = Body.parse(req.body);
        (0, financialLayoutService_1.writeFinancialLayout)(layout);
        res.json((0, financialLayoutService_1.readFinancialLayout)());
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to save financial layout" });
    }
});
exports.default = router;
