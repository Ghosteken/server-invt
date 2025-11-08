import { Request, Response } from "express";
import prisma from "../db/prisma";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";

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
