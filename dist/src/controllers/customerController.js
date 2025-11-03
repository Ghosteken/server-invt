"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomers = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const getCustomers = async (req, res) => {
    try {
        const customers = await prisma.customers.findMany({
            orderBy: { createdAt: "desc" },
        });
        // Fetch purchases grouped by customer
        const purchases = await prisma.customerPurchases.findMany({});
        const byCustomer = new Map();
        for (const p of purchases) {
            const list = byCustomer.get(p.customerId) || [];
            list.push({ productId: p.productId, quantity: p.quantity, totalCost: p.totalCost });
            byCustomer.set(p.customerId, list);
        }
        const result = customers.map((c) => ({
            customerId: c.customerId,
            name: c.name,
            mobile: c.mobile,
            address: c.address,
            city: c.city,
            state: c.state,
            country: c.country,
            createdAt: c.createdAt,
            purchases: byCustomer.get(c.customerId) || [],
        }));
        res.json(result);
    }
    catch (error) {
        console.error("getCustomers error:", error);
        res.status(500).json({ message: "Error retrieving customers" });
    }
};
exports.getCustomers = getCustomers;
