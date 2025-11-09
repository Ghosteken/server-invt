import { Request, Response } from "express";
import prisma from "../db/prisma";
import { Prisma } from "@prisma/client";
import { readExpenses } from "../services/expensesService";
import { getSupplierMetaFor } from "../services/supplierPurchasesService";

export const getSalesReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: Prisma.DateTimeFilter | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };
    const where: Prisma.CustomerPurchasesWhereInput = timestampFilter
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
    const productNameMap = new Map(products.map((p) => [p.productId, p.name] as const));
    const customerNameMap = new Map(customers.map((c) => [c.customerId, c.name] as const));

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
    const dailyMap = new Map<string, number>();
    for (const it of items) {
      const d = new Date(it.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyMap.set(key, (dailyMap.get(key) || 0) + it.totalCost);
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
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: Prisma.DateTimeFilter | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };

    // Sales from customer purchases (total and detailed items)
    const salesWhere: Prisma.CustomerPurchasesWhereInput = timestampFilter
      ? { timestamp: timestampFilter }
      : {};
    const salesRowsFull = await prisma.customerPurchases.findMany({ where: salesWhere, orderBy: { timestamp: "desc" } });
    const salesProductIds = Array.from(new Set(salesRowsFull.map((p) => p.productId).filter(Boolean)));
    const salesCustomerIds = Array.from(new Set(salesRowsFull.map((p) => p.customerId).filter(Boolean)));
    const salesProducts = salesProductIds.length
      ? await prisma.products.findMany({ where: { productId: { in: salesProductIds } }, select: { productId: true, name: true } })
      : [];
    const salesCustomers = salesCustomerIds.length
      ? await prisma.customers.findMany({ where: { customerId: { in: salesCustomerIds } }, select: { customerId: true, name: true } })
      : [];
    const salesProductNameMap = new Map(salesProducts.map((p) => [p.productId, p.name] as const));
    const salesCustomerNameMap = new Map(salesCustomers.map((c) => [c.customerId, c.name] as const));
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
    const purchasesWhere: Prisma.PurchasesWhereInput = timestampFilter
      ? { timestamp: timestampFilter }
      : {};
    const purchaseRowsFull = await prisma.purchases.findMany({ where: purchasesWhere, orderBy: { timestamp: "desc" } });
    const purchaseProductIds = Array.from(new Set(purchaseRowsFull.map((p) => p.productId).filter(Boolean)));
    const purchaseProducts = purchaseProductIds.length
      ? await prisma.products.findMany({ where: { productId: { in: purchaseProductIds } }, select: { productId: true, name: true } })
      : [];
    const purchaseProductNameMap = new Map(purchaseProducts.map((p) => [p.productId, p.name] as const));
    const purchaseItems = purchaseRowsFull.map((p) => ({
      purchaseId: p.purchaseId,
      productId: p.productId,
      productName: purchaseProductNameMap.get(p.productId) || undefined,
      quantity: p.quantity,
      unitCost: Number(p.unitCost || 0),
      totalCost: Number(p.totalCost || 0),
      timestamp: p.timestamp,
      supplierName: getSupplierMetaFor(p.purchaseId)?.supplierName || undefined,
    }));
    const purchasesTotal = purchaseItems.reduce((sum, r) => sum + Number(r.totalCost || 0), 0);

    // Expenses total from JSON store
    const expenses = readExpenses();
    const expensesFiltered = expenses.filter((e) => {
      const d = new Date(e.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const expenseItems = expensesFiltered.map((e) => ({ id: e.id, name: e.name, category: e.category, amount: Number(e.amount || 0), date: e.date }));
    const expensesTotal = expenseItems.reduce((sum, e) => sum + Number(e.amount || 0), 0);

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
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: Prisma.DateTimeFilter | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };
    const where: Prisma.PurchasesWhereInput = timestampFilter
      ? { timestamp: timestampFilter }
      : {};

    const purchases = await prisma.purchases.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    // Preload product names
    const productIds = Array.from(new Set(purchases.map((p) => p.productId).filter(Boolean)));
    const products = productIds.length
      ? await prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } })
      : [];
    const productNameMap = new Map(products.map((p) => [p.productId, p.name] as const));

    const items = purchases.map((p) => ({
      purchaseId: p.purchaseId,
      productId: p.productId,
      productName: productNameMap.get(p.productId) || undefined,
      supplierName: getSupplierMetaFor(p.purchaseId)?.supplierName || undefined,
      quantity: p.quantity,
      unitCost: Number(p.unitCost || 0),
      totalCost: Number(p.totalCost || 0),
      timestamp: p.timestamp,
    }));

    const total = items.reduce((sum, it) => sum + Number(it.totalCost || 0), 0);

    // Aggregate by day
    const dailyMap = new Map<string, number>();
    for (const it of items) {
      const d = new Date(it.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyMap.set(key, (dailyMap.get(key) || 0) + Number(it.totalCost || 0));
    }
    const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));

    res.json({ total, count: items.length, items, daily });
  } catch (err) {
    console.error("getPurchasesReport error:", err);
    res.status(500).json({ message: "Failed to load purchases report" });
  }
};