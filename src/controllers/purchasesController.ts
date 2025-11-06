import { Request, Response } from "express";
import prisma from "../db/prisma";

// GET /purchases - list all customer purchases with joined names
export const getPurchases = async (_req: Request, res: Response): Promise<void> => {
  try {
    const purchases = await prisma.customerPurchases.findMany({ orderBy: { timestamp: "desc" } });
    const customerIds = Array.from(new Set(purchases.map((p) => p.customerId)));
    const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
    const [customers, products] = await Promise.all([
      prisma.customers.findMany({ where: { customerId: { in: customerIds } }, select: { customerId: true, name: true } }),
      prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } }),
    ]);
    const customerMap = new Map(customers.map((c) => [c.customerId, c.name] as const));
    const productMap = new Map(products.map((p) => [p.productId, p.name] as const));

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
  } catch (err) {
    console.error("getPurchases error:", err);
    res.status(500).json({ message: "Failed to load purchases" });
  }
};

// DELETE /purchases/:id - delete a specific customer purchase
export const deletePurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.customerPurchases.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    await prisma.customerPurchases.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("deletePurchase error:", err);
    res.status(500).json({ message: "Failed to delete purchase" });
  }
};