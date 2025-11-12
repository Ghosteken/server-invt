"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readExpenses = readExpenses;
exports.appendExpense = appendExpense;
exports.updateExpense = updateExpense;
exports.deleteExpense = deleteExpense;
exports.readExpenseCategories = readExpenseCategories;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const crypto_1 = require("crypto");
const SEED_DIR = node_path_1.default.join(__dirname, "../../prisma/seedData");
const EXPENSES_PATH = node_path_1.default.join(SEED_DIR, "expenses.json");
const CATEGORIES_PATH = node_path_1.default.join(SEED_DIR, "expenseCategories.json");
function ensureSeedDir() {
    if (!node_fs_1.default.existsSync(SEED_DIR))
        node_fs_1.default.mkdirSync(SEED_DIR, { recursive: true });
}
function readExpenses() {
    try {
        ensureSeedDir();
        if (!node_fs_1.default.existsSync(EXPENSES_PATH)) {
            node_fs_1.default.writeFileSync(EXPENSES_PATH, "[]", "utf-8");
            return [];
        }
        const raw = node_fs_1.default.readFileSync(EXPENSES_PATH, "utf-8").trim();
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed;
    }
    catch {
        return [];
    }
}
function appendExpense(entry) {
    const list = readExpenses();
    const full = {
        id: entry.id || (0, crypto_1.randomUUID)(),
        category: String(entry.category || "").trim(),
        name: String(entry.name || "").trim(),
        amount: Number(entry.amount) || 0,
        date: entry.date || new Date().toISOString(),
    };
    const next = [...list, full];
    try {
        ensureSeedDir();
        node_fs_1.default.writeFileSync(EXPENSES_PATH, JSON.stringify(next, null, 2), "utf-8");
    }
    catch {
        // ignore write failures
    }
    return full;
}
function updateExpense(id, changes) {
    const list = readExpenses();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1)
        return null;
    const prev = list[idx];
    const next = {
        ...prev,
        ...(changes.category !== undefined ? { category: String(changes.category).trim() } : {}),
        ...(changes.name !== undefined ? { name: String(changes.name).trim() } : {}),
        ...(changes.amount !== undefined ? { amount: Number(changes.amount) || 0 } : {}),
        ...(changes.date !== undefined ? { date: String(changes.date) } : {}),
    };
    const newList = [...list];
    newList[idx] = next;
    try {
        ensureSeedDir();
        node_fs_1.default.writeFileSync(EXPENSES_PATH, JSON.stringify(newList, null, 2), "utf-8");
    }
    catch {
        // ignore write failures
    }
    return next;
}
function deleteExpense(id) {
    const list = readExpenses();
    const newList = list.filter((e) => e.id !== id);
    if (newList.length === list.length)
        return false;
    try {
        ensureSeedDir();
        node_fs_1.default.writeFileSync(EXPENSES_PATH, JSON.stringify(newList, null, 2), "utf-8");
    }
    catch {
        // ignore write failures
    }
    return true;
}
function readExpenseCategories() {
    try {
        ensureSeedDir();
        if (!node_fs_1.default.existsSync(CATEGORIES_PATH))
            return [];
        const raw = node_fs_1.default.readFileSync(CATEGORIES_PATH, "utf-8").trim();
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed;
    }
    catch {
        return [];
    }
}
