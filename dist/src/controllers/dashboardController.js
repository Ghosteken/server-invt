"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLowStockPcs = exports.getTopCustomers = exports.getDeadStockProducts = exports.getExpiringProducts = exports.getLowStockProducts = exports.getDashboardMetrics = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const pcsInventoryService_1 = require("../services/pcsInventoryService");
const cache_1 = require("../services/cache");
const errorHandler_1 = require("../utils/errorHandler");
// Use shared Prisma client
// Only include products currently in inventory: Qty > 0
const nonInventoryFilter = { stockQuantity: { gt: 0 } };
const getDashboardMetrics = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
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
        // Parallelize independent queries
        const [totalProducts, totalProductsInStock, lowStockCount, pcsData, inventoryValue, inventoryValuePcs, sales7dTotal, popularProducts] = await Promise.all([
            (0, cache_1.withCache)(`t=${tenantId}:metrics:totalProducts:all`, 60, async () => prisma_1.default.products.count({ where: { tenantId } })),
            (0, cache_1.withCache)(`t=${tenantId}:metrics:totalProducts:inStock`, 60, async () => prisma_1.default.products.count({ where: { tenantId, ...nonInventoryFilter } })),
            (0, cache_1.withCache)(`t=${tenantId}:metrics:lowStock:${LOW_STOCK_THRESHOLD}`, 60, async () => prisma_1.default.products.count({
                where: { tenantId, stockQuantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
            })),
            (0, cache_1.withCache)(`t=${tenantId}:metrics:pcs-and-combined:${LOW_STOCK_THRESHOLD}`, 60, async () => {
                // Optimization: Use SQL for counts to avoid loading thousands of rows
                const [pcsInventoryCount, lowStockPcsCount] = await Promise.all([
                    prisma_1.default.pcsInventory.count({ where: { tenantId, quantity: { gt: 0 } } }),
                    prisma_1.default.pcsInventory.count({ where: { tenantId, quantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } } })
                ]);
                // Optimization: Use SQL UNION for unique name counting
                const combinedCountResult = await prisma_1.default.$queryRaw `
             SELECT COUNT(DISTINCT LOWER(name)) as count
             FROM (
                 SELECT name FROM "Products" WHERE "tenantId" = ${tenantId} AND "stockQuantity" > 0
                 UNION ALL
                 SELECT name FROM "pcs_inventory" WHERE "tenantId" = ${tenantId} AND "quantity" > 0
             ) as combined
          `;
                const combinedInventoryCount = Number(combinedCountResult?.[0]?.count || 0);
                const combinedLowResult = await prisma_1.default.$queryRaw `
             SELECT COUNT(DISTINCT LOWER(name)) as count
             FROM (
                 SELECT name FROM "Products" WHERE "tenantId" = ${tenantId} AND "stockQuantity" > 0 AND "stockQuantity" <= ${LOW_STOCK_THRESHOLD}
                 UNION ALL
                 SELECT name FROM "pcs_inventory" WHERE "tenantId" = ${tenantId} AND "quantity" > 0 AND "quantity" <= ${LOW_STOCK_THRESHOLD}
             ) as combined
          `;
                const combinedLowStockCount = Number(combinedLowResult?.[0]?.count || 0);
                return {
                    pcsInventoryCount,
                    lowStockPcsCount,
                    combinedInventoryCount,
                    combinedLowStockCount,
                };
            }),
            (0, cache_1.withCache)(`t=${tenantId}:metrics:inventoryValue`, 60, async () => {
                // Optimization: Use DB aggregation instead of loading all rows into memory
                // This moves the O(N) calculation from Node.js (RAM heavy) to Postgres (Optimized)
                const result = await prisma_1.default.$queryRaw `
          SELECT SUM("price" * "stockQuantity") as total
          FROM "Products"
          WHERE "tenantId" = ${tenantId} AND "stockQuantity" > 0
        `;
                return Number(result?.[0]?.total || 0);
            }),
            (0, cache_1.withCache)(`t=${tenantId}:metrics:inventoryValuePcs:${LOW_STOCK_THRESHOLD}`, 60, async () => {
                const pcs = await (0, pcsInventoryService_1.readPcsInventory)(tenantId);
                const inStock = pcs.filter((e) => Number(e.quantity || 0) > 0);
                if (!inStock.length)
                    return 0;
                // Optimization: Fetch only relevant products if the list is small enough
                // If we have too many PCS items, fetching all products is more efficient than a massive OR query
                const THRESHOLD_FOR_FULL_FETCH = 500;
                let products = [];
                if (inStock.length > THRESHOLD_FOR_FULL_FETCH) {
                    products = await prisma_1.default.products.findMany({
                        where: { tenantId },
                        select: { productId: true, name: true, price: true, packSize: true },
                    });
                }
                else {
                    const productIds = inStock.map(e => e.productId).filter(id => id && typeof id === 'string');
                    const names = inStock.map(e => e.name).filter(n => n && typeof n === 'string');
                    const uniqueIds = Array.from(new Set(productIds));
                    const uniqueNames = Array.from(new Set(names));
                    if (uniqueIds.length > 0 || uniqueNames.length > 0) {
                        products = await prisma_1.default.products.findMany({
                            where: {
                                tenantId,
                                OR: [
                                    ...(uniqueIds.length ? [{ productId: { in: uniqueIds } }] : []),
                                    // Use multiple OR conditions for case-insensitive name matching
                                    ...uniqueNames.map(n => ({ name: { equals: n, mode: 'insensitive' } }))
                                ]
                            },
                            select: { productId: true, name: true, price: true, packSize: true },
                        });
                    }
                }
                const byId = new Map();
                const byName = new Map();
                for (const p of products) {
                    const rec = { price: Number(p.price || 0), packSize: p.packSize ?? null, name: String(p.name || "") };
                    byId.set(String(p.productId), rec);
                    byName.set(String(rec.name).toLowerCase(), rec);
                }
                const extractPackCount = (ps) => {
                    if (!ps)
                        return null;
                    const m = String(ps).match(/(\d{1,4})/);
                    if (!m)
                        return null;
                    const n = Number(m[1]);
                    return Number.isFinite(n) && n > 0 ? n : null;
                };
                let total = 0;
                for (const e of inStock) {
                    const match = (e.productId && byId.get(String(e.productId))) || byName.get(String(e.name || "").toLowerCase()) || null;
                    const price = match?.price || 0;
                    const pcsPack = extractPackCount(e.packSize ?? match?.packSize ?? null);
                    const perPiece = pcsPack ? (price / pcsPack) : 0;
                    total += (perPiece * Number(e.quantity || 0));
                }
                return total;
            }),
            (0, cache_1.withCache)(`t=${tenantId}:metrics:sales7d`, 60, async () => {
                const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                const salesAgg = await prisma_1.default.customerPurchases.aggregate({ where: { tenantId, timestamp: { gte: since7 } }, _sum: { totalCost: true } });
                return Number(salesAgg._sum.totalCost || 0);
            }),
            // Popular products logic (wrapped for parallelism)
            (async () => {
                const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                let popularGrouped = [];
                try {
                    // @ts-ignore - Prisma groupBy typing can be verbose
                    popularGrouped = await prisma_1.default.customerPurchases.groupBy({
                        by: ['productId'],
                        where: { tenantId, timestamp: { gte: since30 } },
                        _count: { productId: true },
                        orderBy: { _count: { productId: 'desc' } },
                        take: 5,
                    });
                }
                catch (e) {
                    popularGrouped = [];
                }
                let popularProducts = [];
                if (popularGrouped.length) {
                    const ids = popularGrouped.map((g) => g.productId);
                    const details = await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: ids }, ...nonInventoryFilter }, select: { productId: true, name: true, price: true, stockQuantity: true } });
                    popularProducts = details.map((d) => ({
                        ...d,
                        price: Number(d.price),
                        purchaseCount: popularGrouped.find((g) => g.productId === d.productId)?._count.productId || 0,
                    }));
                }
                else {
                    const fallback = await prisma_1.default.products.findMany({ where: { tenantId, ...nonInventoryFilter }, take: 5, orderBy: { stockQuantity: 'desc' }, select: { productId: true, name: true, price: true, stockQuantity: true } });
                    popularProducts = fallback.map((d) => ({ ...d, price: Number(d.price), purchaseCount: 0 }));
                }
                return popularProducts;
            })()
        ]);
        const { pcsInventoryCount, lowStockPcsCount, combinedInventoryCount, combinedLowStockCount } = pcsData;
        const inventoryValueCombined = inventoryValue + inventoryValuePcs;
        res.set("Cache-Control", "public, max-age=60");
        res.json({
            totalProducts,
            totalProductsInStock,
            lowStockCount,
            lowStockThreshold: LOW_STOCK_THRESHOLD,
            // New fields (non-breaking): separate CTN/PCS and combined counts
            totalProductsCtn: totalProductsInStock,
            totalProductsPcs: pcsInventoryCount,
            totalProductsCombined: combinedInventoryCount,
            lowStockPcsCount,
            lowStockCombinedCount: combinedLowStockCount,
            // Extended inventory value (non-breaking): CTN/PCS and combined
            inventoryValueCtn: inventoryValue,
            inventoryValuePcs,
            inventoryValueCombined,
            inventoryValue,
            sales7dTotal,
            popularProducts,
        });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving dashboard metrics"));
    }
};
exports.getDashboardMetrics = getDashboardMetrics;
// Detailed low-stock list
const getLowStockProducts = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
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
        const products = await (0, cache_1.withCache)(`t=${tenantId}:lowStock:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
            return prisma_1.default.products.findMany({
                where: {
                    tenantId,
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
        res.json(products.map((p) => ({ ...p, price: Number(p.price) })));
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving low-stock products"));
    }
};
exports.getLowStockProducts = getLowStockProducts;
// Products expiring within N days
const getExpiringProducts = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const q = req.query?.days;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
        const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const products = await prisma_1.default.products.findMany({
            where: { tenantId, expiryDate: { lte: cutoff }, ...nonInventoryFilter },
            select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true }
        });
        res.set("Cache-Control", "public, max-age=30");
        res.json(products.map((p) => ({ ...p, price: Number(p.price) })));
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving expiring products"));
    }
};
exports.getExpiringProducts = getExpiringProducts;
// Dead stock: no sales in the past N days
const getDeadStockProducts = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const q = req.query?.days;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        // Find latest purchase per product since forever
        // @ts-ignore Prisma groupBy typing verbosity
        const grouped = await prisma_1.default.customerPurchases.groupBy({
            by: ['productId'],
            where: { tenantId },
            _max: { timestamp: true },
        });
        const latestByProduct = new Map(grouped.map((g) => [g.productId, g._max.timestamp ? new Date(g._max.timestamp) : null]));
        const allProducts = await prisma_1.default.products.findMany({ where: { tenantId, ...nonInventoryFilter }, select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true } });
        const dead = allProducts.filter((p) => {
            const last = latestByProduct.get(p.productId) || null;
            return !last || last < since;
        });
        res.set("Cache-Control", "public, max-age=30");
        res.json(dead.map((d) => ({ ...d, price: Number(d.price) })));
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving dead stock products"));
    }
};
exports.getDeadStockProducts = getDeadStockProducts;
// Top customers by purchase value
const getTopCustomers = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const q = req.query?.limit;
        const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
        const limit = Number.isFinite(qNum) && qNum > 0 ? Math.min(50, qNum) : 5;
        // @ts-ignore Prisma groupBy typing verbosity
        const grouped = await prisma_1.default.customerPurchases.groupBy({
            by: ['customerId'],
            where: { tenantId },
            _sum: { totalCost: true },
            orderBy: { _sum: { totalCost: 'desc' } },
            take: limit,
        });
        const ids = grouped.map((g) => g.customerId);
        const customers = await prisma_1.default.customers.findMany({ where: { tenantId, customerId: { in: ids } }, select: { customerId: true, name: true, mobile: true, city: true, state: true, country: true } });
        const result = customers.map((c) => ({
            ...c,
            totalPurchaseValue: Number(grouped.find((g) => g.customerId === c.customerId)?._sum.totalCost || 0),
        })).sort((a, b) => b.totalPurchaseValue - a.totalPurchaseValue);
        res.set("Cache-Control", "public, max-age=60");
        res.json(result);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving top customers"));
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
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving low-stock PCS items"));
    }
};
exports.getLowStockPcs = getLowStockPcs;
