"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPurchasesReport = exports.getFinancialReport = exports.getSalesReport = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const supplierPurchasesService_1 = require("../services/supplierPurchasesService");
const getSalesReport = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const fromRaw = req.query?.from;
        const toRaw = req.query?.to;
        const from = fromRaw ? new Date(fromRaw) : undefined;
        const to = toRaw ? new Date(toRaw) : undefined;
        let timestampFilter = undefined;
        if (from)
            timestampFilter = { ...(timestampFilter || {}), gte: from };
        if (to)
            timestampFilter = { ...(timestampFilter || {}), lte: to };
        const where = timestampFilter
            ? { tenantId, timestamp: timestampFilter }
            : { tenantId };
        const purchases = await prisma_1.default.customerPurchases.findMany({
            where,
            orderBy: { timestamp: "desc" },
        });
        // Preload product and customer names
        const productIds = Array.from(new Set(purchases.map((p) => p.productId).filter(Boolean)));
        const customerIds = Array.from(new Set(purchases.map((p) => p.customerId).filter(Boolean)));
        const products = productIds.length
            ? await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } })
            : [];
        const customers = customerIds.length
            ? await prisma_1.default.customers.findMany({ where: { tenantId, customerId: { in: customerIds } }, select: { customerId: true, name: true } })
            : [];
        const productNameMap = new Map(products.map((p) => [p.productId, p.name]));
        const customerNameMap = new Map(customers.map((c) => [c.customerId, c.name]));
        const items = purchases.map((p) => ({
            id: p.id,
            productId: p.productId,
            productName: productNameMap.get(p.productId) || undefined,
            customerId: p.customerId,
            customerName: customerNameMap.get(p.customerId) || undefined,
            quantity: p.quantity,
            unitPrice: Number(p.unitPrice || 0),
            totalCost: Number(p.totalCost || 0),
            timestamp: p.timestamp,
        }));
        const total = items.reduce((sum, it) => sum + it.totalCost, 0);
        // Aggregate by day
        const dailyMap = new Map();
        for (const it of items) {
            const d = new Date(it.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            dailyMap.set(key, (dailyMap.get(key) || 0) + it.totalCost);
        }
        const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));
        res.json({ total, count: items.length, items, daily });
    }
    catch (err) {
        console.error("getSalesReport error:", err);
        res.status(500).json({ message: "Failed to load sales report" });
    }
};
exports.getSalesReport = getSalesReport;
const getFinancialReport = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const fromRaw = req.query?.from;
        const toRaw = req.query?.to;
        const from = fromRaw ? new Date(fromRaw) : undefined;
        const to = toRaw ? new Date(toRaw) : undefined;
        let timestampFilter = undefined;
        if (from)
            timestampFilter = { ...(timestampFilter || {}), gte: from };
        if (to)
            timestampFilter = { ...(timestampFilter || {}), lte: to };
        // Sales from customer purchases (total and detailed items)
        const salesWhere = timestampFilter
            ? { tenantId, timestamp: timestampFilter }
            : { tenantId };
        const salesRowsFull = await prisma_1.default.customerPurchases.findMany({ where: salesWhere, orderBy: { timestamp: "desc" } });
        const salesProductIds = Array.from(new Set(salesRowsFull.map((p) => p.productId).filter(Boolean)));
        const salesCustomerIds = Array.from(new Set(salesRowsFull.map((p) => p.customerId).filter(Boolean)));
        const salesProducts = salesProductIds.length
            ? await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: salesProductIds } }, select: { productId: true, name: true } })
            : [];
        const salesCustomers = salesCustomerIds.length
            ? await prisma_1.default.customers.findMany({ where: { tenantId, customerId: { in: salesCustomerIds } }, select: { customerId: true, name: true } })
            : [];
        const salesProductNameMap = new Map(salesProducts.map((p) => [p.productId, p.name]));
        const salesCustomerNameMap = new Map(salesCustomers.map((c) => [c.customerId, c.name]));
        const salesItems = salesRowsFull.map((p) => ({
            id: p.id,
            productId: p.productId,
            productName: salesProductNameMap.get(p.productId) || undefined,
            customerId: p.customerId,
            customerName: salesCustomerNameMap.get(p.customerId) || undefined,
            quantity: p.quantity,
            unitPrice: Number(p.unitPrice || 0),
            totalCost: Number(p.totalCost || 0),
            timestamp: p.timestamp,
        }));
        const salesTotal = salesItems.reduce((sum, r) => sum + Number(r.totalCost || 0), 0);
        // Purchases from procurement purchases (total and detailed items)
        const purchasesWhere = timestampFilter
            ? { tenantId, timestamp: timestampFilter }
            : { tenantId };
        const purchaseRowsFull = await prisma_1.default.purchases.findMany({ where: purchasesWhere, orderBy: { timestamp: "desc" } });
        const purchaseProductIds = Array.from(new Set(purchaseRowsFull.map((p) => p.productId).filter(Boolean)));
        const purchaseProducts = purchaseProductIds.length
            ? await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: purchaseProductIds } }, select: { productId: true, name: true } })
            : [];
        const purchaseProductNameMap = new Map(purchaseProducts.map((p) => [p.productId, p.name]));
        const purchaseItems = purchaseRowsFull.map((p) => ({
            purchaseId: p.purchaseId,
            productId: p.productId,
            productName: purchaseProductNameMap.get(p.productId) || undefined,
            quantity: p.quantity,
            unitCost: Number(p.unitCost || 0),
            totalCost: Number(p.totalCost || 0),
            timestamp: p.timestamp,
            supplierName: (0, supplierPurchasesService_1.getSupplierMetaFor)(p.purchaseId)?.supplierName || undefined,
        }));
        const purchasesTotal = purchaseItems.reduce((sum, r) => sum + Number(r.totalCost || 0), 0);
        // Expenses total from JSON store
        const expensesRows = await prisma_1.default.expenses.findMany({ where: { tenantId, ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, orderBy: { timestamp: "desc" } });
        const expenseItems = expensesRows.map((e) => ({ id: e.expenseId, name: e.category, category: e.category, amount: Number(e.amount || 0), date: e.timestamp.toISOString() }));
        const expensesTotal = expenseItems.reduce((sum, e) => sum + Number(e.amount || 0), 0);
        const net = salesTotal - purchasesTotal - expensesTotal;
        res.json({ salesTotal, purchasesTotal, expensesTotal, net, from: fromRaw || null, to: toRaw || null, salesItems, purchaseItems, expenseItems });
    }
    catch (err) {
        console.error("getFinancialReport error:", err);
        res.status(500).json({ message: "Failed to load financial report" });
    }
};
exports.getFinancialReport = getFinancialReport;
// Purchases report (similar to sales, but for procurement purchases)
const getPurchasesReport = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const fromRaw = req.query?.from;
        const toRaw = req.query?.to;
        const from = fromRaw ? new Date(fromRaw) : undefined;
        const to = toRaw ? new Date(toRaw) : undefined;
        let timestampFilter = undefined;
        if (from)
            timestampFilter = { ...(timestampFilter || {}), gte: from };
        if (to)
            timestampFilter = { ...(timestampFilter || {}), lte: to };
        const where = timestampFilter
            ? { tenantId, timestamp: timestampFilter }
            : { tenantId };
        const purchases = await prisma_1.default.purchases.findMany({
            where,
            orderBy: { timestamp: "desc" },
        });
        // Preload product names
        const productIds = Array.from(new Set(purchases.map((p) => p.productId).filter(Boolean)));
        const products = productIds.length
            ? await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } })
            : [];
        const productNameMap = new Map(products.map((p) => [p.productId, p.name]));
        const items = purchases.map((p) => ({
            purchaseId: p.purchaseId,
            productId: p.productId,
            productName: productNameMap.get(p.productId) || undefined,
            supplierName: (0, supplierPurchasesService_1.getSupplierMetaFor)(p.purchaseId)?.supplierName || undefined,
            quantity: p.quantity,
            unitCost: Number(p.unitCost || 0),
            totalCost: Number(p.totalCost || 0),
            timestamp: p.timestamp,
        }));
        const total = items.reduce((sum, it) => sum + Number(it.totalCost || 0), 0);
        // Aggregate by day
        const dailyMap = new Map();
        for (const it of items) {
            const d = new Date(it.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            dailyMap.set(key, (dailyMap.get(key) || 0) + Number(it.totalCost || 0));
        }
        const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));
        res.json({ total, count: items.length, items, daily });
    }
    catch (err) {
        console.error("getPurchasesReport error:", err);
        res.status(500).json({ message: "Failed to load purchases report" });
    }
};
exports.getPurchasesReport = getPurchasesReport;
