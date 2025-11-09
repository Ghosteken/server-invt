import { Request, Response } from "express";
import prisma from "../db/prisma";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
import { appendExpense, readExpenses, readExpenseCategories, updateExpense, deleteExpense } from "../services/expensesService";
import { appendNotification } from "../services/notificationService";

// Use shared Prisma client

export const getExpensesByCategory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const expenseByCategorySummaryRaw = await prisma.expenseByCategory.findMany(
      {
        orderBy: {
          date: "desc",
        },
      }
    );
    const expenseByCategorySummary = expenseByCategorySummaryRaw.map(
      (item: { amount: { toString: () => string } }) => ({
        ...item,
        amount: item.amount.toString(),
      })
    );

    res.json(expenseByCategorySummary);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving expenses by category" });
  }
};

/**
 * List individual expenses (JSON-backed store) with optional filters.
 * Query params: category, from, to.
 */
export const listExpenses = async (req: Request, res: Response): Promise<void> => {
  try {
    const category = String(req.query.category || "").trim().toLowerCase();
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const all = readExpenses();
    const filtered = all.filter((e) => {
      if (category && e.category.toLowerCase() !== category) return false;
      const d = new Date(e.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    res.json({ expenses: filtered });
  } catch (err) {
    res.status(500).json({ message: "Error retrieving expenses" });
  }
};

/**
 * Create an expense entry (stored in JSON-backed store).
 * Body: { category: string; name: string; amount: number; date?: string }
 */
export const createExpense = async (req: Request, res: Response): Promise<void> => {
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
    const saved = appendExpense({ category, name, amount, date });
    // Notify: expense created
    appendNotification({ type: "expense", message: `Created expense '${name}' (${category}) ₦${amount.toLocaleString("en")}` });
    res.status(201).json({ expense: saved });
  } catch (err) {
    res.status(500).json({ message: "Failed to create expense" });
  }
};

/**
 * Update an expense entry (JSON-backed store).
 * Params: id
 * Body: { category?: string; name?: string; amount?: number; date?: string }
 */
export const updateExpenseController = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ message: "Missing expense id" });
      return;
    }
    const changes = req.body || {};
    const updated = updateExpense(id, changes);
    if (!updated) {
      res.status(404).json({ message: "Expense not found" });
      return;
    }
    // Notify: expense updated
    appendNotification({ type: "expense", message: `Updated expense '${updated.name}' (${updated.category}) to ₦${Number(updated.amount || 0).toLocaleString("en")}` });
    res.json({ expense: updated });
  } catch (err) {
    res.status(500).json({ message: "Failed to update expense" });
  }
};

/**
 * Delete an expense entry (JSON-backed store).
 * Params: id
 */
export const deleteExpenseController = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ message: "Missing expense id" });
      return;
    }
    const ok = deleteExpense(id);
    if (!ok) {
      res.status(404).json({ message: "Expense not found" });
      return;
    }
    // Notify: expense deleted
    appendNotification({ type: "expense", message: `Deleted expense ${id}` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete expense" });
  }
};

/**
 * Get expense categories from seed JSON.
 */
export const getExpenseCategories = async (_req: Request, res: Response): Promise<void> => {
  try {
    const cats = readExpenseCategories();
    res.json({ categories: cats.map((c) => c.name) });
  } catch (err) {
    res.status(500).json({ message: "Failed to load expense categories" });
  }
};

/**
 * Import expenses categories from an uploaded Excel file.
 * Expected header: "Category name" (case-insensitive). Writes to seed JSON and upserts
 * a zero-amount ExpenseSummary with corresponding ExpenseByCategory entries.
 */
export const importExpenseCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
      return;
    }
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    const norm = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();

    const categories: string[] = [];
    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[norm(k)] = row[k];
      const cat = kv["category name"] ?? kv["category"] ?? kv["name"];
      if (!cat) continue;
      const cleaned = String(cat).trim();
      if (!cleaned) continue;
      categories.push(cleaned);
    }
    const unique = Array.from(new Set(categories.map((c) => c.toLowerCase())));

    // Persist to seed JSON
    try {
      const seedDir = path.join(__dirname, "../../prisma/seedData");
      const outPath = path.join(seedDir, "expenseCategories.json");
      if (!fs.existsSync(seedDir)) fs.mkdirSync(seedDir, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(unique.map((c) => ({ name: c })), null, 2), "utf-8");
    } catch (persistErr) {
      console.warn("Failed to persist expense categories to JSON:", persistErr);
    }

    // Upsert a zero-amount summary and related category entries in DB
    const summaryId = randomUUID();
    const now = new Date();
    await prisma.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now } });
    for (const catLower of unique) {
      try {
        await prisma.expenseByCategory.create({
          data: {
            expenseByCategoryId: randomUUID(),
            expenseSummaryId: summaryId,
            category: catLower,
            amount: BigInt(0),
            date: now,
          },
        });
      } catch (e) {
        console.warn("Failed to insert ExpenseByCategory for", catLower, e);
      }
    }

    res.json({ importedCategories: unique.length });
  } catch (error) {
    console.error("importExpenseCategories error:", error);
    res.status(500).json({ message: "Failed to import expense categories" });
  }
};
