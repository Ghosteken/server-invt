import { Request, Response } from "express";
import prisma from "../db/prisma";
import { getInvoiceMeta } from "../services/invoiceMetaService";
import { createErrorResponse } from "../utils/errorHandler";

// Simple in-memory cache for product search results (per process)
const PRODUCT_SEARCH_CACHE = new Map<string, { ts: number; data: any[] }>();
const PRODUCT_SEARCH_TTL_MS = 30_000; // 30s TTL
import { appendNotification } from "../services/notificationService";
import { syncProductsJsonFromDb, writeEmptyProductsJson, writeEmptyImportedProductsJson } from "../services/productSyncService";
import { appendCustomerSales } from "../services/customerSalesService";
import { readPcsInventory, upsertPcsEntries, adjustPcsQuantity, reloadPcsInventory } from "../services/pcsInventoryService";
import { recordFieldUpdates, getLastFieldUpdates } from "../services/productUpdateAuditService";
import XLSX from "xlsx";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "crypto";
// pdf-parse lacks TypeScript types; use require to avoid compile errors in ts-node
const pdfParse = require("pdf-parse");

// Use shared Prisma client

export const getProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const rawSearch = req.query.search?.toString() ?? "";
    const search = rawSearch.trim();
    const typeahead = String(req.query.typeahead || "").trim() === "1";
    const limitRaw = req.query.limit?.toString();
    const pageRaw = req.query.page?.toString();
    const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw) || 20)) : undefined;
    const page = pageRaw ? Math.max(1, Number(pageRaw) || 1) : undefined;

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
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const products = await prisma.products.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { category: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                { barcode: { contains: search, mode: "insensitive" } },
                { packSize: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      ...(typeahead ? { select: { productId: true, name: true } } : {}),
      ...(limit ? { take: limit } : {}),
      ...(page && limit ? { skip: (page - 1) * limit } : {}),
      orderBy: {
        name: "asc",
      },
    });
    PRODUCT_SEARCH_CACHE.set(cacheKey, { ts: now, data: products });
    res.json(products);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error retrieving products"));
  }
};

export const createProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const Body = z.object({
      name: z.string().min(1),
      price: z.coerce.number().nonnegative(),
      stockQuantity: z.coerce.number().int().nonnegative(),
      category: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
      packSize: z.string().optional().nullable(),
    });
    const { name, price, stockQuantity, category, description, packSize } = Body.parse(req.body);
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const product = await prisma.products.create({
      data: {
        productId: randomUUID(),
        name,
        price,
        stockQuantity,
        category,
        description,
        packSize,
        tenantId,
      },
    });
    // Log notification for product creation
    appendNotification({
      type: "product",
      message: `Product created: ${name} (qty: ${stockQuantity})`,
      actorUserId: req.user?.userId,
      tenantId,
    });
    // Sync JSON snapshot after write
    await syncProductsJsonFromDb(prisma);

    try {
      const io = req.app.get("io");
      io.emit("product:created", product);
      io.emit("dashboard:refresh", { tenantId });
    } catch (err) {
      console.warn("Socket emission failed for createProduct", err);
    }

    res.status(201).json(product);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error creating product"));
  }
};

export const getProductById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const product = await prisma.products.findFirst({ where: { productId, tenantId } });
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }
    res.json(product);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error retrieving product"));
  }
};

export const updateProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const Body = z.object({
      name: z.string().min(1).optional(),
      price: z.coerce.number().nonnegative().optional(),
      purchasePrice: z.coerce.number().nonnegative().optional(),
      stockQuantity: z.coerce.number().int().nonnegative().optional(),
      expiryDate: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      packSize: z.string().nullable().optional(),
      barcode: z.string().nullable().optional(),
    });
    const { name, price, purchasePrice, stockQuantity, expiryDate, category, description, packSize, barcode } = Body.parse(req.body);

    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.products.findFirst({ where: { productId, tenantId } });
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
    if (barcode !== undefined) data.barcode = barcode ?? null;

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
      tenantId,
    });
    // Sync JSON snapshot after update
    await syncProductsJsonFromDb(prisma);

    try {
      const io = req.app.get("io");
      io.emit("product:updated", updated);
      io.emit("dashboard:refresh", { tenantId });
    } catch (err) {
      console.warn("Socket emission failed for updateProduct", err);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error updating product"));
  }
};

export const exportProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const products = await prisma.products.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    const json = JSON.stringify(products, null, 2);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=products.json");
    res.status(200).send(json);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to export products"));
  }
};

// Export products as Excel
export const exportProductsExcel = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const products = await prisma.products.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    const rows = products.map((p: any) => ({
      Name: p.name,
      Barcode: (p as any).barcode ?? "",
      PackSize: (p as any).packSize ?? "",
      Category: p.category ?? "",
      PurchasePrice: p.purchasePrice ?? "",
      SalesPrice: p.price ?? "",
      Quantity: p.stockQuantity ?? 0,
      ExpiryDate: p.expiryDate instanceof Date ? p.expiryDate.toLocaleDateString() : "",
      Description: (p as any).description ?? "",
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: [
      "Name",
      "Barcode",
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
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to export products as Excel"));
  }
};

export const getProductMovements = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { productId } = req.params;
    const fromRaw = req.query?.from?.toString();
    const toRaw = req.query?.to?.toString();
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    let timestampFilter: any = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };

    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const product = await prisma.products.findFirst({ where: { productId, tenantId } });
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }

    const sales = await prisma.customerPurchases.findMany({
      where: {
        productId,
        ...(timestampFilter ? { timestamp: timestampFilter } : {}),
      },
      orderBy: { timestamp: "desc" },
    });
    const purchases = await prisma.purchases.findMany({
      where: {
        productId,
        ...(timestampFilter ? { timestamp: timestampFilter } : {}),
      },
      orderBy: { timestamp: "desc" },
    });

    const saleDates: string[] = Array.from(new Set<string>(sales.map((s: any) => s.timestamp.toISOString())));
    const saleCustomerIds: string[] = Array.from(new Set<string>(sales.map((s: any) => s.customerId).filter(Boolean as any)));
    const candidateInvoices = saleDates.length && saleCustomerIds.length
      ? await prisma.invoices.findMany({ where: { date: { in: saleDates.map((d: string) => new Date(d)) }, customerId: { in: saleCustomerIds } } })
      : [];
    const invoiceByPair = new Map<string, { invoiceId: string }>();
    for (const inv of candidateInvoices) {
      invoiceByPair.set(`${inv.customerId}|${inv.date.toISOString()}`, { invoiceId: inv.invoiceId });
    }
    const numberById = new Map<string, string | undefined>();
    for (const inv of candidateInvoices) {
      const meta = await getInvoiceMeta(inv.invoiceId);
      if (meta?.invoiceNumber) numberById.set(inv.invoiceId, meta.invoiceNumber);
    }
    const saleItems = sales.map((s: any) => {
      const pair = `${s.customerId}|${s.timestamp.toISOString()}`;
      const inv = invoiceByPair.get(pair);
      const invoiceId = inv?.invoiceId;
      const invoiceNumber = invoiceId ? numberById.get(invoiceId) : undefined;
      return {
        kind: "sale" as const,
        timestamp: s.timestamp,
        quantity: Number(s.quantity || 0),
        unitPrice: Number(s.unitPrice || 0),
        totalCost: Number(s.totalCost || 0),
        invoiceId,
        invoiceNumber,
      };
    });
    const purchaseItems = purchases.map((p: any) => ({
      kind: "purchase" as const,
      timestamp: p.timestamp,
      quantity: Number(p.quantity || 0),
      unitCost: Number(p.unitCost || 0),
      totalCost: Number(p.totalCost || 0),
    }));
    const items = [...saleItems, ...purchaseItems].sort((a, b) => new Date(b.timestamp as any).getTime() - new Date(a.timestamp as any).getTime());

    res.json({
      product: {
        productId: product.productId,
        name: product.name,
        stockQuantity: Number(product.stockQuantity || 0),
      },
      items,
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error retrieving product movements"));
  }
};

