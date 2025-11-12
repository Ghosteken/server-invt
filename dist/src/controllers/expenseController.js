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
exports.importExpenseCategories = exports.getExpenseCategories = exports.deleteExpenseController = exports.updateExpenseController = exports.createExpense = exports.listExpenses = exports.getExpensesByCategory = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const XLSX = __importStar(require("xlsx"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const crypto_1 = require("crypto");
const expensesService_1 = require("../services/expensesService");
const notificationService_1 = require("../services/notificationService");
// Use shared Prisma client
const getExpensesByCategory = async (req, res) => {
    try {
        const expenseByCategorySummaryRaw = await prisma_1.default.expenseByCategory.findMany({
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
    catch (error) {
        res.status(500).json({ message: "Error retrieving expenses by category" });
    }
};
exports.getExpensesByCategory = getExpensesByCategory;
/**
 * List individual expenses (JSON-backed store) with optional filters.
 * Query params: category, from, to.
 */
const listExpenses = async (req, res) => {
    try {
        const category = String(req.query.category || "").trim().toLowerCase();
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const all = (0, expensesService_1.readExpenses)();
        const filtered = all.filter((e) => {
            if (category && e.category.toLowerCase() !== category)
                return false;
            const d = new Date(e.date);
            if (from && d < from)
                return false;
            if (to && d > to)
                return false;
            return true;
        });
        res.json({ expenses: filtered });
    }
    catch (err) {
        res.status(500).json({ message: "Error retrieving expenses" });
    }
};
exports.listExpenses = listExpenses;
/**
 * Create an expense entry (stored in JSON-backed store).
 * Body: { category: string; name: string; amount: number; date?: string }
 */
const createExpense = async (req, res) => {
    try {
        const body = req.body || {};
        const category = String(body.category || "").trim();
        const name = String(body.name || "").trim();
        const amount = Number(body.amount) || 0;
        // Ensure date is always a string to satisfy type requirements
        // If not provided, default to today's date (YYYY-MM-DD)
        const date = body.date ? String(body.date) : new Date().toISOString().slice(0, 10);
        if (!category || !name || !amount) {
            res.status(400).json({ message: "category, name, and amount are required" });
            return;
        }
        const saved = (0, expensesService_1.appendExpense)({ category, name, amount, date });
        // Notify: expense created
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Created expense '${name}' (${category}) ₦${amount.toLocaleString("en")}` });
        res.status(201).json({ expense: saved });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to create expense" });
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
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const changes = req.body || {};
        const updated = (0, expensesService_1.updateExpense)(id, changes);
        if (!updated) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        // Notify: expense updated
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Updated expense '${updated.name}' (${updated.category}) to ₦${Number(updated.amount || 0).toLocaleString("en")}` });
        res.json({ expense: updated });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to update expense" });
    }
};
exports.updateExpenseController = updateExpenseController;
/**
 * Delete an expense entry (JSON-backed store).
 * Params: id
 */
const deleteExpenseController = async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) {
            res.status(400).json({ message: "Missing expense id" });
            return;
        }
        const ok = (0, expensesService_1.deleteExpense)(id);
        if (!ok) {
            res.status(404).json({ message: "Expense not found" });
            return;
        }
        // Notify: expense deleted
        (0, notificationService_1.appendNotification)({ type: "expense", message: `Deleted expense ${id}` });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to delete expense" });
    }
};
exports.deleteExpenseController = deleteExpenseController;
/**
 * Get expense categories from seed JSON.
 */
const getExpenseCategories = async (_req, res) => {
    try {
        const cats = (0, expensesService_1.readExpenseCategories)();
        res.json({ categories: cats.map((c) => c.name) });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to load expense categories" });
    }
};
exports.getExpenseCategories = getExpenseCategories;
/**
 * Import expenses categories from an uploaded Excel file.
 * Expected header: "Category name" (case-insensitive). Writes to seed JSON and upserts
 * a zero-amount ExpenseSummary with corresponding ExpenseByCategory entries.
 */
const importExpenseCategories = async (req, res) => {
    try {
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
        // Persist to seed JSON
        try {
            const seedDir = node_path_1.default.join(__dirname, "../../prisma/seedData");
            const outPath = node_path_1.default.join(seedDir, "expenseCategories.json");
            if (!node_fs_1.default.existsSync(seedDir))
                node_fs_1.default.mkdirSync(seedDir, { recursive: true });
            node_fs_1.default.writeFileSync(outPath, JSON.stringify(unique.map((c) => ({ name: c })), null, 2), "utf-8");
        }
        catch (persistErr) {
            console.warn("Failed to persist expense categories to JSON:", persistErr);
        }
        // Upsert a zero-amount summary and related category entries in DB
        const summaryId = (0, crypto_1.randomUUID)();
        const now = new Date();
        await prisma_1.default.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now } });
        for (const catLower of unique) {
            try {
                await prisma_1.default.expenseByCategory.create({
                    data: {
                        expenseByCategoryId: (0, crypto_1.randomUUID)(),
                        expenseSummaryId: summaryId,
                        category: catLower,
                        amount: BigInt(0),
                        date: now,
                    },
                });
            }
            catch (e) {
                console.warn("Failed to insert ExpenseByCategory for", catLower, e);
            }
        }
        res.json({ importedCategories: unique.length });
    }
    catch (error) {
        console.error("importExpenseCategories error:", error);
        res.status(500).json({ message: "Failed to import expense categories" });
    }
};
exports.importExpenseCategories = importExpenseCategories;
