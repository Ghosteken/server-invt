import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { appendNotification } from "../services/notificationService";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

export const getProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const rawSearch = req.query.search?.toString() ?? "";
    const search = rawSearch.trim();

    // If a search term is provided, perform a case-insensitive contains match.
    // If no search term, return all products.
    const products = await prisma.products.findMany({
      where: search
        ? {
            name: {
              contains: search,
              mode: "insensitive",
            },
          }
        : undefined,
      orderBy: {
        name: "asc",
      },
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving products" });
  }
};

export const createProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { name, price, stockQuantity } = req.body;
    const product = await prisma.products.create({
      data: {
        productId: randomUUID(),
        name,
        price,
        stockQuantity,
      },
    });
    // Log notification for product creation
    appendNotification({
      type: "product",
      message: `Product created: ${name} (qty: ${stockQuantity})`,
      actorUserId: req.user?.userId,
    });
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: "Error creating product" });
  }
};

export const getProductById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const product = await prisma.products.findUnique({ where: { productId } });
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving product" });
  }
};

export const updateProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const { name, price, stockQuantity, expiryDate } = req.body;

    const existing = await prisma.products.findUnique({ where: { productId } });
    if (!existing) {
      res.status(404).json({ message: "Product not found" });
      return;
    }

    const data: any = {};
    if (typeof name === "string") data.name = name;
    if (price !== undefined && price !== null && !isNaN(Number(price))) data.price = Number(price);
    if (stockQuantity !== undefined && stockQuantity !== null && !isNaN(Number(stockQuantity))) data.stockQuantity = Number(stockQuantity);
    if (expiryDate !== undefined) {
      if (expiryDate === null || expiryDate === "") {
        data.expiryDate = null;
      } else {
        const d = new Date(expiryDate);
        if (isNaN(d.getTime())) {
          res.status(400).json({ message: "Invalid expiryDate" });
          return;
        }
        data.expiryDate = d;
      }
    }

    const updated = await prisma.products.update({ where: { productId }, data });
    appendNotification({
      type: "product",
      message: `Product updated: ${updated.name}`,
      actorUserId: req.user?.userId,
    });
    res.json(updated);
  } catch (error) {
    console.error("updateProduct error:", error);
    res.status(500).json({ message: "Error updating product" });
  }
};

export const exportProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const products = await prisma.products.findMany({ orderBy: { name: "asc" } });
    const json = JSON.stringify(products, null, 2);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=products.json");
    res.status(200).send(json);
  } catch (error) {
    console.error("exportProducts error:", error);
    res.status(500).json({ message: "Failed to export products" });
  }
};

/**
 * Bulk import products from an uploaded Excel file.
 * Accepts a single file under field name "file". The Excel sheet should contain
 * columns that map to product fields. Supported column headers (case-insensitive):
 * - productId | id | sku (optional; if missing, a UUID is generated)
 * - name (required)
 * - price (required)
 * - rating (optional)
 * - stockQuantity | quantity (required)
 */
export const importProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
      return;
    }

    // Parse Excel buffer
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    if (!rows.length) {
      res.status(400).json({ message: "Uploaded sheet is empty." });
      return;
    }

    // Normalize header keys to lower-case for flexible matching
    const normalizeKey = (k: string) => k.toString().trim().toLowerCase();

    const productsToInsert = rows
      .map((row) => {
        const keys = Object.keys(row);
        const kv: Record<string, any> = {};
        for (const k of keys) kv[normalizeKey(k)] = row[k];

        const productId = kv["productid"] ?? kv["id"] ?? kv["sku"] ?? randomUUID();
        const name = kv["name"];
        const priceRaw = kv["price"];
        const stockRaw = kv["stockquantity"] ?? kv["quantity"];

        // Basic validation
        if (!name || priceRaw === null || priceRaw === undefined || stockRaw === null || stockRaw === undefined) {
          return null; // skip invalid rows
        }

        const price = typeof priceRaw === "string" ? parseFloat(priceRaw) : Number(priceRaw);
        const stockQuantity = typeof stockRaw === "string" ? parseInt(stockRaw, 10) : Number(stockRaw);

        if (!isFinite(price) || !Number.isFinite(stockQuantity)) {
          return null;
        }

        return {
          productId: String(productId),
          name: String(name),
          price,
          stockQuantity,
        } as {
          productId: string;
          name: string;
          price: number;
          stockQuantity: number;
        };
      })
      .filter(Boolean) as Array<{
        productId: string;
        name: string;
        price: number;
        stockQuantity: number;
      }>;

    if (!productsToInsert.length) {
      res.status(400).json({ message: "No valid product rows found in the sheet." });
      return;
    }

    // Bulk insert; skip duplicates by primary key (productId)
    const result = await prisma.products.createMany({
      data: productsToInsert,
      skipDuplicates: true,
    });

    // Persist imported products to JSON file for audit and optional future seeding
    try {
      const seedDir = path.join(__dirname, "../../prisma/seedData");
      const outPath = path.join(seedDir, "importedProducts.json");
      if (!fs.existsSync(seedDir)) {
        fs.mkdirSync(seedDir, { recursive: true });
      }
      let existing: any[] = [];
      if (fs.existsSync(outPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
        } catch {
          existing = [];
        }
      }
      const map = new Map<string, any>();
      for (const item of existing) {
        if (item && item.productId) map.set(String(item.productId), item);
      }
      for (const item of productsToInsert) {
        map.set(item.productId, {
          productId: item.productId,
          name: item.name,
          price: item.price,
          stockQuantity: item.stockQuantity,
        });
      }
      const merged = Array.from(map.values());
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
    } catch (persistErr) {
      console.warn("Failed to persist imported products to JSON:", persistErr);
    }

    appendNotification({
      type: "product",
      message: `Imported ${result.count} products from Excel`,
      actorUserId: req.user?.userId,
    });

    res.status(201).json({ insertedCount: result.count, attempted: productsToInsert.length });
  } catch (error) {
    console.error("importProducts error:", error);
    res.status(500).json({ message: "Error importing products" });
  }
};

/**
 * Generate and send a sample Excel file for inventory import testing.
 */
export const getImportSample = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const sampleRows = [
      { name: "Sample Widget", price: 12.99, quantity: 50 },
      { name: "Sample Gadget", price: 5.5, quantity: 200 },
      { name: "Example Item", price: 99.0, quantity: 10 },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleRows, { skipHeader: false });
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=sample-inventory.xlsx");
    res.status(200).send(buffer);
  } catch (err) {
    console.error("getImportSample error:", err);
    res.status(500).json({ message: "Failed to generate sample file" });
  }
};
