import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";

type ExpenseEntry = {
  id: string;
  category: string;
  name: string;
  amount: number;
  date: string; // ISO date
};

const SEED_DIR = path.join(__dirname, "../../prisma/seedData");
const EXPENSES_PATH = path.join(SEED_DIR, "expenses.json");
const CATEGORIES_PATH = path.join(SEED_DIR, "expenseCategories.json");

function ensureSeedDir() {
  if (!fs.existsSync(SEED_DIR)) fs.mkdirSync(SEED_DIR, { recursive: true });
}

export function readExpenses(): ExpenseEntry[] {
  try {
    ensureSeedDir();
    if (!fs.existsSync(EXPENSES_PATH)) {
      fs.writeFileSync(EXPENSES_PATH, "[]", "utf-8");
      return [];
    }
    const raw = fs.readFileSync(EXPENSES_PATH, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ExpenseEntry[];
  } catch {
    return [];
  }
}

export function appendExpense(entry: Omit<ExpenseEntry, "id"> & { id?: string }): ExpenseEntry {
  const list = readExpenses();
  const full: ExpenseEntry = {
    id: entry.id || randomUUID(),
    category: String(entry.category || "").trim(),
    name: String(entry.name || "").trim(),
    amount: Number(entry.amount) || 0,
    date: entry.date || new Date().toISOString(),
  };
  const next = [...list, full];
  try {
    ensureSeedDir();
    fs.writeFileSync(EXPENSES_PATH, JSON.stringify(next, null, 2), "utf-8");
  } catch {
    // ignore write failures
  }
  return full;
}

export function updateExpense(id: string, changes: Partial<Omit<ExpenseEntry, "id">>): ExpenseEntry | null {
  const list = readExpenses();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const prev = list[idx];
  const next: ExpenseEntry = {
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
    fs.writeFileSync(EXPENSES_PATH, JSON.stringify(newList, null, 2), "utf-8");
  } catch {
    // ignore write failures
  }
  return next;
}

export function deleteExpense(id: string): boolean {
  const list = readExpenses();
  const newList = list.filter((e) => e.id !== id);
  if (newList.length === list.length) return false;
  try {
    ensureSeedDir();
    fs.writeFileSync(EXPENSES_PATH, JSON.stringify(newList, null, 2), "utf-8");
  } catch {
    // ignore write failures
  }
  return true;
}

export function readExpenseCategories(): Array<{ name: string }> {
  try {
    ensureSeedDir();
    if (!fs.existsSync(CATEGORIES_PATH)) return [];
    const raw = fs.readFileSync(CATEGORIES_PATH, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Array<{ name: string }>;
  } catch {
    return [];
  }
}

export type { ExpenseEntry };