export const getPcsProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const Query = z.object({ search: z.string().optional() });
    const q = Query.safeParse({ search: req.query.search?.toString() });
    const rawSearch = q.success ? q.data.search ?? "" : "";
    const search = rawSearch.trim().toLowerCase();
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const pcs = await readPcsInventory(tenantId);
    // Load all products to allow robust matching and enrichment
    const products = await prisma.products.findMany({ where: { tenantId } });

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
    const byExact = new Map<string, any>(products.map((p: any) => [p.name.toLowerCase(), p]));
    const byNorm = new Map<string, { product: any; toks: Set<string> }>();
    for (const p of products as any[]) {
      const toks = new Set(tokensOf(p.name).filter((t: string) => !FILLER_TOKENS.has(t)));
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
      let matched: any = exact ?? null;
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
    res.status(500).json(createErrorResponse(err, "product", "Failed to load PCS products"));
  }
};

// Reload PCS inventory from disk (useful after external imports)
export const reloadPcs = async (req: Request, res: Response): Promise<void> => {
  try {
    const pcs = await reloadPcsInventory(req.tenantId || req.user?.tenantId || "default");
    res.json({ reloaded: pcs.length });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to reload PCS inventory"));
  }
};

export const importPcsProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
      return;
    }
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: false });
    if (!rows.length) {
      res.status(400).json({ message: "Uploaded sheet is empty" });
      return;
    }
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
        const allowed = new Set([
          "name",
          "packsize",
          "category",
          "price",
          "purchaseprice",
          "expirydate",
          "barcode",
          "description",
          "pcsquantity",
        ]);
        const selected = arr.map((f) => f.toLowerCase()).filter((f) => allowed.has(f));
        if (selected.length > 0) updateFieldsSet = new Set(selected);
      } catch {
        updateFieldsSet = null;
      }
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
    const importedSnapshot: Array<{
      productId?: string;
      name: string;
      barcode?: string;
      packSize?: string | null;
      category?: string;
      pcsQuantity: number;
      purchasePrice?: number | null;
      salesPrice?: number | null;
      expiryDate?: string | Date | null;
      description?: string | null;
    }> = [];
    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[norm(k)] = row[k];
      let name = kv["product description"] ?? kv["name"] ?? kv["product"] ?? kv["item"] ?? kv["description"];
      // Fallback: first non-empty string cell as name
      if (!name) {
        const firstStrKey = Object.keys(kv).find((k) => typeof kv[k] === "string" && String(kv[k]).trim().length > 0);
        if (firstStrKey) name = kv[firstStrKey];
      }
      if (!name) continue;

      const qtyCandidates = [
        "pcs quantity",
        "pcsquantity",
        "pcs",
        "quantity",
        "qty",
        "pcs qty",
        "pcsqty",
        "qty pcs",
        "quantity pcs",
        "pieces",
        "pcs count",
        "count pcs",
      ];
      let qty: number | null = null;
      for (const key of qtyCandidates) {
        const n = coerceNumber(kv[key]);
        if (n != null) {
          qty = n;
          break;
        }
      }
      if (qty == null) qty = 0;
      const packSize = kv["pack size"] ?? kv["pack"] ?? kv["packsize"] ?? null;
      const productId = kv["productid"] ?? kv["sku"] ?? null;
      const barcode = kv["barcode"] ?? null;
      const category = kv["category"] ?? null;
      const purchasePrice = coerceNumber(kv["purchaseprice"]);
      const salesPrice = coerceNumber(kv["salesprice"]);
      const expiryDateRaw = kv["expirydate"] ? String(kv["expirydate"]).trim() : null;
      const parseDate = (val: any): Date | null => {
        if (val === null || val === undefined) return null;
        if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
        if (typeof val === "number" && Number.isFinite(val)) {
          const excelEpoch = Date.UTC(1899, 11, 30);
          const ms = Math.round(val * 86400 * 1000);
          const d = new Date(excelEpoch + ms);
          return Number.isNaN(d.getTime()) ? null : d;
        }
        const s = String(val).trim().replace(/[.]+$/g, "");
        const ymd = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
        if (ymd) {
          const y = Number(ymd[1]);
          const m = Number(ymd[2]);
          const day = Number(ymd[3]);
          const d = new Date(y, Math.max(0, Math.min(11, m - 1)), Math.max(1, Math.min(31, day)));
          return Number.isNaN(d.getTime()) ? null : d;
        }
        const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
        if (dmy) {
          const a = Number(dmy[1]);
          const b = Number(dmy[2]);
          const y = Number(dmy[3]);
          const month = a > 12 ? b : a;
          const day = a > 12 ? a : b;
          const d = new Date(y, Math.max(0, Math.min(11, month - 1)), Math.max(1, Math.min(31, day)));
          return Number.isNaN(d.getTime()) ? null : d;
        }
        const mmYYYY = s.match(/^(\d{1,2})[\/-](\d{4})$/);
        if (mmYYYY) {
          const m = Number(mmYYYY[1]);
          const y = Number(mmYYYY[2]);
          const d = new Date(y, Math.max(0, Math.min(11, m - 1)), 1);
          return Number.isNaN(d.getTime()) ? null : d;
        }
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const expiryDate = parseDate(expiryDateRaw);
      const description = kv["description"] ? String(kv["description"]).trim() : null;

      incoming.push({ name: String(name).trim(), quantity: Math.max(0, Number(qty)), packSize: packSize ? String(packSize).trim() : null });
      importedSnapshot.push({
        productId: productId ? String(productId) : undefined,
        name: String(name).trim(),
        barcode: barcode ? String(barcode) : undefined,
        packSize: packSize ? String(packSize).trim() : null,
        category: category ? String(category) : undefined,
        pcsQuantity: Math.max(0, Number(qty)),
        purchasePrice: purchasePrice ?? null,
        salesPrice: salesPrice ?? null,
        expiryDate,
        description,
      });
    }
    // Optionally update matching Product records for selected fields
    try {
      const should = (field: string) => !updateFieldsSet || updateFieldsSet.has(field);
      const existingProducts = await prisma.products.findMany({ where: { tenantId } });
      const keyOf = (r: { name: string; packSize: string | null }) => `${String(r.name).toLowerCase()}|${String(r.packSize ?? "").toLowerCase()}`;
      const existingByKey = new Map<string, any>();
      const existingByBarcode = new Map<string, any>();
      for (const p of existingProducts) {
        existingByKey.set(keyOf({ name: p.name, packSize: (p as any).packSize ?? null }), p);
        const bc = (p as any).barcode;
        if (bc) existingByBarcode.set(String(bc).trim(), p);
      }
      for (const item of importedSnapshot) {
        let target: any = null;
        if (item.productId) {
          target = await prisma.products.findFirst({ where: { productId: item.productId, tenantId } });
        }
        if (!target && item.barcode) {
          target = existingByBarcode.get(String(item.barcode).trim());
        }
        if (!target) {
          target = existingByKey.get(keyOf({ name: item.name, packSize: (item.packSize ?? null) as any }));
        }
        if (!target) {
          target = await prisma.products.findFirst({ where: { name: item.name, tenantId } });
        }
        if (!target) {
          const created = await prisma.products.create({
            data: {
              productId: randomUUID(),
              name: item.name,
              price: item.salesPrice != null ? Number(item.salesPrice) : 0,
              purchasePrice: item.purchasePrice != null ? Number(item.purchasePrice) : null,
              stockQuantity: 0,
              expiryDate: (item.expiryDate instanceof Date) ? item.expiryDate : (item.expiryDate ? new Date(item.expiryDate) : null),
              category: item.category ?? null,
              description: item.description ?? null,
              packSize: item.packSize ?? null,
              barcode: item.barcode ? String(item.barcode).trim() : null,
              tenantId,
            },
          });
          try {
            recordFieldUpdates(created.productId, [
              "name",
              ...(item.salesPrice != null ? ["price"] : []),
              ...(item.purchasePrice != null ? ["purchasePrice"] : []),
              "stockQuantity",
              ...(item.expiryDate ? ["expiryDate"] : []),
              ...(item.category ? ["category"] : []),
              ...(item.description ? ["description"] : []),
              ...(item.packSize ? ["packSize"] : []),
              ...(item.barcode ? ["barcode"] : []),
            ], "import");
          } catch {}
          existingByKey.set(keyOf({ name: created.name, packSize: (created as any).packSize ?? null }), created);
          if (created.barcode) existingByBarcode.set(String(created.barcode).trim(), created);
          target = created;
        }
        const dataUpdate: any = {};
        if (should("name") && item.name) dataUpdate.name = item.name;
        if (should("price") && item.salesPrice != null) dataUpdate.price = Number(item.salesPrice);
        if (should("purchaseprice") && item.purchasePrice != null) dataUpdate.purchasePrice = Number(item.purchasePrice);
        if (should("expirydate")) {
          const v = item.expiryDate;
          dataUpdate.expiryDate = v instanceof Date ? v : (v ? new Date(v) : null);
        }
        if (should("category")) dataUpdate.category = (target.category ?? item.category ?? null);
        if (should("description")) dataUpdate.description = item.description ?? target.description ?? null;
        if (should("packsize")) dataUpdate.packSize = item.packSize ?? target.packSize ?? null;
        if (should("barcode")) dataUpdate.barcode = item.barcode ?? target.barcode ?? null;
        dataUpdate.stockQuantity = Math.max(0, Number(item.pcsQuantity || 0));
        if (Object.keys(dataUpdate).length > 0) {
          const existing = target;
          const updated = await prisma.products.update({ where: { productId: target.productId }, data: dataUpdate });
          try {
            const changed: string[] = [];
            for (const k of Object.keys(dataUpdate)) {
              const oldVal = (existing as any)[k];
              const newVal = (updated as any)[k];
              const oldNorm = oldVal instanceof Date ? oldVal.getTime() : oldVal;
              const newNorm = newVal instanceof Date ? newVal.getTime() : newVal;
              if (oldNorm !== newNorm) changed.push(k);
            }
            if (changed.length) recordFieldUpdates(target.productId, changed, "import");
          } catch (logErr) {
            console.warn("Failed to log field updates on PCS import update:", logErr);
          }
        }
      }
    } catch (updateErr) {
      console.warn("Selective product updates on PCS import failed:", updateErr);
    }

    // Only upsert PCS quantities when selected or when no selection provided
    const doPcsUpsert = !updateFieldsSet || updateFieldsSet.has("pcsquantity");
    const merged = doPcsUpsert ? await upsertPcsEntries(incoming, tenantId) : await readPcsInventory(tenantId);
    const importedCount = doPcsUpsert ? incoming.length : 0;
    appendNotification({ type: "product", message: `Imported ${importedCount} PCS products`, actorUserId: req.user?.userId, tenantId });
    // Persist imported PCS snapshot to JSON
    try {
      const seedDir = path.join(__dirname, "../../prisma/seedData");
      const outPath = path.join(seedDir, "importedPcs.json");
      if (!fs.existsSync(seedDir)) fs.mkdirSync(seedDir, { recursive: true });
      let existing: any[] = [];
      if (fs.existsSync(outPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
        } catch {
          existing = [];
        }
      }
      const keyOf = (r: any) => `${String(r.name).toLowerCase()}|${String(r.packSize ?? "").toLowerCase()}`;
      const map = new Map<string, any>();
      for (const item of existing) {
        if (item && item.name) map.set(keyOf(item), item);
      }
      for (const item of importedSnapshot) {
        map.set(keyOf(item), item);
      }
      const mergedSnap = Array.from(map.values());
      fs.writeFileSync(outPath, JSON.stringify(mergedSnap, null, 2), "utf-8");
    } catch (persistErr) {
      console.warn("Failed to persist imported PCS snapshot to JSON:", persistErr);
    }

    // Sync JSON snapshot with DB after potential product updates
    try { await syncProductsJsonFromDb(prisma); } catch {}
    res.json({ imported: importedCount, total: merged.length });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to import PCS products"));
  }
};

