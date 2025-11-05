"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSalesReport = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const getSalesReport = async (req, res) => {
    try {
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
            ? { timestamp: timestampFilter }
            : {};
        const purchases = await prisma.customerPurchases.findMany({
            where,
            orderBy: { timestamp: "desc" },
        });
        // Preload product and customer names
        const productIds = Array.from(new Set(purchases.map((p) => p.productId).filter(Boolean)));
        const customerIds = Array.from(new Set(purchases.map((p) => p.customerId).filter(Boolean)));
        const products = productIds.length
            ? await prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } })
            : [];
        const customers = customerIds.length
            ? await prisma.customers.findMany({ where: { customerId: { in: customerIds } }, select: { customerId: true, name: true } })
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
