"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePurchase = exports.updatePurchaseMeta = exports.addPurchasePayment = exports.createPurchase = exports.deletePurchase = exports.getPurchases = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const crypto_1 = require("crypto");
const pcsInventoryService_1 = require("../services/pcsInventoryService");
const cache_1 = require("../services/cache");
const notificationService_1 = require("../services/notificationService");
const supplierPurchasesService_1 = require("../services/supplierPurchasesService");
// GET /purchases - list all customer purchases with joined names
// GET /purchases - list all procurement purchases (supplier-side)
const getPurchases = async (req, res) => {
    try {
        // Optional date range filters: from/to (ISO date strings)
        const { from, to } = (req.query || {});
        // Pagination params: page (1-based) and limit (items per page)
        const page = Math.max(1, Number(req.query?.page) || 1);
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 20));
        const where = {};
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
            const products = await prisma_1.default.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } });
            const productMap = new Map(products.map((p) => [p.productId, p.name]));
            const pageList = purchases.map((p) => ({
                purchaseId: p.purchaseId,
                productId: p.productId,
                productName: productMap.get(p.productId) || undefined,
                quantity: p.quantity,
                unitCost: p.unitCost,
                totalCost: p.totalCost,
                timestamp: p.timestamp,
                supplierName: (0, supplierPurchasesService_1.getSupplierMetaFor)(p.purchaseId)?.supplierName || undefined,
                supplierMobile: (0, supplierPurchasesService_1.getSupplierMetaFor)(p.purchaseId)?.supplierMobile || undefined,
            }));
            return { list: pageList, total: totalCount };
        });
        res.json({ purchases: list, total });
    }
    catch (err) {
        console.error("getPurchases error:", err);
        res.status(500).json({ message: "Failed to load purchases" });
    }
};
exports.getPurchases = getPurchases;
// DELETE /purchases/:id - delete a specific procurement purchase
const deletePurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma_1.default.purchases.findUnique({ where: { purchaseId: id } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        // Reduce inventory based on stored unit meta (defaults to carton)
        try {
            const meta = (0, supplierPurchasesService_1.getSupplierMetaFor)(id);
            const unit = (meta?.unit === "pcs" ? "pcs" : "ctn");
            const p = await prisma_1.default.products.findUnique({ where: { productId: existing.productId } });
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
        res.json({ success: true });
    }
    catch (err) {
        console.error("deletePurchase error:", err);
        res.status(500).json({ message: "Failed to delete purchase" });
    }
};
exports.deletePurchase = deletePurchase;
// POST /purchases - create a procurement purchase entry and add to stock
// Body: { date?: string; supplierName?: string; supplierMobile?: string; paymentTerm?: string; items: Array<{ productId?: string; name?: string; unit: "ctn"|"pcs"; quantity: number; unitCost: number }> }
const createPurchase = async (req, res) => {
    try {
        const body = req.body || {};
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
                const p = await prisma_1.default.products.findFirst({ where: { name }, select: { productId: true } });
                if (p)
                    productId = p.productId;
            }
            if (!productId) {
                res.status(400).json({ message: "Missing productId for an item" });
                return;
            }
            const p = await prisma_1.default.products.findUnique({ where: { productId } });
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
            await prisma_1.default.purchases.create({ data: { purchaseId, productId, timestamp: date, quantity, unitCost, totalCost } });
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
        res.json({ success: true, purchases: created });
    }
    catch (err) {
        console.error("createPurchase error:", err);
        const msg = err instanceof Error ? err.message : "Failed to create purchase";
        res.status(500).json({ message: msg });
    }
};
exports.createPurchase = createPurchase;
// POST /purchases/:id/payments - add a supplier payment record for a purchase
const addPurchasePayment = async (req, res) => {
    try {
        const { id } = req.params;
        // Ensure the purchase exists
        const existing = await prisma_1.default.purchases.findUnique({ where: { purchaseId: id } });
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
        res.status(201).json({ payment });
        // Notify: supplier payment added
        (0, notificationService_1.appendNotification)({ type: "purchase", message: `Added supplier payment ₦${amount.toLocaleString("en")} to purchase ${id} (${bankName})` });
    }
    catch (err) {
        console.error("addPurchasePayment error:", err);
        const msg = err instanceof Error ? err.message : "Failed to add payment";
        res.status(500).json({ message: msg });
    }
};
exports.addPurchasePayment = addPurchasePayment;
// PUT /purchases/:id/meta - update supplier-side metadata for a purchase
const updatePurchaseMeta = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma_1.default.purchases.findUnique({ where: { purchaseId: id } });
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
        const meta = (0, supplierPurchasesService_1.getSupplierMetaFor)(id);
        // Notify: purchase meta updated
        (0, notificationService_1.appendNotification)({ type: "purchase", message: `Updated purchase ${id} meta: supplier=${meta?.supplierName || "-"}, term=${meta?.paymentTerm || "-"}` });
        res.json({ meta });
    }
    catch (err) {
        console.error("updatePurchaseMeta error:", err);
        const msg = err instanceof Error ? err.message : "Failed to update purchase meta";
        res.status(500).json({ message: msg });
    }
};
exports.updatePurchaseMeta = updatePurchaseMeta;
// PUT /purchases/:id - update core purchase entry (product, quantity, unitCost, timestamp)
const updatePurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma_1.default.purchases.findUnique({ where: { purchaseId: id } });
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
        const meta = (0, supplierPurchasesService_1.getSupplierMetaFor)(id);
        const oldUnit = (meta?.unit === "pcs" ? "pcs" : "ctn");
        // Fetch product records for inventory adjustments
        const oldProduct = await prisma_1.default.products.findUnique({ where: { productId: existing.productId } });
        if (!oldProduct) {
            res.status(404).json({ message: `Product not found: ${existing.productId}` });
            return;
        }
        const newProductId = nextProductId || existing.productId;
        const newProduct = await prisma_1.default.products.findUnique({ where: { productId: newProductId } });
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
        res.status(500).json({ message: msg });
    }
};
exports.updatePurchase = updatePurchase;