// Upsert a PCS entry (or multiple) directly via JSON body
export const upsertPcsItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const Item = z.object({ name: z.string().min(1), quantity: z.coerce.number().int().nonnegative(), packSize: z.string().nullable().optional() });
    const Body = z.union([z.array(Item), Item]);
    const body = Body.parse(req.body);
    let items: Array<{ name: string; quantity: number; packSize?: string | null }> = [];
    if (Array.isArray(body)) {
      items = body.map((e) => ({ name: e.name.trim(), quantity: Math.max(0, Number(e.quantity) || 0), packSize: e.packSize ? String(e.packSize).trim() : null }));
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

    const merged = await upsertPcsEntries(items);
    await appendNotification({ type: "product", message: `Upserted ${items.length} PCS item(s)`, actorUserId: req.user?.userId, tenantId });
    res.json({ upserted: items.length, total: merged.length });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to upsert PCS items"));
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
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const file = (req as any).file as Express.Multer.File | undefined;
    
    console.log(`[importProducts] Request received. Tenant: ${tenantId}`);
    if (file) {
      console.log(`[importProducts] File uploaded: ${file.originalname}, Size: ${file.size} bytes`);
    } else {
      console.warn(`[importProducts] No file found in request`);
    }

    if (!file) {
      res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
      return;
    }

    // Parse Excel buffer
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: false });
    
    console.log(`[importProducts] Excel parsed. Rows found: ${rows.length}`);
    
    if (!rows.length) {
      res.status(400).json({ message: "Uploaded sheet is empty" });
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
    let productsToInsert = rows
      .map((row) => {
        const keys = Object.keys(row);
        const kv: Record<string, any> = {};
        for (const k of keys) {
          const base = normalizeKey(k);
          kv[base] = row[k];
          const noPunct = base.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
          if (noPunct && noPunct !== base) kv[noPunct] = row[k];
        }
        const present = new Set<string>();
        const productId = kv["productid"] ?? kv["id"] ?? kv["sku"] ?? randomUUID();
        const barcodeRaw = kv["barcode"] ?? kv["bar code"] ?? kv["ean"] ?? kv["upc"] ?? kv["bar-code"] ?? null;
        if (barcodeRaw !== undefined && barcodeRaw !== null) present.add("barcode");
        // Support description-driven files; if name missing but description present, use description as name and also store description
        const description = kv["product description"] ?? kv["productdescription"] ?? kv["description"] ?? null;
        if (description !== undefined && description !== null) present.add("description");
        // Accept common headers: "Name", "Product", "Product Name", and also "ProductDescription" from our own export
        const name = kv["name"] ?? kv["product"] ?? kv["product name"] ?? kv["product description"] ?? kv["productdescription"] ?? description;
        if (kv["name"] !== undefined || kv["product"] !== undefined || kv["product name"] !== undefined || kv["product description"] !== undefined || kv["productdescription"] !== undefined) {
          present.add("name");
        }
        // Support multiple price header variants
        const priceRaw = kv["price"] ?? kv["unit price"] ?? kv["selling price"] ?? kv["sales price"] ?? kv["salesprice"] ?? kv["amount"];
        if (priceRaw !== undefined && priceRaw !== null) present.add("price");
        // Optional purchase price (cost) variants
        const purchasePriceRaw = kv["purchase price"] ?? kv["purchaseprice"] ?? kv["cost"] ?? kv["unit cost"] ?? kv["buying price"] ?? kv["buy price"];
        if (purchasePriceRaw !== undefined && purchasePriceRaw !== null) present.add("purchaseprice");
        // Support quantity/stock variants
        const stockRaw = kv["stockquantity"] ?? kv["quantity"] ?? kv["qty"] ?? kv["qty/ctn"] ?? kv["qty ctn"] ?? kv["stock"];
        if (stockRaw !== undefined && stockRaw !== null) present.add("stockquantity");
        // Optional expiry date variants
        const expiryRaw = kv["expiry date"] ?? kv["exp date"] ?? kv["expiry"] ?? kv["expity date"] ?? kv["expity"] ?? kv["expirydate"] ?? null;
        if (expiryRaw !== undefined && expiryRaw !== null) present.add("expirydate");
        // Additional fields
        const category = kv["category"] ?? kv["product category"] ?? null;
        if (category !== undefined && category !== null) present.add("category");
        const packSize = kv["pack size"] ?? kv["packsize"] ?? kv["size"] ?? null;
        if (packSize !== undefined && packSize !== null) present.add("packsize");

        // Detect category rows: a single label like "SPREAD" with no numeric fields
        const numericHints = [kv["price"], kv["unit price"], kv["selling price"], kv["sales price"], kv["salesprice"], kv["amount"], kv["purchase price"], kv["purchaseprice"], kv["cost"], kv["unit cost"], kv["buying price"], kv["buy price"], kv["stockquantity"], kv["quantity"], kv["qty"], kv["qty/ctn"], kv["qty ctn"], kv["stock"]];
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
          if (typeof val === "number" && Number.isFinite(val)) {
            const excelEpoch = Date.UTC(1899, 11, 30);
            const ms = Math.round(val * 86400 * 1000);
            const d = new Date(excelEpoch + ms);
            return Number.isNaN(d.getTime()) ? null : d;
          }
          const s = String(val).trim().replace(/[.]+$/g, "");
          // yyyy-mm-dd or yyyy/mm/dd
          const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
          if (ymd) {
            const y = Number(ymd[1]);
            const m = Number(ymd[2]);
            const day = Number(ymd[3]);
            const d = new Date(y, Math.max(0, Math.min(11, m - 1)), Math.max(1, Math.min(31, day)));
            return Number.isNaN(d.getTime()) ? null : d;
          }
          // dd/mm/yyyy or mm/dd/yyyy
          const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (dmy) {
            let a = Number(dmy[1]);
            let b = Number(dmy[2]);
            const y = Number(dmy[3]);
            // If first token > 12, treat as day/month, else assume month/day
            const month = a > 12 ? b : a;
            const day = a > 12 ? a : b;
            const d = new Date(y, Math.max(0, Math.min(11, month - 1)), Math.max(1, Math.min(31, day)));
            return Number.isNaN(d.getTime()) ? null : d;
          }
          // mm/YYYY fallback
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
          barcode: barcodeRaw ? String(barcodeRaw).trim() : null,
          __present: present,
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
          barcode: string | null;
          __present: Set<string>;
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
        barcode: string | null;
      }>;

    if (!productsToInsert.length) {
      // Fallback parser: handle files laid out strictly as positional columns without headers
      // Expected order: [Barcode, Category, Product, Pack Size]
      try {
        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][];
        const dataRows = Array.isArray(matrix) ? matrix.filter(r => Array.isArray(r) && r.length >= 3) : [];
        // If the first row contains header-like values, skip it
        const looksLikeHeader = dataRows.length && (
          /barcode/i.test(String(dataRows[0][0] ?? '')) ||
          /category/i.test(String(dataRows[0][1] ?? '')) ||
          /product/i.test(String(dataRows[0][2] ?? ''))
        );
        const startIdx = looksLikeHeader ? 1 : 0;
        const fallbackItems = [] as Array<{
          productId: string;
          name: string;
          price: number;
          purchasePrice: number | null;
          stockQuantity: number;
          expiryDate: Date | null;
          category: string | null;
          description: string | null;
          packSize: string | null;
          barcode: string | null;
        }>;
        for (let i = startIdx; i < dataRows.length; i++) {
          const r = dataRows[i];
          const barcodeCell = r[0];
          const categoryCell = r[1];
          const productCell = r[2];
          const packSizeCell = r[3];
          if (!productCell) continue;
          fallbackItems.push({
            productId: randomUUID(),
            name: String(productCell),
            price: 0,
            purchasePrice: null,
            stockQuantity: 0,
            expiryDate: null,
            category: categoryCell ? String(categoryCell) : null,
            description: null,
            packSize: packSizeCell ? String(packSizeCell) : null,
            barcode: barcodeCell ? String(barcodeCell).trim() : null,
          });
        }
        productsToInsert = fallbackItems;
      } catch (fallbackErr) {
        console.warn("Fallback parser failed:", fallbackErr);
      }

      if (!productsToInsert.length) {
        res.status(400).json({ message: "No valid product rows found in the sheet." });
        return;
      }
    }

    // Deduplicate by name + packSize: prepare batch updates and batch creates to minimize per-row DB ops
    const normalizeText = (s: string | null | undefined) => (s ?? "").toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    const names = Array.from(new Set(productsToInsert.map(p => p.name)));
    const barcodes = Array.from(new Set(productsToInsert.map(p => p.barcode).filter((b): b is string => !!b)));
    const existingCandidates = await prisma.products.findMany({
      where: { tenantId, name: { in: names } },
    });
    const existingByBarcode = barcodes.length
      ? await prisma.products.findMany({ where: { tenantId, barcode: { in: barcodes } } })
      : [];
    const keyOf = (p: { name: string; packSize: string | null }) => `${normalizeText(p.name)}|${normalizeText(p.packSize)}`;
    const existingMap = new Map<string, any>();
    for (const p of existingCandidates) {
      existingMap.set(keyOf({ name: p.name, packSize: (p as any).packSize ?? null }), p);
    }
    const barcodeMap = new Map<string, any>();
    for (const p of existingByBarcode) {
      const bc = (p as any).barcode;
      if (bc) barcodeMap.set(String(bc).trim(), p);
    }

    let insertedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
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
      barcode: string | null;
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
          "barcode",
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

    // Precompute existing categories for similarity matching for new items (tenant-scoped)
    const existingCategoriesRaw = await prisma.products.findMany({ select: { category: true }, where: { tenantId, category: { not: null } } });
    const existingCategories: string[] = Array.from(new Set<string>(existingCategoriesRaw.map((r: { category: string | null }) => String(r.category))));
    const normalizeToken = (t: string) => {
      let x = t.toLowerCase();
      if (x === "drinks") x = "drink";
      if (x === "bitters") x = "bitter";
      if (x === "liquer") x = "liqueur";
      if (x === "liquor") x = "liqueur";
      // generic plural strip
      if (x.endsWith("s")) x = x.slice(0, -1);
      return x;
    };
    const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map(normalizeToken);
    const jaccard = (a: string, b: string): number => {
      const ta = tokenize(a);
      const tb = tokenize(b);
      if (!ta.length || !tb.length) return 0;
      const setA = new Set(ta);
      const setB = new Set(tb);
      let inter = 0;
      for (const t of setA) if (setB.has(t)) inter += 1;
      const union = setA.size + setB.size - inter;
      return inter / Math.max(1, union);
    };
    const bestCategoryForValue = (value: string): string | null => {
      let best: { cat: string; score: number } | null = null;
      for (const cat of existingCategories as string[]) {
        const s = jaccard(value, cat);
        if (!best || s > best.score) best = { cat, score: s };
      }
      return best && best.score >= 0.4 ? best.cat : null; // require minimal similarity
    };
    const bestCategoryForName = (name: string): string | null => bestCategoryForValue(name);

    const fuzzyFindExisting = async (item: { name: string; packSize: string | null }) => {
      const toks = tokenize(item.name);
      const ors = toks.slice(0, 3).map(tok => ({ name: { contains: tok, mode: "insensitive" as const } }));
      if (!ors.length) return null;
      const candidates = await prisma.products.findMany({ where: { tenantId, OR: ors }, take: 25 });
      let best: any = null;
      let bestScore = 0;
      for (const p of candidates) {
        const s = jaccard(item.name, p.name) + (normalizeText(item.packSize) === normalizeText((p as any).packSize ?? null) ? 0.15 : 0);
        if (s > bestScore) { best = p; bestScore = s; }
      }
      return bestScore >= 0.6 ? best : null;
    };

    const idList = Array.from(new Set(productsToInsert.map((p: any) => p.productId)));
    const existingById = idList.length ? await prisma.products.findMany({ where: { tenantId, productId: { in: idList } } }) : [];
    const idMap = new Map<string, any>(existingById.map((p: any) => [p.productId, p]));

    const batchedUpdates: Array<{ where: { productId: string }, data: any }> = [];
    const batchedCreates: Array<any> = [];

    for (const item of productsToInsert) {
      const key = keyOf({ name: item.name, packSize: item.packSize });
      let existing = idMap.get(item.productId) || (item.barcode ? barcodeMap.get(String(item.barcode).trim()) : undefined) || existingMap.get(key);
      // Avoid expensive fuzzy search for huge imports; cap with a simple guard
      if (!existing && productsToInsert.length <= 500) {
        existing = await fuzzyFindExisting({ name: item.name, packSize: item.packSize });
      }
      if (existing) {
        const dataUpdate: any = {};
        const present = (item as any).__present as Set<string>;
        const should = (field: string) => (!updateFieldsSet || updateFieldsSet.has(field)) && present.has(field);
        if (should("name")) dataUpdate.name = item.name;
        if (should("price") && item.price !== undefined) dataUpdate.price = item.price;
        if (should("purchaseprice") && item.purchasePrice !== undefined) dataUpdate.purchasePrice = item.purchasePrice;
        if (should("stockquantity") && item.stockQuantity !== undefined) dataUpdate.stockQuantity = item.stockQuantity;
        if (should("expirydate")) dataUpdate.expiryDate = item.expiryDate ?? null;
        if (should("category")) dataUpdate.category = (item.category ?? existing.category ?? null);
        if (should("description")) dataUpdate.description = item.description ?? existing.description ?? null;
        if (should("packsize")) dataUpdate.packSize = item.packSize ?? existing.packSize ?? null;
        if (should("barcode")) dataUpdate.barcode = item.barcode ?? existing.barcode ?? null;
        batchedUpdates.push({ where: { productId: existing.productId }, data: dataUpdate });
        try {
          const changed: string[] = [];
          for (const k of Object.keys(dataUpdate)) {
            const oldVal = (existing as any)[k];
            const newVal = (dataUpdate as any)[k];
            const oldNorm = oldVal instanceof Date ? oldVal.getTime() : oldVal;
            const newNorm = newVal instanceof Date ? newVal.getTime() : newVal;
            if (oldNorm !== newNorm) changed.push(k);
          }
          if (changed.length) {
            recordFieldUpdates(existing.productId, changed, "import");
          } else {
            // If nothing changed, drop this update to avoid false-positive counts
            batchedUpdates.pop();
          }
        } catch (logErr) {
          console.warn("Failed to log field updates on import update:", logErr);
        }
        mergedItemsForJson.push({ ...item, productId: existing.productId });
      } else {
        const { __present, ...raw } = (item as any);
        const allowed = new Set([
          "productId",
          "name",
          "price",
          "purchasePrice",
          "stockQuantity",
          "expiryDate",
          "category",
          "description",
          "packSize",
          "barcode",
        ]);
        const newItemData: any = {};
        for (const k of Object.keys(raw)) {
          if (allowed.has(k)) newItemData[k] = raw[k];
        }
        if (newItemData.category) {
          const mapped = bestCategoryForValue(String(newItemData.category));
          newItemData.category = mapped ?? newItemData.category;
        } else {
          newItemData.category = bestCategoryForName(item.name);
        }
        batchedCreates.push({ ...newItemData, tenantId });
        try {
          recordFieldUpdates(item.productId, ["name", "price", "purchasePrice", "stockQuantity", "expiryDate", "category", "description", "packSize", "barcode"].filter((f) => (item as any)[f] !== undefined), "import");
        } catch (logErr) {
          console.warn("Failed to log field updates on import create:", logErr);
        }
        mergedItemsForJson.push(item);
      }
    }

    if (batchedCreates.length) {
      await prisma.products.createMany({ data: batchedCreates });
      insertedCount += batchedCreates.length;
    }
    if (batchedUpdates.length) {
      await prisma.$transaction(batchedUpdates.map((u) => prisma.products.update(u)));
      updatedCount += batchedUpdates.length;
    }

    // Purge products missing from the uploaded sheet (by Name+PackSize or matching Barcode)
    try {
      const normalizeText = (s: string | null | undefined) => (s ?? "").toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
      const presentKeys = new Set(productsToInsert.map((p: any) => `${normalizeText(p.name)}|${normalizeText(p.packSize)}`));
      const presentBarcodes = new Set(
        productsToInsert
          .map((p) => (p.barcode ? String(p.barcode).trim() : null))
          .filter((b): b is string => !!b)
      );
      const existingAll = await prisma.products.findMany({ where: { tenantId } });
      const toDeleteIds: string[] = [];
      for (const ex of existingAll as Array<any>) {
        const key = `${normalizeText(ex.name)}|${normalizeText(ex.packSize ?? null)}`;
        const bc = ex.barcode ? String(ex.barcode).trim() : null;
        const isPresent = presentKeys.has(key) || (!!bc && presentBarcodes.has(bc));
        if (!isPresent) toDeleteIds.push(ex.productId);
      }
      if (toDeleteIds.length) {
        await prisma.$transaction(toDeleteIds.map((id) => prisma.products.delete({ where: { productId: id } })));
        deletedCount += toDeleteIds.length;
      }
    } catch (purgeErr) {
      console.warn("Failed to purge missing products:", purgeErr);
    }

    // After processing import rows, collapse any existing duplicates in DB for the same name+packSize
    try {
      const candidatesForDedupe = await prisma.products.findMany({ where: { tenantId, name: { in: names } } });
      // Cluster by fuzzy name similarity and identical packSize
      type Prod = typeof candidatesForDedupe[number] & { packSize?: string | null };
      const clusters: Prod[][] = [];
      const samePack = (a: Prod, b: Prod) => normalizeText((a as any).packSize ?? null) === normalizeText((b as any).packSize ?? null);
      const SIM_THRESHOLD = 0.6;
      for (const p of candidatesForDedupe as Prod[]) {
        let placed = false;
        for (const cluster of clusters) {
          // If any member is sufficiently similar and pack size matches, place into cluster
          if (cluster.some((m: Prod) => samePack(m, p) && jaccard(m.name, p.name) >= SIM_THRESHOLD)) {
            cluster.push(p);
            placed = true;
            break;
          }
        }
        if (!placed) clusters.push([p]);
      }
      let dedupedCount = 0;
      for (const arr of clusters) {
        if (arr.length <= 1) continue;
        // Prefer categorized row as canonical
        arr.sort((a: Prod, b: Prod) => {
          const ac = a.category ? 1 : 0;
          const bc = b.category ? 1 : 0;
          if (ac !== bc) return bc - ac;
          // Prefer having expiryDate
          const ae = (a as any).expiryDate ? 1 : 0;
          const be = (b as any).expiryDate ? 1 : 0;
          if (ae !== be) return be - ae;
          // Prefer having barcode
          const ab = (a as any).barcode ? 1 : 0;
          const bb = (b as any).barcode ? 1 : 0;
          if (ab !== bb) return bb - ab;
          // Otherwise stable
          return 0;
        });
        const canonical = arr[0];
        // Merge quantities: sum stock across duplicates
        let mergedStock = canonical.stockQuantity ?? 0;
        let mergedCategory = canonical.category ?? null;
        let mergedPrice = canonical.price;
        let mergedPurchase = canonical.purchasePrice ?? null;
        let mergedExpiry = (canonical as any).expiryDate ?? null;
        let mergedDesc = (canonical as any).description ?? null;
        let mergedPack = (canonical as any).packSize ?? null;
        let mergedBarcode = (canonical as any).barcode ?? null;

        for (let i = 1; i < arr.length; i++) {
          const dup = arr[i] as any;
          const dupStock = typeof dup.stockQuantity === "number" ? dup.stockQuantity : 0;
          mergedStock = (mergedStock || 0) + (dupStock || 0);
          if (!mergedCategory && dup.category) mergedCategory = dup.category;
          if (typeof dup.price === "number") mergedPrice = dup.price;
          if (dup.purchasePrice != null) mergedPurchase = dup.purchasePrice;
          if (!mergedExpiry && dup.expiryDate) mergedExpiry = dup.expiryDate as Date;
          if (!mergedDesc && dup.description) mergedDesc = dup.description;
          if (!mergedPack && dup.packSize) mergedPack = dup.packSize;
          if (!mergedBarcode && dup.barcode) mergedBarcode = String(dup.barcode).trim();
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
            barcode: mergedBarcode ?? null,
          },
        });
        for (let i = 1; i < arr.length; i++) {
          try {
            await prisma.products.delete({ where: { productId: arr[i].productId } });
            dedupedCount += 1;
          } catch (deleteErr: any) {
            // Ignore deletion errors (likely foreign key constraints from purchases/invoices)
            // Just skip deleting this duplicate; it will remain as a legacy entry
            console.warn(`Failed to delete duplicate product ${arr[i].productId}: ${deleteErr.message}`);
          }
        }
      }

      // Global dedupe across the entire products table to catch legacy duplicates
      const allProducts = await prisma.products.findMany({ where: { tenantId } });
      type AnyProd = typeof allProducts[number] & { packSize?: string | null, barcode?: string | null };
      const globalClusters: AnyProd[][] = [];
      for (const p of allProducts as AnyProd[]) {
        let placed = false;
        for (const cluster of globalClusters) {
          if (cluster.some(m => samePack(m as any, p as any) && jaccard((m as any).name, (p as any).name) >= SIM_THRESHOLD)) {
            cluster.push(p);
            placed = true;
            break;
          }
        }
        if (!placed) globalClusters.push([p]);
      }
      // Prepare category list for mapping
      const catRows = await prisma.products.findMany({ where: { category: { not: null } }, select: { category: true } });
      const categoriesList: string[] = Array.from(new Set(catRows.map((r: { category: string | null }) => String(r.category || "")).filter((s: string) => s.length > 0)));
      const mapCategory = (val: string | null) => {
        if (!val) return null;
        // 1) Split on common separators like '/', '-', '&', ',' and pick the strongest segment
        // Split by '/', ',', '&', or '-' (hyphen). Place '-' at the end of the class to avoid range.
        const rawSegments = val.split(/[\/,&-]+/).map(s => s.trim()).filter(Boolean);
        const singularize = (s: string) => {
          const parts = s.split(/\s+/);
          if (parts.length) {
            const last = parts[parts.length - 1];
            if (/^[A-Za-z]+s$/i.test(last)) parts[parts.length - 1] = last.slice(0, -1);
            s = parts.join(" ");
          }
          return s;
        };
        const segments = rawSegments.length ? rawSegments.map(singularize) : [singularize(val)];

        // 2) If a segment exactly exists in categoriesList (case-insensitive), prefer that
        const findExact = (s: string) => {
          const lower = s.toLowerCase();
          for (const c of categoriesList) {
            if (c.toLowerCase() === lower) return c;
          }
          return null;
        };
        for (const seg of segments) {
          const exact = findExact(seg);
          if (exact) return exact;
        }

        // 3) Otherwise, rank by similarity and prefer the shortest best match
        const ranked = categoriesList
          .map((c: string) => ({ c, s: Math.max(...segments.map((seg: string) => jaccard(seg, c))) }))
          .sort((a: { c: string; s: number }, b: { c: string; s: number }) => {
            if (a.s !== b.s) return b.s - a.s;
            return a.c.length - b.c.length;
          });
        const top = ranked[0];
        if (!top || top.s < 0.4) {
          // 4) If we didn't find a good match, default to the first segment
          return segments[0];
        }
        return top.c;
      };

      for (const arr of globalClusters) {
        if (arr.length <= 1) continue;
        arr.sort((a, b) => {
          const ac = (a as any).category ? 1 : 0;
          const bc = (b as any).category ? 1 : 0;
          if (ac !== bc) return bc - ac;
          const ab = (a as any).barcode ? 1 : 0;
          const bb = (b as any).barcode ? 1 : 0;
          if (ab !== bb) return bb - ab;
          return 0;
        });
        const canonical = arr[0] as AnyProd;
        let mergedStock = canonical.stockQuantity ?? 0;
        let mergedCategory = (canonical as any).category ?? null;
        let mergedPrice = (canonical as any).price;
        let mergedPurchase = (canonical as any).purchasePrice ?? null;
        let mergedExpiry = (canonical as any).expiryDate ?? null;
        let mergedDesc = (canonical as any).description ?? null;
        let mergedPack = (canonical as any).packSize ?? null;
        let mergedBarcode = (canonical as any).barcode ?? null;
        for (let i = 1; i < arr.length; i++) {
          const dup = arr[i] as any;
          const dupStock = typeof dup.stockQuantity === "number" ? dup.stockQuantity : 0;
          mergedStock = (mergedStock || 0) + (dupStock || 0);
          if (!mergedCategory && dup.category) mergedCategory = dup.category;
          if (typeof dup.price === "number") mergedPrice = dup.price;
          if (dup.purchasePrice != null) mergedPurchase = dup.purchasePrice;
          if (!mergedExpiry && dup.expiryDate) mergedExpiry = dup.expiryDate as Date;
          if (!mergedDesc && dup.description) mergedDesc = dup.description;
          if (!mergedPack && dup.packSize) mergedPack = dup.packSize;
          if (!mergedBarcode && dup.barcode) mergedBarcode = String(dup.barcode).trim();
        }
        await prisma.products.update({
          where: { productId: canonical.productId },
          data: {
            stockQuantity: Math.max(0, Math.floor(mergedStock)),
            category: mapCategory(mergedCategory),
            price: mergedPrice,
            purchasePrice: mergedPurchase,
            expiryDate: mergedExpiry,
            description: mergedDesc,
            packSize: mergedPack,
            barcode: mergedBarcode ?? null,
          },
        });
        for (let i = 1; i < arr.length; i++) {
          await prisma.products.delete({ where: { productId: arr[i].productId } });
          dedupedCount += 1;
        }
      }

      // Normalize categories for all products, even when not in a duplicate cluster
      for (const p of allProducts as AnyProd[]) {
        const current = (p as any).category ?? null;
        const normalized = mapCategory(current);
        if (normalized && normalized !== current) {
          await prisma.products.update({ where: { productId: (p as any).productId }, data: { category: normalized } });
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
          barcode: item.barcode ?? undefined,
        });
      }
      const merged = Array.from(map.values());
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
    } catch (persistErr) {
      console.warn("Failed to persist imported products to JSON:", persistErr);
    }

    // Clear product search cache so UI sees fresh results immediately
    try {
      PRODUCT_SEARCH_CACHE.clear();
    } catch {}

    appendNotification({
      type: "product",
      message: `Imported ${insertedCount}, updated ${updatedCount}, deleted ${deletedCount} (processed ${productsToInsert.length})`,
      actorUserId: req.user?.userId,
      tenantId,
    });
    // Sync JSON snapshot with DB after import
    await syncProductsJsonFromDb(prisma);
    res.status(201).json({ insertedCount, updatedCount, deletedCount, attempted: productsToInsert.length });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error importing products"));
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
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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
            tenantId,
            OR: keyTokens.map((t) => ({ name: { contains: t, mode: "insensitive" } })),
          },
        });
      } else {
        candidates = await prisma.products.findMany({ where: { name: { contains: item.name, mode: "insensitive" }, tenantId } });
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

    appendNotification({ type: "inventory", message: `Processed invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId, tenantId });
    res.json({ customer: cust, items, updates });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error processing invoice"));
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
      const tenantId = req.tenantId || req.user?.tenantId || "default";
      if (it?.productId) {
        const p = await prisma.products.findFirst({ where: { productId: String(it.productId), tenantId } });
        if (p) product = { productId: p.productId, name: p.name, price: Number(p.price), stockQuantity: p.stockQuantity };
      }
      if (!product && it?.name) {
        // Try exact by name then loose contains
        const name = String(it.name).trim();
        const pExact = await prisma.products.findFirst({ where: { name, tenantId } });
        if (pExact) {
          product = { productId: pExact.productId, name: pExact.name, price: Number(pExact.price), stockQuantity: pExact.stockQuantity };
        }
        if (!product) {
          const candidates = await prisma.products.findMany({ where: { name: { contains: name, mode: 'insensitive' }, tenantId }, take: 1 });
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

    // appendNotification({ type: "inventory", message: `Processed manual invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId });
    res.json({ customer: cust, updates });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error processing manual invoice"));
  }
};

