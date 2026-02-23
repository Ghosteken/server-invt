"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteInvoice = exports.addPayment = exports.updateInvoice = exports.getInvoiceById = exports.getInvoiceStats = exports.getInvoices = exports.getInvoicePrintOptions = exports.createInvoice = void 0;
const zod_1 = require("zod");
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const notificationService_1 = require("../services/notificationService");
const invoiceMetaService_1 = require("../services/invoiceMetaService");
const pcsInventoryService_1 = require("../services/pcsInventoryService");
const errorHandler_1 = require("../utils/errorHandler");
const CTNX_UNITS = [
    "ctnx24",
    "ctnx30",
    "ctnx20",
    "ctnx26",
    "ctnx48",
    "ctnx9",
    "ctnx96",
    "ctnx14",
    "ctnx12",
    "ctnx16",
    "ctnx50",
    "ctnx4",
    "ctnx8",
    "ctnx10",
    "ctnx18",
    "ctnx28",
];
const ALLOWED_UNITS = ["ctn", "pcs", ...CTNX_UNITS];
const UnitSchema = zod_1.z.enum(ALLOWED_UNITS);
const CreateInvoiceBodySchema = zod_1.z.object({
    customerId: zod_1.z.string().optional(),
    customerName: zod_1.z.string().optional(),
    date: zod_1.z.string().optional(),
    location: zod_1.z.string().min(1),
    salesAgent: zod_1.z.string().min(1),
    locationId: zod_1.z.string().optional(),
    salesAgentId: zod_1.z.string().optional(),
    vatPercent: zod_1.z.coerce.number().nonnegative().optional(),
    discountPercent: zod_1.z.coerce.number().min(0).max(100).optional(),
    paymentTermType: zod_1.z.enum(["immediate", "due_date"]),
    dueDate: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    invoiceNumber: zod_1.z.string().optional(),
    overrideStock: zod_1.z.boolean().optional().default(false),
    items: zod_1.z.array(zod_1.z.object({
        productId: zod_1.z.string().optional(),
        name: zod_1.z.string().min(1),
        unit: UnitSchema,
        quantity: zod_1.z.coerce.number().int().min(1),
        unitPrice: zod_1.z.coerce.number().nonnegative().optional(),
        pcsPrice: zod_1.z.coerce.number().nonnegative().optional(),
    })),
});
const UpdateInvoiceBodySchema = zod_1.z.object({
    date: zod_1.z.string().optional(),
    location: zod_1.z.string().optional(),
    salesAgent: zod_1.z.string().optional(),
    locationId: zod_1.z.string().optional(),
    salesAgentId: zod_1.z.string().optional(),
    vatPercent: zod_1.z.coerce.number().nonnegative().optional(),
    discountPercent: zod_1.z.coerce.number().min(0).max(100).optional(),
    paymentTermType: zod_1.z.enum(["immediate", "due_date"]).optional(),
    dueDate: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    invoiceNumber: zod_1.z.string().optional(),
    overrideStock: zod_1.z.boolean().optional().default(false),
    items: zod_1.z
        .array(zod_1.z.object({
        id: zod_1.z.string().optional(),
        productId: zod_1.z.string().optional(),
        name: zod_1.z.string().optional(),
        unit: UnitSchema,
        quantity: zod_1.z.coerce.number().int().min(1),
        unitPrice: zod_1.z.coerce.number().nonnegative().optional(),
        pcsPrice: zod_1.z.coerce.number().nonnegative().optional(),
    }))
        .optional(),
});
function computeTotals(items, vatPercent, discountPercent) {
    const totalWithoutVAT = items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0);
    const discountAmount = discountPercent > 0 ? (totalWithoutVAT * discountPercent) / 100 : 0;
    const base = Math.max(0, totalWithoutVAT - discountAmount);
    const vatAmount = vatPercent > 0 ? (base * vatPercent) / 100 : 0;
    const totalWithVAT = base + vatAmount;
    return { totalWithoutVAT, vatAmount, totalWithVAT };
}
function statusFromPayments(totalWithVAT, paymentsSum) {
    if (paymentsSum <= 0)
        return "unpaid";
    if (paymentsSum >= totalWithVAT)
        return "paid";
    return "partial";
}
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function diffInCalendarDays(from, to) {
    const a = startOfLocalDay(from).getTime();
    const b = startOfLocalDay(to).getTime();
    return Math.round((b - a) / MS_PER_DAY);
}
function parseCtnxMultiplier(unit) {
    const m = /^ctnx(\d+)$/i.exec(String(unit || "").trim());
    if (!m)
        return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
}
async function maybeNotifyDueSoon(inv, actorUserId) {
    if (!inv.dueDate)
        return;
    if (inv.status === "paid")
        return;
    const days = diffInCalendarDays(new Date(), inv.dueDate);
    if (days === 3 && !inv.dueSoonNotifiedAt) {
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
        const invoiceLabel = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
        let customerName = "Customer";
        if (inv.customerId) {
            const c = await prisma_1.default.customers.findFirst({ where: { customerId: inv.customerId, tenantId: inv.tenantId || "default" } });
            if (c)
                customerName = c.name;
        }
        (0, notificationService_1.appendNotification)({
            type: "invoice",
            message: `${invoiceLabel} for ${customerName} has 3 days remaining to complete payment`,
            actorUserId,
            tenantId: inv.tenantId || "default",
        });
        await prisma_1.default.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueSoonNotifiedAt: new Date() } });
    }
    if (days === 0 && !inv.dueDateNotifiedAt) {
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
        const invoiceLabel = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
        let customerName = "Customer";
        if (inv.customerId) {
            const c = await prisma_1.default.customers.findFirst({ where: { customerId: inv.customerId, tenantId: inv.tenantId || "default" } });
            if (c)
                customerName = c.name;
        }
        (0, notificationService_1.appendNotification)({
            type: "invoice",
            message: `${invoiceLabel} for ${customerName} is due today and is still unpaid`,
            actorUserId,
            tenantId: inv.tenantId || "default",
        });
        await prisma_1.default.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueDateNotifiedAt: new Date() } });
    }
}
const createInvoice = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const body = CreateInvoiceBodySchema.parse(req.body || {});
        const { customerId, customerName, date, location, salesAgent, locationId, salesAgentId, vatPercent = 7.5, discountPercent = 0, paymentTermType, dueDate, notes, items, invoiceNumber } = body;
        if (!location || !salesAgent || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ message: "Missing required fields" });
            return;
        }
        // Resolve customer
        let resolvedCustomerId = customerId || "";
        if (!resolvedCustomerId) {
            const normalizedName = (customerName || "").trim();
            if (!normalizedName) {
                res.status(400).json({ message: "customerName or customerId is required" });
                return;
            }
            const existing = await prisma_1.default.customers.findFirst({ where: { name: normalizedName, tenantId } });
            if (existing) {
                resolvedCustomerId = existing.customerId;
            }
            else {
                const created = await prisma_1.default.customers.create({ data: { customerId: (0, crypto_1.randomUUID)(), name: normalizedName, tenantId } });
                resolvedCustomerId = created.customerId;
            }
        }
        const productIds = Array.from(new Set(items.map((it) => it.productId).filter(Boolean)));
        const products = productIds.length ? await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: productIds } } }) : [];
        const byId = new Map(products.map((p) => [p.productId, p]));
        const productNames = Array.from(new Set(products.map((p) => String(p.name || "").trim()).filter(Boolean)));
        const pcsRows = (productIds.length || productNames.length)
            ? await prisma_1.default.pcsInventory.findMany({
                where: {
                    tenantId,
                    OR: [
                        ...(productIds.length ? [{ productId: { in: productIds } }] : []),
                        ...(productNames.length ? [{ name: { in: productNames } }] : []),
                    ],
                },
                select: { name: true, productId: true, salesPrice: true },
            })
            : [];
        const pcsByProductId = new Map();
        const pcsByName = new Map();
        for (const r of pcsRows) {
            if (r.productId && r.salesPrice !== null && r.salesPrice !== undefined)
                pcsByProductId.set(r.productId, Number(r.salesPrice));
            if (r.name && r.salesPrice !== null && r.salesPrice !== undefined)
                pcsByName.set(String(r.name).toLowerCase(), Number(r.salesPrice));
        }
        const pcsPriceUpserts = new Map();
        const missingPcsPriceForUnit = [];
        const hydrated = items.map((it) => {
            let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
            const p = it.productId ? byId.get(it.productId) : undefined;
            let displayName = it.name || (p ? p.name : undefined);
            const multiplier = parseCtnxMultiplier(it.unit);
            const explicitPcsPrice = typeof it.pcsPrice === "number" ? Number(it.pcsPrice) : undefined;
            const pcsPriceFromDb = p?.productId && pcsByProductId.has(p.productId)
                ? pcsByProductId.get(p.productId)
                : pcsByName.get(String(displayName || "").toLowerCase());
            const pack = p ? Number(String(p.packSize || "").replace(/\D+/g, "")) || 0 : 0;
            const derivedPcsPrice = p && pack > 0 ? Number(p.price) / Math.max(pack, 1) : undefined;
            const basePcsPrice = explicitPcsPrice ?? pcsPriceFromDb ?? derivedPcsPrice;
            if (explicitPcsPrice !== undefined && p?.productId && displayName) {
                pcsPriceUpserts.set(String(displayName).toLowerCase(), {
                    productId: p.productId,
                    name: String(displayName),
                    pcsPrice: explicitPcsPrice,
                    packSize: p.packSize ?? null,
                });
            }
            if ((it.unit === "pcs" || multiplier !== null) && unitPrice === undefined && basePcsPrice === undefined) {
                missingPcsPriceForUnit.push(String(displayName || "").trim() || String(it.productId || "").trim() || "Unknown item");
            }
            if (unitPrice === undefined) {
                if (it.unit === "ctn") {
                    unitPrice = p ? Number(p.price) : 0;
                }
                else if (it.unit === "pcs") {
                    unitPrice = basePcsPrice ?? 0;
                }
                else if (multiplier !== null) {
                    unitPrice = (basePcsPrice ?? 0) * multiplier;
                }
                else {
                    unitPrice = p ? Number(p.price) : 0;
                }
            }
            unitPrice = unitPrice ?? 0;
            const quantity = Math.max(1, Number(it.quantity) || 1);
            return { productId: it.productId, name: displayName, unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
        });
        if (missingPcsPriceForUnit.length) {
            res.status(400).json({ message: `Missing PCS price for: ${Array.from(new Set(missingPcsPriceForUnit)).join(", ")}` });
            return;
        }
        const totals = computeTotals(hydrated, vatPercent, discountPercent);
        const invoiceId = (0, crypto_1.randomUUID)();
        // Resolve normalized names if IDs provided
        let resolvedLocation = location;
        let resolvedSalesAgent = salesAgent;
        if (locationId) {
            const loc = await prisma_1.default.locations.findFirst({ where: { id: locationId, tenantId } });
            resolvedLocation = loc?.name || location;
        }
        if (salesAgentId) {
            const agent = await prisma_1.default.salesAgents.findFirst({ where: { id: salesAgentId, tenantId } });
            resolvedSalesAgent = agent?.name || salesAgent;
        }
        // Use current time if date is today to ensure correct chronological order in history
        let finalDate = date ? new Date(date) : new Date();
        if (date) {
            const now = new Date();
            const d = new Date(date);
            if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
                finalDate = now;
            }
        }
        // Check stock availability if not overridden
        if (!body.overrideStock) {
            const insufficientItems = [];
            const tempCtn = new Map();
            const tempPcs = new Map();
            // Aggregate requested quantities
            for (const it of hydrated) {
                if (it.unit === "pcs") {
                    const key = String(it.name || "").trim().toLowerCase();
                    if (key)
                        tempPcs.set(key, (tempPcs.get(key) || 0) + it.quantity);
                }
                else {
                    // ctn or ctnx units
                    if (it.productId) {
                        tempCtn.set(it.productId, (tempCtn.get(it.productId) || 0) + it.quantity);
                    }
                }
            }
            // Check carton stock
            if (tempCtn.size > 0) {
                const ids = Array.from(tempCtn.keys());
                const prods = await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: ids } } });
                const prodMap = new Map(prods.map(p => [p.productId, p]));
                for (const [pid, reqQty] of tempCtn.entries()) {
                    const p = prodMap.get(pid);
                    if (!p || (p.stockQuantity < reqQty)) {
                        insufficientItems.push(`${p?.name || "Unknown Product"} (Requested: ${reqQty}, Available: ${p?.stockQuantity ?? 0})`);
                    }
                }
            }
            // Check PCS stock
            if (tempPcs.size > 0) {
                const names = Array.from(tempPcs.keys());
                const pcsEntries = await prisma_1.default.pcsInventory.findMany({
                    where: { tenantId, name: { in: names, mode: "insensitive" } }
                });
                const pcsMap = new Map(pcsEntries.map(p => [p.name.toLowerCase(), p]));
                for (const [name, reqQty] of tempPcs.entries()) {
                    const p = pcsMap.get(name);
                    if (!p || (p.quantity < reqQty)) {
                        insufficientItems.push(`${p?.name || name} (Requested: ${reqQty}, Available: ${p?.quantity ?? 0})`);
                    }
                }
            }
            if (insufficientItems.length > 0) {
                res.status(409).json({
                    message: "Insufficient stock for items",
                    insufficientItems,
                    requiresOverride: true
                });
                return;
            }
        }
        const created = await prisma_1.default.invoices.create({
            data: {
                invoiceId,
                customerId: resolvedCustomerId,
                date: finalDate,
                location: resolvedLocation,
                salesAgent: resolvedSalesAgent,
                locationId: locationId || null,
                salesAgentId: salesAgentId || null,
                vatPercent,
                discountPercent,
                paymentTermType: paymentTermType === "due_date" ? "due_date" : "immediate",
                dueDate: dueDate ? new Date(dueDate) : null,
                status: "unpaid",
                totalWithoutVAT: totals.totalWithoutVAT,
                vatAmount: totals.vatAmount,
                totalWithVAT: totals.totalWithVAT,
                notes: notes || null,
                tenantId,
                items: { create: hydrated.map((h) => ({
                        id: (0, crypto_1.randomUUID)(),
                        productId: h.productId || null,
                        name: h.name,
                        unit: h.unit,
                        quantity: h.quantity,
                        unitPrice: h.unitPrice,
                        subtotal: h.subtotal,
                        tenantId,
                        isOverridden: body.overrideStock
                    })) },
            },
            include: { items: true, payments: true },
        });
        if (pcsPriceUpserts.size) {
            for (const up of pcsPriceUpserts.values()) {
                const prev = await prisma_1.default.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name: up.name } } });
                const qty = prev?.quantity ?? 0;
                await prisma_1.default.pcsInventory.upsert({
                    where: { tenantId_name: { tenantId, name: up.name } },
                    create: {
                        id: (0, crypto_1.randomUUID)(),
                        tenantId,
                        name: up.name,
                        quantity: qty,
                        productId: up.productId,
                        packSize: up.packSize ?? null,
                        salesPrice: up.pcsPrice,
                    },
                    update: {
                        productId: up.productId,
                        packSize: up.packSize ?? null,
                        salesPrice: up.pcsPrice,
                    },
                });
            }
        }
        // Persist optional invoice number in meta store
        if (invoiceNumber && invoiceNumber.trim()) {
            await (0, invoiceMetaService_1.upsertInvoiceMeta)({ invoiceId, invoiceNumber: invoiceNumber.trim(), tenantId });
        }
        const createdWithMeta = {
            ...created,
            invoiceNumber: invoiceNumber?.trim() || undefined,
            customerName: resolvedCustomerId ? (await prisma_1.default.customers.findFirst({ where: { customerId: resolvedCustomerId, tenantId } }))?.name : undefined
        };
        try {
            const io = req.app.get("io");
            io.emit("invoice:created", createdWithMeta);
            io.emit("dashboard:refresh", { tenantId });
        }
        catch (err) {
            console.warn("Socket emission failed for createInvoice", err);
        }
        const pcsTotals = new Map();
        const ctnTotals = new Map();
        const purchaseRows = [];
        for (const h of hydrated) {
            const qty = Math.max(0, Number(h.quantity) || 0);
            const unitPrice = Number(h.unitPrice || 0);
            const totalCost = unitPrice * qty;
            // Point 1: Sync price back to inventory
            if (h.unit === "ctn" && h.productId) {
                // Update product carton price
                await prisma_1.default.products.update({
                    where: { productId: h.productId },
                    data: { price: unitPrice }
                });
            }
            else if (h.unit === "pcs" && h.name) {
                // Update PCS sales price
                await prisma_1.default.pcsInventory.updateMany({
                    where: { tenantId, name: { equals: h.name, mode: "insensitive" } },
                    data: { salesPrice: unitPrice }
                });
            }
            if (h.unit === "pcs") {
                const key = String(h.name || "").trim().toLowerCase();
                if (key)
                    pcsTotals.set(key, (pcsTotals.get(key) || 0) + qty);
                if (h.productId) {
                    purchaseRows.push({
                        id: (0, crypto_1.randomUUID)(),
                        customerId: resolvedCustomerId,
                        productId: h.productId,
                        timestamp: created.date,
                        quantity: qty,
                        unit: "pcs",
                        unitPrice,
                        totalCost,
                        tenantId,
                        isOverridden: body.overrideStock
                    });
                }
            }
            else {
                if (h.productId) {
                    ctnTotals.set(h.productId, { qty: (ctnTotals.get(h.productId)?.qty || 0) + qty });
                    purchaseRows.push({
                        id: (0, crypto_1.randomUUID)(),
                        customerId: resolvedCustomerId,
                        productId: h.productId,
                        timestamp: created.date,
                        quantity: qty,
                        unit: "ctn",
                        unitPrice,
                        totalCost,
                        tenantId,
                        isOverridden: body.overrideStock
                    });
                }
            }
        }
        const pcsPromises = [];
        for (const [name, qty] of pcsTotals.entries()) {
            pcsPromises.push((0, pcsInventoryService_1.adjustPcsQuantity)({ name, delta: -qty, tenantId }));
        }
        if (pcsPromises.length)
            await Promise.all(pcsPromises);
        if (ctnTotals.size) {
            const ids = Array.from(ctnTotals.keys());
            const prods = ids.length ? await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: ids } } }) : [];
            const map = new Map(prods.map((p) => [p.productId, p]));
            const updates = ids
                .map((pid) => {
                const p = map.get(pid);
                if (!p)
                    return null;
                const nextQty = Math.max(0, Number(p.stockQuantity) - Number(ctnTotals.get(pid)?.qty || 0));
                return prisma_1.default.products.update({ where: { productId: pid }, data: { stockQuantity: nextQty } });
            })
                .filter(Boolean);
            if (updates.length)
                await prisma_1.default.$transaction(updates);
        }
        if (purchaseRows.length) {
            await prisma_1.default.customerPurchases.createMany({ data: purchaseRows });
        }
        const label = createdWithMeta.invoiceNumber ? `Invoice #${createdWithMeta.invoiceNumber}` : "Invoice";
        (0, notificationService_1.appendNotification)({ type: "invoice", message: `Invoice created: ${label} (${createdWithMeta.customerName || created.location})`, actorUserId: req.user?.userId, tenantId });
        await maybeNotifyDueSoon(created, req.user?.userId);
        res.status(201).json(created);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to create invoice"));
    }
};
exports.createInvoice = createInvoice;
const getInvoicePrintOptions = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.invoices.findFirst({ where: { invoiceId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        res.json({
            invoiceId: id,
            options: {
                includePrices: true,
                includeDiscounts: true,
                includeVAT: true,
                pageSizes: ["A4", "Letter"],
                orientation: ["portrait", "landscape"],
            },
        });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to load print options"));
    }
};
exports.getInvoicePrintOptions = getInvoicePrintOptions;
const getInvoices = async (req, res) => {
    try {
        const search = (req.query.search || "").toString().trim().toLowerCase();
        const agentId = (req.query.agentId || "").toString().trim();
        const customerIdQ = (req.query.customerId || "").toString().trim();
        const customerQ = (req.query.customer || "").toString().trim().toLowerCase();
        const locationQ = (req.query.location || "").toString().trim();
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const statusQ = (req.query.status || "").toString().trim().toLowerCase();
        const limit = Math.max(0, Number(req.query.limit || 0));
        const offset = Math.max(0, Number(req.query.offset || 0));
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const where = { tenantId };
        if (agentId) {
            where.OR = [{ salesAgentId: agentId }];
        }
        if (customerIdQ) {
            where.customerId = customerIdQ;
        }
        if (locationQ) {
            where.location = { contains: locationQ, mode: "insensitive" };
        }
        if (customerQ) {
            where.customer = { name: { contains: customerQ, mode: "insensitive" } };
        }
        if (from || to) {
            where.date = {};
            if (from)
                where.date.gte = from;
            if (to)
                where.date.lte = to;
        }
        if (statusQ === "paid" || statusQ === "unpaid" || statusQ === "partial") {
            where.status = statusQ;
        }
        if (search) {
            const searchOr = [
                { invoiceId: { contains: search, mode: "insensitive" } },
                { location: { contains: search, mode: "insensitive" } },
                { customer: { name: { contains: search, mode: "insensitive" } } },
            ];
            if (where.AND) {
                where.AND.push({ OR: searchOr });
            }
            else {
                where.AND = [{ OR: searchOr }];
            }
        }
        const findManyArgs = {
            where,
            select: {
                invoiceId: true,
                customerId: true,
                date: true,
                location: true,
                salesAgent: true,
                status: true,
                totalWithoutVAT: true,
                vatAmount: true,
                totalWithVAT: true,
                dueDate: true,
                dueSoonNotifiedAt: true,
                dueDateNotifiedAt: true,
                createdAt: true,
                updatedAt: true,
                items: true,
                payments: true,
            },
            orderBy: { date: "desc" },
        };
        if (limit > 0) {
            findManyArgs.skip = offset;
            findManyArgs.take = limit;
        }
        const [invoices, total] = await Promise.all([
            prisma_1.default.invoices.findMany(findManyArgs),
            prisma_1.default.invoices.count({ where }),
        ]);
        if (!invoices.length) {
            res.json({ invoices: [], total });
            return;
        }
        const customerIds = Array.from(new Set(invoices.map((i) => i.customerId))).filter(Boolean);
        const customers = customerIds.length
            ? await prisma_1.default.customers.findMany({ where: { tenantId, customerId: { in: customerIds } } })
            : [];
        const customerMap = new Map(customers.map((c) => [c.customerId, c.name]));
        const list = await Promise.all(invoices.map(async (inv) => {
            const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
            return { ...inv, customerName: customerMap.get(inv.customerId), invoiceNumber: meta?.invoiceNumber || undefined };
        }));
        res.json({ invoices: list, total });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to load invoices"));
    }
};
exports.getInvoices = getInvoices;
const getInvoiceStats = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const where = { tenantId };
        if (from || to) {
            where.date = {};
            if (from)
                where.date.gte = from;
            if (to)
                where.date.lte = to;
        }
        const [paid, unpaid, partial] = await Promise.all([
            prisma_1.default.invoices.count({ where: { ...where, status: "paid" } }),
            prisma_1.default.invoices.count({ where: { ...where, status: "unpaid" } }),
            prisma_1.default.invoices.count({ where: { ...where, status: "partial" } }),
        ]);
        res.json({ counts: { paid, unpaid, partial } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to load invoice stats"));
    }
};
exports.getInvoiceStats = getInvoiceStats;
const getInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const inv = await prisma_1.default.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: { include: { product: true } }, payments: true, customer: true } });
        if (!inv) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        const paymentsSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
        const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
        res.json({ ...inv, status, invoiceNumber: meta?.invoiceNumber || undefined, customerName: inv.customer?.name });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to load invoice"));
    }
};
exports.getInvoiceById = getInvoiceById;
const updateInvoice = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const { id } = req.params;
        const body = UpdateInvoiceBodySchema.parse(req.body || {});
        const existing = await prisma_1.default.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: true, payments: true } });
        if (!existing) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        const vatPercent = typeof body.vatPercent === "number" ? body.vatPercent : existing.vatPercent;
        const discountPercent = typeof body.discountPercent === "number" ? body.discountPercent : existing.discountPercent;
        const pcsPriceUpserts = new Map();
        const updatedItems = body.items ? await Promise.all(body.items.map(async (it) => {
            let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
            let displayName = it.name;
            if (it.productId) {
                const p = await prisma_1.default.products.findFirst({ where: { productId: it.productId, tenantId } });
                if (p) {
                    displayName = displayName || p.name;
                    if (unitPrice === undefined) {
                        const multiplier = parseCtnxMultiplier(it.unit);
                        const explicitPcsPrice = typeof it.pcsPrice === "number" ? Number(it.pcsPrice) : undefined;
                        const pcsRow = await prisma_1.default.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name: p.name } }, select: { salesPrice: true } });
                        const pack = Number(String(p.packSize || "").replace(/\D+/g, "")) || 0;
                        const derivedPcsPrice = pack > 0 ? Number(p.price) / Math.max(pack, 1) : undefined;
                        const basePcsPrice = explicitPcsPrice ?? (pcsRow?.salesPrice ?? undefined) ?? derivedPcsPrice;
                        if (explicitPcsPrice !== undefined) {
                            pcsPriceUpserts.set(String(p.name || "").toLowerCase(), { productId: p.productId, name: p.name, pcsPrice: explicitPcsPrice, packSize: p.packSize ?? null });
                        }
                        if (it.unit === "ctn") {
                            unitPrice = Number(p.price);
                        }
                        else if (it.unit === "pcs") {
                            unitPrice = basePcsPrice ?? 0;
                        }
                        else if (multiplier !== null) {
                            unitPrice = (basePcsPrice ?? 0) * multiplier;
                        }
                        else {
                            unitPrice = Number(p.price);
                        }
                    }
                }
            }
            unitPrice = unitPrice ?? 0;
            const quantity = Math.max(1, Number(it.quantity) || 1);
            return { id: (0, crypto_1.randomUUID)(), productId: it.productId || null, name: displayName || "", unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
        })) : existing.items;
        const totals = computeTotals(updatedItems.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })), vatPercent, discountPercent);
        // Resolve normalized display names if IDs provided
        let nextLocation = body.location ?? existing.location;
        let nextSalesAgent = body.salesAgent ?? existing.salesAgent;
        let nextLocationId = body.locationId ?? existing.locationId ?? null;
        let nextSalesAgentId = body.salesAgentId ?? existing.salesAgentId ?? null;
        if (body.locationId) {
            const loc = await prisma_1.default.locations.findFirst({ where: { id: body.locationId, tenantId } });
            nextLocation = loc?.name || nextLocation;
            nextLocationId = body.locationId;
        }
        if (body.salesAgentId) {
            const agent = await prisma_1.default.salesAgents.findFirst({ where: { id: body.salesAgentId, tenantId } });
            nextSalesAgent = agent?.name || nextSalesAgent;
            nextSalesAgentId = body.salesAgentId;
        }
        const nextDueDate = body.dueDate ? new Date(body.dueDate) : existing.dueDate;
        const dueDateChanged = typeof body.dueDate === "string" &&
            (existing.dueDate?.getTime() || null) !== (nextDueDate?.getTime() || null);
        const updated = await prisma_1.default.invoices.update({
            where: { invoiceId: id },
            data: {
                location: nextLocation,
                salesAgent: nextSalesAgent,
                locationId: nextLocationId,
                salesAgentId: nextSalesAgentId,
                // Allow updating the invoice date if provided
                date: body.date ? new Date(body.date) : existing.date,
                vatPercent,
                discountPercent,
                paymentTermType: body.paymentTermType ? (body.paymentTermType === "due_date" ? "due_date" : "immediate") : existing.paymentTermType,
                dueDate: nextDueDate,
                dueSoonNotifiedAt: dueDateChanged ? null : existing.dueSoonNotifiedAt,
                dueDateNotifiedAt: dueDateChanged ? null : existing.dueDateNotifiedAt,
                notes: body.notes ?? existing.notes,
                totalWithoutVAT: totals.totalWithoutVAT,
                vatAmount: totals.vatAmount,
                totalWithVAT: totals.totalWithVAT,
                items: body.items ? {
                    deleteMany: { invoiceId: id },
                    create: updatedItems.map((h) => ({
                        id: h.id,
                        productId: h.productId || null,
                        name: h.name,
                        unit: h.unit,
                        quantity: h.quantity,
                        unitPrice: h.unitPrice,
                        subtotal: h.subtotal,
                        isOverridden: body.overrideStock
                    })),
                } : undefined,
            },
            include: { items: true, payments: true },
        });
        if (pcsPriceUpserts.size) {
            for (const up of pcsPriceUpserts.values()) {
                const prev = await prisma_1.default.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name: up.name } } });
                const qty = prev?.quantity ?? 0;
                await prisma_1.default.pcsInventory.upsert({
                    where: { tenantId_name: { tenantId, name: up.name } },
                    create: {
                        id: (0, crypto_1.randomUUID)(),
                        tenantId,
                        name: up.name,
                        quantity: qty,
                        productId: up.productId,
                        packSize: up.packSize ?? null,
                        salesPrice: up.pcsPrice,
                    },
                    update: {
                        productId: up.productId,
                        packSize: up.packSize ?? null,
                        salesPrice: up.pcsPrice,
                    },
                });
            }
        }
        // Update invoice number in meta store if provided
        if (typeof body.invoiceNumber === "string") {
            const normalized = body.invoiceNumber.trim();
            await (0, invoiceMetaService_1.upsertInvoiceMeta)({ invoiceId: id, invoiceNumber: normalized || null, tenantId });
        }
        // Reconcile inventory changes based on item diffs (carton stock and PCS inventory)
        const prevMap = new Map();
        for (const it of existing.items) {
            if (it.unit === "ctn" && it.productId) {
                prevMap.set(`ctn:${it.productId}`, { qty: (prevMap.get(`ctn:${it.productId}`)?.qty || 0) + Number(it.quantity || 0) });
            }
            else if (it.unit === "pcs") {
                const keyName = String(it.name || "").trim();
                if (keyName)
                    prevMap.set(`pcs:${keyName.toLowerCase()}`, { qty: (prevMap.get(`pcs:${keyName.toLowerCase()}`)?.qty || 0) + Number(it.quantity || 0) });
            }
        }
        const nextMap = new Map();
        for (const it of updated.items) {
            if (it.unit === "ctn" && it.productId) {
                const k = `ctn:${it.productId}`;
                const prev = nextMap.get(k);
                nextMap.set(k, { qty: (prev?.qty || 0) + Number(it.quantity || 0), unitPrice: it.unitPrice, productId: it.productId || undefined });
            }
            else if (it.unit === "pcs") {
                const keyName = String(it.name || "").trim().toLowerCase();
                if (!keyName)
                    continue;
                const k = `pcs:${keyName}`;
                const prev = nextMap.get(k);
                nextMap.set(k, { qty: (prev?.qty || 0) + Number(it.quantity || 0), unitPrice: it.unitPrice, name: it.name });
            }
        }
        const keys = new Set([...prevMap.keys(), ...nextMap.keys()]);
        let changedCount = 0;
        for (const k of keys) {
            const prevQty = prevMap.get(k)?.qty || 0;
            const nextQty = nextMap.get(k)?.qty || 0;
            const delta = nextQty - prevQty;
            if (!delta)
                continue;
            changedCount += 1;
            if (k.startsWith("ctn:")) {
                const productId = k.slice(4);
                const p = await prisma_1.default.products.findFirst({ where: { productId, tenantId } });
                if (p) {
                    const newQty = Math.max(0, Number(p.stockQuantity) - delta); // delta>0 deduct; delta<0 add back
                    await prisma_1.default.products.update({ where: { productId }, data: { stockQuantity: newQty } });
                    // Record additional purchases only when quantity increases
                    if (delta > 0) {
                        const unitPrice = Number(nextMap.get(k)?.unitPrice || p.price);
                        await prisma_1.default.customerPurchases.create({ data: {
                                id: (0, crypto_1.randomUUID)(),
                                customerId: updated.customerId,
                                productId,
                                timestamp: updated.date,
                                quantity: delta,
                                unit: "ctn",
                                unitPrice,
                                totalCost: unitPrice * delta,
                                tenantId,
                                isOverridden: body.overrideStock || false
                            } });
                    }
                }
            }
            else if (k.startsWith("pcs:")) {
                const name = k.slice(4);
                await (0, pcsInventoryService_1.adjustPcsQuantity)({ name, delta: -delta, tenantId });
                // Also record purchase if quantity increased and we can find a productId
                if (delta > 0) {
                    const info = nextMap.get(k);
                    const pcsRow = await prisma_1.default.pcsInventory.findFirst({ where: { tenantId, name: { equals: name, mode: "insensitive" } } });
                    if (pcsRow?.productId) {
                        const unitPrice = Number(info?.unitPrice || pcsRow.salesPrice || 0);
                        await prisma_1.default.customerPurchases.create({ data: {
                                id: (0, crypto_1.randomUUID)(),
                                customerId: updated.customerId,
                                productId: pcsRow.productId,
                                timestamp: updated.date,
                                quantity: delta,
                                unit: "pcs",
                                unitPrice,
                                totalCost: unitPrice * delta,
                                tenantId,
                                isOverridden: body.overrideStock || false
                            } });
                    }
                }
            }
        }
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(id, req.tenantId || req.user?.tenantId || "default");
        if (changedCount > 0) {
            const label = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
            (0, notificationService_1.appendNotification)({ type: "inventory", message: `Reconciled inventory for ${label}; ${changedCount} item group(s) adjusted.`, actorUserId: req.user?.userId, tenantId });
        }
        await maybeNotifyDueSoon(updated, req.user?.userId);
        const updatedWithMeta = { ...updated, invoiceNumber: meta?.invoiceNumber || undefined };
        try {
            const io = req.app.get("io");
            io.emit("invoice:updated", updatedWithMeta);
            io.emit("dashboard:refresh", { tenantId: req.tenantId || req.user?.tenantId || "default" });
        }
        catch (err) {
            console.warn("Socket emission failed for updateInvoice", err);
        }
        res.json(updatedWithMeta);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to update invoice"));
    }
};
exports.updateInvoice = updateInvoice;
const addPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const body = req.body || {};
        const inv = await prisma_1.default.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { payments: true } });
        if (!inv) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        const amount = Number(body.amount) || 0;
        // Check if invoice is already fully paid
        const currentPaid = (inv.payments || []).reduce((acc, p) => acc + Number(p.amount), 0);
        const remaining = Math.max(0, inv.totalWithVAT - currentPaid);
        if (remaining <= 0) {
            res.status(400).json({ message: "Invoice is already fully paid" });
            return;
        }
        // Prevent overpayment
        if (amount > remaining + 0.01) { // small buffer for float precision
            res.status(400).json({ message: `Payment amount (₦${amount.toFixed(2)}) exceeds remaining balance (₦${remaining.toFixed(2)})` });
            return;
        }
        const payment = await prisma_1.default.$transaction(async (tx) => {
            const bank = await tx.banks.findFirst({ where: { tenantId, name: body.bankName, account: body.bankAccount } });
            if (!bank) {
                const err = new Error("Selected bank account not found");
                err.status = 400;
                throw err;
            }
            // Invoice payments INCREASE bank balance
            const bal = Number(bank.balance || 0);
            await tx.banks.update({ where: { id: bank.id }, data: { balance: bal + amount } });
            const pay = await tx.payments.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    invoiceId: id,
                    customerId: body.customerId || inv.customerId,
                    date: body.date ? new Date(body.date) : new Date(),
                    amount,
                    bankName: body.bankName,
                    bankAccount: body.bankAccount,
                    tenantId,
                },
            });
            return pay;
        }).catch((e) => {
            const code = typeof e?.status === "number" ? e.status : 500;
            const msg = typeof e?.message === "string" ? e.message : "Failed to add payment";
            res.status(code).json({ message: msg });
            return null;
        });
        if (!payment)
            return;
        const paymentsSum = (inv.payments || []).reduce((acc, p) => acc + p.amount, 0) + payment.amount;
        const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
        const updatedInv = await prisma_1.default.invoices.update({ where: { invoiceId: id }, data: { status } });
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(id, tenantId);
        const label = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
        (0, notificationService_1.appendNotification)({ type: "invoice", message: `Payment added for ${label}: ₦${payment.amount.toFixed(2)} (${payment.bankName})`, actorUserId: req.user?.userId, tenantId });
        const fullInvoice = await prisma_1.default.invoices.findUnique({
            where: { invoiceId: id },
            include: { items: true, payments: true },
        });
        if (fullInvoice) {
            // meta already fetched
            try {
                const io = req.app.get("io");
                io.emit("invoice:updated", { ...fullInvoice, invoiceNumber: meta?.invoiceNumber });
                io.emit("dashboard:refresh", { tenantId });
            }
            catch (err) {
                console.warn("Socket emission failed for addPayment", err);
            }
        }
        res.status(201).json({ payment, invoice: updatedInv });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to add payment"));
    }
};
exports.addPayment = addPayment;
// DELETE /invoices/:id - delete an invoice and reconcile inventory & related records
const deleteInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const inv = await prisma_1.default.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: true, payments: true } });
        if (!inv) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        // Revert inventory adjustments and remove customer purchase records linked by timestamp & productId
        for (const it of inv.items) {
            const qty = Math.max(0, Number(it.quantity) || 0);
            if (it.unit === "ctn" && it.productId) {
                const p = await prisma_1.default.products.findFirst({ where: { productId: it.productId, tenantId } });
                if (p) {
                    const newQty = Math.max(0, Number(p.stockQuantity) + qty);
                    await prisma_1.default.products.update({ where: { productId: it.productId }, data: { stockQuantity: newQty } });
                }
            }
            else if (it.unit === "pcs") {
                const nameForPcs = String(it.name || "").trim();
                if (nameForPcs) {
                    await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: nameForPcs, delta: qty, tenantId });
                }
            }
            // Remove any recorded customer purchases for this invoice item (matching customer, date, product)
            await prisma_1.default.customerPurchases.deleteMany({
                where: {
                    customerId: inv.customerId,
                    timestamp: inv.date,
                    productId: it.productId ?? undefined,
                    tenantId,
                },
            });
        }
        // Remove dependent records first to satisfy FK constraints
        await prisma_1.default.payments.deleteMany({ where: { invoiceId: id } });
        await prisma_1.default.invoiceItems.deleteMany({ where: { invoiceId: id } });
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(id);
        const label = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
        await prisma_1.default.invoices.delete({ where: { invoiceId: id } });
        // Remove meta on delete for cleanliness
        try {
            await (0, invoiceMetaService_1.removeInvoiceMeta)(id);
        }
        catch { }
        (0, notificationService_1.appendNotification)({ type: "invoice", message: `Deleted ${label}`, actorUserId: req.user?.userId, tenantId });
        try {
            const io = req.app.get("io");
            io.emit("invoice:deleted", { invoiceId: id });
            io.emit("dashboard:refresh", { tenantId });
        }
        catch (err) {
            console.warn("Socket emission failed for deleteInvoice", err);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "invoice", "Failed to delete invoice"));
    }
};
exports.deleteInvoice = deleteInvoice;
