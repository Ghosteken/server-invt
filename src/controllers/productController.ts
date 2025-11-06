import { Request, Response } from "express";
import prisma from "../db/prisma";

// Simple in-memory cache for product search results (per process)
const PRODUCT_SEARCH_CACHE = new Map<string, { ts: number; data: any[] }>();
const PRODUCT_SEARCH_TTL_MS = 30_000; // 30s TTL
import { appendNotification } from "../services/notificationService";
import { syncProductsJsonFromDb, writeEmptyProductsJson, writeEmptyImportedProductsJson } from "../services/productSyncService";
import { appendCustomerSales } from "../services/customerSalesService";
import { readPcsInventory, upsertPcsEntries, adjustPcsQuantity } from "../services/pcsInventoryService";
import { recordFieldUpdates, getLastFieldUpdates } from "../services/productUpdateAuditService";
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
// pdf-parse lacks TypeScript types; use require to avoid compile errors in ts-node
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");

// Use shared Prisma client

export const getProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const rawSearch = req.query.search?.toString() ?? "";
    const search = rawSearch.trim();

    // Cache key per search term
    const cacheKey = search.toLowerCase();
    const now = Date.now();
    const cached = PRODUCT_SEARCH_CACHE.get(cacheKey);
    if (cached && now - cached.ts < PRODUCT_SEARCH_TTL_MS) {
      res.json(cached.data);
      return;
    }

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
    PRODUCT_SEARCH_CACHE.set(cacheKey, { ts: now, data: products });
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
    try {
      const changed: string[] = [];
      const keys = Object.keys(data);
      for (const k of keys) {
        const oldVal = (existing as any)[k];
        const newVal = (data as any)[k];
        const oldNorm = oldVal instanceof Date ? oldVal.getTime() : oldVal;
        const newNorm = newVal instanceof Date ? newVal.getTime() : newVal;
        if (oldNorm !== newNorm) changed.push(k);
      }
      if (changed.length) recordFieldUpdates(productId, changed, "api");
    } catch (logErr) {
      console.warn("Failed to log field updates on updateProduct:", logErr);
    }
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

// Export products as Excel
export const exportProductsExcel = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const products = await prisma.products.findMany({ orderBy: { name: "asc" } });
    const rows = products.map((p) => ({
      ProductId: p.productId,
      SKU: p.productId, // use ProductId as SKU for export (no separate sku field)
      ProductDescription: p.name,
      PackSize: p.packSize ?? "",
      Category: p.category ?? "",
      PurchasePrice: p.purchasePrice ?? "",
      SalesPrice: p.price ?? "",
      Quantity: p.stockQuantity ?? 0,
      ExpiryDate: p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : "",
      Description: p.description ?? "",
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: [
      "ProductId",
      "SKU",
      "ProductDescription",
      "PackSize",
      "Category",
      "PurchasePrice",
      "SalesPrice",
      "Quantity",
      "ExpiryDate",
      "Description",
    ]});
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");
    res.status(200).send(buf);
  } catch (error) {
    console.error("exportProductsExcel error:", error);
    res.status(500).json({ message: "Failed to export products as Excel" });
  }
};