// Delete a single product and dependent rows, then sync JSON
export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.products.findFirst({ where: { productId, tenantId } });
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
    const pcs = await readPcsInventory(req.tenantId || req.user?.tenantId || "default");
    const hasPcsRef = pcs.some((e) => String(e.name || "").trim().toLowerCase() === String(existing.name || "").trim().toLowerCase());
    if (hasPcsRef) {
      res.status(409).json({ message: "Cannot delete product while PCS inventory contains entries referencing it." });
      return;
    }
    await prisma.customerPurchases.deleteMany({ where: { productId } });
    await prisma.sales.deleteMany({ where: { productId } });
    await prisma.purchases.deleteMany({ where: { productId } });
    await prisma.products.delete({ where: { productId } });
    appendNotification({ type: "product", message: `Product deleted: ${existing.name}`, actorUserId: req.user?.userId, tenantId });
    await syncProductsJsonFromDb(prisma);

    try {
      const io = req.app.get("io");
      io.emit("product:deleted", { productId });
      io.emit("dashboard:refresh", { tenantId: req.user?.tenantId || "default" });
    } catch (err) {
      console.warn("Socket emission failed for deleteProduct", err);
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error deleting product"));
  }
};

// Purge all products and dependent rows, clear JSON files, and sync
export const purgeProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    await prisma.customerPurchases.deleteMany({});
    await prisma.sales.deleteMany({});
    await prisma.purchases.deleteMany({});
    await prisma.products.deleteMany({});
    writeEmptyProductsJson();
    writeEmptyImportedProductsJson();
    await syncProductsJsonFromDb(prisma);
    await appendNotification({ type: "product", message: "Purged all products and related records", actorUserId: req.user?.userId, tenantId });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Error purging products"));
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
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const products = await prisma.products.findMany({ where: { tenantId }, orderBy: { name: "asc" } });

    const norm = (s: string | null | undefined) => (s ?? "").toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    const keyOf = (name: string, packSize: string | null | undefined) => `${norm(name)}|${norm(packSize ?? null)}`;

    let rows: any[] = products.map((p: any) => ({
      Name: p.name,
      Barcode: (p as any).barcode ?? "",
      PackSize: (p as any).packSize ?? "",
      Category: p.category ?? "",
      PurchasePrice: p.purchasePrice ?? "",
      SalesPrice: p.price ?? "",
      Quantity: p.stockQuantity ?? 0,
      ExpiryDate: p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : "",
      Description: (p as any).description ?? "",
    }));

    const seen = new Set<string>(products.map((p: any) => keyOf(p.name, (p as any).packSize ?? null)));

    const samplePath = path.join(__dirname, "../../assets/barcode-products.xlsx");
    if (fs.existsSync(samplePath)) {
      const workbook = XLSX.read(fs.readFileSync(samplePath), { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const incoming: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });
      const normalizeKey = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();

      const existingCategoriesRaw = await prisma.products.findMany({ select: { category: true }, where: { tenantId, category: { not: null } } });
      const existingCategories: string[] = Array.from(new Set<string>(existingCategoriesRaw.map((r: any) => String(r.category))));
      const similarity = (a: string, b: string): number => {
        const ta = a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const tb = b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        if (!ta.length || !tb.length) return 0;
        const setA = new Set(ta);
        let score = 0;
        for (const t of tb) if (setA.has(t)) score += 1;
        return score / Math.max(ta.length, tb.length);
      };
      const bestCategoryForName = (name: string): string | null => {
        let best: { cat: string; score: number } | null = null;
        for (const cat of existingCategories as string[]) {
          const s = similarity(name, cat);
          if (!best || s > best.score) best = { cat, score: s };
        }
        return best && best.score > 0 ? best.cat : null;
      };

      for (const row of incoming) {
        const kv: Record<string, any> = {};
        for (const k of Object.keys(row)) kv[normalizeKey(k)] = row[k];
        const name = kv["product"] ?? kv["product name"] ?? kv["product description"] ?? kv["productdescription"] ?? kv["name"] ?? null;
        const packSize = kv["pack size"] ?? kv["packsize"] ?? kv["size"] ?? null;
        const barcode = kv["barcode"] ?? kv["bar code"] ?? kv["ean"] ?? kv["upc"] ?? null;
        const category = kv["category"] ?? kv["product category"] ?? null;
        if (!name) continue;
        const k = keyOf(String(name), packSize ? String(packSize) : null);
        if (seen.has(k)) continue;
        rows.push({
          Name: String(name),
          Barcode: barcode ? String(barcode).trim() : "",
          PackSize: packSize ? String(packSize) : "",
          Category: category ? String(category) : (bestCategoryForName(String(name)) ?? ""),
          PurchasePrice: "",
          SalesPrice: "",
          Quantity: "",
          ExpiryDate: "",
          Description: "",
        });
      }
    }

    const header = [
      "Name",
      "Barcode",
      "PackSize",
      "Category",
      "PurchasePrice",
      "SalesPrice",
      "Quantity",
      "ExpiryDate",
      "Description",
    ];
    if (tenantId !== "default") {
      rows = [];
    }
    const wb = XLSX.utils.book_new();
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows, { header })
      : XLSX.utils.aoa_to_sheet([header]);
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=barcode-products-updated.xlsx");
    res.status(200).send(buffer);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to generate sample file"));
  }
};

