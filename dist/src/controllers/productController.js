"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProductUpdatesLast = exports.exportPcsExcel = exports.getPcsSample = exports.getImportSample = exports.purgeProducts = exports.deleteProduct = exports.processInvoiceManual = exports.processInvoice = exports.importProducts = exports.upsertPcsItems = exports.importPcsProducts = exports.getPcsProducts = exports.exportProductsExcel = exports.exportProducts = exports.updateProduct = exports.getProductById = exports.createProduct = exports.getProducts = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
// Simple in-memory cache for product search results (per process)
const PRODUCT_SEARCH_CACHE = new Map();
const PRODUCT_SEARCH_TTL_MS = 30000; // 30s TTL
const notificationService_1 = require("../services/notificationService");
const productSyncService_1 = require("../services/productSyncService");
const customerSalesService_1 = require("../services/customerSalesService");
const pcsInventoryService_1 = require("../services/pcsInventoryService");
const productUpdateAuditService_1 = require("../services/productUpdateAuditService");
const xlsx_1 = __importDefault(require("xlsx"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const crypto_1 = require("crypto");
// pdf-parse lacks TypeScript types; use require to avoid compile errors in ts-node
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");
// Use shared Prisma client
const getProducts = async (req, res) => {
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
        const products = await prisma_1.default.products.findMany({
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
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving products" });
    }
};
exports.getProducts = getProducts;
const createProduct = async (req, res) => {
    try {
        const { name, price, stockQuantity, category, description, packSize } = req.body;
        const product = await prisma_1.default.products.create({
            data: {
                productId: (0, crypto_1.randomUUID)(),
                name,
                price,
                stockQuantity,
                category,
                description,
                packSize,
            },
        });
        // Log notification for product creation
        (0, notificationService_1.appendNotification)({
            type: "product",
            message: `Product created: ${name} (qty: ${stockQuantity})`,
            actorUserId: req.user?.userId,
        });
        // Sync JSON snapshot after write
        await (0, productSyncService_1.syncProductsJsonFromDb)(prisma_1.default);
        res.status(201).json(product);
    }
    catch (error) {
        res.status(500).json({ message: "Error creating product" });
    }
};
exports.createProduct = createProduct;
const getProductById = async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await prisma_1.default.products.findUnique({ where: { productId } });
        if (!product) {
            res.status(404).json({ message: "Product not found" });
            return;
        }
        res.json(product);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving product" });
    }
};
exports.getProductById = getProductById;
const updateProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const { name, price, purchasePrice, stockQuantity, expiryDate, category, description, packSize } = req.body;
        const existing = await prisma_1.default.products.findUnique({ where: { productId } });
        if (!existing) {
            res.status(404).json({ message: "Product not found" });
            return;
        }
        const data = {};
        if (typeof name === "string")
            data.name = name;
        if (price !== undefined && price !== null && !isNaN(Number(price)))
            data.price = Number(price);
        if (purchasePrice !== undefined && purchasePrice !== null && !isNaN(Number(purchasePrice)))
            data.purchasePrice = Number(purchasePrice);
        if (stockQuantity !== undefined && stockQuantity !== null && !isNaN(Number(stockQuantity)))
            data.stockQuantity = Number(stockQuantity);
        if (expiryDate !== undefined) {
            if (expiryDate === null || expiryDate === "") {
                data.expiryDate = null;
            }
            else {
                const d = new Date(expiryDate);
                if (isNaN(d.getTime())) {
                    res.status(400).json({ message: "Invalid expiryDate" });
                    return;
                }
                data.expiryDate = d;
            }
        }
        if (category !== undefined)
            data.category = category ?? null;
        if (description !== undefined)
            data.description = description ?? null;
        if (packSize !== undefined)
            data.packSize = packSize ?? null;
        const updated = await prisma_1.default.products.update({ where: { productId }, data });
        try {
            const changed = [];
            const keys = Object.keys(data);
            for (const k of keys) {
                const oldVal = existing[k];
                const newVal = data[k];
                const oldNorm = oldVal instanceof Date ? oldVal.getTime() : oldVal;
                const newNorm = newVal instanceof Date ? newVal.getTime() : newVal;
                if (oldNorm !== newNorm)
                    changed.push(k);
            }
            if (changed.length)
                (0, productUpdateAuditService_1.recordFieldUpdates)(productId, changed, "api");
        }
        catch (logErr) {
            console.warn("Failed to log field updates on updateProduct:", logErr);
        }
        (0, notificationService_1.appendNotification)({
            type: "product",
            message: `Product updated: ${updated.name}`,
            actorUserId: req.user?.userId,
        });
        // Sync JSON snapshot after update
        await (0, productSyncService_1.syncProductsJsonFromDb)(prisma_1.default);
        res.json(updated);
    }
    catch (error) {
        console.error("updateProduct error:", error);
        res.status(500).json({ message: "Error updating product" });
    }
};
exports.updateProduct = updateProduct;
const exportProducts = async (req, res) => {
    try {
        const products = await prisma_1.default.products.findMany({ orderBy: { name: "asc" } });
        const json = JSON.stringify(products, null, 2);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", "attachment; filename=products.json");
        res.status(200).send(json);
    }
    catch (error) {
        console.error("exportProducts error:", error);
        res.status(500).json({ message: "Failed to export products" });
    }
};
exports.exportProducts = exportProducts;
// Export products as Excel
const exportProductsExcel = async (req, res) => {
    try {
        const products = await prisma_1.default.products.findMany({ orderBy: { name: "asc" } });
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
        const wb = xlsx_1.default.utils.book_new();
        const ws = xlsx_1.default.utils.json_to_sheet(rows, { header: [
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
            ] });
        xlsx_1.default.utils.book_append_sheet(wb, ws, "Products");
        const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");
        res.status(200).send(buf);
    }
    catch (error) {
        console.error("exportProductsExcel error:", error);
        res.status(500).json({ message: "Failed to export products as Excel" });
    }
};
exports.exportProductsExcel = exportProductsExcel;
const getPcsProducts = async (req, res) => {
    try {
        const rawSearch = req.query.search?.toString() ?? "";
        const search = rawSearch.trim().toLowerCase();
        const pcs = (0, pcsInventoryService_1.readPcsInventory)();
        // Load all products to allow robust matching and enrichment
        const products = await prisma_1.default.products.findMany({});
        // Helper normalization (aligned with invoice parsing heuristics)
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        const normalizeWithSynonyms = (s) => normalize(s
            .replace(/\byoghurt\b/gi, "yogurt")
            .replace(/\bflavour\b/gi, "flavor")
            .replace(/(\d+)([a-z]+)/gi, "$1 $2"));
        const tokensOf = (s) => normalizeWithSynonyms(s).split(" ").filter(Boolean);
        const FILLER_TOKENS = new Set(["drink", "flavor", "flavour", "ctn", "carton", "pack", "copy", "x"]);
        const normSimple = (s) => String(s ?? "").replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const extractNum = (s) => {
            const m = String(s ?? "").match(/\d+/);
            return m ? Number(m[0]) : null;
        };
        const packEq = (a, b) => {
            const na = extractNum(a);
            const nb = extractNum(b);
            if (na != null && nb != null)
                return na === nb;
            return normSimple(a) === normSimple(b);
        };
        // Build indices for quick matching
        const byExact = new Map(products.map(p => [p.name.toLowerCase(), p]));
        const byNorm = new Map();
        for (const p of products) {
            const toks = new Set(tokensOf(p.name).filter(t => !FILLER_TOKENS.has(t)));
            byNorm.set(normalizeWithSynonyms(p.name), { product: p, toks });
        }
        // Accumulate results with deduplication by matched product or normalized name
        const agg = new Map();
        for (const e of pcs) {
            const exact = byExact.get(e.name.toLowerCase());
            let matched = exact ?? null;
            if (!matched) {
                const etoks = new Set(tokensOf(e.name).filter(t => !FILLER_TOKENS.has(t)));
                // Score candidates by token overlap; prefer pack match when available
                let best = null;
                for (const { product, toks } of byNorm.values()) {
                    // quick skip when overlap is tiny
                    const overlap = Array.from(etoks).filter(t => toks.has(t)).length;
                    if (overlap === 0)
                        continue;
                    let score = overlap;
                    if (e.packSize && packEq(e.packSize, product.packSize))
                        score += 2;
                    if (!best || score > best.score)
                        best = { product, score };
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
                packSize: (matched?.packSize ?? e.packSize ?? null),
                category: matched?.category ?? null,
                expiryDate: matched?.expiryDate ?? null,
                price: matched?.price ?? 0,
                purchasePrice: matched?.purchasePrice ?? null,
            };
            agg.set(key, payload);
        }
        let enriched = Array.from(agg.values());
        if (search) {
            enriched = enriched.filter((e) => String(e.name || "").toLowerCase().includes(search));
        }
        res.json(enriched);
    }
    catch (err) {
        console.error("getPcsProducts error:", err);
        res.status(500).json({ message: "Failed to load PCS products" });
    }
};
exports.getPcsProducts = getPcsProducts;
const importPcsProducts = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        const workbook = xlsx_1.default.read(file.buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = xlsx_1.default.utils.sheet_to_json(worksheet, { defval: null });
        if (!rows.length) {
            res.status(400).json({ message: "Uploaded sheet is empty." });
            return;
        }
        const norm = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const coerceNumber = (val) => {
            if (val === null || val === undefined)
                return null;
            if (typeof val === "number" && Number.isFinite(val))
                return val;
            const s = String(val);
            const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
            if (!m)
                return null;
            const n = Number(m[0]);
            return Number.isFinite(n) ? n : null;
        };
        const incoming = [];
        for (const row of rows) {
            const kv = {};
            for (const k of Object.keys(row))
                kv[norm(k)] = row[k];
            let name = kv["name"] ?? kv["product"] ?? kv["item"] ?? kv["product description"] ?? kv["description"];
            // Fallback: first non-empty string cell as name
            if (!name) {
                const firstStrKey = Object.keys(kv).find((k) => typeof kv[k] === "string" && String(kv[k]).trim().length > 0);
                if (firstStrKey)
                    name = kv[firstStrKey];
            }
            if (!name)
                continue;
            let qty = coerceNumber(kv["pcs"] ?? kv["quantity"] ?? kv["qty"] ?? kv["pcs qty"] ?? kv["qty pcs"] ?? kv["pcs quantity"] ?? kv["quantity pcs"] ?? kv["pieces"] ?? kv["pcs count"] ?? kv["count pcs"]);
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
            if (qty == null)
                qty = 0;
            const packSize = kv["pack size"] ?? kv["pack"] ?? null;
            incoming.push({ name: String(name).trim(), quantity: Math.max(0, Number(qty)), packSize: packSize ? String(packSize).trim() : null });
        }
        const merged = (0, pcsInventoryService_1.upsertPcsEntries)(incoming);
        (0, notificationService_1.appendNotification)({ type: "product", message: `Imported ${incoming.length} PCS products`, actorUserId: req.user?.userId });
        res.json({ imported: incoming.length, total: merged.length });
    }
    catch (err) {
        console.error("importPcsProducts error:", err);
        res.status(500).json({ message: "Failed to import PCS products" });
    }
};
exports.importPcsProducts = importPcsProducts;
// Upsert a PCS entry (or multiple) directly via JSON body
const upsertPcsItems = async (req, res) => {
    try {
        const body = req.body;
        let items = [];
        if (Array.isArray(body)) {
            items = body.map((e) => ({ name: String(e?.name || "").trim(), quantity: Math.max(0, Number(e?.quantity) || 0), packSize: e?.packSize ? String(e.packSize).trim() : null }));
        }
        else if (body && typeof body === "object") {
            const name = String(body?.name || "").trim();
            const qty = Math.max(0, Number(body?.quantity) || 0);
            const packSize = body?.packSize ? String(body.packSize).trim() : null;
            if (!name) {
                res.status(400).json({ message: "Missing 'name' for PCS item" });
                return;
            }
            items = [{ name, quantity: qty, packSize }];
        }
        else {
            res.status(400).json({ message: "Invalid request body" });
            return;
        }
        const merged = (0, pcsInventoryService_1.upsertPcsEntries)(items);
        (0, notificationService_1.appendNotification)({ type: "product", message: `Upserted ${items.length} PCS item(s)`, actorUserId: req.user?.userId });
        res.json({ upserted: items.length, total: merged.length });
    }
    catch (err) {
        console.error("upsertPcsItems error:", err);
        res.status(500).json({ message: "Failed to upsert PCS items" });
    }
};
exports.upsertPcsItems = upsertPcsItems;
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
const importProducts = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        // Parse Excel buffer
        const workbook = xlsx_1.default.read(file.buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = xlsx_1.default.utils.sheet_to_json(worksheet, { defval: null });
        if (!rows.length) {
            res.status(400).json({ message: "Uploaded sheet is empty." });
            return;
        }
        // Normalize header keys: lower-case, collapse spaces, replace NBSP, and also provide a no-punctuation variant
        const normalizeKey = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        // Helper to coerce mixed-formatted numeric cells (e.g., "$1,234.50", "GH₵ 12.3", "50 Qty")
        const coerceNumber = (val) => {
            if (val === null || val === undefined)
                return null;
            if (typeof val === "number" && Number.isFinite(val))
                return val;
            const s = String(val);
            // Extract first numeric token including optional decimal
            const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
            if (!m)
                return null;
            const n = Number(m[0]);
            return Number.isFinite(n) ? n : null;
        };
        let currentCategory = null;
        const productsToInsert = rows
            .map((row) => {
            const keys = Object.keys(row);
            const kv = {};
            for (const k of keys) {
                const base = normalizeKey(k);
                kv[base] = row[k];
                const noPunct = base.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
                if (noPunct && noPunct !== base)
                    kv[noPunct] = row[k];
            }
            const productId = kv["productid"] ?? kv["id"] ?? kv["sku"] ?? (0, crypto_1.randomUUID)();
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
            const coerceDate = (val) => {
                if (val === null || val === undefined)
                    return null;
                if (val instanceof Date && !Number.isNaN(val.getTime()))
                    return val;
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
            const finalStock = stockQuantity === null ? 0 : Math.floor(stockQuantity);
            return {
                productId: String(productId),
                name: String(name),
                price: finalPrice,
                purchasePrice: (purchasePrice !== null && Number.isFinite(purchasePrice)) ? purchasePrice : null,
                stockQuantity: finalStock,
                expiryDate: expiryDate ?? null,
                category: (category ? String(category) : (currentCategory ? String(currentCategory) : null)),
                description: description ? String(description) : null,
                packSize: packSize ? String(packSize) : null,
            };
        })
            .filter(Boolean);
        if (!productsToInsert.length) {
            res.status(400).json({ message: "No valid product rows found in the sheet." });
            return;
        }
        // Deduplicate by name + packSize: update existing rows; create new for unknown pairs
        const normalizeText = (s) => (s ?? "").toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const names = Array.from(new Set(productsToInsert.map(p => p.name)));
        const existingCandidates = await prisma_1.default.products.findMany({
            where: { name: { in: names } },
        });
        const keyOf = (p) => `${normalizeText(p.name)}|${normalizeText(p.packSize)}`;
        const existingMap = new Map();
        for (const p of existingCandidates) {
            existingMap.set(keyOf({ name: p.name, packSize: p.packSize ?? null }), p);
        }
        let insertedCount = 0;
        const mergedItemsForJson = [];
        // Parse optional selective update fields from multipart form (CSV or JSON array)
        const rawUpdateFields = req.body?.updateFields ?? undefined;
        let updateFieldsSet = null;
        if (rawUpdateFields && typeof rawUpdateFields === "string") {
            try {
                const trimmed = rawUpdateFields.trim();
                let arr = [];
                if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                    arr = JSON.parse(trimmed);
                }
                else {
                    arr = trimmed.split(/[,;\s]+/).filter(Boolean);
                }
                const normalizeField = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
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
                if (selected.length > 0)
                    updateFieldsSet = new Set(selected);
            }
            catch {
                // ignore parse errors; fall back to updating all fields
                updateFieldsSet = null;
            }
        }
        for (const item of productsToInsert) {
            const key = keyOf({ name: item.name, packSize: item.packSize });
            const existing = existingMap.get(key);
            if (existing) {
                const dataUpdate = {};
                const should = (field) => !updateFieldsSet || updateFieldsSet.has(field);
                if (should("name"))
                    dataUpdate.name = item.name;
                if (should("price"))
                    dataUpdate.price = item.price;
                if (should("purchaseprice"))
                    dataUpdate.purchasePrice = item.purchasePrice;
                if (should("stockquantity"))
                    dataUpdate.stockQuantity = item.stockQuantity;
                if (should("expirydate"))
                    dataUpdate.expiryDate = item.expiryDate ?? null;
                if (should("category"))
                    dataUpdate.category = (existing.category ?? item.category ?? null);
                if (should("description"))
                    dataUpdate.description = item.description ?? existing.description ?? null;
                if (should("packsize"))
                    dataUpdate.packSize = item.packSize ?? existing.packSize ?? null;
                await prisma_1.default.products.update({ where: { productId: existing.productId }, data: dataUpdate });
                try {
                    const changed = [];
                    for (const k of Object.keys(dataUpdate)) {
                        const oldVal = existing[k];
                        const newVal = dataUpdate[k];
                        const oldNorm = oldVal instanceof Date ? oldVal.getTime() : oldVal;
                        const newNorm = newVal instanceof Date ? newVal.getTime() : newVal;
                        if (oldNorm !== newNorm)
                            changed.push(k);
                    }
                    if (changed.length)
                        (0, productUpdateAuditService_1.recordFieldUpdates)(existing.productId, changed, "import");
                }
                catch (logErr) {
                    console.warn("Failed to log field updates on import update:", logErr);
                }
                mergedItemsForJson.push({ ...item, productId: existing.productId });
            }
            else {
                await prisma_1.default.products.create({ data: item });
                try {
                    (0, productUpdateAuditService_1.recordFieldUpdates)(item.productId, ["name", "price", "purchasePrice", "stockQuantity", "expiryDate", "category", "description", "packSize"].filter((f) => item[f] !== undefined), "import");
                }
                catch (logErr) {
                    console.warn("Failed to log field updates on import create:", logErr);
                }
                insertedCount += 1;
                mergedItemsForJson.push(item);
            }
        }
        // After processing import rows, collapse any existing duplicates in DB for the same name+packSize
        try {
            const candidatesForDedupe = await prisma_1.default.products.findMany({ where: { name: { in: names } } });
            const groups = new Map();
            for (const p of candidatesForDedupe) {
                const k = keyOf({ name: p.name, packSize: p.packSize ?? null });
                const arr = groups.get(k) ?? [];
                arr.push(p);
                groups.set(k, arr);
            }
            let dedupedCount = 0;
            for (const [k, arr] of groups.entries()) {
                if (arr.length <= 1)
                    continue;
                // Prefer categorized row as canonical
                arr.sort((a, b) => {
                    const ac = a.category ? 1 : 0;
                    const bc = b.category ? 1 : 0;
                    if (ac !== bc)
                        return bc - ac;
                    // Prefer having expiryDate
                    const ae = a.expiryDate ? 1 : 0;
                    const be = b.expiryDate ? 1 : 0;
                    if (ae !== be)
                        return be - ae;
                    // Otherwise stable
                    return 0;
                });
                const canonical = arr[0];
                // Avoid doubled quantities: keep the highest stock across duplicates
                let mergedStock = canonical.stockQuantity ?? 0;
                let mergedCategory = canonical.category ?? null;
                let mergedPrice = canonical.price;
                let mergedPurchase = canonical.purchasePrice ?? null;
                let mergedExpiry = canonical.expiryDate ?? null;
                let mergedDesc = canonical.description ?? null;
                let mergedPack = canonical.packSize ?? null;
                for (let i = 1; i < arr.length; i++) {
                    const dup = arr[i];
                    const dupStock = typeof dup.stockQuantity === "number" ? dup.stockQuantity : 0;
                    mergedStock = Math.max(mergedStock, dupStock);
                    if (!mergedCategory && dup.category)
                        mergedCategory = dup.category;
                    if (typeof dup.price === "number")
                        mergedPrice = dup.price;
                    if (dup.purchasePrice != null)
                        mergedPurchase = dup.purchasePrice;
                    if (!mergedExpiry && dup.expiryDate)
                        mergedExpiry = dup.expiryDate;
                    if (!mergedDesc && dup.description)
                        mergedDesc = dup.description;
                    if (!mergedPack && dup.packSize)
                        mergedPack = dup.packSize;
                }
                await prisma_1.default.products.update({
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
                    await prisma_1.default.products.delete({ where: { productId: arr[i].productId } });
                    dedupedCount += 1;
                }
            }
            if (dedupedCount > 0) {
                console.log(`Deduped ${dedupedCount} duplicate products by name+packSize.`);
            }
        }
        catch (dedupeErr) {
            console.warn("Failed to dedupe existing products:", dedupeErr);
        }
        // Persist imported products to JSON file for audit and optional future seeding
        try {
            const seedDir = node_path_1.default.join(__dirname, "../../prisma/seedData");
            const outPath = node_path_1.default.join(seedDir, "importedProducts.json");
            if (!node_fs_1.default.existsSync(seedDir)) {
                node_fs_1.default.mkdirSync(seedDir, { recursive: true });
            }
            let existing = [];
            if (node_fs_1.default.existsSync(outPath)) {
                try {
                    existing = JSON.parse(node_fs_1.default.readFileSync(outPath, "utf-8"));
                }
                catch {
                    existing = [];
                }
            }
            const map = new Map();
            for (const item of existing) {
                if (item && item.productId)
                    map.set(String(item.productId), item);
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
            node_fs_1.default.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
        }
        catch (persistErr) {
            console.warn("Failed to persist imported products to JSON:", persistErr);
        }
        (0, notificationService_1.appendNotification)({
            type: "product",
            message: `Imported ${insertedCount} products from Excel (processed ${productsToInsert.length})`,
            actorUserId: req.user?.userId,
        });
        // Sync JSON snapshot with DB after import
        await (0, productSyncService_1.syncProductsJsonFromDb)(prisma_1.default);
        res.status(201).json({ insertedCount, attempted: productsToInsert.length });
    }
    catch (error) {
        console.error("importProducts error:", error);
        res.status(500).json({ message: "Error importing products" });
    }
};
exports.importProducts = importProducts;
// Process an invoice: parse text or PDF and deduct stock; persist customer and purchases
const processInvoice = async (req, res) => {
    try {
        const file = req.file;
        const { invoiceText } = req.body;
        let text = undefined;
        if (invoiceText && typeof invoiceText === "string" && invoiceText.trim().length > 0) {
            text = invoiceText;
        }
        else if (file && file.mimetype === "application/pdf") {
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
        const customer = {};
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
                    if (customer.name.includes(","))
                        customer.name = customer.name.split(",")[0].trim();
                    customer.name = customer.name.replace(/\s+(AJAH|LAGOS|STATE|NIGERIA).*$/i, "").trim();
                    continue;
                }
                if (!customer.address && /Lagos|NIGERIA|STATE/i.test(l)) {
                    customer.address = l;
                }
            }
        }
        // Helpers
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        const parseNumbers = (s) => {
            const nums = s.match(/\d[\d,]*\.?\d*/g) || [];
            return nums.map(n => Number(n.replace(/,/g, ""))).filter(n => !Number.isNaN(n));
        };
        // Name normalization with simple synonyms (e.g., yoghurt -> yogurt; flavour -> flavor)
        const normalizeWithSynonyms = (s) => normalize(s
            .replace(/\byoghurt\b/gi, "yogurt")
            .replace(/\bflavour\b/gi, "flavor")
            // Split combined number+unit tokens so "500ml" and "500 ml" normalize equally
            .replace(/(\d+)([a-z]+)/gi, "$1 $2"));
        const tokensOf = (s) => normalizeWithSynonyms(s).split(" ").filter(Boolean);
        const FILLER_TOKENS = new Set(["drink", "flavor", "flavour", "ctn", "carton", "pack", "copy", "x"]);
        const extractPackFromText = (s) => {
            // Only treat patterns like "X 12" as pack-size; do not capture "500ML" as pack
            const m = s.match(/\b[xX]\s*(\d{1,4})(?:\s*\([^)]*\))?/);
            let pack = null;
            let name = s;
            if (m) {
                pack = m[1];
                name = s.replace(m[0], " ");
            }
            name = name.replace(/\(copy\)/ig, " ").replace(/\s{2,}/g, " ").trim();
            return { name, pack };
        };
        const items = [];
        let pendingName = null;
        let pendingPackSize = null;
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const isHeaderLine = (/(Invoice\s*No\.|Customer|Total Paid|Total:|Bank Transfer|Date\b|SALES AGENT|Mobile:|Note:)/i.test(l)
                || /^\s*Invoice\s*$/i.test(l)
                || /Product\s+Quantity\s+Unit\s+Price\s+Subtotal/i.test(l)
                || /AMAGYZ|LAGOS,\s+NIGERIA/i.test(l));
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
                }
                else {
                    // Likely the actual product name (may include pack info inline)
                    const extracted = extractPackFromText(namePart);
                    pendingName = extracted.name;
                    if (extracted.pack && !pendingPackSize)
                        pendingPackSize = extracted.pack;
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
                        if (extracted.pack && !pendingPackSize)
                            pendingPackSize = extracted.pack;
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
                        if (extracted.pack && !pendingPackSize)
                            pendingPackSize = extracted.pack;
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
                    if (extracted.pack && !pendingPackSize)
                        pendingPackSize = extracted.pack;
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
                if (extracted.pack && !pendingPackSize)
                    pendingPackSize = extracted.pack;
                continue;
            }
        }
        if (!items.length) {
            res.status(400).json({ message: "No line items parsed from invoice." });
            return;
        }
        // Create or find customer
        const custName = customer.name || "Unknown Customer";
        let cust = await prisma_1.default.customers.findFirst({ where: { name: custName } });
        if (!cust) {
            cust = await prisma_1.default.customers.create({ data: {
                    customerId: (0, crypto_1.randomUUID)(),
                    name: custName,
                    mobile: customer.mobile,
                    address: customer.address,
                    city: customer.city,
                    state: customer.state,
                    country: customer.country,
                } });
        }
        // For each item, find product by name using robust matching, deduct stock, and record purchase
        const updates = [];
        // Helpers for pack-size comparison
        const normSimple = (s) => String(s ?? "").replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const extractNum = (s) => {
            const m = String(s ?? "").match(/\d+/);
            return m ? Number(m[0]) : null;
        };
        const packEq = (a, b) => {
            const na = extractNum(a);
            const nb = extractNum(b);
            if (na != null && nb != null)
                return na === nb;
            return normSimple(a) === normSimple(b);
        };
        for (const item of items) {
            const packNorm = (typeof item.packSize === "string" ? item.packSize : null);
            const invTokens = new Set(tokensOf(item.name).filter(t => !FILLER_TOKENS.has(t)));
            const keyTokens = Array.from(invTokens).filter(t => t.length >= 3).slice(0, 6);
            let candidates = [];
            if (keyTokens.length > 0) {
                candidates = await prisma_1.default.products.findMany({
                    where: {
                        OR: keyTokens.map((t) => ({ name: { contains: t, mode: "insensitive" } })),
                    },
                });
            }
            else {
                candidates = await prisma_1.default.products.findMany({ where: { name: { contains: item.name, mode: "insensitive" } } });
            }
            const subsetMatches = candidates.filter((p) => {
                const ptoks = new Set(tokensOf(p.name).filter((t) => !FILLER_TOKENS.has(t)));
                // Require every product token to appear in invoice tokens
                for (const t of ptoks) {
                    if (!invTokens.has(t))
                        return false;
                }
                if (packNorm && p.packSize) {
                    if (!packEq(p.packSize, packNorm))
                        return false;
                }
                return true;
            });
            let prod = subsetMatches[0];
            if (!prod) {
                // Fallbacks: strict normalized equality, then substring checks
                const normName = normalizeWithSynonyms(item.name);
                prod = candidates.find((p) => normalizeWithSynonyms(p.name) === normName && (packNorm ? packEq(p.packSize ?? null, packNorm) : true));
                if (!prod) {
                    prod = candidates.find((p) => (normalizeWithSynonyms(p.name).includes(normName) || normName.includes(normalizeWithSynonyms(p.name))) && (packNorm ? packEq(p.packSize ?? null, packNorm) : true));
                }
                if (!prod && candidates.length) {
                    // Overlap-based scoring fallback: pick best token overlap candidate
                    let best = null;
                    let bestScore = 0;
                    for (const p of candidates) {
                        const ptoks = new Set(tokensOf(p.name).filter((t) => !FILLER_TOKENS.has(t)));
                        let overlap = 0;
                        for (const t of ptoks) {
                            if (invTokens.has(t))
                                overlap++;
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
                (0, pcsInventoryService_1.adjustPcsQuantity)({ name: item.name, delta: -item.quantity });
                if (prod) {
                    const unitPrice = Number(item.unitPrice ?? prod.price ?? 0);
                    const totalCost = Number(item.subtotal ?? unitPrice * item.quantity);
                    await prisma_1.default.customerPurchases.create({ data: {
                            id: (0, crypto_1.randomUUID)(),
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
            await prisma_1.default.products.update({ where: { productId: prod.productId }, data: { stockQuantity: newQty } });
            try {
                (0, productUpdateAuditService_1.recordFieldUpdates)(prod.productId, ["stockQuantity"], "invoice");
            }
            catch { }
            const unitPrice = Number(item.unitPrice ?? prod.price ?? 0);
            const totalCost = Number(item.subtotal ?? unitPrice * item.quantity);
            await prisma_1.default.customerPurchases.create({ data: {
                    id: (0, crypto_1.randomUUID)(),
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
            (0, customerSalesService_1.appendCustomerSales)({
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
        }
        catch (persistErr) {
            console.warn("Failed to persist customerSales JSON:", persistErr);
        }
        (0, notificationService_1.appendNotification)({ type: "inventory", message: `Processed invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId });
        res.json({ customer: cust, items, updates });
    }
    catch (error) {
        console.error("processInvoice error:", error);
        res.status(500).json({ message: "Error processing invoice" });
    }
};
exports.processInvoice = processInvoice;
// Manual invoice processing: user provides customer, date, and selected products/quantities
const processInvoiceManual = async (req, res) => {
    try {
        const prismaDate = (d) => (d ? new Date(d) : new Date());
        const body = req.body;
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
        let cust = await prisma_1.default.customers.findFirst({ where: { name: customerName } });
        if (!cust) {
            cust = await prisma_1.default.customers.create({ data: {
                    customerId: (0, crypto_1.randomUUID)(),
                    name: customerName,
                } });
        }
        const updates = [];
        for (const it of itemsInput) {
            const qty = Number(it?.quantity ?? 0);
            if (!qty || qty <= 0)
                continue;
            const unit = String(it?.unit || 'ctn').toLowerCase();
            let product = null;
            if (it?.productId) {
                const p = await prisma_1.default.products.findUnique({ where: { productId: String(it.productId) } });
                if (p)
                    product = { productId: p.productId, name: p.name, price: Number(p.price), stockQuantity: p.stockQuantity };
            }
            if (!product && it?.name) {
                // Try exact by name then loose contains
                const name = String(it.name).trim();
                const pExact = await prisma_1.default.products.findFirst({ where: { name } });
                if (pExact) {
                    product = { productId: pExact.productId, name: pExact.name, price: Number(pExact.price), stockQuantity: pExact.stockQuantity };
                }
                if (!product) {
                    const candidates = await prisma_1.default.products.findMany({ where: { name: { contains: name, mode: 'insensitive' } }, take: 1 });
                    if (candidates.length) {
                        const p = candidates[0];
                        product = { productId: p.productId, name: p.name, price: Number(p.price), stockQuantity: p.stockQuantity };
                    }
                }
            }
            if (unit === 'pcs') {
                const nameForPcs = String(it?.name || product?.name || '').trim();
                if (nameForPcs)
                    (0, pcsInventoryService_1.adjustPcsQuantity)({ name: nameForPcs, delta: -qty });
            }
            else {
                if (!product)
                    continue; // skip unknown product for carton flow
                // Deduct stock (clamp at 0)
                const newQty = Math.max(0, Number(product.stockQuantity) - qty);
                await prisma_1.default.products.update({ where: { productId: product.productId }, data: { stockQuantity: newQty } });
            }
            const unitPrice = Number(product?.price ?? 0);
            const totalCost = Number(unitPrice) * qty;
            // Record purchase
            if (product) {
                await prisma_1.default.customerPurchases.create({ data: {
                        id: (0, crypto_1.randomUUID)(),
                        customerId: cust.customerId,
                        productId: product.productId,
                        timestamp,
                        quantity: qty,
                        unitPrice,
                        totalCost,
                    } });
            }
            if (product)
                updates.push({ productId: product.productId, name: product.name, deducted: qty });
        }
        (0, notificationService_1.appendNotification)({ type: "inventory", message: `Processed manual invoice for ${cust.name}; updated ${updates.length} product(s).`, actorUserId: req.user?.userId });
        res.json({ customer: cust, updates });
    }
    catch (error) {
        console.error("processInvoiceManual error:", error);
        res.status(500).json({ message: "Error processing manual invoice" });
    }
};
exports.processInvoiceManual = processInvoiceManual;
// Delete a single product and dependent rows, then sync JSON
const deleteProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const existing = await prisma_1.default.products.findUnique({ where: { productId } });
        if (!existing) {
            res.status(404).json({ message: "Product not found" });
            return;
        }
        // Guard: prevent deletion when related entries exist
        const [purchaseCount, salesCount, purchasesCount] = await Promise.all([
            prisma_1.default.customerPurchases.count({ where: { productId } }),
            prisma_1.default.sales.count({ where: { productId } }),
            prisma_1.default.purchases.count({ where: { productId } }),
        ]);
        if (purchaseCount > 0 || salesCount > 0 || purchasesCount > 0) {
            res.status(409).json({ message: "Cannot delete product with related purchase/sales records. Clear related records first." });
            return;
        }
        // Optional guard: prevent deletion if PCS inventory still references this product by name
        const pcs = (0, pcsInventoryService_1.readPcsInventory)();
        const hasPcsRef = pcs.some((e) => String(e.name || "").trim().toLowerCase() === String(existing.name || "").trim().toLowerCase());
        if (hasPcsRef) {
            res.status(409).json({ message: "Cannot delete product while PCS inventory contains entries referencing it." });
            return;
        }
        await prisma_1.default.customerPurchases.deleteMany({ where: { productId } });
        await prisma_1.default.sales.deleteMany({ where: { productId } });
        await prisma_1.default.purchases.deleteMany({ where: { productId } });
        await prisma_1.default.products.delete({ where: { productId } });
        (0, notificationService_1.appendNotification)({ type: "product", message: `Product deleted: ${existing.name}`, actorUserId: req.user?.userId });
        await (0, productSyncService_1.syncProductsJsonFromDb)(prisma_1.default);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("deleteProduct error:", error);
        res.status(500).json({ message: "Error deleting product" });
    }
};
exports.deleteProduct = deleteProduct;
// Purge all products and dependent rows, clear JSON files, and sync
const purgeProducts = async (req, res) => {
    try {
        await prisma_1.default.customerPurchases.deleteMany({});
        await prisma_1.default.sales.deleteMany({});
        await prisma_1.default.purchases.deleteMany({});
        await prisma_1.default.products.deleteMany({});
        (0, productSyncService_1.writeEmptyProductsJson)();
        (0, productSyncService_1.writeEmptyImportedProductsJson)();
        await (0, productSyncService_1.syncProductsJsonFromDb)(prisma_1.default);
        (0, notificationService_1.appendNotification)({ type: "product", message: "Purged all products and related records", actorUserId: req.user?.userId });
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("purgeProducts error:", error);
        res.status(500).json({ message: "Error purging products" });
    }
};
exports.purgeProducts = purgeProducts;
/**
 * Generate and send a sample Excel file for inventory import testing.
 */
const getImportSample = async (req, res) => {
    try {
        // Serve the canonical sample file that defines the expected format
        const samplePath = node_path_1.default.join(__dirname, "../../assets/full-products.xlsx");
        if (!node_fs_1.default.existsSync(samplePath)) {
            res.status(404).json({ message: "Sample file not found at server/assets/full-products.xlsx" });
            return;
        }
        const buffer = node_fs_1.default.readFileSync(samplePath);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=full-products.xlsx");
        res.status(200).send(buffer);
    }
    catch (err) {
        console.error("getImportSample error:", err);
        res.status(500).json({ message: "Failed to generate sample file" });
    }
};
exports.getImportSample = getImportSample;
// Serve PCS sample Excel
const getPcsSample = async (req, res) => {
    try {
        const samplePath = node_path_1.default.join(__dirname, "../../assets/PCS.xlsx");
        if (!node_fs_1.default.existsSync(samplePath)) {
            res.status(404).json({ message: "PCS sample file not found at server/assets/PCS.xlsx" });
            return;
        }
        const buffer = node_fs_1.default.readFileSync(samplePath);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=PCS.xlsx");
        res.status(200).send(buffer);
    }
    catch (err) {
        console.error("getPcsSample error:", err);
        res.status(500).json({ message: "Failed to serve PCS sample file" });
    }
};
exports.getPcsSample = getPcsSample;
// Export PCS inventory as Excel
const exportPcsExcel = async (req, res) => {
    try {
        const pcs = (0, pcsInventoryService_1.readPcsInventory)();
        const products = await prisma_1.default.products.findMany({});
        const byName = new Map(products.map((p) => [String(p.name).toLowerCase(), p]));
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
        const wb = xlsx_1.default.utils.book_new();
        const ws = xlsx_1.default.utils.json_to_sheet(rows, { header: [
                "ProductId",
                "ProductDescription",
                "PackSize",
                "Category",
                "PCSQuantity",
                "PurchasePrice",
                "SalesPrice",
                "ExpiryDate",
            ] });
        xlsx_1.default.utils.book_append_sheet(wb, ws, "PCS");
        const buf = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=pcs.xlsx");
        res.status(200).send(buf);
    }
    catch (err) {
        console.error("exportPcsExcel error:", err);
        res.status(500).json({ message: "Failed to export PCS inventory as Excel" });
    }
};
exports.exportPcsExcel = exportPcsExcel;
// Return last updated timestamps per product field
const getProductUpdatesLast = async (req, res) => {
    try {
        const last = (0, productUpdateAuditService_1.getLastFieldUpdates)();
        // Enrich with product names for display
        const ids = Object.keys(last);
        const products = ids.length ? await prisma_1.default.products.findMany({ where: { productId: { in: ids } } }) : [];
        const nameMap = new Map(products.map(p => [p.productId, p.name]));
        const payload = ids.map((id) => ({ productId: id, name: nameMap.get(id) || "Unknown", last: last[id] }));
        res.json(payload);
    }
    catch (err) {
        console.error("getProductUpdatesLast error:", err);
        res.status(500).json({ message: "Failed to load last updates" });
    }
};
exports.getProductUpdatesLast = getProductUpdatesLast;
