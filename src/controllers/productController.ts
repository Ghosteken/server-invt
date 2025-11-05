import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { appendNotification } from "../services/notificationService";
import { syncProductsJsonFromDb, writeEmptyProductsJson, writeEmptyImportedProductsJson } from "../services/productSyncService";
import { appendCustomerSales } from "../services/customerSalesService";
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
    const { name, price, stockQuantity, category, description, packSize } = req.body;
    const product = await prisma.products.create({
      data: {
        productId: randomUUID(),
        name,
        price,
        stockQuantity,
        category,
        description,
        packSize,
      },
    });
    // Log notification for product creation
    appendNotification({
      type: "product",
      message: `Product created: ${name} (qty: ${stockQuantity})`,
      actorUserId: req.user?.userId,
    });
    // Sync JSON snapshot after write
    await syncProductsJsonFromDb(prisma);
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
    const { name, price, purchasePrice, stockQuantity, expiryDate, category, description, packSize } = req.body;

    const existing = await prisma.products.findUnique({ where: { productId } });
    if (!existing) {
      res.status(404).json({ message: "Product not found" });
      return;
    }

    const data: any = {};
    if (typeof name === "string") data.name = name;
    if (price !== undefined && price !== null && !isNaN(Number(price))) data.price = Number(price);
    if (purchasePrice !== undefined && purchasePrice !== null && !isNaN(Number(purchasePrice))) data.purchasePrice = Number(purchasePrice);
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
    if (category !== undefined) data.category = category ?? null;
    if (description !== undefined) data.description = description ?? null;
    if (packSize !== undefined) data.packSize = packSize ?? null;

    const updated = await prisma.products.update({ where: { productId }, data });
    appendNotification({
      type: "product",
      message: `Product updated: ${updated.name}`,
      actorUserId: req.user?.userId,
    });
    // Sync JSON snapshot after update
    await syncProductsJsonFromDb(prisma);
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

    // Normalize header keys: lower-case, collapse spaces, replace NBSP, and also provide a no-punctuation variant
    const normalizeKey = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();

    // Helper to coerce mixed-formatted numeric cells (e.g., "$1,234.50", "GH₵ 12.3", "50 Qty")
    const coerceNumber = (val: any): number | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === "number" && Number.isFinite(val)) return val;
      const s = String(val);
      // Extract first numeric token including optional decimal
      const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    };

    let currentCategory: string | null = null;
    const productsToInsert = rows
      .map((row) => {
        const keys = Object.keys(row);
        const kv: Record<string, any> = {};
        for (const k of keys) {
          const base = normalizeKey(k);
          kv[base] = row[k];
          const noPunct = base.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
          if (noPunct && noPunct !== base) kv[noPunct] = row[k];
        }

        const productId = kv["productid"] ?? kv["id"] ?? kv["sku"] ?? randomUUID();
        // Support description-driven files; if name missing but description present, use description as name and also store description
        const description = kv["product description"] ?? kv["description"] ?? null;
        const name = kv["name"] ?? description;
        // Support multiple price header variants
        const priceRaw = kv["price"] ?? kv["unit price"] ?? kv["selling price"] ?? kv["sales price"] ?? kv["amount"];
        // Optional purchase price (cost) variants
        const purchasePriceRaw = kv["purchase price"] ?? kv["purchaseprice"] ?? kv["cost"] ?? kv["unit cost"] ?? kv["buying price"] ?? kv["buy price"];
        // Support quantity/stock variants
        const stockRaw = kv["stockquantity"] ?? kv["quantity"] ?? kv["qty"] ?? kv["qty/ctn"] ?? kv["qty ctn"] ?? kv["stock"];
        // Optional expiry date variants
        const expiryRaw = kv["expiry date"] ?? kv["exp date"] ?? kv["expiry"] ?? kv["expity date"] ?? kv["expity"] ?? null;
        // Additional fields
        const category = kv["category"] ?? kv["product category"] ?? null;
        const packSize = kv["pack size"] ?? kv["packsize"] ?? kv["size"] ?? null;

        // Detect category rows: a single label like "SPREAD" with no numeric fields
        const numericHints = [kv["price"], kv["unit price"], kv["selling price"], kv["sales price"], kv["amount"], kv["purchase price"], kv["purchaseprice"], kv["cost"], kv["unit cost"], kv["buying price"], kv["buy price"], kv["stockquantity"], kv["quantity"], kv["qty"], kv["qty/ctn"], kv["qty ctn"], kv["stock"]];
        const hasAnyNumeric = numericHints.some(v => coerceNumber(v) !== null);
        const hasOnlyLabel = !!description && !hasAnyNumeric && !packSize;
        if (hasOnlyLabel) {
          currentCategory = String(description).trim();
          return null; // category header row; skip insert
        }

        // Basic validation
        if (!name || priceRaw === null || priceRaw === undefined || stockRaw === null || stockRaw === undefined) {
          return null; // skip invalid rows
        }
        const price = coerceNumber(priceRaw);
        const purchasePrice = purchasePriceRaw === null || purchasePriceRaw === undefined ? null : coerceNumber(purchasePriceRaw);
        const stockQuantity = coerceNumber(stockRaw);
        const coerceDate = (val: any): Date | null => {
          if (val === null || val === undefined) return null;
          if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
          const s = String(val).trim().replace(/[.]+$/g, "");
          const mmYYYY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
          if (mmYYYY) {
            const m = Number(mmYYYY[1]);
            const y = Number(mmYYYY[2]);
            const d = new Date(y, Math.max(0, Math.min(11, m - 1)), 1);
            return Number.isNaN(d.getTime()) ? null : d;
          }
          const d = new Date(s);
          return Number.isNaN(d.getTime()) ? null : d;
        };
        const expiryDate = coerceDate(expiryRaw);

        if (price === null || stockQuantity === null) {
          return null;
        }

        return {
          productId: String(productId),
          name: String(name),
          price: price as number,
          purchasePrice: (purchasePrice !== null && Number.isFinite(purchasePrice)) ? (purchasePrice as number) : null,
          stockQuantity: Math.floor(stockQuantity as number),
          expiryDate: expiryDate ?? null,
          category: (category ? String(category) : (currentCategory ? String(currentCategory) : null)),
          description: description ? String(description) : null,
          packSize: packSize ? String(packSize) : null,
        } as {
          productId: string;
          name: string;
          price: number;
          purchasePrice: number | null;
          stockQuantity: number;
          expiryDate: Date | null;
          category: string | null;
          description: string | null;
          packSize: string | null;
        };
      })
      .filter(Boolean) as Array<{
        productId: string;
        name: string;
        price: number;
        purchasePrice: number | null;
        stockQuantity: number;
        expiryDate: Date | null;
        category: string | null;
        description: string | null;
        packSize: string | null;
      }>;

    if (!productsToInsert.length) {
      res.status(400).json({ message: "No valid product rows found in the sheet." });
      return;
    }

    // Deduplicate by name + packSize: update existing rows; create new for unknown pairs
    const normalizeText = (s: string | null | undefined) => (s ?? "").toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    const names = Array.from(new Set(productsToInsert.map(p => p.name)));
    const existingCandidates = await prisma.products.findMany({
      where: { name: { in: names } },
    });
    const keyOf = (p: { name: string; packSize: string | null }) => `${normalizeText(p.name)}|${normalizeText(p.packSize)}`;
    const existingMap = new Map<string, any>();
    for (const p of existingCandidates) {
      existingMap.set(keyOf({ name: p.name, packSize: (p as any).packSize ?? null }), p);
    }

    let insertedCount = 0;
    const mergedItemsForJson: Array<{
      productId: string;
      name: string;
      price: number;
      purchasePrice: number | null;
      stockQuantity: number;
      expiryDate: Date | null;
      category: string | null;
      description: string | null;
      packSize: string | null;
    }> = [];

    for (const item of productsToInsert) {
      const key = keyOf({ name: item.name, packSize: item.packSize });
      const existing = existingMap.get(key);
      if (existing) {
        const dataUpdate: any = {
          name: item.name,
          price: item.price,
          purchasePrice: item.purchasePrice,
          stockQuantity: item.stockQuantity,
          expiryDate: item.expiryDate ?? null,
          // Prefer existing category unless missing; then use imported category/header-derived
          category: existing.category ?? item.category ?? null,
          description: item.description ?? existing.description ?? null,
          packSize: item.packSize ?? existing.packSize ?? null,
        };
        await prisma.products.update({ where: { productId: existing.productId }, data: dataUpdate });
        mergedItemsForJson.push({ ...item, productId: existing.productId });
      } else {
        await prisma.products.create({ data: item });
        insertedCount += 1;
        mergedItemsForJson.push(item);
      }
    }

    // After processing import rows, collapse any existing duplicates in DB for the same name+packSize
    try {
      const candidatesForDedupe = await prisma.products.findMany({ where: { name: { in: names } } });
      const groups = new Map<string, typeof candidatesForDedupe>();
      for (const p of candidatesForDedupe) {
        const k = keyOf({ name: p.name, packSize: (p as any).packSize ?? null });
        const arr = (groups.get(k) as any[]) ?? [];
        arr.push(p);
        groups.set(k, arr as any);
      }
      let dedupedCount = 0;
      for (const [k, arr] of groups.entries()) {
        if (arr.length <= 1) continue;
        // Prefer categorized row as canonical
        arr.sort((a, b) => {
          const ac = a.category ? 1 : 0;
          const bc = b.category ? 1 : 0;
          if (ac !== bc) return bc - ac;
          // Prefer having expiryDate
          const ae = (a as any).expiryDate ? 1 : 0;
          const be = (b as any).expiryDate ? 1 : 0;
          if (ae !== be) return be - ae;
          // Otherwise stable
          return 0;
        });
        const canonical = arr[0];
        // Avoid doubled quantities: keep the highest stock across duplicates
        let mergedStock = canonical.stockQuantity ?? 0;
        let mergedCategory = canonical.category ?? null;
        let mergedPrice = canonical.price;
        let mergedPurchase = canonical.purchasePrice ?? null;
        let mergedExpiry = (canonical as any).expiryDate ?? null;
        let mergedDesc = (canonical as any).description ?? null;
        let mergedPack = (canonical as any).packSize ?? null;

        for (let i = 1; i < arr.length; i++) {
          const dup = arr[i] as any;
          const dupStock = typeof dup.stockQuantity === "number" ? dup.stockQuantity : 0;
          mergedStock = Math.max(mergedStock, dupStock);
          if (!mergedCategory && dup.category) mergedCategory = dup.category;
          if (typeof dup.price === "number") mergedPrice = dup.price;
          if (dup.purchasePrice != null) mergedPurchase = dup.purchasePrice;
          if (!mergedExpiry && dup.expiryDate) mergedExpiry = dup.expiryDate as Date;
          if (!mergedDesc && dup.description) mergedDesc = dup.description;
          if (!mergedPack && dup.packSize) mergedPack = dup.packSize;
        }

        await prisma.products.update({
          where: { productId: canonical.productId },
          data: {
            stockQuantity: Math.max(0, Math.floor(mergedStock)),
            category: mergedCategory,
            price: mergedPrice,
            purchasePrice: mergedPurchase,
            expiryDate: mergedExpiry,
            description: mergedDesc,
            packSize: mergedPack,
          },
        });
        for (let i = 1; i < arr.length; i++) {
          await prisma.products.delete({ where: { productId: arr[i].productId } });
          dedupedCount += 1;
        }
      }
      if (dedupedCount > 0) {
        console.log(`Deduped ${dedupedCount} duplicate products by name+packSize.`);
      }
    } catch (dedupeErr) {
      console.warn("Failed to dedupe existing products:", dedupeErr);
    }

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
      for (const item of mergedItemsForJson) {
        map.set(item.productId, {
          productId: item.productId,
          name: item.name,
          price: item.price,
          purchasePrice: item.purchasePrice ?? undefined,
          stockQuantity: item.stockQuantity,
          expiryDate: item.expiryDate ?? undefined,
          category: item.category ?? undefined,
          description: item.description ?? undefined,
          packSize: item.packSize ?? undefined,
        });
      }
      const merged = Array.from(map.values());
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
    } catch (persistErr) {
      console.warn("Failed to persist imported products to JSON:", persistErr);
    }

    appendNotification({
      type: "product",
      message: `Imported ${insertedCount} products from Excel (processed ${productsToInsert.length})`,
      actorUserId: req.user?.userId,
    });
    // Sync JSON snapshot with DB after import
    await syncProductsJsonFromDb(prisma);
    res.status(201).json({ insertedCount, attempted: productsToInsert.length });
  } catch (error) {
    console.error("importProducts error:", error);
    res.status(500).json({ message: "Error importing products" });
  }
};