// Serve PCS sample Excel
export const getPcsSample = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const pcs = await readPcsInventory(tenantId);
    const products = await prisma.products.findMany({ where: { tenantId } });
    const byName = new Map<string, any>(products.map((p: any) => [String(p.name).toLowerCase(), p] as const));

    const rows = tenantId === "default" ? pcs.map((e) => {
      const match = byName.get(String(e.name).toLowerCase());
      return {
        Name: e.name,
        Barcode: (match as any)?.barcode ?? "",
        PackSize: e.packSize ?? (match as any)?.packSize ?? "",
        Category: match?.category ?? "",
        PCSQuantity: e.quantity ?? 0,
        PurchasePrice: match?.purchasePrice ?? "",
        SalesPrice: match?.price ?? "",
        ExpiryDate: match?.expiryDate ? new Date(match.expiryDate).toLocaleDateString() : "",
        Description: (match as any)?.description ?? "",
      };
    }) : [];

    const headerPcs = [
      "Name",
      "Barcode",
      "PackSize",
      "Category",
      "PCSQuantity",
      "PurchasePrice",
      "SalesPrice",
      "ExpiryDate",
      "Description",
    ];
    const wb = XLSX.utils.book_new();
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows, { header: headerPcs })
      : XLSX.utils.aoa_to_sheet([headerPcs]);
    XLSX.utils.book_append_sheet(wb, ws, "PCS");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=PCS-sample.xlsx");
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to generate PCS sample file"));
  }
};

