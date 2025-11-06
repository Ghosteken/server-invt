import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { readPcsInventory } from "../services/pcsInventoryService";
import { withCache } from "../services/cache";

const prisma = new PrismaClient();

export const getDashboardMetrics = async (
  req: Request,
  res: Response
): Promise<void> => {
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

    const totalProducts = await withCache(`metrics:totalProducts`, 60, async () => prisma.products.count());
    const lowStockCount = await withCache(`metrics:lowStock:${LOW_STOCK_THRESHOLD}`, 60, async () => prisma.products.count({ where: { stockQuantity: { lt: LOW_STOCK_THRESHOLD } } }));

    const inventoryValue = await withCache(`metrics:inventoryValue`, 60, async () => {
      const productsBasic = await prisma.products.findMany({ select: { productId: true, name: true, price: true, stockQuantity: true } });
      return productsBasic.reduce((sum, p) => sum + (Number(p.price) * p.stockQuantity), 0);
    });

    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sales7dTotal = await withCache(`metrics:sales7d`, 60, async () => {
      const salesAgg = await prisma.customerPurchases.aggregate({ where: { timestamp: { gte: since7 } }, _sum: { totalCost: true } });
      return Number(salesAgg._sum.totalCost || 0);
    });

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let popularGrouped: Array<{ productId: string; _count: { productId: number } }> = [];
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
    } catch (e) {
      // Fallback: no purchases yet -> use top by stock quantity
      popularGrouped = [];
    }

    let popularProducts: Array<{ productId: string; name: string; price: number; stockQuantity: number; purchaseCount: number }> = [];
    if (popularGrouped.length) {
      const ids = popularGrouped.map((g) => g.productId);
      const details = await prisma.products.findMany({ where: { productId: { in: ids } }, select: { productId: true, name: true, price: true, stockQuantity: true } });
      popularProducts = details.map((d) => ({
        ...d,
        price: Number(d.price),
        purchaseCount: popularGrouped.find((g) => g.productId === d.productId)?._count.productId || 0,
      }));
    } else {
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
    res.set("Cache-Control", "public, max-age=30");
  } catch (error) {
    res.status(500).json({ message: "Error retrieving dashboard metrics" });
  }
};

// Detailed low-stock list
export const getLowStockProducts = async (req: Request, res: Response): Promise<void> => {
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
    const rawSearch = req.query?.search?.toString() ?? "";
    const limit = rawLimit ? Math.min(200, Math.max(1, Number(rawLimit))) : undefined;
    const offset = rawOffset ? Math.max(0, Number(rawOffset)) : undefined;
    const search = rawSearch.trim().toLowerCase();

    const products = await withCache(`lowStock:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
      return prisma.products.findMany({
        where: {
          stockQuantity: { lt: threshold },
          ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        },
        select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true },
        ...(typeof limit === 'number' ? { take: limit } : {}),
        ...(typeof offset === 'number' ? { skip: offset } : {}),
        orderBy: { stockQuantity: 'asc' },
      });
    });
    res.set("Cache-Control", "public, max-age=30");
    res.json(products.map(p => ({ ...p, price: Number(p.price) })));
  } catch (error) {
    res.status(500).json({ message: "Error retrieving low-stock products" });
  }
};

// Products expiring within N days
export const getExpiringProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query?.days;
    const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
    const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const products = await prisma.products.findMany({
      where: { expiryDate: { lte: cutoff } },
      select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true }
    });
    res.json(products.map(p => ({ ...p, price: Number(p.price) })));
  } catch (error) {
    res.status(500).json({ message: "Error retrieving expiring products" });
  }
};

// Dead stock: no sales in the past N days
export const getDeadStockProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query?.days;
    const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
    const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Find latest purchase per product since forever
    // @ts-ignore Prisma groupBy typing verbosity
    const grouped = await prisma.customerPurchases.groupBy({
      by: ['productId'],
      _max: { timestamp: true },
    });
    const latestByProduct = new Map<string, Date | null>(grouped.map((g: any) => [g.productId, g._max.timestamp ? new Date(g._max.timestamp) : null]));

    const allProducts = await prisma.products.findMany({ select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true } });
    const dead = allProducts.filter(p => {
      const last = latestByProduct.get(p.productId) || null;
      return !last || last < since;
    });
    res.json(dead.map(d => ({ ...d, price: Number(d.price) })));
  } catch (error) {
    res.status(500).json({ message: "Error retrieving dead stock products" });
  }
};

// Top customers by purchase value
export const getTopCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query?.limit;
    const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
    const limit = Number.isFinite(qNum) && qNum > 0 ? Math.min(50, qNum) : 5;

    // @ts-ignore Prisma groupBy typing verbosity
    const grouped = await prisma.customerPurchases.groupBy({
      by: ['customerId'],
      _sum: { totalCost: true },
      orderBy: { _sum: { totalCost: 'desc' } },
      take: limit,
    });
    const ids = grouped.map((g: any) => g.customerId);
    const customers = await prisma.customers.findMany({ where: { customerId: { in: ids } }, select: { customerId: true, name: true, mobile: true, city: true, state: true, country: true } });
    const result = customers.map((c) => ({
      ...c,
      totalPurchaseValue: Number(grouped.find((g: any) => g.customerId === c.customerId)?._sum.totalCost || 0),
    })).sort((a, b) => b.totalPurchaseValue - a.totalPurchaseValue);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving top customers" });
  }
};

// Low-stock for PCS inventory (pieces), sourced from pcsInventory.json
export const getLowStockPcs = async (req: Request, res: Response): Promise<void> => {
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
    const rawSearch = req.query?.search?.toString() ?? "";
    const limit = rawLimit ? Math.min(500, Math.max(1, Number(rawLimit))) : undefined;
    const offset = rawOffset ? Math.max(0, Number(rawOffset)) : undefined;
    const search = rawSearch.trim().toLowerCase();

    const low = await withCache(`lowPcs:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
      const pcs = readPcsInventory();
      const filtered = pcs
        .filter((e) => (e.quantity || 0) < threshold)
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
  } catch (error) {
    res.status(500).json({ message: "Error retrieving low-stock PCS items" });
  }
};
