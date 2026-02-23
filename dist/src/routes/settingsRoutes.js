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
const banksService_1 = require("../services/banksService");
const notificationService_1 = require("../services/notificationService");
const authMiddleware_1 = require("../middleware/authMiddleware");
const permissionMiddleware_1 = require("../middleware/permissionMiddleware");
const productController_1 = require("../controllers/productController");
const backupController_1 = require("../controllers/backupController");
const router = (0, express_1.Router)();
// Use shared Prisma client
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
    "expenseAnomalyDetection",
    "accounts",
];
// Set features by email for convenience in admin UI
router.put("/features/by-email", async (req, res) => {
    try {
        const Body = zod_1.z.object({ email: zod_1.z.string().email(), features: zod_1.z.array(zod_1.z.string()).default([]) });
        const { email, features } = Body.parse(req.body);
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
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
// Update organization display name for current tenant
router.put("/org", async (req, res) => {
    try {
        const Body = zod_1.z.object({ name: zod_1.z.string().min(1) });
        const { name } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.organizations.findUnique({ where: { id: tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Organization not found" });
            return;
        }
        const updated = await prisma_1.default.organizations.update({ where: { id: tenantId }, data: { name } });
        res.json({ org: { id: updated.id, name: updated.name } });
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to save organization name" });
    }
});
// Get features by email (diagnostic/fallback)
router.get("/features/by-email", async (req, res) => {
    try {
        const Query = zod_1.z.object({ email: zod_1.z.string().email() });
        const { email } = Query.parse(req.query);
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
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
// Get tenant-allowed features (set by Super Admin)
router.get("/features/allowed", async (req, res) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const flags = await (0, featureFlagsService_1.readFlags)(tenantId);
        const allowed = Array.isArray(flags["__allowed__"]) ? flags["__allowed__"] : ALL_FEATURES;
        res.json({ features: allowed });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read tenant allowed features" });
    }
});
// Get features for a user by ID
router.get("/features/:userId", async (req, res) => {
    try {
        const Params = zod_1.z.object({ userId: zod_1.z.string().min(1) });
        const { userId } = Params.parse(req.params);
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
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
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
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
// Invoice layout settings (tenant-aware)
router.get("/invoice-layout", async (req, res) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const layout = await (0, invoiceLayoutService_1.readInvoiceLayout)(tenantId);
        res.json(layout);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read invoice layout" });
    }
});
router.put("/invoice-layout", async (req, res) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const Body = zod_1.z.object({}).passthrough();
        const layout = Body.parse(req.body);
        (0, invoiceLayoutService_1.writeInvoiceLayout)(tenantId, layout);
        res.json(await (0, invoiceLayoutService_1.readInvoiceLayout)(tenantId));
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
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
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const layout = (0, financialLayoutService_1.readFinancialLayout)(tenantId);
        res.json(layout);
    }
    catch (err) {
        res.status(500).json({ message: "Failed to read financial layout" });
    }
});
router.put("/financial-layout", async (req, res) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const Body = zod_1.z.object({}).passthrough();
        const layout = Body.parse(req.body);
        (0, financialLayoutService_1.writeFinancialLayout)(tenantId, layout);
        res.json((0, financialLayoutService_1.readFinancialLayout)(tenantId));
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to save financial layout" });
    }
});
// Tenant-scoped bank accounts list
router.get("/banks", authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const tenantBanks = await (0, banksService_1.readBanks)(tenantId);
        const list = tenantBanks;
        res.json({ banks: list });
    }
    catch {
        res.status(500).json({ banks: [] });
    }
});
router.post("/banks", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requireFeature)("accounts"), async (req, res) => {
    try {
        const Body = zod_1.z.object({ name: zod_1.z.string().min(1), account: zod_1.z.string().min(1), balance: zod_1.z.coerce.number().optional() });
        const { name, account, balance } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const list = await (0, banksService_1.addBank)(tenantId, { name, account, balance });
        try {
            (0, notificationService_1.appendNotification)({ type: "bank", message: `Bank account created: ${name} - ${account}`, actorUserId: req.user?.userId, tenantId });
        }
        catch { }
        res.status(201).json({ banks: list });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to create bank account" });
    }
});
router.put("/banks", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requireFeature)("accounts"), async (req, res) => {
    try {
        const Body = zod_1.z.object({
            oldName: zod_1.z.string().min(1),
            oldAccount: zod_1.z.string().min(1),
            name: zod_1.z.string().min(1),
            account: zod_1.z.string().min(1),
            balance: zod_1.z.coerce.number().optional(),
        });
        const { oldName, oldAccount, name, account, balance } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const list = await (0, banksService_1.updateBank)(tenantId, { name: oldName, account: oldAccount }, { name, account, balance });
        try {
            (0, notificationService_1.appendNotification)({ type: "bank", message: `Bank account updated: ${oldName} - ${oldAccount} → ${name} - ${account}`, actorUserId: req.user?.userId, tenantId });
        }
        catch { }
        res.json({ banks: list });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to update bank account" });
    }
});
router.delete("/banks", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requireFeature)("accounts"), async (req, res) => {
    try {
        const Body = zod_1.z.object({ name: zod_1.z.string().min(1), account: zod_1.z.string().min(1) });
        const { name, account } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const list = await (0, banksService_1.removeBank)(tenantId, { name, account });
        try {
            (0, notificationService_1.appendNotification)({ type: "bank", message: `Bank account removed: ${name} - ${account}`, actorUserId: req.user?.userId, tenantId });
        }
        catch { }
        res.json({ banks: list });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to delete bank account" });
    }
});
function cryptoRandom() {
    try {
        const { randomUUID } = require("crypto");
        return randomUUID();
    }
    catch {
        return Math.random().toString(36).slice(2);
    }
}
router.get("/expense-banks", authMiddleware_1.authenticateToken, async (req, res) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const db = prisma_1.default;
        const rows = await db.expenseBanks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        res.json({ expenseBanks: rows.map((r) => ({ id: r.id, name: r.name, account: r.account, balance: Number(r.balance || 0) })) });
    }
    catch {
        res.status(500).json({ expenseBanks: [] });
    }
});
router.post("/expense-banks", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requireFeature)("accounts"), async (req, res) => {
    try {
        const Body = zod_1.z.object({ name: zod_1.z.string().min(1), account: zod_1.z.string().min(1), balance: zod_1.z.coerce.number().optional() });
        const { name, account, balance } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const db = prisma_1.default;
        const existing = await db.expenseBanks.findFirst({ where: { tenantId, name: String(name).trim(), account: String(account).trim() } });
        if (!existing) {
            await db.expenseBanks.create({
                data: { id: cryptoRandom(), tenantId, name: String(name).trim(), account: String(account).trim(), balance: balance !== undefined ? Number(balance) : 0 },
            });
            try {
                (0, notificationService_1.appendNotification)({ type: "expenseBank", message: `Expense bank created: ${name} - ${account}`, actorUserId: req.user?.userId, tenantId });
            }
            catch { }
        }
        const rows = await db.expenseBanks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        res.status(201).json({ expenseBanks: rows.map((r) => ({ id: r.id, name: r.name, account: r.account, balance: Number(r.balance || 0) })) });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to create expense bank account" });
    }
});
router.put("/expense-banks", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requireFeature)("accounts"), async (req, res) => {
    try {
        const Body = zod_1.z.object({ id: zod_1.z.string().min(1), name: zod_1.z.string().min(1), account: zod_1.z.string().min(1), balance: zod_1.z.coerce.number() });
        const { id, name, account, balance } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const db = prisma_1.default;
        const existing = await db.expenseBanks.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense bank account not found" });
            return;
        }
        await db.expenseBanks.update({ where: { id }, data: { name: String(name).trim(), account: String(account).trim(), balance: Number(balance) } });
        try {
            (0, notificationService_1.appendNotification)({ type: "expenseBank", message: `Expense bank updated: ${existing.name} - ${existing.account} → ${name} - ${account}`, actorUserId: req.user?.userId, tenantId });
        }
        catch { }
        const rows = await db.expenseBanks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        res.json({ expenseBanks: rows.map((r) => ({ id: r.id, name: r.name, account: r.account, balance: Number(r.balance || 0) })) });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to update expense bank account" });
    }
});
router.delete("/expense-banks", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requireFeature)("accounts"), async (req, res) => {
    try {
        const Body = zod_1.z.object({ id: zod_1.z.string().min(1) });
        const { id } = Body.parse(req.body || {});
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        const tenantId = headerTenant || req.tenantId || req.user?.tenantId || "default";
        const db = prisma_1.default;
        const existing = await db.expenseBanks.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense bank account not found" });
            return;
        }
        await db.expenseBanks.delete({ where: { id } });
        try {
            (0, notificationService_1.appendNotification)({ type: "expenseBank", message: `Expense bank removed: ${existing.name} - ${existing.account}`, actorUserId: req.user?.userId, tenantId });
        }
        catch { }
        const rows = await db.expenseBanks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        res.json({ expenseBanks: rows.map((r) => ({ id: r.id, name: r.name, account: r.account, balance: Number(r.balance || 0) })) });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to delete expense bank account" });
    }
});
// Reset opening stock
router.post("/reset-opening-stock", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, productController_1.resetOpeningStock);
router.post("/reset-all-opening-stock", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, productController_1.resetAllOpeningStock);
// Generate closing snapshots (month-end)
router.post("/generate-closing-snapshot", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, productController_1.generateClosingSnapshot);
// Download full backup
router.get("/backup", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, backupController_1.downloadBackup);
// Restore full backup
router.post("/restore", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, backupController_1.restoreBackup);
exports.default = router;