// Export PCS inventory as Excel
export const exportPcsExcel = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pcs = await readPcsInventory();
    const products = await prisma.products.findMany({});
    const byName = new Map<string, any>(products.map((p: any) => [String(p.name).toLowerCase(), p] as const));
    const rows = pcs.map((e) => {
      const match = byName.get(String(e.name).toLowerCase());
      return {
        Name: e.name,
        Barcode: (match as any)?.barcode ?? "",
        PackSize: e.packSize ?? match?.packSize ?? "",
        Category: match?.category ?? "",
        PCSQuantity: e.quantity ?? 0,
        PurchasePrice: match?.purchasePrice ?? "",
        SalesPrice: match?.price ?? "",
        ExpiryDate: match?.expiryDate ? new Date(match.expiryDate).toLocaleDateString() : "",
        Description: (match as any)?.description ?? "",
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: [
      "Name",
      "Barcode",
      "PackSize",
      "Category",
      "PCSQuantity",
      "PurchasePrice",
      "SalesPrice",
      "ExpiryDate",
      "Description",
    ]});
    XLSX.utils.book_append_sheet(wb, ws, "PCS");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=pcs.xlsx");
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to export PCS inventory as Excel"));
  }
};

// Return last updated timestamps per product field
export const getProductUpdatesLast = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const last = getLastFieldUpdates();
    // Enrich with product names for display
    const ids = Object.keys(last);
    const products = ids.length ? await prisma.products.findMany({ where: { productId: { in: ids }, tenantId } }) : [];
    const nameMap = new Map<string, string>(products.map((p: any) => [p.productId, p.name] as const));
    const payload = ids.map((id) => ({ productId: id, name: nameMap.get(id) || "Unknown", last: last[id] }));
    res.json(payload);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "product", "Failed to load last updates"));
  }
};