// Process an invoice: parse text or PDF and deduct stock; persist customer and purchases
export const processInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file;
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
    // Name normalization with simple synonyms (e.g., yoghurt -> yogurt; flavour -> flavor)
    const normalizeWithSynonyms = (s: string) => normalize(
      s
        .replace(/\byoghurt\b/gi, "yogurt")
        .replace(/\bflavour\b/gi, "flavor")
        // Split combined number+unit tokens so "500ml" and "500 ml" normalize equally
        .replace(/(\d+)([a-z]+)/gi, "$1 $2")
    );
    const tokensOf = (s: string) => normalizeWithSynonyms(s).split(" ").filter(Boolean);
    const FILLER_TOKENS = new Set(["drink", "flavor", "flavour", "ctn", "carton", "pack", "copy", "x"]);
    const extractPackFromText = (s: string): { name: string; pack?: string | null } => {
      // Only treat patterns like "X 12" as pack-size; do not capture "500ML" as pack
      const m = s.match(/\b[xX]\s*(\d{1,4})(?:\s*\([^)]*\))?/);
      let pack: string | null = null;
      let name = s;
      if (m) {
        pack = m[1];
        name = s.replace(m[0], " ");
      }
      name = name.replace(/\(copy\)/ig, " ").replace(/\s{2,}/g, " ").trim();
      return { name, pack };
    };

    type Item = { name: string; quantity: number; unitPrice?: number; subtotal?: number; packSize?: string | null };
    const items: Item[] = [];
    let pendingName: string | null = null;
    let pendingPackSize: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const isHeaderLine = (
        /(Invoice\s*No\.|Customer|Total Paid|Total:|Bank Transfer|Date\b|SALES AGENT|Mobile:|Note:)/i.test(l)
        || /^\s*Invoice\s*$/i.test(l)
        || /Product\s+Quantity\s+Unit\s+Price\s+Subtotal/i.test(l)
        || /AMAGYZ|LAGOS,\s+NIGERIA/i.test(l)
      );

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

      // If we already captured a product name, check for a quantity line with unit label before handling comma+digits lines.
      if (pendingName) {
        const qtyMatch = l.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units)\b/i);
        const priceNums = parseNumbers(l);
        if (qtyMatch) {
          const quantity = Math.floor(Number(qtyMatch[1].replace(/,/g, "")) || 0);
          const unitPrice = priceNums.length >= 2 ? priceNums[priceNums.length - 2] : undefined;
          const subtotal = priceNums.length >= 1 ? priceNums[priceNums.length - 1] : undefined;
          items.push({ name: pendingName, quantity, unitPrice, subtotal, packSize: pendingPackSize });
          pendingName = null;
          pendingPackSize = null;
          continue;
        }
      }

      // Comma+digits: either one-line or two-line format
      if (/,/.test(l) && /\d{4,}/.test(l)) {
        const parts = l.split(",");
        const namePart = parts[0].trim();
        const rest = parts.slice(1).join(",");
        // If namePart looks like a pack-size line (e.g., "X 12 (copy)"), do not treat as product name
        const namePartLooksLikePack = /^x\b|^X\b/.test(namePart) || (/^\d/.test(namePart) && !/[a-zA-Z]/.test(namePart));
        if (namePartLooksLikePack) {
          const packNumFromName = parseNumbers(namePart)[0];
          const packNumFromRest = parseNumbers(rest)[0];
          const packNum = (packNumFromName ?? packNumFromRest);
          if (typeof packNum === "number" && packNum > 0 && packNum <= 1000) {
            pendingPackSize = String(packNum);
          }
        } else {
          // Likely the actual product name (may include pack info inline)
          const extracted = extractPackFromText(namePart);
          pendingName = extracted.name;
          if (extracted.pack && !pendingPackSize) pendingPackSize = extracted.pack;
        }
        // Prefer explicit quantity pattern like "50.00 Ctn" when present
        const qtyExplicit = rest.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units)\b/i);
        if (qtyExplicit) {
          const quantity = Math.floor(Number(qtyExplicit[1].replace(/,/g, "")) || 0);
          const numsInline = parseNumbers(rest);
          const unitPrice = numsInline.find(n => n >= 1 && n < 100000 && n !== quantity);
          const subtotal = numsInline.length ? numsInline[numsInline.length - 1] : undefined;
          if (quantity > 0) {
            const extracted = extractPackFromText(pendingName ?? namePart);
            const finalName = extracted.name;
            if (extracted.pack && !pendingPackSize) pendingPackSize = extracted.pack;
            items.push({ name: finalName, quantity, unitPrice, subtotal, packSize: pendingPackSize });
            pendingName = null;
            pendingPackSize = null;
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
            const extracted = extractPackFromText(pendingName ?? namePart);
            const finalName = extracted.name;
            if (extracted.pack && !pendingPackSize) pendingPackSize = extracted.pack;
            items.push({ name: finalName, quantity, unitPrice, subtotal, packSize: pendingPackSize });
            pendingName = null;
            pendingPackSize = null;
            continue;
          }
        }
        // Fallback to two-line behaviour
        if (!namePartLooksLikePack) {
          const extracted = extractPackFromText(namePart);
          pendingName = extracted.name;
          if (extracted.pack && !pendingPackSize) pendingPackSize = extracted.pack;
        }
        continue;
      }
      // Late fallback for quantity lines (requires unit label to avoid pack-size lines)
      if (pendingName) {
        const qtyMatch = l.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units)\b/i);
        const priceNums = parseNumbers(l);
        if (qtyMatch) {
          const quantity = Math.floor(Number(qtyMatch[1].replace(/,/g, "")) || 0);
          const unitPrice = priceNums.length >= 2 ? priceNums[priceNums.length - 2] : undefined;
          const subtotal = priceNums.length >= 1 ? priceNums[priceNums.length - 1] : undefined;
          items.push({ name: pendingName, quantity, unitPrice, subtotal, packSize: pendingPackSize });
          pendingName = null;
          pendingPackSize = null;
          continue;
        }
      }

      // If we haven't captured a product name yet, and this line looks like a name (letters present) and is not a header,
      // treat it as the pending product name. The following lines typically contain pack-size and quantity/price.
      if (!pendingName && /[A-Za-z]/.test(l) && !isHeaderLine) {
        const extracted = extractPackFromText(l);
        pendingName = extracted.name;
        if (extracted.pack && !pendingPackSize) pendingPackSize = extracted.pack;
        continue;
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
    // Helpers for pack-size comparison
    const normSimple = (s: unknown) => String(s ?? "").replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    const extractNum = (s: unknown): number | null => {
      const m = String(s ?? "").match(/\d+/);
      return m ? Number(m[0]) : null;
    };
    const packEq = (a: unknown, b: unknown) => {
      const na = extractNum(a);
      const nb = extractNum(b);
      if (na != null && nb != null) return na === nb;
      return normSimple(a) === normSimple(b);
    };

    for (const item of items) {
      const packNorm = (typeof item.packSize === "string" ? item.packSize : null);
      const invTokens = new Set(tokensOf(item.name).filter(t => !FILLER_TOKENS.has(t)));
      const keyTokens = Array.from(invTokens).filter(t => t.length >= 3).slice(0, 6);

      let candidates: Array<{ productId: string; name: string; packSize?: string | null; price?: number; stockQuantity?: number }> = [];
      if (keyTokens.length > 0) {
        candidates = await prisma.products.findMany({
          where: {
            OR: keyTokens.map((t) => ({ name: { contains: t, mode: "insensitive" } })),
          },
        });
      } else {
        candidates = await prisma.products.findMany({ where: { name: { contains: item.name, mode: "insensitive" } } });
      }

      const subsetMatches = candidates.filter((p) => {
        const ptoks = new Set(tokensOf(p.name).filter((t) => !FILLER_TOKENS.has(t)));
        // Require every product token to appear in invoice tokens
        for (const t of ptoks) {
          if (!invTokens.has(t)) return false;
        }
        if (packNorm && p.packSize) {
          if (!packEq(p.packSize, packNorm)) return false;
        }
        return true;
      });

      let prod: { productId: string; name: string; packSize?: string | null; price?: number; stockQuantity?: number } | undefined = subsetMatches[0];
      if (!prod) {
        // Fallbacks: strict normalized equality, then substring checks
        const normName = normalizeWithSynonyms(item.name);
        prod = candidates.find((p) => normalizeWithSynonyms(p.name) === normName && (packNorm ? packEq(p.packSize ?? null, packNorm) : true));
        if (!prod) {
          prod = candidates.find((p) => (normalizeWithSynonyms(p.name).includes(normName) || normName.includes(normalizeWithSynonyms(p.name))) && (packNorm ? packEq(p.packSize ?? null, packNorm) : true));
        }
        if (!prod && candidates.length) {
          // Overlap-based scoring fallback: pick best token overlap candidate
          let best: { productId: string; name: string; packSize?: string | null; price?: number; stockQuantity?: number } | null = null;
          let bestScore = 0;
          for (const p of candidates) {
            const ptoks = new Set(tokensOf(p.name).filter((t) => !FILLER_TOKENS.has(t)));
            let overlap = 0;
            for (const t of ptoks) {
              if (invTokens.has(t)) overlap++;
            }
            const packBonus = (packNorm && p.packSize && packEq(p.packSize, packNorm)) ? 1 : 0;
            const score = overlap + packBonus;
            if (score > bestScore) {
              bestScore = score;
              best = p;
            }
          }
          // Require at least 2-token overlap to avoid spurious matches
          if (best && bestScore >= 2) {
            prod = best;
          }
        }
      }
      if (!prod) {
        continue; // skip unmatched
      }
      const newQty = Math.max(0, (prod.stockQuantity || 0) - (item.quantity || 0));
      await prisma.products.update({ where: { productId: prod.productId }, data: { stockQuantity: newQty } });
      const unitPrice = Number(item.unitPrice ?? prod.price ?? 0);
      const totalCost = Number(item.subtotal ?? unitPrice * item.quantity);
      await prisma.customerPurchases.create({ data: {
        id: randomUUID(),
        customerId: cust.customerId,
        productId: prod.productId,
        quantity: item.quantity,
        unitPrice,
        totalCost,
      } });
      updates.push({ productId: prod.productId, name: prod.name, deducted: item.quantity });
    }

    // Persist customer sales snapshot to JSON for audit/seed purposes
    try {
      appendCustomerSales({
        customer: {
          id: undefined,
          name: cust.name,
          mobile: cust.mobile,
          address: cust.address,
          city: cust.city,
          state: cust.state,
          country: cust.country,
        },
        itemsParsed: items.map(i => ({ raw: i.name, productName: i.name, quantity: i.quantity })),
        matchedUpdates: updates.map(u => ({ productId: Number.NaN, name: u.name, deducted: u.deducted })),
      });
    } catch (persistErr) {
      console.warn("Failed to persist customerSales JSON:", persistErr);
    }

    appendNotification({ type: "inventory", message: `Processed invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId });
    res.json({ customer: cust, items, updates });
  } catch (error) {
    console.error("processInvoice error:", error);
    res.status(500).json({ message: "Error processing invoice" });
  }
};

// Manual invoice processing: user provides customer, date, and selected products/quantities
export const processInvoiceManual = async (req: Request, res: Response): Promise<void> => {
  try {
    const prismaDate = (d?: string | number | Date) => (d ? new Date(d) : new Date());
    type ManualItemInput = { productId?: string; name?: string; quantity: number };
    type ManualInvoiceBody = { customerName: string; date?: string | number | Date; items: ManualItemInput[] };
    const body = req.body as ManualInvoiceBody;
    const customerName = String(body?.customerName || '').trim();
    const timestamp = prismaDate(body?.date);
    const itemsInput = Array.isArray(body?.items) ? body.items : [];

    if (!customerName) {
      res.status(400).json({ message: "customerName is required" });
      return;
    }
    if (!itemsInput.length) {
      res.status(400).json({ message: "items is required (array of { productId | name, quantity })" });
      return;
    }

    // Create or find customer
    let cust = await prisma.customers.findFirst({ where: { name: customerName } });
    if (!cust) {
      cust = await prisma.customers.create({ data: {
        customerId: randomUUID(),
        name: customerName,
      } });
    }

    const updates: Array<{ productId: string; name: string; deducted: number }> = [];

    for (const it of itemsInput) {
      const qty = Number(it?.quantity ?? 0);
      if (!qty || qty <= 0) continue;

      let product: { productId: string; name: string; price: number; stockQuantity: number } | null = null;
      if (it?.productId) {
        const p = await prisma.products.findUnique({ where: { productId: String(it.productId) } });
        if (p) product = { productId: p.productId, name: p.name, price: Number(p.price), stockQuantity: p.stockQuantity };
      }
      if (!product && it?.name) {
        // Try exact by name then loose contains
        const name = String(it.name).trim();
        const pExact = await prisma.products.findFirst({ where: { name } });
        if (pExact) {
          product = { productId: pExact.productId, name: pExact.name, price: Number(pExact.price), stockQuantity: pExact.stockQuantity };
        }
        if (!product) {
          const candidates = await prisma.products.findMany({ where: { name: { contains: name, mode: 'insensitive' } }, take: 1 });
          if (candidates.length) {
            const p = candidates[0];
            product = { productId: p.productId, name: p.name, price: Number(p.price), stockQuantity: p.stockQuantity };
          }
        }
      }

      if (!product) continue; // skip unknown product

      // Deduct stock (clamp at 0)
      const newQty = Math.max(0, Number(product.stockQuantity) - qty);
      await prisma.products.update({ where: { productId: product.productId }, data: { stockQuantity: newQty } });

      const unitPrice = Number(product.price);
      const totalCost = Number(unitPrice) * qty;

      // Record purchase
      await prisma.customerPurchases.create({ data: {
        id: randomUUID(),
        customerId: cust.customerId,
        productId: product.productId,
        timestamp,
        quantity: qty,
        unitPrice,
        totalCost,
      } });

      updates.push({ productId: product.productId, name: product.name, deducted: qty });
    }

    appendNotification({ type: "inventory", message: `Processed manual invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId });
    res.json({ customer: cust, updates });
  } catch (error) {
    console.error("processInvoiceManual error:", error);
    res.status(500).json({ message: "Error processing manual invoice" });
  }
};

