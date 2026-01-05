"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSupplier = exports.updateSupplier = exports.createSupplier = exports.exportSuppliersExcel = exports.importSuppliers = exports.getSuppliers = exports.getPurchasePrintOptions = exports.updatePurchase = exports.updatePurchaseMeta = exports.addPurchasePayment = exports.createPurchase = exports.deletePurchase = exports.getPurchases = exports.upload = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const crypto_1 = require("crypto");
const pcsInventoryService_1 = require("../services/pcsInventoryService");
const cache_1 = require("../services/cache");
const notificationService_1 = require("../services/notificationService");
const supplierPurchasesService_1 = require("../services/supplierPurchasesService");
const XLSX = __importStar(require("xlsx"));
const multer_1 = __importDefault(require("multer"));
const errorHandler_1 = require("../utils/errorHandler");
exports.upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// GET /purchases - list all customer purchases with joined names
// GET /purchases - list all procurement purchases (supplier-side)
const getPurchases = async (req, res) => {
    try {
        // Optional date range filters: from/to (ISO date strings)
        const { from, to } = (req.query || {});
        // Pagination params: page (1-based) and limit (items per page)
        const page = Math.max(1, Number(req.query?.page) || 1);
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 20));
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const where = { tenantId };
        if (from || to) {
            where.timestamp = {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
            };
        }
        const cacheKey = `purchases:list:${from || "all"}:${to || "all"}:p=${page}:lim=${limit}`;
        const { list, total } = await (0, cache_1.withCache)(cacheKey, 30, async () => {
            const totalCount = await prisma_1.default.purchases.count({ where });
            const purchases = await prisma_1.default.purchases.findMany({ where, orderBy: { timestamp: "desc" }, skip: (page - 1) * limit, take: limit });
            const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
            const products = await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } });
            const productMap = new Map(products.map((p) => [p.productId, p.name]));
            const metaRows = await prisma_1.default.supplierPurchaseMeta.findMany({ where: { purchaseId: { in: purchases.map((p) => p.purchaseId) }, tenantId } });
            const metaMap = new Map(metaRows.map((m) => [m.purchaseId, m]));
            const pageList = purchases.map((p) => ({
                purchaseId: p.purchaseId,
                productId: p.productId,
                productName: productMap.get(p.productId) || undefined,
                quantity: p.quantity,
                unitCost: p.unitCost,
                totalCost: p.totalCost,
                timestamp: p.timestamp,
                supplierName: metaMap.get(p.purchaseId)?.supplierName || undefined,
                supplierMobile: metaMap.get(p.purchaseId)?.supplierMobile || undefined,
            }));
            return { list: pageList, total: totalCount };
        });
        res.json({ purchases: list, total });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to load purchases"));
    }
};
exports.getPurchases = getPurchases;
// DELETE /purchases/:id - delete a specific procurement purchase
const deletePurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.purchases.findFirst({ where: { purchaseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        // Reduce inventory based on stored unit meta (defaults to carton)
        try {
            const tenantId = req.tenantId || req.user?.tenantId || "default";
            const metaRow = await prisma_1.default.supplierPurchaseMeta.findFirst({ where: { purchaseId: id, tenantId } });
            const unit = (metaRow?.unit === "pcs" ? "pcs" : "ctn");
            const p = await prisma_1.default.products.findFirst({ where: { productId: existing.productId, tenantId } });
            if (p) {
                const qty = Math.max(0, Number(existing.quantity) || 0);
                if (unit === "ctn") {
                    const newQty = Math.max(0, Number(p.stockQuantity) - qty);
                    await prisma_1.default.products.update({ where: { productId: existing.productId }, data: { stockQuantity: newQty } });
                }
                else {
                    await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: p.name, delta: -qty });
                }
            }
        }
        catch (e) {
            // If adjustment fails, continue with delete; log for visibility
            console.warn("Inventory adjustment on deletePurchase failed", e);
        }
        await prisma_1.default.purchases.delete({ where: { purchaseId: id } });
        // Notify: purchase deleted
        (0, notificationService_1.appendNotification)({ type: "purchase", message: `Deleted purchase ${id}` });
        try {
            const io = req.app.get("io");
            io.emit("purchase:deleted", { purchaseId: id });
            io.emit("dashboard:refresh", { tenantId });
        }
        catch (err) {
            console.warn("Socket emission failed for deletePurchase", err);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to delete purchase"));
    }
};
exports.deletePurchase = deletePurchase;
// POST /purchases - create a procurement purchase entry and add to stock
// Body: { date?: string; supplierName?: string; supplierMobile?: string; paymentTerm?: string; items: Array<{ productId?: string; name?: string; unit: "ctn"|"pcs"; quantity: number; unitCost: number }> }
const createPurchase = async (req, res) => {
    try {
        const body = req.body || {};
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const date = body.date ? new Date(body.date) : new Date();
        const supplierName = body.supplierName ? String(body.supplierName) : undefined;
        const supplierMobile = body.supplierMobile ? String(body.supplierMobile) : undefined;
        const paymentTerm = body.paymentTerm ? String(body.paymentTerm) : undefined;
        const dueDate = body.dueDate ? String(body.dueDate) : undefined;
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) {
            res.status(400).json({ message: "No items provided" });
            return;
        }
        const created = [];
        for (const it of items) {
            const quantity = Math.max(1, Number(it.quantity) || 1);
            const unitCost = Math.max(0, Number(it.unitCost) || 0);
            let productId = it.productId || "";
            let name = it.name || "";
            if (!productId && name) {
                const p = await prisma_1.default.products.findFirst({ where: { tenantId, name }, select: { productId: true } });
                if (p)
                    productId = p.productId;
            }
            if (!productId) {
                res.status(400).json({ message: "Missing productId for an item" });
                return;
            }
            const p = await prisma_1.default.products.findFirst({ where: { productId, tenantId } });
            if (!p) {
                res.status(404).json({ message: `Product not found: ${productId}` });
                return;
            }
            // Adjust stock: purchases add to stock; handle cartons and pcs
            if (it.unit === "ctn") {
                const newQty = Math.max(0, Number(p.stockQuantity) + quantity);
                await prisma_1.default.products.update({ where: { productId }, data: { stockQuantity: newQty, expiryDate: it.expiryDate ? new Date(it.expiryDate) : p.expiryDate } });
            }
            else {
                // pcs: adjust pcs inventory positively
                await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: p.name, delta: quantity });
                // Optionally update expiryDate on product for reference
                if (it.expiryDate) {
                    await prisma_1.default.products.update({ where: { productId }, data: { expiryDate: new Date(it.expiryDate) } });
                }
            }
            const purchaseId = (0, crypto_1.randomUUID)();
            const totalCost = unitCost * quantity;
            await prisma_1.default.purchases.create({ data: { purchaseId, productId, timestamp: date, quantity, unitCost, totalCost, tenantId } });
            // Persist supplier-side metadata for UI enrichment
            (0, supplierPurchasesService_1.upsertSupplierMeta)({
                purchaseId,
                supplierName: supplierName ?? null,
                supplierMobile: supplierMobile ?? null,
                paymentTerm: paymentTerm ?? null,
                date: date.toISOString(),
                dueDate: dueDate ?? null,
                unit: it.unit,
            });
            created.push({ purchaseId, productId, quantity, unitCost, totalCost, timestamp: date });
            // Notify: purchase item created
            (0, notificationService_1.appendNotification)({ type: "purchase", message: `Purchased ${quantity} ${it.unit} of '${p.name}' for ₦${totalCost.toLocaleString("en")}` });
        }
        try {
            const io = req.app.get("io");
            // We might be creating multiple purchases in one go, but the client list expects individual purchase items.
            // We can emit each one or a bulk event. Since the UI is a list of purchases, emitting each one is safer for now.
            for (const p of created) {
                // Re-fetch full object with meta if possible, or construct it.
                // Fetching is safer to ensure consistency with getPurchases
                const full = await prisma_1.default.purchases.findUnique({ where: { purchaseId: p.purchaseId } });
                if (full) {
                    const meta = await prisma_1.default.supplierPurchaseMeta.findUnique({ where: { purchaseId: p.purchaseId } });
                    // We need to attach product name which getPurchases returns
                    const product = await prisma_1.default.products.findUnique({ where: { productId: p.productId } });
                    const payload = {
                        ...full,
                        productName: product?.name,
                        supplierName: meta?.supplierName,
                        supplierMobile: meta?.supplierMobile
                    };
                    io.emit("purchase:created", payload);
                }
            }
            io.emit("dashboard:refresh", { tenantId });
        }
        catch (err) {
            console.warn("Socket emission failed for createPurchase", err);
        }
        res.json({ success: true, purchases: created });
    }
    catch (err) {
        console.error("createPurchase error:", err);
        const msg = err instanceof Error ? err.message : "Failed to create purchase";
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", msg));
    }
};
exports.createPurchase = createPurchase;
// POST /purchases/:id/payments - add a supplier payment record for a purchase
const addPurchasePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        // Ensure the purchase exists
        const existing = await prisma_1.default.purchases.findFirst({ where: { purchaseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        const body = req.body || {};
        const amount = Number(body.amount) || 0;
        const bankName = String(body.bankName || "").trim();
        // Allow missing bankAccount and auto-fill based on known banks mapping
        const KNOWN_BANKS = [
            { name: "Amagzy global vic limited(Zenith bank) FOR SUPPLIES", account: "1017679715" },
            { name: "Amagzy global vic limited FCMB(FOR SUPPLIES)", account: "2002076509" },
            { name: "Amagzy global ventures(Sterling bank) FOR CHEQUES", account: "0501928477" },
            { name: "Amagzy global ventures(Stanbic bank) FOR OPERATIONS", account: "0034297097" },
            { name: "Amagzy global ventures(GTbank)FOR MANUFACTURING", account: "0240198526" },
        ];
        const providedAccount = String(body.bankAccount || "").trim();
        const bankAccount = providedAccount || (KNOWN_BANKS.find((b) => b.name === bankName)?.account || "");
        const notes = body.notes ? String(body.notes) : null;
        if (!amount || !bankName) {
            res.status(400).json({ message: "amount and bankName are required" });
            return;
        }
        const payment = (0, supplierPurchasesService_1.addSupplierPayment)({
            id: (0, crypto_1.randomUUID)(),
            purchaseId: id,
            date: body.date ? String(body.date) : new Date().toISOString(),
            amount,
            bankName,
            bankAccount,
            notes,
        });
        // Notify: supplier payment added
        (0, notificationService_1.appendNotification)({ type: "purchase", message: `Added supplier payment ₦${amount.toLocaleString("en")} to purchase ${id} (${bankName})` });
        try {
            const io = req.app.get("io");
            const updatedWithMeta = await prisma_1.default.purchases.findUnique({ where: { purchaseId: id }, include: { payments: true } });
            if (updatedWithMeta) {
                io.emit("purchase:updated", updatedWithMeta);
                const tenantId = req.tenantId || req.user?.tenantId || "default";
                io.emit("dashboard:refresh", { tenantId });
            }
        }
        catch (err) {
            console.warn("Socket emission failed for addPurchasePayment", err);
        }
        res.status(201).json({ payment });
    }
    catch (err) {
        console.error("addPurchasePayment error:", err);
        const msg = err instanceof Error ? err.message : "Failed to add payment";
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", msg));
    }
};
exports.addPurchasePayment = addPurchasePayment;
// PUT /purchases/:id/meta - update supplier-side metadata for a purchase
const updatePurchaseMeta = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.purchases.findFirst({ where: { purchaseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        const body = req.body || {};
        const supplierName = body.supplierName !== undefined ? (body.supplierName ? String(body.supplierName) : null) : undefined;
        const supplierMobile = body.supplierMobile !== undefined ? (body.supplierMobile ? String(body.supplierMobile) : null) : undefined;
        const paymentTerm = body.paymentTerm !== undefined ? (body.paymentTerm ? String(body.paymentTerm) : null) : undefined;
        const dueDate = body.dueDate !== undefined ? (body.dueDate ? String(body.dueDate) : null) : undefined;
        (0, supplierPurchasesService_1.upsertSupplierMeta)({ purchaseId: id, supplierName, supplierMobile, paymentTerm, dueDate });
        const meta = { purchaseId: id, supplierName: supplierName ?? null, supplierMobile: supplierMobile ?? null, paymentTerm: paymentTerm ?? null, dueDate: dueDate ?? null };
        (0, notificationService_1.appendNotification)({ type: "purchase", message: `Updated purchase ${id} meta: supplier=${meta.supplierName || "-"}, term=${meta.paymentTerm || "-"}` });
        res.json({ meta });
    }
    catch (err) {
        console.error("updatePurchaseMeta error:", err);
        const msg = err instanceof Error ? err.message : "Failed to update purchase meta";
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", msg));
    }
};
exports.updatePurchaseMeta = updatePurchaseMeta;
// PUT /purchases/:id - update core purchase entry (product, quantity, unitCost, timestamp)
const updatePurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.purchases.findFirst({ where: { purchaseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        const body = req.body || {};
        const nextDate = body.date ? new Date(String(body.date)) : undefined;
        const nextProductId = body.productId ? String(body.productId) : undefined;
        const nextQuantity = body.quantity !== undefined ? Math.max(0, Number(body.quantity) || 0) : undefined;
        const nextUnitCost = body.unitCost !== undefined ? Math.max(0, Number(body.unitCost) || 0) : undefined;
        const nextUnit = body.unit === "pcs" ? "pcs" : (body.unit === "ctn" ? "ctn" : undefined);
        const nextExpiryDate = body.expiryDate ? String(body.expiryDate) : undefined;
        // Determine old unit from meta (defaults to 'ctn' for backwards compat)
        const metaRow = await prisma_1.default.supplierPurchaseMeta.findUnique({ where: { purchaseId: id } });
        const oldUnit = (metaRow?.unit === "pcs" ? "pcs" : "ctn");
        // Fetch product records for inventory adjustments
        const oldProduct = await prisma_1.default.products.findFirst({ where: { productId: existing.productId, tenantId } });
        if (!oldProduct) {
            res.status(404).json({ message: `Product not found: ${existing.productId}` });
            return;
        }
        const newProductId = nextProductId || existing.productId;
        const newProduct = await prisma_1.default.products.findFirst({ where: { productId: newProductId, tenantId } });
        if (!newProduct) {
            res.status(404).json({ message: `Product not found: ${newProductId}` });
            return;
        }
        const oldQty = Math.max(0, Number(existing.quantity) || 0);
        const newQty = nextQuantity !== undefined ? Math.max(0, Number(nextQuantity) || 0) : oldQty;
        const effectiveOldUnit = oldUnit;
        const effectiveNewUnit = nextUnit || effectiveOldUnit;
        // Reverse old inventory effect on old product
        try {
            if (effectiveOldUnit === "ctn") {
                const revertQty = Math.max(0, Number(oldProduct.stockQuantity) - oldQty);
                await prisma_1.default.products.update({ where: { productId: oldProduct.productId }, data: { stockQuantity: revertQty } });
            }
            else {
                await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: oldProduct.name, delta: -oldQty });
            }
        }
        catch (invErr) {
            console.warn("Inventory reversal failed on updatePurchase", invErr);
        }
        // Apply new inventory effect on new product
        try {
            if (effectiveNewUnit === "ctn") {
                const applyQty = Math.max(0, Number(newProduct.stockQuantity) + newQty);
                await prisma_1.default.products.update({ where: { productId: newProduct.productId }, data: { stockQuantity: applyQty, expiryDate: nextExpiryDate ? new Date(nextExpiryDate) : newProduct.expiryDate } });
            }
            else {
                await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: newProduct.name, delta: newQty });
                if (nextExpiryDate) {
                    await prisma_1.default.products.update({ where: { productId: newProduct.productId }, data: { expiryDate: new Date(nextExpiryDate) } });
                }
            }
        }
        catch (invErr) {
            console.warn("Inventory application failed on updatePurchase", invErr);
        }
        // Persist updated purchase entry
        const updated = await prisma_1.default.purchases.update({
            where: { purchaseId: id },
            data: {
                productId: newProductId,
                timestamp: nextDate || existing.timestamp,
                quantity: newQty,
                unitCost: nextUnitCost !== undefined ? nextUnitCost : existing.unitCost,
                totalCost: (nextUnitCost !== undefined ? nextUnitCost : existing.unitCost) * newQty,
            },
        });
        // Update meta fields if provided (unit and date)
        (0, supplierPurchasesService_1.upsertSupplierMeta)({ purchaseId: id, unit: nextUnit ?? undefined, date: nextDate ? nextDate.toISOString() : undefined });
        // Notify
        (0, notificationService_1.appendNotification)({ type: "purchase", message: `Updated purchase ${id}: ${newQty} ${effectiveNewUnit} of '${newProduct.name}'` });
        res.json({ purchase: updated });
    }
    catch (err) {
        console.error("updatePurchase error:", err);
        const msg = err instanceof Error ? err.message : "Failed to update purchase";
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", msg));
    }
};
exports.updatePurchase = updatePurchase;
const getPurchasePrintOptions = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.purchases.findFirst({ where: { purchaseId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        res.json({
            purchaseId: id,
            options: {
                includePrices: true,
                includeSupplierDetails: true,
                pageSizes: ["A4", "Letter"],
                orientation: ["portrait", "landscape"],
            },
        });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to load print options"));
    }
};
exports.getPurchasePrintOptions = getPurchasePrintOptions;
const getSuppliers = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        let list = await prisma_1.default.suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true, mobile: true } });
        if (!list.length) {
            const purchases = await prisma_1.default.purchases.findMany({ where: { tenantId } });
            const map = new Map();
            for (const p of purchases) {
                const m = await prisma_1.default.supplierPurchaseMeta.findUnique({ where: { purchaseId: p.purchaseId } });
                const n = String(m?.supplierName || "").trim();
                if (!n)
                    continue;
                const key = n.toLowerCase();
                const mobile = m?.supplierMobile ?? null;
                const prev = map.get(key);
                map.set(key, { name: n, mobile: mobile ?? prev?.mobile ?? null });
            }
            list = Array.from(map.values()).map((s) => ({ id: (0, crypto_1.randomUUID)(), name: s.name, mobile: s.mobile ?? null })).sort((a, b) => a.name.localeCompare(b.name));
        }
        res.json({ suppliers: list });
    }
    catch {
        res.json({ suppliers: [] });
    }
};
exports.getSuppliers = getSuppliers;
const importSuppliers = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        const wb = XLSX.read(file.buffer, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
        const norm = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const out = [];
        for (const row of rows) {
            const kv = {};
            for (const k of Object.keys(row))
                kv[norm(k)] = row[k];
            const name = kv["supplier"] ?? kv["name"] ?? kv["supplier name"];
            const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"] ?? null;
            const n = String(name || "").trim();
            if (!n)
                continue;
            out.push({ name: n, mobile: mobile == null ? null : String(mobile) });
        }
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.suppliers.findMany({ where: { tenantId }, select: { name: true, mobile: true } });
        const byName = new Map();
        const add = (s) => {
            const key = s.name.toLowerCase();
            const prev = byName.get(key);
            byName.set(key, { name: s.name, mobile: s.mobile ?? prev?.mobile ?? null });
        };
        existing.forEach(add);
        out.forEach(add);
        const merged = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
        for (const s of merged) {
            await prisma_1.default.suppliers.upsert({
                where: { tenantId_name: { tenantId, name: s.name } },
                update: { mobile: s.mobile ?? undefined },
                create: { id: (0, crypto_1.randomUUID)(), tenantId, name: s.name, mobile: s.mobile ?? undefined },
            });
        }
        res.json({ importedSuppliers: out.length });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to import suppliers"));
    }
};
exports.importSuppliers = importSuppliers;
const exportSuppliersExcel = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        let list = await prisma_1.default.suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { name: true, mobile: true } });
        if (!list.length) {
            const purchases = await prisma_1.default.purchases.findMany({ where: { tenantId } });
            const map = new Map();
            for (const p of purchases) {
                const m = await prisma_1.default.supplierPurchaseMeta.findUnique({ where: { purchaseId: p.purchaseId } });
                const n = String(m?.supplierName || "").trim();
                if (!n)
                    continue;
                const key = n.toLowerCase();
                const mobile = m?.supplierMobile ?? null;
                const prev = map.get(key);
                map.set(key, { name: n, mobile: mobile ?? prev?.mobile ?? null });
            }
            list = Array.from(map.values()).map((s) => ({ name: s.name, mobile: s.mobile ?? null })).sort((a, b) => a.name.localeCompare(b.name));
        }
        const rows = list.map((s) => ({ Name: s.name, Mobile: s.mobile ?? "" }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows, { header: ["Name", "Mobile"] });
        XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=suppliers.xlsx");
        res.status(200).send(buf);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to export suppliers"));
    }
};
exports.exportSuppliersExcel = exportSuppliersExcel;
// Suppliers utilities for routes file
// `upload` is defined once at the top of this file for reuse
// Create a supplier
const createSupplier = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const name = String((req.body || {}).name || "").trim();
        const mobile = String((req.body || {}).mobile || "").trim() || null;
        if (!name) {
            res.status(400).json({ message: "Supplier name is required" });
            return;
        }
        const exists = await prisma_1.default.suppliers.findFirst({ where: { tenantId, name } });
        if (exists) {
            res.status(409).json({ message: "Supplier already exists" });
            return;
        }
        await prisma_1.default.suppliers.create({ data: { id: (0, crypto_1.randomUUID)(), tenantId, name, mobile: mobile || undefined } });
        res.status(201).json({ supplier: { name, mobile } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to create supplier"));
    }
};
exports.createSupplier = createSupplier;
// Update a supplier
const updateSupplier = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        const changes = req.body || {};
        const existing = await prisma_1.default.suppliers.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Supplier not found" });
            return;
        }
        const next = await prisma_1.default.suppliers.update({
            where: { id },
            data: {
                ...(changes.name !== undefined ? { name: String(changes.name).trim() } : {}),
                ...(changes.mobile !== undefined ? { mobile: String(changes.mobile).trim() || null } : {}),
            },
        });
        res.json({ supplier: { id: next.id, name: next.name, mobile: next.mobile } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to update supplier"));
    }
};
exports.updateSupplier = updateSupplier;
// Delete a supplier
const deleteSupplier = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const id = String(req.params.id || "").trim();
        const existing = await prisma_1.default.suppliers.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Supplier not found" });
            return;
        }
        await prisma_1.default.suppliers.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "purchase", "Failed to delete supplier"));
    }
};
exports.deleteSupplier = deleteSupplier;