export const getPcsProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawSearch = req.query.search?.toString() ?? "";
    const search = rawSearch.trim().toLowerCase();
    const pcs = readPcsInventory();
    // Load all products to allow robust matching and enrichment
    const products = await prisma.products.findMany({});

    // Helper normalization (aligned with invoice parsing heuristics)
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const normalizeWithSynonyms = (s: string) => normalize(
      s
        .replace(/\byoghurt\b/gi, "yogurt")
        .replace(/\bflavour\b/gi, "flavor")
        .replace(/(\d+)([a-z]+)/gi, "$1 $2")
    );
    const tokensOf = (s: string) => normalizeWithSynonyms(s).split(" ").filter(Boolean);
    const FILLER_TOKENS = new Set(["drink", "flavor", "flavour", "ctn", "carton", "pack", "copy", "x"]);
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

    // Build indices for quick matching
    const byExact = new Map(products.map(p => [p.name.toLowerCase(), p] as const));
    const byNorm = new Map<string, { product: any; toks: Set<string> }>();
    for (const p of products) {
      const toks = new Set(tokensOf(p.name).filter(t => !FILLER_TOKENS.has(t)));
      byNorm.set(normalizeWithSynonyms(p.name), { product: p, toks });
    }

    // Accumulate results with deduplication by matched product or normalized name
    const agg = new Map<string, {
      productId: string | number;
      name: string;
      pcsQuantity: number;
      packSize?: string | null;
      category?: string | null;
      expiryDate?: Date | null;
      price?: number;
      purchasePrice?: number | null;
    }>();

    for (const e of pcs) {
      const exact = byExact.get(e.name.toLowerCase());
      let matched = exact ?? null;
      if (!matched) {
        const etoks = new Set(tokensOf(e.name).filter(t => !FILLER_TOKENS.has(t)));
        // Score candidates by token overlap; prefer pack match when available
        let best: { product: any; score: number } | null = null;
        for (const { product, toks } of byNorm.values()) {
          // quick skip when overlap is tiny
          const overlap = Array.from(etoks).filter(t => toks.has(t)).length;
          if (overlap === 0) continue;
          let score = overlap;
          if (e.packSize && packEq(e.packSize, product.packSize)) score += 2;
          if (!best || score > best.score) best = { product, score };
        }
        matched = best?.product ?? null;
      }

      const key = matched?.productId ? String(matched.productId) : normalizeWithSynonyms(e.name);
      const prev = agg.get(key);
      const pcsQuantity = (prev?.pcsQuantity ?? 0) + (e.quantity || 0);
      const payload = {
        productId: matched?.productId || e.productId || e.name,
        name: matched?.name || e.name,
        pcsQuantity,
        packSize: (matched?.packSize ?? e.packSize ?? null) as string | null,
        category: matched?.category ?? null,
        expiryDate: matched?.expiryDate ?? null,
        price: matched?.price ?? 0,
        purchasePrice: matched?.purchasePrice ?? null,
      } as const;
      agg.set(key, payload as any);
    }

    let enriched = Array.from(agg.values());
    if (search) {
      enriched = enriched.filter((e) => String(e.name || "").toLowerCase().includes(search));
    }
    res.json(enriched);
  } catch (err) {
    console.error("getPcsProducts error:", err);
    res.status(500).json({ message: "Failed to load PCS products" });
  }
};

export const importPcsProducts = async (req: Request, res: Response): Promise<void> => {
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
    if (!rows.length) {
      res.status(400).json({ message: "Uploaded sheet is empty." });
      return;
    }
    const norm = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    const coerceNumber = (val: any): number | null => {
      if (val === null || val === undefined) return null;
      if (typeof val === "number" && Number.isFinite(val)) return val;
      const s = String(val);
      const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    };
    const incoming: { name: string; quantity: number; packSize?: string | null }[] = [];
    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[norm(k)] = row[k];
      let name = kv["name"] ?? kv["product"] ?? kv["item"] ?? kv["product description"] ?? kv["description"];
      // Fallback: first non-empty string cell as name
      if (!name) {
        const firstStrKey = Object.keys(kv).find((k) => typeof kv[k] === "string" && String(kv[k]).trim().length > 0);
        if (firstStrKey) name = kv[firstStrKey];
      }
      if (!name) continue;

      let qty = coerceNumber(
        kv["pcs"] ?? kv["quantity"] ?? kv["qty"] ?? kv["pcs qty"] ?? kv["qty pcs"] ?? kv["pcs quantity"] ?? kv["quantity pcs"] ?? kv["pieces"] ?? kv["pcs count"] ?? kv["count pcs"]
      );
      // Fallback: first numeric-like cell in the row
      if (qty == null) {
        for (const key of Object.keys(kv)) {
          const n = coerceNumber(kv[key]);
          if (n != null) {
            qty = n;
            break;
          }
        }
      }
      // If quantity is still missing, import the item with quantity 0
      if (qty == null) qty = 0;
      const packSize = kv["pack size"] ?? kv["pack"] ?? null;
      incoming.push({ name: String(name).trim(), quantity: Math.max(0, Number(qty)), packSize: packSize ? String(packSize).trim() : null });
    }
    const merged = upsertPcsEntries(incoming);
    appendNotification({ type: "product", message: `Imported ${incoming.length} PCS products`, actorUserId: req.user?.userId });
    res.json({ imported: incoming.length, total: merged.length });
  } catch (err) {
    console.error("importPcsProducts error:", err);
    res.status(500).json({ message: "Failed to import PCS products" });
  }
};

