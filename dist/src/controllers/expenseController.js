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
exports.importExpenseCategories = exports.createExpenseCategory = exports.getExpenseCategories = exports.revokeExpense = exports.rejectExpense = exports.approveExpense = exports.exportExpensesExcel = exports.deleteExpenseController = exports.updateExpenseController = exports.createExpense = exports.listExpenses = exports.getExpensesByCategory = void 0;
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
        if (to) {
            to.setHours(23, 59, 59, 999);
        }
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
        const db = prisma_1.default;
        const rows = await db.expenses.findMany({ where, include: { expenseBank: true }, orderBy: { timestamp: "desc" } });
        const expenses = rows.map((r) => ({
            id: r.expenseId,
            category: r.category,
            name: String(r.name || "").trim() || r.category,
            amount: r.amount,
            date: r.timestamp.toISOString().slice(0, 10),
            status: r.status || "pending",
            expenseBankId: r.expenseBankId ?? undefined,
            expenseBankName: r.expenseBank?.name ?? undefined,
            expenseBankAccount: r.expenseBank?.account ?? undefined,
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
        const expenseBankIdRaw = body.expenseBankId !== undefined ? String(body.expenseBankId || "").trim() : "";
        const expenseBankId = expenseBankIdRaw || null;
        if (!category || !name || !amount) {
            res.status(400).json({ message: "category, name, and amount are required" });
            return;
        }
        const db = prisma_1.default;
        const created = await db.$transaction(async (tx) => {
            let bank = null;
            if (expenseBankId) {
                bank = await tx.expenseBanks.findFirst({ where: { id: expenseBankId, tenantId } });
                if (!bank) {
                    res.status(400).json({ message: "Selected expense bank account not found" });
                    return null;
                }
                const bal = Number(bank.balance || 0);
                if (bal < amount) {
                    res.status(400).json({ message: "Insufficient balance in selected expense bank account" });
                    return null;
                }
                await tx.expenseBanks.update({ where: { id: bank.id }, data: { balance: bal - amount } });
            }
            const exp = await tx.expenses.create({ data: { expenseId: (0, crypto_1.randomUUID)(), category, name, amount, timestamp: date, tenantId, status: "pending", expenseBankId } });
            return exp;
        });
        if (!created)
            return;
        // appendNotification({ type: "expense", message: `Created expense '${name}' (${category}) ₦${amount.toLocaleString("en")}` });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:created", { id: created.expenseId, category, name, amount, date: date.toISOString().slice(0, 10), status: "pending", expenseBankId: created.expenseBankId ?? undefined });
        }
        res.status(201).json({ expense: { id: created.expenseId, category, name, amount, date: date.toISOString().slice(0, 10), status: "pending", expenseBankId: created.expenseBankId ?? undefined } });
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
        const db = prisma_1.default;
        const existing = await db.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        const changes = req.body || {};
        const nextCategory = changes.category !== undefined ? String(changes.category).trim() : existing.category;
        const nextName = changes.name !== undefined ? String(changes.name).trim() : existing.name;
        const nextAmount = changes.amount !== undefined ? Number(changes.amount) || 0 : Number(existing.amount || 0);
        const nextTimestamp = changes.date !== undefined ? new Date(String(changes.date)) : existing.timestamp;
        const nextExpenseBankId = changes.expenseBankId !== undefined ? (String(changes.expenseBankId || "").trim() || null) : (existing.expenseBankId ?? null);
        const oldAmount = Number(existing.amount || 0);
        const oldExpenseBankId = existing.expenseBankId ?? null;
        const next = await db.$transaction(async (tx) => {
            if (oldExpenseBankId && oldExpenseBankId === nextExpenseBankId) {
                const delta = nextAmount - oldAmount;
                if (delta !== 0) {
                    const bank = await tx.expenseBanks.findFirst({ where: { id: oldExpenseBankId, tenantId } });
                    if (!bank) {
                        res.status(400).json({ message: "Selected expense bank account not found" });
                        return null;
                    }
                    const bal = Number(bank.balance || 0);
                    if (delta > 0 && bal < delta) {
                        res.status(400).json({ message: "Insufficient balance in selected expense bank account" });
                        return null;
                    }
                    await tx.expenseBanks.update({ where: { id: bank.id }, data: { balance: bal - delta } });
                }
            }
            else {
                if (oldExpenseBankId) {
                    const oldBank = await tx.expenseBanks.findFirst({ where: { id: oldExpenseBankId, tenantId } });
                    if (oldBank) {
                        const bal = Number(oldBank.balance || 0);
                        await tx.expenseBanks.update({ where: { id: oldBank.id }, data: { balance: bal + oldAmount } });
                    }
                }
                if (nextExpenseBankId) {
                    const newBank = await tx.expenseBanks.findFirst({ where: { id: nextExpenseBankId, tenantId } });
                    if (!newBank) {
                        res.status(400).json({ message: "Selected expense bank account not found" });
                        return null;
                    }
                    const bal = Number(newBank.balance || 0);
                    if (bal < nextAmount) {
                        res.status(400).json({ message: "Insufficient balance in selected expense bank account" });
                        return null;
                    }
                    await tx.expenseBanks.update({ where: { id: newBank.id }, data: { balance: bal - nextAmount } });
                }
            }
            const data = {
                category: nextCategory,
                name: nextName,
                amount: nextAmount,
                timestamp: nextTimestamp,
                expenseBankId: nextExpenseBankId,
            };
            return tx.expenses.update({ where: { expenseId: id }, data });
        });
        if (!next)
            return;
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Updated expense '${existing.category}' (${next.category}) to ₦${Number(next.amount || 0).toLocaleString("en")}`, tenantId, actorUserId: req.user?.userId });
        // Emit socket event
        const io = req.app.get("io");
        if (io) {
            io.emit("expense:updated", { id: next.expenseId, category: next.category, name: next.name || next.category, amount: next.amount, date: next.timestamp.toISOString().slice(0, 10), status: next.status, expenseBankId: next.expenseBankId ?? undefined });
        }
        res.json({ expense: { id: next.expenseId, category: next.category, name: next.name || next.category, amount: next.amount, date: next.timestamp.toISOString().slice(0, 10), status: next.status, expenseBankId: next.expenseBankId ?? undefined } });
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
        const db = prisma_1.default;
        const existing = await db.expenses.findFirst({ where: { expenseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        await db.$transaction(async (tx) => {
            const amt = Number(existing.amount || 0);
            const bankId = existing.expenseBankId ?? null;
            if (bankId) {
                const bank = await tx.expenseBanks.findFirst({ where: { id: bankId, tenantId } });
                if (bank) {
                    const bal = Number(bank.balance || 0);
                    await tx.expenseBanks.update({ where: { id: bank.id }, data: { balance: bal + amt } });
                }
            }
            await tx.expenses.delete({ where: { expenseId: id } });
        });
        const desc = existing.category || "Uncategorized";
        const amt = Number(existing.amount || 0).toLocaleString("en");
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Deleted expense: ${desc} (₦${amt})`, tenantId, actorUserId: req.user?.userId });
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
// Export expenses as Excel
const exportExpensesExcel = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const db = prisma_1.default;
        const rows = await db.expenses.findMany({ where: { tenantId }, include: { expenseBank: true }, orderBy: { timestamp: "desc" } });
        const mapped = (rows || []).map((r) => ({
            Date: r.timestamp instanceof Date ? r.timestamp.toISOString().slice(0, 10) : "",
            Category: r.category ?? "",
            Name: String(r.name || "").trim() || r.category || "",
            Amount: Number(r.amount || 0),
            Status: r.status || "pending",
            ExpenseBankName: r.expenseBank?.name ?? "",
            ExpenseBankAccount: r.expenseBank?.account ?? "",
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(mapped, { header: ["Date", "Category", "Name", "Amount", "Status", "ExpenseBankName", "ExpenseBankAccount"] });
        XLSX.utils.book_append_sheet(wb, ws, "Expenses");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=expenses.xlsx");
        res.status(200).send(buf);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "expense", "Failed to export expenses as Excel"));
    }
};
exports.exportExpensesExcel = exportExpensesExcel;
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
