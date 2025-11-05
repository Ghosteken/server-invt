import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const customers = await prisma.customers.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Fetch purchases grouped by customer
    const purchases = await prisma.customerPurchases.findMany({});
    const productIds = Array.from(new Set(purchases.map(p => p.productId)));
    const products = await prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } });
    const nameById = new Map(products.map(p => [p.productId, p.name] as const));
    const byCustomer = new Map<string, Array<{ productId: string; productName: string; quantity: number; totalCost: number }>>();
    for (const p of purchases) {
      const list = byCustomer.get(p.customerId) || [];
      list.push({ productId: p.productId, productName: nameById.get(p.productId) || p.productId, quantity: p.quantity, totalCost: p.totalCost });
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
  } catch (error) {
    console.error("getCustomers error:", error);
    res.status(500).json({ message: "Error retrieving customers" });
  }
};

export const purgeCustomerPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.customerPurchases.deleteMany({});
    res.json({ message: "Purged customer purchases", deletedCount: result.count });
  } catch (error) {
    console.error("purgeCustomerPurchases error:", error);
    res.status(500).json({ message: "Error purging customer purchases" });
  }
};