// Delete a single product and dependent rows, then sync JSON
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const existing = await prisma.products.findUnique({ where: { productId } });
    if (!existing) {
      res.status(404).json({ message: "Product not found" });
      return;
    }
    await prisma.customerPurchases.deleteMany({ where: { productId } });
    await prisma.sales.deleteMany({ where: { productId } });
    await prisma.purchases.deleteMany({ where: { productId } });
    await prisma.products.delete({ where: { productId } });
    appendNotification({ type: "product", message: `Product deleted: ${existing.name}`, actorUserId: req.user?.userId });
    await syncProductsJsonFromDb(prisma);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("deleteProduct error:", error);
    res.status(500).json({ message: "Error deleting product" });
  }
};

// Purge all products and dependent rows, clear JSON files, and sync
export const purgeProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.customerPurchases.deleteMany({});
    await prisma.sales.deleteMany({});
    await prisma.purchases.deleteMany({});
    await prisma.products.deleteMany({});
    writeEmptyProductsJson();
    writeEmptyImportedProductsJson();
    await syncProductsJsonFromDb(prisma);
    appendNotification({ type: "product", message: "Purged all products and related records", actorUserId: req.user?.userId });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("purgeProducts error:", error);
    res.status(500).json({ message: "Error purging products" });
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
    // Serve the canonical sample file that defines the expected format
    const samplePath = path.join(__dirname, "../../assets/full-products.xlsx");
    if (!fs.existsSync(samplePath)) {
      res.status(404).json({ message: "Sample file not found at server/assets/full-products.xlsx" });
      return;
    }
    const buffer = fs.readFileSync(samplePath);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=full-products.xlsx");
    res.status(200).send(buffer);
  } catch (err) {
    console.error("getImportSample error:", err);
    res.status(500).json({ message: "Failed to generate sample file" });
  }
};
