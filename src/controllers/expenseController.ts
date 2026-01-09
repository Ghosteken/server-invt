import { Request, Response } from "express";
import prisma from "../db/prisma";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
import { appendExpense, readExpenses, readExpenseCategories, updateExpense, deleteExpense } from "../services/expensesService";
import { appendNotification } from "../services/notificationService";
import { createErrorResponse } from "../utils/errorHandler";

// Use shared Prisma client

export const getExpensesByCategory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const expenseByCategorySummaryRaw = await prisma.expenseByCategory.findMany(
      {
        where: { tenantId },
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
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Error retrieving expenses by category"));
  }
};

/**
 * List individual expenses (JSON-backed store) with optional filters.
 * Query params: category, from, to.
 */
export const listExpenses = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const category = String(req.query.category || "").trim();
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    
    if (to) {
      to.setHours(23, 59, 59, 999);
    }

    const where: any = { tenantId };
    if (category) where.category = { contains: category, mode: "insensitive" };
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }
    const rows = await prisma.expenses.findMany({ where, orderBy: { timestamp: "desc" } });
    
    const expenses = rows.map((r: { expenseId: string; category: string | null; amount: number; timestamp: Date; status: string }) => ({
      id: r.expenseId,
      category: r.category,
      name: r.category,
      amount: r.amount,
      date: r.timestamp.toISOString().slice(0, 10),
      status: r.status || "pending",
    }));
    res.json({ expenses });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Error retrieving expenses"));
  }
};

/**
 * Create an expense entry (stored in JSON-backed store).
 * Body: { category: string; name: string; amount: number; date?: string }
 */
export const createExpense = async (req: Request, res: Response): Promise<void> => {
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
    const created = await prisma.expenses.create({ data: { expenseId: randomUUID(), category, amount, timestamp: date, tenantId, status: "pending" } });
    // appendNotification({ type: "expense", message: `Created expense '${name}' (${category}) ₦${amount.toLocaleString("en")}` });
    
    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("expense:created", { id: created.expenseId, category, name, amount, date: date.toISOString().slice(0, 10), status: "pending" });
    }

    res.status(201).json({ expense: { id: created.expenseId, category, name, amount, date: date.toISOString().slice(0, 10), status: "pending" } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Failed to create expense"));
  }
};

/**
 * Update an expense entry (JSON-backed store).
 * Params: id
 * Body: { category?: string; name?: string; amount?: number; date?: string }
 */
export const updateExpenseController = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ message: "Missing expense id" });
      return;
    }
    const existing = await prisma.expenses.findFirst({ where: { expenseId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Expense not found" }); return; }
    const changes = req.body || {};
    const data: any = {};
    if (changes.category !== undefined) data.category = String(changes.category).trim();
    if (changes.amount !== undefined) data.amount = Number(changes.amount) || 0;
    if (changes.date !== undefined) data.timestamp = new Date(String(changes.date));
    const next = await prisma.expenses.update({ where: { expenseId: id }, data });
    appendNotification({ type: "expense", message: `Updated expense '${existing.category}' (${next.category}) to ₦${Number(next.amount || 0).toLocaleString("en")}`, tenantId, actorUserId: req.user?.userId });
    
    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("expense:updated", { id: next.expenseId, category: next.category, name: next.category, amount: next.amount, date: next.timestamp.toISOString().slice(0, 10), status: next.status });
    }

    res.json({ expense: { id: next.expenseId, category: next.category, name: next.category, amount: next.amount, date: next.timestamp.toISOString().slice(0, 10), status: next.status } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Failed to update expense"));
  }
};

/**
 * Delete an expense entry (JSON-backed store).
 * Params: id
 */
export const deleteExpenseController = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ message: "Missing expense id" });
      return;
    }
    const existing = await prisma.expenses.findFirst({ where: { expenseId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Expense not found" }); return; }
    await prisma.expenses.delete({ where: { expenseId: id } });
    
    const desc = existing.category || "Uncategorized";
    const amt = Number(existing.amount || 0).toLocaleString("en");
    appendNotification({ type: "expense", message: `Deleted expense: ${desc} (₦${amt})`, tenantId, actorUserId: req.user?.userId });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("expense:deleted", { id });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Failed to delete expense"));
  }
};

/**
 * Approve an expense (writes to audit logs for traceability).
 */
export const approveExpense = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ message: "Missing expense id" }); return; }
    const existing = await prisma.expenses.findFirst({ where: { expenseId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Expense not found" }); return; }
    
    await prisma.expenses.update({
      where: { expenseId: id },
      data: { status: "approved" },
    });

    await prisma.auditLogs.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorUserId: req.user?.userId || undefined,
        action: "expense.approve",
        resourceType: "expense",
        resourceId: id,
        payload: { amount: existing.amount, category: existing.category },
      } as any,
    });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("expense:updated", { id, status: "approved" });
    }

    res.json({ expense: { id, status: "approved" } });
  } catch {
    res.status(500).json(createErrorResponse(null, "expense", "Failed to approve expense"));
  }
};

