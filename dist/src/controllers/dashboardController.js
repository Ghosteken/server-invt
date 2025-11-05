"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardMetrics = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
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
        const totalProducts = await prisma.products.count();
        const lowStockCount = await prisma.products.count({ where: { stockQuantity: { lt: LOW_STOCK_THRESHOLD } } });
        const productsBasic = await prisma.products.findMany({ select: { productId: true, name: true, price: true, stockQuantity: true } });
        const inventoryValue = productsBasic.reduce((sum, p) => sum + (Number(p.price) * p.stockQuantity), 0);
        const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const salesAgg = await prisma.customerPurchases.aggregate({ where: { timestamp: { gte: since7 } }, _sum: { totalCost: true } });
        const sales7dTotal = Number(salesAgg._sum.totalCost || 0);
        const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        let popularGrouped = [];
        try {
            // Use groupBy to find most purchased products in last 30 days
            // @ts-ignore - Prisma groupBy typing can be verbose
            popularGrouped = await prisma.customerPurchases.groupBy({
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
            const details = await prisma.products.findMany({ where: { productId: { in: ids } }, select: { productId: true, name: true, price: true, stockQuantity: true } });
            popularProducts = details.map((d) => ({
                ...d,
                price: Number(d.price),
                purchaseCount: popularGrouped.find((g) => g.productId === d.productId)?._count.productId || 0,
            }));
        }
        else {
            const fallback = await prisma.products.findMany({ take: 5, orderBy: { stockQuantity: 'desc' }, select: { productId: true, name: true, price: true, stockQuantity: true } });
            popularProducts = fallback.map((d) => ({ ...d, price: Number(d.price), purchaseCount: 0 }));
        }
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