// Upsert a PCS entry (or multiple) directly via JSON body
export const upsertPcsItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as any;
    let items: Array<{ name: string; quantity: number; packSize?: string | null }> = [];
    if (Array.isArray(body)) {
      items = body.map((e) => ({ name: String(e?.name || "").trim(), quantity: Math.max(0, Number(e?.quantity) || 0), packSize: e?.packSize ? String(e.packSize).trim() : null }));
    } else if (body && typeof body === "object") {
      const name = String(body?.name || "").trim();
      const qty = Math.max(0, Number(body?.quantity) || 0);
      const packSize = body?.packSize ? String(body.packSize).trim() : null;
      if (!name) {
        res.status(400).json({ message: "Missing 'name' for PCS item" });
        return;
      }
      items = [{ name, quantity: qty, packSize }];
    } else {
      res.status(400).json({ message: "Invalid request body" });
      return;
    }

    const merged = upsertPcsEntries(items);
    appendNotification({ type: "product", message: `Upserted ${items.length} PCS item(s)`, actorUserId: req.user?.userId });
    res.json({ upserted: items.length, total: merged.length });
  } catch (err) {
    console.error("upsertPcsItems error:", err);
    res.status(500).json({ message: "Failed to upsert PCS items" });
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

        // Basic validation: require only name; allow missing price/quantity and default them later
        if (!name) {
          return null; // skip rows without a name/description
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

        // Default missing numeric fields to 0 to ensure products are created even with incomplete info
        const finalPrice = price === null ? 0 : price;
        const finalStock = stockQuantity === null ? 0 : Math.floor(stockQuantity as number);

        return {
          productId: String(productId),
          name: String(name),
          price: finalPrice as number,
          purchasePrice: (purchasePrice !== null && Number.isFinite(purchasePrice)) ? (purchasePrice as number) : null,
          stockQuantity: finalStock,
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

    // Parse optional selective update fields from multipart form (CSV or JSON array)
    const rawUpdateFields = (req.body?.updateFields as string | undefined) ?? undefined;
    let updateFieldsSet: Set<string> | null = null;
    if (rawUpdateFields && typeof rawUpdateFields === "string") {
      try {
        const trimmed = rawUpdateFields.trim();
        let arr: string[] = [];
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          arr = JSON.parse(trimmed);
        } else {
          arr = trimmed.split(/[,;\s]+/).filter(Boolean);
        }
        const normalizeField = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
        const allowed = new Set([
          "name",
          "price",
          "purchaseprice",
          "stockquantity",
          "expirydate",
          "category",
          "description",
          "packsize",
        ]);
        const selected = arr
          .map(normalizeField)
          .filter(f => allowed.has(f));
        if (selected.length > 0) updateFieldsSet = new Set(selected);
      } catch {
        // ignore parse errors; fall back to updating all fields
        updateFieldsSet = null;
      }
    }

    for (const item of productsToInsert) {
      const key = keyOf({ name: item.name, packSize: item.packSize });
      const existing = existingMap.get(key);
      if (existing) {
        const dataUpdate: any = {};
        const should = (field: string) => !updateFieldsSet || updateFieldsSet.has(field);
        if (should("name")) dataUpdate.name = item.name;
        if (should("price")) dataUpdate.price = item.price;
        if (should("purchaseprice")) dataUpdate.purchasePrice = item.purchasePrice;
        if (should("stockquantity")) dataUpdate.stockQuantity = item.stockQuantity;
        if (should("expirydate")) dataUpdate.expiryDate = item.expiryDate ?? null;
        if (should("category")) dataUpdate.category = (existing.category ?? item.category ?? null);
        if (should("description")) dataUpdate.description = item.description ?? existing.description ?? null;
        if (should("packsize")) dataUpdate.packSize = item.packSize ?? existing.packSize ?? null;
        await prisma.products.update({ where: { productId: existing.productId }, data: dataUpdate });
        try {
          const changed: string[] = [];
          for (const k of Object.keys(dataUpdate)) {
            const oldVal = (existing as any)[k];
            const newVal = (dataUpdate as any)[k];
            const oldNorm = oldVal instanceof Date ? oldVal.getTime() : oldVal;
            const newNorm = newVal instanceof Date ? newVal.getTime() : newVal;
            if (oldNorm !== newNorm) changed.push(k);
          }
          if (changed.length) recordFieldUpdates(existing.productId, changed, "import");
        } catch (logErr) {
          console.warn("Failed to log field updates on import update:", logErr);
        }
        mergedItemsForJson.push({ ...item, productId: existing.productId });
      } else {
        await prisma.products.create({ data: item });
        try {
          recordFieldUpdates(item.productId, ["name", "price", "purchasePrice", "stockQuantity", "expiryDate", "category", "description", "packSize"].filter((f) => (item as any)[f] !== undefined), "import");
        } catch (logErr) {
          console.warn("Failed to log field updates on import create:", logErr);
        }
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

    type Item = { name: string; quantity: number; unitPrice?: number; subtotal?: number; packSize?: string | null; unit?: "ctn" | "pcs" };
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
            items.push({ name: nameCol, quantity, unitPrice, subtotal, unit: /\bpcs\b/i.test(numberCols) ? "pcs" : "ctn" });
            continue;
          }
        }
      }

      // If we already captured a product name, check for a quantity line with unit label before handling comma+digits lines.
      if (pendingName) {
        const qtyMatch = l.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units|PCS)\b/i);
        const priceNums = parseNumbers(l);
        if (qtyMatch) {
          const quantity = Math.floor(Number(qtyMatch[1].replace(/,/g, "")) || 0);
          const unitPrice = priceNums.length >= 2 ? priceNums[priceNums.length - 2] : undefined;
          const subtotal = priceNums.length >= 1 ? priceNums[priceNums.length - 1] : undefined;
          const unitLabel = String(qtyMatch[2] || '').toLowerCase();
          items.push({ name: pendingName, quantity, unitPrice, subtotal, packSize: pendingPackSize, unit: unitLabel === 'pcs' ? 'pcs' : 'ctn' });
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
        const qtyExplicit = rest.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units|PCS)\b/i);
        if (qtyExplicit) {
          const quantity = Math.floor(Number(qtyExplicit[1].replace(/,/g, "")) || 0);
          const numsInline = parseNumbers(rest);
          const unitPrice = numsInline.find(n => n >= 1 && n < 100000 && n !== quantity);
          const subtotal = numsInline.length ? numsInline[numsInline.length - 1] : undefined;
          if (quantity > 0) {
            const extracted = extractPackFromText(pendingName ?? namePart);
            const finalName = extracted.name;
            if (extracted.pack && !pendingPackSize) pendingPackSize = extracted.pack;
            const unitLabel = String(qtyExplicit[2] || '').toLowerCase();
            items.push({ name: finalName, quantity, unitPrice, subtotal, packSize: pendingPackSize, unit: unitLabel === 'pcs' ? 'pcs' : 'ctn' });
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
            items.push({ name: finalName, quantity, unitPrice, subtotal, packSize: pendingPackSize, unit: /\bpcs\b/i.test(rest) ? 'pcs' : 'ctn' });
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
        const qtyMatch = l.match(/(\d+(?:\.\d+)?)\s*(Ctn|Qty|Units|PCS)\b/i);
        const priceNums = parseNumbers(l);
        if (qtyMatch) {
          const quantity = Math.floor(Number(qtyMatch[1].replace(/,/g, "")) || 0);
          const unitPrice = priceNums.length >= 2 ? priceNums[priceNums.length - 2] : undefined;
          const subtotal = priceNums.length >= 1 ? priceNums[priceNums.length - 1] : undefined;
          const unitLabel = String(qtyMatch[2] || '').toLowerCase();
          items.push({ name: pendingName, quantity, unitPrice, subtotal, packSize: pendingPackSize, unit: unitLabel === 'pcs' ? 'pcs' : 'ctn' });
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
      // When unit is PCS, adjust PCS inventory file and do not change carton stockQuantity
      if (item.unit === 'pcs') {
        adjustPcsQuantity({ name: item.name, delta: -item.quantity });
        if (prod) {
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
        continue;
      }
      if (!prod) {
        continue; // skip unmatched
      }
      const newQty = Math.max(0, (prod.stockQuantity || 0) - (item.quantity || 0));
      await prisma.products.update({ where: { productId: prod.productId }, data: { stockQuantity: newQty } });
      try { recordFieldUpdates(prod.productId, ["stockQuantity"], "invoice"); } catch {}
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
    type ManualItemInput = { productId?: string; name?: string; quantity: number; unit?: "ctn" | "pcs" };
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
      const unit = String(it?.unit || 'ctn').toLowerCase();

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

      if (unit === 'pcs') {
        const nameForPcs = String(it?.name || product?.name || '').trim();
        if (nameForPcs) adjustPcsQuantity({ name: nameForPcs, delta: -qty });
      } else {
        if (!product) continue; // skip unknown product for carton flow
        // Deduct stock (clamp at 0)
        const newQty = Math.max(0, Number(product.stockQuantity) - qty);
        await prisma.products.update({ where: { productId: product.productId }, data: { stockQuantity: newQty } });
      }

      const unitPrice = Number(product?.price ?? 0);
      const totalCost = Number(unitPrice) * qty;

      // Record purchase
      if (product) {
        await prisma.customerPurchases.create({ data: {
          id: randomUUID(),
          customerId: cust.customerId,
          productId: product.productId,
          timestamp,
          quantity: qty,
          unitPrice,
          totalCost,
        } });
      }

      if (product) updates.push({ productId: product.productId, name: product.name, deducted: qty });
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
    // Guard: prevent deletion when related entries exist
    const [purchaseCount, salesCount, purchasesCount] = await Promise.all([
      prisma.customerPurchases.count({ where: { productId } }),
      prisma.sales.count({ where: { productId } }),
      prisma.purchases.count({ where: { productId } }),
    ]);
    if (purchaseCount > 0 || salesCount > 0 || purchasesCount > 0) {
      res.status(409).json({ message: "Cannot delete product with related purchase/sales records. Clear related records first." });
      return;
    }
    // Optional guard: prevent deletion if PCS inventory still references this product by name
    const pcs = readPcsInventory();
    const hasPcsRef = pcs.some((e) => String(e.name || "").trim().toLowerCase() === String(existing.name || "").trim().toLowerCase());
    if (hasPcsRef) {
      res.status(409).json({ message: "Cannot delete product while PCS inventory contains entries referencing it." });
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

// Serve PCS sample Excel
export const getPcsSample = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const samplePath = path.join(__dirname, "../../assets/PCS.xlsx");
    if (!fs.existsSync(samplePath)) {
      res.status(404).json({ message: "PCS sample file not found at server/assets/PCS.xlsx" });
      return;
    }
    const buffer = fs.readFileSync(samplePath);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=PCS.xlsx");
    res.status(200).send(buffer);
  } catch (err) {
    console.error("getPcsSample error:", err);
    res.status(500).json({ message: "Failed to serve PCS sample file" });
  }
};

// Export PCS inventory as Excel
export const exportPcsExcel = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pcs = readPcsInventory();
    const products = await prisma.products.findMany({});
    const byName = new Map(products.map((p) => [String(p.name).toLowerCase(), p] as const));
    const rows = pcs.map((e) => {
      const match = byName.get(String(e.name).toLowerCase());
      return {
        ProductId: match?.productId ?? "",
        ProductDescription: e.name,
        PackSize: e.packSize ?? match?.packSize ?? "",
        Category: match?.category ?? "",
        PCSQuantity: e.quantity ?? 0,
        PurchasePrice: match?.purchasePrice ?? "",
        SalesPrice: match?.price ?? "",
        ExpiryDate: match?.expiryDate ? new Date(match.expiryDate).toLocaleDateString() : "",
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: [
      "ProductId",
      "ProductDescription",
      "PackSize",
      "Category",
      "PCSQuantity",
      "PurchasePrice",
      "SalesPrice",
      "ExpiryDate",
    ]});
    XLSX.utils.book_append_sheet(wb, ws, "PCS");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=pcs.xlsx");
    res.status(200).send(buf);
  } catch (err) {
    console.error("exportPcsExcel error:", err);
    res.status(500).json({ message: "Failed to export PCS inventory as Excel" });
  }
};

// Return last updated timestamps per product field
export const getProductUpdatesLast = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const last = getLastFieldUpdates();
    // Enrich with product names for display
    const ids = Object.keys(last);
    const products = ids.length ? await prisma.products.findMany({ where: { productId: { in: ids } } }) : [];
    const nameMap = new Map(products.map(p => [p.productId, p.name] as const));
    const payload = ids.map((id) => ({ productId: id, name: nameMap.get(id) || "Unknown", last: last[id] }));
    res.json(payload);
  } catch (err) {
    console.error("getProductUpdatesLast error:", err);
    res.status(500).json({ message: "Failed to load last updates" });
  }
};
