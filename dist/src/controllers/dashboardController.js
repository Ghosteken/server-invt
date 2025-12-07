"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLowStockPcs = exports.getTopCustomers = exports.getDeadStockProducts = exports.getExpiringProducts = exports.getLowStockProducts = exports.getDashboardMetrics = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const pcsInventoryService_1 = require("../services/pcsInventoryService");
const cache_1 = require("../services/cache");
// Use shared Prisma client
// Only include products currently in inventory: Qty > 0
const nonInventoryFilter = { stockQuantity: { gt: 0 } };
const getDashboardMetrics = async (req, res) => {
    try {
        // Simplified, live analytics (no dummy tables)
        // Configurable low-stock threshold: query param > env > default
        const q = req.query?.threshold;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const envNum = Number(process.env.LOW_STOCK_THRESHOLD);
        const LOW_STOCK_THRESHOLD = Number.isFinite(qNum) && qNum >= 0
            ? qNum
            : Number.isFinite(envNum) && envNum >= 0
                ? envNum
                : 5;
        // Total products currently in inventory (stockQuantity > 0)
        const totalProducts = await (0, cache_1.withCache)(`metrics:totalProducts:inventory`, 60, async () => prisma_1.default.products.count({ where: nonInventoryFilter }));
        const lowStockCount = await (0, cache_1.withCache)(`metrics:lowStock:${LOW_STOCK_THRESHOLD}`, 60, async () => prisma_1.default.products.count({
            where: { stockQuantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
        }));
        const inventoryValue = await (0, cache_1.withCache)(`metrics:inventoryValue`, 60, async () => {
            const productsBasic = await prisma_1.default.products.findMany({ where: nonInventoryFilter, select: { productId: true, name: true, price: true, stockQuantity: true } });
            return productsBasic.reduce((sum, p) => sum + (Number(p.price) * p.stockQuantity), 0);
        });
        const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const sales7dTotal = await (0, cache_1.withCache)(`metrics:sales7d`, 60, async () => {
            const salesAgg = await prisma_1.default.customerPurchases.aggregate({ where: { timestamp: { gte: since7 } }, _sum: { totalCost: true } });
            return Number(salesAgg._sum.totalCost || 0);
        });
        const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        let popularGrouped = [];
        try {
            // Use groupBy to find most purchased products in last 30 days
            // @ts-ignore - Prisma groupBy typing can be verbose
            popularGrouped = await prisma_1.default.customerPurchases.groupBy({
                by: ['productId'],
                where: { timestamp: { gte: since30 } },
                _count: { productId: true },
                orderBy: { _count: { productId: 'desc' } },
                take: 5,
            });
        }
        catch (e) {
            // Fallback: no purchases yet -> use top by stock quantity
            popularGrouped = [];
        }
        let popularProducts = [];
        if (popularGrouped.length) {
            const ids = popularGrouped.map((g) => g.productId);
            const details = await prisma_1.default.products.findMany({ where: { productId: { in: ids }, ...nonInventoryFilter }, select: { productId: true, name: true, price: true, stockQuantity: true } });
            popularProducts = details.map((d) => ({
                ...d,
                price: Number(d.price),
                purchaseCount: popularGrouped.find((g) => g.productId === d.productId)?._count.productId || 0,
            }));
        }
        else {
            const fallback = await prisma_1.default.products.findMany({ where: nonInventoryFilter, take: 5, orderBy: { stockQuantity: 'desc' }, select: { productId: true, name: true, price: true, stockQuantity: true } });
            popularProducts = fallback.map((d) => ({ ...d, price: Number(d.price), purchaseCount: 0 }));
        }
        res.set("Cache-Control", "public, max-age=60");
        res.json({
            totalProducts,
            lowStockCount,
            lowStockThreshold: LOW_STOCK_THRESHOLD,
            inventoryValue,
            sales7dTotal,
            popularProducts,
        });
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving dashboard metrics" });
    }
};
exports.getDashboardMetrics = getDashboardMetrics;
// Detailed low-stock list
const getLowStockProducts = async (req, res) => {
    try {
        const q = req.query?.threshold;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const envNum = Number(process.env.LOW_STOCK_THRESHOLD);
        const threshold = Number.isFinite(qNum) && qNum >= 0
            ? qNum
            : Number.isFinite(envNum) && envNum >= 0
                ? envNum
                : 5;
        const rawLimit = req.query?.limit?.toString();
        const rawOffset = req.query?.offset?.toString();
        const rawPage = req.query?.page?.toString();
        const rawSearch = req.query?.search?.toString() ?? "";
        const limit = rawLimit ? Math.min(200, Math.max(1, Number(rawLimit))) : undefined;
        const page = rawPage ? Math.max(1, Number(rawPage)) : undefined;
        const offset = rawOffset ? Math.max(0, Number(rawOffset)) : (page && typeof limit === 'number' ? (page - 1) * limit : undefined);
        const search = rawSearch.trim().toLowerCase();
        const products = await (0, cache_1.withCache)(`lowStock:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
            return prisma_1.default.products.findMany({
                where: {
                    stockQuantity: { gt: 0, lte: threshold },
                    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
                },
                select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true },
                ...(typeof limit === 'number' ? { take: limit } : {}),
                ...(typeof offset === 'number' ? { skip: offset } : {}),
                orderBy: { stockQuantity: 'asc' },
            });
        });
        res.set("Cache-Control", "public, max-age=30");
        res.json(products.map(p => ({ ...p, price: Number(p.price) })));
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving low-stock products" });
    }
};
exports.getLowStockProducts = getLowStockProducts;
// Products expiring within N days
const getExpiringProducts = async (req, res) => {
    try {
        const q = req.query?.days;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
        const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const products = await prisma_1.default.products.findMany({
            where: { expiryDate: { lte: cutoff }, ...nonInventoryFilter },
            select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true }
        });
        res.set("Cache-Control", "public, max-age=30");
        res.json(products.map(p => ({ ...p, price: Number(p.price) })));
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving expiring products" });
    }
};
exports.getExpiringProducts = getExpiringProducts;
// Dead stock: no sales in the past N days
const getDeadStockProducts = async (req, res) => {
    try {
        const q = req.query?.days;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        // Find latest purchase per product since forever
        // @ts-ignore Prisma groupBy typing verbosity
        const grouped = await prisma_1.default.customerPurchases.groupBy({
            by: ['productId'],
            _max: { timestamp: true },
        });
        const latestByProduct = new Map(grouped.map((g) => [g.productId, g._max.timestamp ? new Date(g._max.timestamp) : null]));
        const allProducts = await prisma_1.default.products.findMany({ where: nonInventoryFilter, select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true } });
        const dead = allProducts.filter(p => {
            const last = latestByProduct.get(p.productId) || null;
            return !last || last < since;
        });
        res.set("Cache-Control", "public, max-age=30");
        res.json(dead.map(d => ({ ...d, price: Number(d.price) })));
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving dead stock products" });
    }
};
exports.getDeadStockProducts = getDeadStockProducts;
// Top customers by purchase value
const getTopCustomers = async (req, res) => {
    try {
        const q = req.query?.limit;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const limit = Number.isFinite(qNum) && qNum > 0 ? Math.min(50, qNum) : 5;
        // @ts-ignore Prisma groupBy typing verbosity
        const grouped = await prisma_1.default.customerPurchases.groupBy({
            by: ['customerId'],
            _sum: { totalCost: true },
            orderBy: { _sum: { totalCost: 'desc' } },
            take: limit,
        });
        const ids = grouped.map((g) => g.customerId);
        const customers = await prisma_1.default.customers.findMany({ where: { customerId: { in: ids } }, select: { customerId: true, name: true, mobile: true, city: true, state: true, country: true } });
        const result = customers.map((c) => ({
            ...c,
            totalPurchaseValue: Number(grouped.find((g) => g.customerId === c.customerId)?._sum.totalCost || 0),
        })).sort((a, b) => b.totalPurchaseValue - a.totalPurchaseValue);
        res.set("Cache-Control", "public, max-age=60");
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving top customers" });
    }
};
exports.getTopCustomers = getTopCustomers;
// Low-stock for PCS inventory (pieces), sourced from pcsInventory.json
const getLowStockPcs = async (req, res) => {
    try {
        const q = req.query?.threshold;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const envNum = Number(process.env.LOW_STOCK_THRESHOLD);
        const threshold = Number.isFinite(qNum) && qNum >= 0
            ? qNum
            : Number.isFinite(envNum) && envNum >= 0
                ? envNum
                : 5;
        const rawLimit = req.query?.limit?.toString();
        const rawOffset = req.query?.offset?.toString();
        const rawPage = req.query?.page?.toString();
        const rawSearch = req.query?.search?.toString() ?? "";
        const limit = rawLimit ? Math.min(500, Math.max(1, Number(rawLimit))) : undefined;
        const page = rawPage ? Math.max(1, Number(rawPage)) : undefined;
        const offset = rawOffset ? Math.max(0, Number(rawOffset)) : (page && typeof limit === 'number' ? (page - 1) * limit : undefined);
        const search = rawSearch.trim().toLowerCase();
        const low = await (0, cache_1.withCache)(`lowPcs:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
            const tenantId = req.tenantId || req.user?.tenantId || "default";
            const pcs = await (0, pcsInventoryService_1.readPcsInventory)(tenantId);
            const filtered = pcs
                // Only items currently in inventory: quantity > 0
                .filter((e) => (e.quantity || 0) > 0)
                // Low-stock threshold: 1..threshold (inclusive)
                .filter((e) => (e.quantity || 0) <= threshold)
                .filter((e) => (search ? e.name.toLowerCase().includes(search) : true))
                .map((e) => ({
                name: e.name,
                pcsQuantity: e.quantity,
                packSize: e.packSize ?? null,
                productId: e.productId ?? null,
            }));
            const sliced = typeof offset === 'number' || typeof limit === 'number'
                ? filtered.slice(offset || 0, (offset || 0) + (limit || filtered.length))
                : filtered;
            return sliced;
        });
        res.set("Cache-Control", "public, max-age=30");
        res.json(low);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving low-stock PCS items" });
    }
};
exports.getLowStockPcs = getLowStockPcs;
