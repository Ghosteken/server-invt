"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePurchase = exports.getPurchases = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
// GET /purchases - list all customer purchases with joined names
const getPurchases = async (_req, res) => {
    try {
        const purchases = await prisma_1.default.customerPurchases.findMany({ orderBy: { timestamp: "desc" } });
        const customerIds = Array.from(new Set(purchases.map((p) => p.customerId)));
        const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
        const [customers, products] = await Promise.all([
            prisma_1.default.customers.findMany({ where: { customerId: { in: customerIds } }, select: { customerId: true, name: true } }),
            prisma_1.default.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } }),
        ]);
        const customerMap = new Map(customers.map((c) => [c.customerId, c.name]));
        const productMap = new Map(products.map((p) => [p.productId, p.name]));
        const list = purchases.map((p) => ({
            id: p.id,
            customerId: p.customerId,
            customerName: customerMap.get(p.customerId) || undefined,
            productId: p.productId,
            productName: productMap.get(p.productId) || undefined,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            totalCost: p.totalCost,
            timestamp: p.timestamp,
        }));
        res.json({ purchases: list });
    }
    catch (err) {
        console.error("getPurchases error:", err);
        res.status(500).json({ message: "Failed to load purchases" });
    }
};
exports.getPurchases = getPurchases;
// DELETE /purchases/:id - delete a specific customer purchase
const deletePurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma_1.default.customerPurchases.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }
        await prisma_1.default.customerPurchases.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (err) {
        console.error("deletePurchase error:", err);
        res.status(500).json({ message: "Failed to delete purchase" });
    }
};
exports.deletePurchase = deletePurchase;
