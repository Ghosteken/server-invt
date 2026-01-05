"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importExpenseCategories = exports.createExpenseCategory = exports.getExpenseCategories = exports.revokeExpense = exports.rejectExpense = exports.approveExpense = exports.deleteExpenseController = exports.updateExpenseController = exports.createExpense = exports.listExpenses = exports.getExpensesByCategory = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const XLSX = __importStar(require("xlsx"));
const crypto_1 = require("crypto");
const notificationService_1 = require("../services/notificationService");
const errorHandler_1 = require("../utils/errorHandler");
// Use shared Prisma client
const getExpensesByCategory = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const expenseByCategorySummaryRaw = await prisma_1.default.expenseByCategory.findMany({
            where: { tenantId },
            orderBy: {
                date: "desc",
            },
        });
        const expenseByCategorySummary = expenseByCategorySummaryRaw.map((item) => ({
            ...item,
            amount: item.amount.toString(),
        }));
        res.json(expenseByCategorySummary);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Error retrieving expenses by category"));
    }
};
exports.getExpensesByCategory = getExpensesByCategory;
/**
 * List individual expenses (JSON-backed store) with optional filters.
 * Query params: category, from, to.
 */
const listExpenses = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const category = String(req.query.category || "").trim();
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const where = { tenantId };
        if (category)
            where.category = { contains: category, mode: "insensitive" };
        if (from || to) {
            where.timestamp = {};
            if (from)
                where.timestamp.gte = from;
            if (to)
                where.timestamp.lte = to;
        }
        const rows = await prisma_1.default.expenses.findMany({ where, orderBy: { timestamp: "desc" } });
        const expenses = rows.map((r) => ({
            id: r.expenseId,
            category: r.category,
            name: r.category,
            amount: r.amount,
            date: r.timestamp.toISOString().slice(0, 10),
            status: r.status || "pending",
        }));
        res.json({ expenses });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Error retrieving expenses"));
    }
};
exports.listExpenses = listExpenses;
/**
 * Create an expense entry (stored in JSON-backed store).
 * Body: { category: string; name: string; amount: number; date?: string }
 */
const createExpense = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const body = req.body || {};
        const category = String(body.category || "").trim();
        const name = String(body.name || "").trim();
        const amount = Number(body.amount) || 0;
        const date = body.date ? new Date(String(body.date)) : new Date();
        if (!category || !name || !amount) {
            res.status(400).json({ message: "category, name, and amount are required" });
            return;
        }
        const created = await prisma_1.default.expenses.create({ data: { expenseId: (0, crypto_1.randomUUID)(), category, amount, timestamp: date, tenantId, status: "pending" } });
        // appendNotification({ type: "expense", message: `Created expense '${name}' (${category}) ₦${amount.toLocaleString("en")}` });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:created", { id: created.expenseId, category, name, amount, date: date.toISOString().slice(0, 10), status: "pending" });
        }
        res.status(201).json({ expense: { id: created.expenseId, category, name, amount, date: date.toISOString().slice(0, 10), status: "pending" } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to create expense"));
    }
};
exports.createExpense = createExpense;
/**
 * Update an expense entry (JSON-backed store).
 * Params: id
 * Body: { category?: string; name?: string; amount?: number; date?: string }
 */
const updateExpenseController = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const existing = await prisma_1.default.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        const changes = req.body || {};
        const data = {};
        if (changes.category !== undefined)
            data.category = String(changes.category).trim();
        if (changes.amount !== undefined)
            data.amount = Number(changes.amount) || 0;
        if (changes.date !== undefined)
            data.timestamp = new Date(String(changes.date));
        const next = await prisma_1.default.expenses.update({ where: { expenseId: id }, data });
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Updated expense '${existing.category}' (${next.category}) to ₦${Number(next.amount || 0).toLocaleString("en")}` });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:updated", { id: next.expenseId, category: next.category, name: next.category, amount: next.amount, date: next.timestamp.toISOString().slice(0, 10), status: next.status });
        }
        res.json({ expense: { id: next.expenseId, category: next.category, name: next.category, amount: next.amount, date: next.timestamp.toISOString().slice(0, 10), status: next.status } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to update expense"));
    }
};
exports.updateExpenseController = updateExpenseController;
/**
 * Delete an expense entry (JSON-backed store).
 * Params: id
 */
const deleteExpenseController = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const existing = await prisma_1.default.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        await prisma_1.default.expenses.delete({ where: { expenseId: id } });
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Deleted expense ${id}` });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:deleted", { id });
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to delete expense"));
    }
};
exports.deleteExpenseController = deleteExpenseController;
/**
 * Approve an expense (writes to audit logs for traceability).
 */
