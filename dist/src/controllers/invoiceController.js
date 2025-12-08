"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteInvoice = exports.addPayment = exports.updateInvoice = exports.getInvoiceById = exports.getInvoices = exports.getInvoicePrintOptions = exports.createInvoice = void 0;
const zod_1 = require("zod");
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const notificationService_1 = require("../services/notificationService");
const invoiceMetaService_1 = require("../services/invoiceMetaService");
const pcsInventoryService_1 = require("../services/pcsInventoryService");
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
    items: zod_1.z.array(zod_1.z.object({
        productId: zod_1.z.string().optional(),
        name: zod_1.z.string().min(1),
        unit: zod_1.z.enum(["ctn", "pcs"]),
        quantity: zod_1.z.coerce.number().int().min(1),
        unitPrice: zod_1.z.coerce.number().nonnegative().optional(),
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
    items: zod_1.z
        .array(zod_1.z.object({
        id: zod_1.z.string().optional(),
        productId: zod_1.z.string().optional(),
        name: zod_1.z.string().optional(),
        unit: zod_1.z.enum(["ctn", "pcs"]),
        quantity: zod_1.z.coerce.number().int().min(1),
        unitPrice: zod_1.z.coerce.number().nonnegative().optional(),
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
function daysUntil(date) {
    const now = new Date();
    const ms = date.getTime() - now.getTime();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
async function maybeNotifyDueSoon(inv, actorUserId) {
    if (!inv.dueDate)
        return;
    if (inv.status === "paid")
        return;
    const days = daysUntil(inv.dueDate);
    if (days === 5 && !inv.dueSoonNotifiedAt) {
        (0, notificationService_1.appendNotification)({
            type: "invoice",
            message: `Invoice ${inv.invoiceId} for customer ${inv.customerId} has 5 days remaining to complete payment`,
            actorUserId,
        });
        await prisma_1.default.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueSoonNotifiedAt: new Date() } });
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
        // Hydrate items with default prices if missing
        const hydrated = await Promise.all(items.map(async (it) => {
            let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
            let displayName = it.name;
            if (it.productId) {
                const p = await prisma_1.default.products.findFirst({ where: { productId: it.productId, tenantId } });
                if (p) {
                    displayName = displayName || p.name;
                    if (unitPrice === undefined) {
                        if (it.unit === "pcs") {
                            const pack = Number((p.packSize || "").replace(/\D+/g, "")) || 1;
                            unitPrice = p.price / Math.max(pack, 1);
                        }
                        else {
                            unitPrice = p.price;
                        }
                    }
                }
            }
            unitPrice = unitPrice ?? 0;
            const quantity = Math.max(1, Number(it.quantity) || 1);
            return { productId: it.productId, name: displayName, unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
        }));
        const totals = computeTotals(hydrated, vatPercent, discountPercent);
        const invoiceId = (0, crypto_1.randomUUID)();
        // Resolve normalized names if IDs provided
        let resolvedLocation = location;
        let resolvedSalesAgent = salesAgent;
        if (locationId) {
            const loc = await prisma_1.default.locations.findUnique({ where: { id: locationId } });
            resolvedLocation = loc?.name || location;
        }
        if (salesAgentId) {
            const agent = await prisma_1.default.salesAgents.findUnique({ where: { id: salesAgentId } });
            resolvedSalesAgent = agent?.name || salesAgent;
        }
        const created = await prisma_1.default.invoices.create({
            data: {
                invoiceId,
                customerId: resolvedCustomerId,
                date: date ? new Date(date) : new Date(),
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
                items: { create: hydrated.map((h) => ({ id: (0, crypto_1.randomUUID)(), productId: h.productId || null, name: h.name, unit: h.unit, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal, tenantId })) },
            },
            include: { items: true, payments: true },
        });
        // Persist optional invoice number in meta store
        if (invoiceNumber && invoiceNumber.trim()) {
            await (0, invoiceMetaService_1.upsertInvoiceMeta)({ invoiceId, invoiceNumber: invoiceNumber.trim(), tenantId });
        }
        // After creating invoice, deduct stock and record purchases for each item
        for (const h of hydrated) {
            const qty = Math.max(0, Number(h.quantity) || 0);
            const unitPrice = Number(h.unitPrice || 0);
            const totalCost = unitPrice * qty;
            if (h.unit === "pcs") {
                const nameForPcs = (h.name || "").trim();
                if (nameForPcs) {
                    // Adjust PCS inventory maintained in JSON store
                    await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: nameForPcs, delta: -qty, tenantId });
                }
                // Record purchase if linked to a product
                if (h.productId) {
                    await prisma_1.default.customerPurchases.create({
                        data: {
                            id: (0, crypto_1.randomUUID)(),
                            customerId: resolvedCustomerId,
                            productId: h.productId,
                            timestamp: created.date,
                            quantity: qty,
                            unitPrice,
                            totalCost,
                            tenantId,
                        },
                    });
                }
            }
            else {
                // Carton unit: deduct from product stock (clamped at 0) and record purchase
                if (h.productId) {
                    const p = await prisma_1.default.products.findFirst({ where: { productId: h.productId, tenantId } });
                    if (p) {
                        const newQty = Math.max(0, Number(p.stockQuantity) - qty);
                        await prisma_1.default.products.update({ where: { productId: h.productId }, data: { stockQuantity: newQty } });
                        await prisma_1.default.customerPurchases.create({
                            data: {
                                id: (0, crypto_1.randomUUID)(),
                                customerId: resolvedCustomerId,
                                productId: h.productId,
                                timestamp: created.date,
                                quantity: qty,
                                unitPrice,
                                totalCost,
                                tenantId,
                            },
                        });
                    }
                }
            }
        }
        (0, notificationService_1.appendNotification)({ type: "invoice", message: `Invoice created: ${created.invoiceId} (${created.location})`, actorUserId: req.user?.userId });
        await maybeNotifyDueSoon(created, req.user?.userId);
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createInvoice error:", err);
        const msg = err instanceof Error ? err.message : "Failed to create invoice";
        res.status(500).json({ message: msg });
    }
};
exports.createInvoice = createInvoice;
const getInvoicePrintOptions = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma_1.default.invoices.findUnique({ where: { invoiceId: id } });
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
        res.status(500).json({ message: "Failed to load print options" });
    }
};
exports.getInvoicePrintOptions = getInvoicePrintOptions;
const getInvoices = async (req, res) => {
    try {
        const search = (req.query.search || "").toString().trim().toLowerCase();
        const agentId = (req.query.agentId || "").toString().trim();
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const where = { tenantId };
        if (agentId) {
            where.OR = [{ salesAgentId: agentId }];
        }
        if (from || to) {
            where.date = {};
            if (from)
                where.date.gte = from;
            if (to)
                where.date.lte = to;
        }
        const invoices = await prisma_1.default.invoices.findMany({ where, include: { items: true, payments: true }, orderBy: { date: "desc" } });
        for (const inv of invoices) {
            await maybeNotifyDueSoon(inv, req.user?.userId);
        }
        if (!invoices.length) {
            res.json({ invoices: [] });
            return;
        }
        const customerIds = Array.from(new Set(invoices.map((i) => i.customerId))).filter(Boolean);
        const customers = customerIds.length
            ? await prisma_1.default.customers.findMany({ where: { tenantId, customerId: { in: customerIds } } })
            : [];
        const customerMap = new Map(customers.map((c) => [c.customerId, c.name]));
        const list = await Promise.all(invoices.map(async (inv) => {
            const paymentsSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
            const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
            const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
            return { ...inv, status, customerName: customerMap.get(inv.customerId), invoiceNumber: meta?.invoiceNumber || undefined };
        }));
        const filtered = list.filter((inv) => {
            if (!search)
                return true;
            return (inv.invoiceId.toLowerCase().includes(search) ||
                (inv.invoiceNumber || "").toLowerCase().includes(search) ||
                (inv.customerName || "").toLowerCase().includes(search) ||
                inv.location.toLowerCase().includes(search));
        });
        res.json({ invoices: filtered });
    }
    catch (err) {
        console.error("getInvoices error:", err);
        const msg = err instanceof Error ? err.message : "Failed to load invoices";
        res.status(500).json({ message: msg });
    }
};
exports.getInvoices = getInvoices;
const getInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const inv = await prisma_1.default.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: true, payments: true } });
        if (!inv) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        const paymentsSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
        const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
        res.json({ ...inv, status, invoiceNumber: meta?.invoiceNumber || undefined });
    }
    catch (err) {
        console.error("getInvoiceById error:", err);
        res.status(500).json({ message: "Failed to load invoice" });
    }
};
exports.getInvoiceById = getInvoiceById;
const updateInvoice = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const { id } = req.params;
        const body = UpdateInvoiceBodySchema.parse(req.body || {});
        const existing = await prisma_1.default.invoices.findUnique({ where: { invoiceId: id }, include: { items: true, payments: true } });
        if (!existing) {
            res.status(404).json({ message: "Invoice not found" });
            return;
        }
        const vatPercent = typeof body.vatPercent === "number" ? body.vatPercent : existing.vatPercent;
        const discountPercent = typeof body.discountPercent === "number" ? body.discountPercent : existing.discountPercent;
        const updatedItems = body.items ? await Promise.all(body.items.map(async (it) => {
            let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
            let displayName = it.name;
            if (it.productId) {
                const p = await prisma_1.default.products.findUnique({ where: { productId: it.productId } });
                if (p) {
                    displayName = displayName || p.name;
                    if (unitPrice === undefined) {
                        if (it.unit === "pcs") {
                            const pack = Number((p.packSize || "").replace(/\D+/g, "")) || 1;
                            unitPrice = p.price / Math.max(pack, 1);
                        }
                        else {
                            unitPrice = p.price;
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
            const loc = await prisma_1.default.locations.findUnique({ where: { id: body.locationId } });
            nextLocation = loc?.name || nextLocation;
            nextLocationId = body.locationId;
        }
        if (body.salesAgentId) {
            const agent = await prisma_1.default.salesAgents.findUnique({ where: { id: body.salesAgentId } });
            nextSalesAgent = agent?.name || nextSalesAgent;
            nextSalesAgentId = body.salesAgentId;
        }
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
                dueDate: body.dueDate ? new Date(body.dueDate) : existing.dueDate,
                notes: body.notes ?? existing.notes,
                totalWithoutVAT: totals.totalWithoutVAT,
                vatAmount: totals.vatAmount,
                totalWithVAT: totals.totalWithVAT,
                items: body.items ? {
                    deleteMany: { invoiceId: id },
                    create: updatedItems.map((h) => ({ id: h.id, productId: h.productId || null, name: h.name, unit: h.unit, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal })),
                } : undefined,
            },
            include: { items: true, payments: true },
        });
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
                                unitPrice,
                                totalCost: unitPrice * delta,
                            } });
                    }
                }
            }
            else if (k.startsWith("pcs:")) {
                const name = k.slice(4);
                await (0, pcsInventoryService_1.adjustPcsQuantity)({ name, delta: -delta, tenantId });
            }
        }
        if (changedCount > 0) {
            (0, notificationService_1.appendNotification)({ type: "inventory", message: `Reconciled inventory for invoice ${id}; ${changedCount} item group(s) adjusted.`, actorUserId: req.user?.userId });
        }
        await maybeNotifyDueSoon(updated, req.user?.userId);
        const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(id, req.tenantId || req.user?.tenantId || "default");
        res.json({ ...updated, invoiceNumber: meta?.invoiceNumber || undefined });
    }
    catch (err) {
        console.error("updateInvoice error:", err);
        res.status(500).json({ message: "Failed to update invoice" });
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
        const payment = await prisma_1.default.payments.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                invoiceId: id,
                customerId: body.customerId || inv.customerId,
                date: body.date ? new Date(body.date) : new Date(),
                amount: Number(body.amount) || 0,
                bankName: body.bankName,
                bankAccount: body.bankAccount,
                tenantId,
            },
        });
        const paymentsSum = (inv.payments || []).reduce((acc, p) => acc + p.amount, 0) + payment.amount;
        const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
        const updatedInv = await prisma_1.default.invoices.update({ where: { invoiceId: id }, data: { status } });
        (0, notificationService_1.appendNotification)({ type: "invoice", message: `Payment added for invoice ${id}: ₦${payment.amount.toFixed(2)} (${payment.bankName})`, actorUserId: req.user?.userId });
        res.status(201).json({ payment, invoice: updatedInv });
    }
    catch (err) {
        console.error("addPayment error:", err);
        res.status(500).json({ message: "Failed to add payment" });
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
                const p = await prisma_1.default.products.findUnique({ where: { productId: it.productId } });
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
        await prisma_1.default.payments.deleteMany({ where: { invoiceId: id, tenantId } });
        await prisma_1.default.invoiceItems.deleteMany({ where: { invoiceId: id, tenantId } });
        await prisma_1.default.invoices.delete({ where: { invoiceId: id } });
        // Remove meta on delete for cleanliness
        try {
            await (0, invoiceMetaService_1.removeInvoiceMeta)(id);
        }
        catch { }
        (0, notificationService_1.appendNotification)({ type: "invoice", message: `Invoice deleted: ${id}`, actorUserId: req.user?.userId });
        res.json({ success: true });
    }
    catch (err) {
        console.error("deleteInvoice error:", err);
        const msg = err instanceof Error ? err.message : "Failed to delete invoice";
        res.status(500).json({ message: msg });
    }
};
exports.deleteInvoice = deleteInvoice;
