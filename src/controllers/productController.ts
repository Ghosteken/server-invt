import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { appendNotification } from "../services/notificationService";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
// pdf-parse lacks TypeScript types; use require to avoid compile errors in ts-node
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");

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

// Process an invoice: parse text or PDF and deduct stock; persist customer and purchases
export const processInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    const { invoiceText } = req.body as { invoiceText?: string };

    let text: string | undefined = undefined;
    if (invoiceText && typeof invoiceText === "string" && invoiceText.trim().length > 0) {
      text = invoiceText;
    } else if (file && file.mimetype === "application/pdf") {
      const data = await pdfParse(file.buffer);
      text = data.text;
    }

    if (!text) {
      res.status(400).json({ message: "No invoice content provided (text or pdf)." });
      return;
    }

    // Basic parsing tailored to provided format: support name-left/quantity-right (single line) and two-line items
    const lines = text.split(/\r?\n/).map(l => l.replace(/[\t]/g, "    ").trim()).filter(l => l.length > 0);

    // Extract customer block heuristically
    const customer: { name?: string; mobile?: string; address?: string; city?: string; state?: string; country?: string } = {};
    const customerIdx = lines.findIndex(l => /Customer/i.test(l));
    if (customerIdx >= 0) {
      // try to read next few lines for name/mobile and address
      for (let i = customerIdx + 1; i < Math.min(lines.length, customerIdx + 6); i++) {
        const l = lines[i];
        const m = l.match(/Mobile:\s*(.*)/i);
        if (m) {
          customer.mobile = m[1].trim();
          continue;
        }
        if (!customer.name) {
          customer.name = l.replace(/[,;]+/g, ", ").trim();
          // strip trailing address tokens if present
          if (customer.name.includes(",")) customer.name = customer.name.split(",")[0].trim();
          customer.name = customer.name.replace(/\s+(AJAH|LAGOS|STATE|NIGERIA).*$/i, "").trim();
          continue;
        }
        if (!customer.address && /Lagos|NIGERIA|STATE/i.test(l)) {
          customer.address = l;
        }
      }
    }

    // Helpers
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const parseNumbers = (s: string): number[] => {
      const nums = s.match(/\d[\d,]*\.?\d*/g) || [];
      return nums.map(n => Number(n.replace(/,/g, ""))).filter(n => !Number.isNaN(n));
    };

    type Item = { name: string; quantity: number; unitPrice?: number; subtotal?: number };
    const items: Item[] = [];
    let pendingName: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];

      // Single-line format with columns separated by 2+ spaces
      const cols = l.split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
      if (cols.length >= 2) {
        const nameCol = cols[0];
        const numberCols = cols.slice(1).join(" ");
        const nums = parseNumbers(numberCols);
        if (nums.length >= 1) {
          const quantity = Math.floor(nums[0]);
          const unitPrice = nums.length >= 2 ? nums[1] : undefined;
          const subtotal = nums.length >= 3 ? nums[2] : undefined;
          if (quantity > 0) {
            items.push({ name: nameCol, quantity, unitPrice, subtotal });
            continue;
          }
        }
      }

      // Comma+digits: either one-line or two-line format
      if (/,/.test(l) && /\d{4,}/.test(l)) {
        const parts = l.split(",");
        const namePart = parts[0].trim();
        const rest = parts.slice(1).join(",");
        // Prefer explicit quantity pattern like "50.00 Ctn" when present
        const qtyExplicit = rest.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units)\b/i);
        if (qtyExplicit) {
          const quantity = Math.floor(Number(qtyExplicit[1].replace(/,/g, "")) || 0);
          const numsInline = parseNumbers(rest);
          const unitPrice = numsInline.find(n => n >= 1 && n < 100000 && n !== quantity);
          const subtotal = numsInline.length ? numsInline[numsInline.length - 1] : undefined;
          if (quantity > 0) {
            items.push({ name: namePart, quantity, unitPrice, subtotal });
            continue;
          }
        }
        // Otherwise, assume first large integer is a code; use next number as quantity
        const numsInline = parseNumbers(rest);
        if (numsInline.length >= 2) {
          const codeCandidate = numsInline[0];
          const quantityCandidate = numsInline[1];
          const quantity = Math.floor(quantityCandidate);
          const unitPrice = numsInline.length >= 3 ? numsInline[2] : undefined;
          const subtotal = numsInline.length >= 4 ? numsInline[3] : undefined;
          if (codeCandidate > 10000 && quantity > 0) {
            items.push({ name: namePart, quantity, unitPrice, subtotal });
            continue;
          }
        }
        // Fallback to two-line behaviour
        pendingName = namePart;
        continue;
      }
      if (pendingName) {
        const qtyMatch = l.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units)?/i);
        const priceNums = parseNumbers(l);
        if (qtyMatch) {
          const quantity = Math.floor(Number(qtyMatch[1].replace(/,/g, "")) || 0);
          const unitPrice = priceNums.length >= 2 ? priceNums[priceNums.length - 2] : undefined;
          const subtotal = priceNums.length >= 1 ? priceNums[priceNums.length - 1] : undefined;
          items.push({ name: pendingName, quantity, unitPrice, subtotal });
          pendingName = null;
          continue;
        }
      }
    }

    if (!items.length) {
      res.status(400).json({ message: "No line items parsed from invoice." });
      return;
    }

    // Create or find customer
    const custName = customer.name || "Unknown Customer";
    let cust = await prisma.customers.findFirst({ where: { name: custName } });
    if (!cust) {
      cust = await prisma.customers.create({ data: {
        customerId: randomUUID(),
        name: custName,
        mobile: customer.mobile,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        country: customer.country,
      } });
    }

    // For each item, find product by name using robust matching, deduct stock, and record purchase
    const updates: Array<{ productId: string; name: string; deducted: number }> = [];
    for (const item of items) {
      const normName = normalize(item.name);
      // Fetch small candidate set by contains; then refine in app logic
      const candidates = await prisma.products.findMany({ where: { name: { contains: item.name, mode: "insensitive" } }, take: 10 });
      let prod = candidates.find(p => normalize(p.name) === normName);
      if (!prod) {
        prod = candidates.find(p => normalize(p.name).includes(normName) || normName.includes(normalize(p.name)));
      }
      if (!prod && candidates.length) {
        // Token overlap (simple Jaccard) as a safe fuzzy fallback
        const tokens = new Set(normName.split(" ").filter(Boolean));
        let best: { p: typeof candidates[number]; score: number } | null = null;
        for (const c of candidates) {
          const ctoks = new Set(normalize(c.name).split(" ").filter(Boolean));
          const inter = new Set([...tokens].filter(t => ctoks.has(t)));
          const union = new Set([...tokens, ...ctoks]);
          const score = inter.size / Math.max(1, union.size);
          if (!best || score > best.score) best = { p: c, score };
        }
        if (best && best.score >= 0.5) prod = best.p;
      }
      if (!prod) {
        continue; // skip unmatched
      }
      const newQty = Math.max(0, (prod.stockQuantity || 0) - (item.quantity || 0));
      await prisma.products.update({ where: { productId: prod.productId }, data: { stockQuantity: newQty } });
      await prisma.customerPurchases.create({ data: {
        id: randomUUID(),
        customerId: cust.customerId,
        productId: prod.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? prod.price,
        totalCost: (item.subtotal ?? (item.unitPrice ?? prod.price) * item.quantity),
      } });
      updates.push({ productId: prod.productId, name: prod.name, deducted: item.quantity });
    }

    appendNotification({ type: "inventory", message: `Processed invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId });
    res.json({ customer: cust, items, updates });
  } catch (error) {
    console.error("processInvoice error:", error);
    res.status(500).json({ message: "Error processing invoice" });
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
