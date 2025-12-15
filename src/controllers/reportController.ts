import { Request, Response } from "express";
import prisma from "../db/prisma";
import { readExpenses } from "../services/expensesService";


export const getSalesReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: any | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };
    const where: any = timestampFilter
      ? { tenantId, timestamp: timestampFilter }
      : { tenantId };

    const purchases = await prisma.customerPurchases.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    // Preload product and customer names
    const productIds = Array.from(new Set(purchases.map((p: any) => p.productId).filter(Boolean)));
    const customerIds = Array.from(new Set(purchases.map((p: any) => p.customerId).filter(Boolean)));
    const products = productIds.length
      ? await prisma.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } })
      : [];
    const customers = customerIds.length
      ? await prisma.customers.findMany({ where: { tenantId, customerId: { in: customerIds } }, select: { customerId: true, name: true } })
      : [];
    const productNameMap = new Map<string, string>(products.map((p: any) => [p.productId, p.name] as const));
    const customerNameMap = new Map<string, string>(customers.map((c: any) => [c.customerId, c.name] as const));

    const items = purchases.map((p: any) => ({
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

    const total = items.reduce((sum: number, it: any) => sum + it.totalCost, 0);

    // Aggregate by day
    const dailyMap = new Map<string, number>();
    for (const it of items as any[]) {
      const d = new Date((it as any).timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyMap.set(key, (dailyMap.get(key) || 0) + (it as any).totalCost);
    }
    const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));

    res.json({ total, count: items.length, items, daily });
  } catch (err) {
    console.error("getSalesReport error:", err);
    res.status(500).json({ message: "Failed to load sales report" });
  }
};

export const getFinancialReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: any | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };

    // Sales from customer purchases (total and detailed items)
    const salesWhere: any = timestampFilter
      ? { tenantId, timestamp: timestampFilter }
      : { tenantId };
    const salesRowsFull = await prisma.customerPurchases.findMany({ where: salesWhere, orderBy: { timestamp: "desc" } });
    const salesProductIds = Array.from(new Set(salesRowsFull.map((p: any) => p.productId).filter(Boolean)));
    const salesCustomerIds = Array.from(new Set(salesRowsFull.map((p: any) => p.customerId).filter(Boolean)));
    const salesProducts = salesProductIds.length
      ? await prisma.products.findMany({ where: { tenantId, productId: { in: salesProductIds } }, select: { productId: true, name: true } })
      : [];
    const salesCustomers = salesCustomerIds.length
      ? await prisma.customers.findMany({ where: { tenantId, customerId: { in: salesCustomerIds } }, select: { customerId: true, name: true } })
      : [];
    const salesProductNameMap = new Map<string, string>(salesProducts.map((p: any) => [p.productId, p.name] as const));
    const salesCustomerNameMap = new Map<string, string>(salesCustomers.map((c: any) => [c.customerId, c.name] as const));
    const salesItems = salesRowsFull.map((p: any) => ({
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
    const salesTotal = salesItems.reduce((sum: number, r: any) => sum + Number(r.totalCost || 0), 0);

    // Purchases from procurement purchases (total and detailed items)
    const purchasesWhere: any = timestampFilter
      ? { tenantId, timestamp: timestampFilter }
      : { tenantId };
    const purchaseRowsFull = await prisma.purchases.findMany({ where: purchasesWhere, orderBy: { timestamp: "desc" } });
    const purchaseProductIds = Array.from(new Set(purchaseRowsFull.map((p: any) => p.productId).filter(Boolean)));
    const purchaseProducts = purchaseProductIds.length
      ? await prisma.products.findMany({ where: { tenantId, productId: { in: purchaseProductIds } }, select: { productId: true, name: true } })
      : [];
    const purchaseProductNameMap = new Map<string, string>(purchaseProducts.map((p: any) => [p.productId, p.name] as const));
    const metaRows = await prisma.supplierPurchaseMeta.findMany({ where: { purchaseId: { in: purchaseRowsFull.map((p: any) => p.purchaseId) } } });
    const metaMap = new Map<string, any>(metaRows.map((m: any) => [m.purchaseId, m]));
    const purchaseItems = purchaseRowsFull.map((p: any) => ({
      purchaseId: p.purchaseId,
      productId: p.productId,
      productName: purchaseProductNameMap.get(p.productId) || undefined,
      quantity: p.quantity,
      unitCost: Number(p.unitCost || 0),
      totalCost: Number(p.totalCost || 0),
      timestamp: p.timestamp,
      supplierName: metaMap.get(p.purchaseId)?.supplierName || undefined,
    }));
    const purchasesTotal = purchaseItems.reduce((sum: number, r: any) => sum + Number(r.totalCost || 0), 0);

    // Expenses total from JSON store
    const expensesRows = await prisma.expenses.findMany({ where: { tenantId, ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, orderBy: { timestamp: "desc" } });
    const expenseItems = expensesRows.map((e: any) => ({ id: e.expenseId, name: e.category, category: e.category, amount: Number(e.amount || 0), date: e.timestamp.toISOString() }));
    const expensesTotal = expenseItems.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

    const net = salesTotal - purchasesTotal - expensesTotal;

    res.json({ salesTotal, purchasesTotal, expensesTotal, net, from: fromRaw || null, to: toRaw || null, salesItems, purchaseItems, expenseItems });
  } catch (err) {
    console.error("getFinancialReport error:", err);
    res.status(500).json({ message: "Failed to load financial report" });
  }
};

// Purchases report (similar to sales, but for procurement purchases)
export const getPurchasesReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: any | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };
    const where: any = timestampFilter
      ? { tenantId, timestamp: timestampFilter }
      : { tenantId };

    const purchases = await prisma.purchases.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    // Preload product names
    const productIds = Array.from(new Set(purchases.map((p: any) => p.productId).filter(Boolean)));
    const products = productIds.length
      ? await prisma.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } })
      : [];
    const productNameMap = new Map<string, string>(products.map((p: any) => [p.productId, p.name] as const));

    const metaRows2 = await prisma.supplierPurchaseMeta.findMany({ where: { purchaseId: { in: purchases.map((p: any) => p.purchaseId) } } });
    const metaMap2 = new Map<string, any>(metaRows2.map((m: any) => [m.purchaseId, m]));
    const items = purchases.map((p: any) => ({
      purchaseId: p.purchaseId,
      productId: p.productId,
      productName: productNameMap.get(p.productId) || undefined,
      supplierName: metaMap2.get(p.purchaseId)?.supplierName || undefined,
      quantity: p.quantity,
      unitCost: Number(p.unitCost || 0),
      totalCost: Number(p.totalCost || 0),
      timestamp: p.timestamp,
    }));

    const total = items.reduce((sum: number, it: any) => sum + Number(it.totalCost || 0), 0);

    // Aggregate by day
    const dailyMap = new Map<string, number>();
    for (const it of items as any[]) {
      const d = new Date((it as any).timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyMap.set(key, (dailyMap.get(key) || 0) + Number((it as any).totalCost || 0));
    }
    const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));

    res.json({ total, count: items.length, items, daily });
  } catch (err) {
    console.error("getPurchasesReport error:", err);
    res.status(500).json({ message: "Failed to load purchases report" });
  }
};