const approveExpense = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const existing = await prisma_1.default.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        await prisma_1.default.expenses.update({
            where: { expenseId: id },
            data: { status: "approved" },
        });
        await prisma_1.default.auditLogs.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                tenantId,
                actorUserId: req.user?.userId || undefined,
                action: "expense.approve",
                resourceType: "expense",
                resourceId: id,
                payload: { amount: existing.amount, category: existing.category },
            },
        });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:updated", { id, status: "approved" });
        }
        res.json({ expense: { id, status: "approved" } });
    }
    catch {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(null, "expense", "Failed to approve expense"));
    }
};
exports.approveExpense = approveExpense;
/**
 * Reject an expense (writes to audit logs for traceability).
 */
const rejectExpense = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const existing = await prisma_1.default.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        await prisma_1.default.expenses.update({
            where: { expenseId: id },
            data: { status: "rejected" },
        });
        await prisma_1.default.auditLogs.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                tenantId,
                actorUserId: req.user?.userId || undefined,
                action: "expense.reject",
                resourceType: "expense",
                resourceId: id,
                payload: { amount: existing.amount, category: existing.category },
            },
        });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:updated", { id, status: "rejected" });
        }
        res.json({ expense: { id, status: "rejected" } });
    }
    catch {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(null, "expense", "Failed to reject expense"));
    }
};
exports.rejectExpense = rejectExpense;
/**
 * Revoke an expense approval/rejection (sets back to pending).
 */
const revokeExpense = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const existing = await prisma_1.default.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        await prisma_1.default.expenses.update({
            where: { expenseId: id },
            data: { status: "pending" },
        });
        await prisma_1.default.auditLogs.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                tenantId,
                actorUserId: req.user?.userId || undefined,
                action: "expense.revoke",
                resourceType: "expense",
                resourceId: id,
                payload: { amount: existing.amount, category: existing.category },
            },
        });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:updated", { id, status: "pending" });
        }
        res.json({ expense: { id, status: "pending" } });
    }
    catch {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(null, "expense", "Failed to revoke expense"));
    }
};
exports.revokeExpense = revokeExpense;
/**
 * Get expense categories from seed JSON.
 */
const getExpenseCategories = async (_req, res) => {
    try {
        const reqAny = _req;
        const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
        const rows = await prisma_1.default.expenseByCategory.findMany({ where: { tenantId }, select: { category: true } });
        const categories = Array.from(new Set(rows.map((r) => (r.category || "").toLowerCase()).filter(Boolean)));
        res.json({ categories });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to load expense categories"));
    }
};
exports.getExpenseCategories = getExpenseCategories;
/**
 * Create a new expense category for the current tenant.
 * Body: { name: string }
 * This inserts a zero-amount ExpenseSummary and an ExpenseByCategory row,
 * ensuring the category appears in dropdowns immediately.
 */
const createExpenseCategory = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const nameRaw = String((req.body || {}).name || "").trim();
        if (!nameRaw) {
            res.status(400).json({ message: "Category name is required" });
            return;
        }
        const category = nameRaw.toLowerCase();
        const exists = await prisma_1.default.expenseByCategory.findFirst({ where: { tenantId, category } });
        if (!exists) {
            const summaryId = (0, crypto_1.randomUUID)();
            const now = new Date();
            await prisma_1.default.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now, tenantId } });
            await prisma_1.default.expenseByCategory.create({ data: { expenseByCategoryId: (0, crypto_1.randomUUID)(), expenseSummaryId: summaryId, category, amount: BigInt(0), date: now, tenantId } });
        }
        res.status(201).json({ category });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to create expense category"));
    }
};
exports.createExpenseCategory = createExpenseCategory;
/**
 * Import expenses categories from an uploaded Excel file.
 * Expected header: "Category name" (case-insensitive). Writes to seed JSON and upserts
 * a zero-amount ExpenseSummary with corresponding ExpenseByCategory entries.
 */
const importExpenseCategories = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        const norm = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const categories = [];
        for (const row of rows) {
            const kv = {};
            for (const k of Object.keys(row))
                kv[norm(k)] = row[k];
            const cat = kv["category name"] ?? kv["category"] ?? kv["name"];
            if (!cat)
                continue;
            const cleaned = String(cat).trim();
            if (!cleaned)
                continue;
            categories.push(cleaned);
        }
        const unique = Array.from(new Set(categories.map((c) => c.toLowerCase())));
        // Upsert a zero-amount summary and related category entries in DB
        const summaryId = (0, crypto_1.randomUUID)();
        const now = new Date();
        await prisma_1.default.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now, tenantId } });
        for (const catLower of unique) {
            try {
                await prisma_1.default.expenseByCategory.create({
                    data: {
                        expenseByCategoryId: (0, crypto_1.randomUUID)(),
                        expenseSummaryId: summaryId,
                        category: catLower,
                        amount: BigInt(0),
                        date: now,
                        tenantId,
                    },
                });
            }
            catch (e) {
                console.warn("Failed to insert ExpenseByCategory for", catLower, e);
            }
        }
        res.json({ importedCategories: unique.length });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to import expense categories"));
    }
};
exports.importExpenseCategories = importExpenseCategories;