/**
 * Reject an expense (writes to audit logs for traceability).
 */
export const rejectExpense = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ message: "Missing expense id" }); return; }
    const existing = await prisma.expenses.findFirst({ where: { expenseId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Expense not found" }); return; }

    await prisma.expenses.update({
      where: { expenseId: id },
      data: { status: "rejected" },
    });

    await prisma.auditLogs.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorUserId: req.user?.userId || undefined,
        action: "expense.reject",
        resourceType: "expense",
        resourceId: id,
        payload: { amount: existing.amount, category: existing.category },
      } as any,
    });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("expense:updated", { id, status: "rejected" });
    }

    res.json({ expense: { id, status: "rejected" } });
  } catch {
    res.status(500).json(createErrorResponse(null, "expense", "Failed to reject expense"));
  }
};

/**
 * Revoke an expense approval/rejection (sets back to pending).
 */
export const revokeExpense = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    if (!id) { res.status(400).json({ message: "Missing expense id" }); return; }
    const existing = await prisma.expenses.findFirst({ where: { expenseId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Expense not found" }); return; }

    await prisma.expenses.update({
      where: { expenseId: id },
      data: { status: "pending" },
    });

    await prisma.auditLogs.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorUserId: req.user?.userId || undefined,
        action: "expense.revoke",
        resourceType: "expense",
        resourceId: id,
        payload: { amount: existing.amount, category: existing.category },
      } as any,
    });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.emit("expense:updated", { id, status: "pending" });
    }

    res.json({ expense: { id, status: "pending" } });
  } catch {
    res.status(500).json(createErrorResponse(null, "expense", "Failed to revoke expense"));
  }
};

/**
 * Get expense categories from seed JSON.
 */
export const getExpenseCategories = async (_req: Request, res: Response): Promise<void> => {
  try {
    const reqAny = _req as any;
    const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
    const rows = await prisma.expenseByCategory.findMany({ where: { tenantId }, select: { category: true } });
    const categories = Array.from(new Set(rows.map((r: { category: string | null }) => (r.category || "").toLowerCase()).filter(Boolean)));
    res.json({ categories });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Failed to load expense categories"));
  }
};

/**
 * Create a new expense category for the current tenant.
 * Body: { name: string }
 * This inserts a zero-amount ExpenseSummary and an ExpenseByCategory row,
 * ensuring the category appears in dropdowns immediately.
 */
export const createExpenseCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const nameRaw = String((req.body || {}).name || "").trim();
    if (!nameRaw) { res.status(400).json({ message: "Category name is required" }); return; }
    const category = nameRaw.toLowerCase();
    const exists = await prisma.expenseByCategory.findFirst({ where: { tenantId, category } });
    if (!exists) {
      const summaryId = randomUUID();
      const now = new Date();
      await prisma.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now, tenantId } });
      await prisma.expenseByCategory.create({ data: { expenseByCategoryId: randomUUID(), expenseSummaryId: summaryId, category, amount: BigInt(0), date: now, tenantId } });
    }
    res.status(201).json({ category });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Failed to create expense category"));
  }
};

/**
 * Import expenses categories from an uploaded Excel file.
 * Expected header: "Category name" (case-insensitive). Writes to seed JSON and upserts
 * a zero-amount ExpenseSummary with corresponding ExpenseByCategory entries.
 */
export const importExpenseCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
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

    // Upsert a zero-amount summary and related category entries in DB
    const summaryId = randomUUID();
    const now = new Date();
    await prisma.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now, tenantId } });
    for (const catLower of unique) {
      try {
        await prisma.expenseByCategory.create({
          data: {
            expenseByCategoryId: randomUUID(),
            expenseSummaryId: summaryId,
            category: catLower,
            amount: BigInt(0),
            date: now,
            tenantId,
          },
        });
      } catch (e) {
        console.warn("Failed to insert ExpenseByCategory for", catLower, e);
      }
    }

    res.json({ importedCategories: unique.length });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "expense", "Failed to import expense categories"));
  }
};
