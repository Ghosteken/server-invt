import { Request, Response } from "express";
import prisma from "../db/prisma";
import { readPcsInventory } from "../services/pcsInventoryService";
import { withCache } from "../services/cache";
import { createErrorResponse } from "../utils/errorHandler";

// Use shared Prisma client
// Only include products currently in inventory: Qty > 0
const nonInventoryFilter: any = { stockQuantity: { gt: 0 } };

export const getDashboardMetrics = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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
    const [
      totalProducts,
      lowStockCount,
      pcsData,
      inventoryValue,
      inventoryValuePcs,
      sales7dTotal,
      popularProducts
    ] = await Promise.all([
      withCache(`t=${tenantId}:metrics:totalProducts:inventory`, 60, async () => prisma.products.count({ where: { tenantId, ...nonInventoryFilter } })),
      withCache(
        `t=${tenantId}:metrics:lowStock:${LOW_STOCK_THRESHOLD}`,
        60,
        async () =>
          prisma.products.count({
            where: { tenantId, stockQuantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } },
          })
      ),
      withCache(
        `t=${tenantId}:metrics:pcs-and-combined:${LOW_STOCK_THRESHOLD}`,
        60,
        async () => {
          // Optimization: Use SQL for counts to avoid loading thousands of rows
          const [pcsInventoryCount, lowStockPcsCount] = await Promise.all([
            prisma.pcsInventory.count({ where: { tenantId, quantity: { gt: 0 } } }),
            prisma.pcsInventory.count({ where: { tenantId, quantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } } })
          ]);

          // Optimization: Use SQL UNION for unique name counting
          const combinedCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
             SELECT COUNT(DISTINCT LOWER(name)) as count
             FROM (
                 SELECT name FROM "Products" WHERE "tenantId" = ${tenantId} AND "stockQuantity" > 0
                 UNION ALL
                 SELECT name FROM "pcs_inventory" WHERE "tenantId" = ${tenantId} AND "quantity" > 0
             ) as combined
          `;
          const combinedInventoryCount = Number(combinedCountResult?.[0]?.count || 0);

          const combinedLowResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
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
        }
      ),
      withCache(`t=${tenantId}:metrics:inventoryValue`, 60, async () => {
        // Optimization: Use DB aggregation instead of loading all rows into memory
        // This moves the O(N) calculation from Node.js (RAM heavy) to Postgres (Optimized)
        const result = await prisma.$queryRaw<Array<{ total: number }>>`
          SELECT SUM("price" * "stockQuantity") as total
          FROM "Products"
          WHERE "tenantId" = ${tenantId} AND "stockQuantity" > 0
        `;
        return Number(result?.[0]?.total || 0);
      }),
      withCache(`t=${tenantId}:metrics:inventoryValuePcs:${LOW_STOCK_THRESHOLD}`, 60, async () => {
        const pcs = await readPcsInventory(tenantId);
        const inStock = pcs.filter((e: any) => Number(e.quantity || 0) > 0);
        if (!inStock.length) return 0;

        // Optimization: Fetch only relevant products if the list is small enough
        // If we have too many PCS items, fetching all products is more efficient than a massive OR query
        const THRESHOLD_FOR_FULL_FETCH = 500;
        
        let products: Array<{ productId: string; name: string; price: unknown; packSize?: string | null }> = [];

        if (inStock.length > THRESHOLD_FOR_FULL_FETCH) {
           products = await prisma.products.findMany({
            where: { tenantId },
            select: { productId: true, name: true, price: true, packSize: true },
          });
        } else {
           const productIds = inStock.map(e => e.productId).filter(id => id && typeof id === 'string') as string[];
           const names = inStock.map(e => e.name).filter(n => n && typeof n === 'string') as string[];
           const uniqueIds = Array.from(new Set(productIds));
           const uniqueNames = Array.from(new Set(names));
           
           if (uniqueIds.length > 0 || uniqueNames.length > 0) {
             products = await prisma.products.findMany({
               where: { 
                 tenantId,
                 OR: [
                   ...(uniqueIds.length ? [{ productId: { in: uniqueIds } }] : []),
                   // Use multiple OR conditions for case-insensitive name matching
                   ...uniqueNames.map(n => ({ name: { equals: n, mode: 'insensitive' as const } }))
                 ]
               },
               select: { productId: true, name: true, price: true, packSize: true },
             });
           }
        }

        const byId = new Map<string, { price: number; packSize?: string | null; name: string }>();
        const byName = new Map<string, { price: number; packSize?: string | null; name: string }>();
        for (const p of products) {
          const rec = { price: Number((p as any).price || 0), packSize: (p as any).packSize ?? null, name: String((p as any).name || "") };
          byId.set(String((p as any).productId), rec);
          byName.set(String(rec.name).toLowerCase(), rec);
        }
        const extractPackCount = (ps?: string | null): number | null => {
          if (!ps) return null;
          const m = String(ps).match(/(\d{1,4})/);
          if (!m) return null;
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
      withCache(`t=${tenantId}:metrics:sales7d`, 60, async () => {
        const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const salesAgg = await prisma.customerPurchases.aggregate({ where: { tenantId, timestamp: { gte: since7 } }, _sum: { totalCost: true } });
        return Number(salesAgg._sum.totalCost || 0);
      }),
      // Popular products logic (wrapped for parallelism)
      (async () => {
        const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        let popularGrouped: Array<{ productId: string; _count: { productId: number } }> = [];
        try {
          // @ts-ignore - Prisma groupBy typing can be verbose
          popularGrouped = await prisma.customerPurchases.groupBy({
            by: ['productId'],
            where: { tenantId, timestamp: { gte: since30 } },
            _count: { productId: true },
            orderBy: { _count: { productId: 'desc' } },
            take: 5,
          });
        } catch (e) {
          popularGrouped = [];
        }

        let popularProducts: Array<{ productId: string; name: string; price: number; stockQuantity: number; purchaseCount: number }> = [];
        if (popularGrouped.length) {
          const ids = popularGrouped.map((g) => g.productId);
          const details = await prisma.products.findMany({ where: { tenantId, productId: { in: ids }, ...nonInventoryFilter }, select: { productId: true, name: true, price: true, stockQuantity: true } });
          popularProducts = details.map((d: { productId: string; name: string; price: unknown; stockQuantity: number }) => ({
            ...d,
            price: Number(d.price),
            purchaseCount: popularGrouped.find((g) => g.productId === d.productId)?._count.productId || 0,
          }));
        } else {
          const fallback = await prisma.products.findMany({ where: { tenantId, ...nonInventoryFilter }, take: 5, orderBy: { stockQuantity: 'desc' }, select: { productId: true, name: true, price: true, stockQuantity: true } });
          popularProducts = fallback.map((d: { productId: string; name: string; price: unknown; stockQuantity: number }) => ({ ...d, price: Number(d.price), purchaseCount: 0 }));
        }
        return popularProducts;
      })()
    ]);

    const { pcsInventoryCount, lowStockPcsCount, combinedInventoryCount, combinedLowStockCount } = pcsData;
    const inventoryValueCombined = inventoryValue + inventoryValuePcs;

    res.set("Cache-Control", "public, max-age=60");
    res.json({
      totalProducts,
      lowStockCount,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      // New fields (non-breaking): separate CTN/PCS and combined counts
      totalProductsCtn: totalProducts,
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
    
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving dashboard metrics"));
  }
};

// Detailed low-stock list
export const getLowStockProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
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

    const products = await withCache(`t=${tenantId}:lowStock:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
      return prisma.products.findMany({
        where: {
          tenantId,
          stockQuantity: { gt: 0, lte: threshold },
          ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        },
        select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true },
        ...(typeof limit === 'number' ? { take: limit } : {}),
        ...(typeof offset === 'number' ? { skip: offset } : {}),
        orderBy: { stockQuantity: 'asc' },
      });
    });
    res.set("Cache-Control", "public, max-age=30");
    res.json(products.map((p: { price: unknown }) => ({ ...p, price: Number(p.price) })));
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving low-stock products"));
  }
};

// Products expiring within N days
export const getExpiringProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const q = req.query?.days;
    const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
    const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const products = await prisma.products.findMany({
      where: { tenantId, expiryDate: { lte: cutoff }, ...nonInventoryFilter },
      select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true }
    });
    res.set("Cache-Control", "public, max-age=30");
    res.json(products.map((p: { price: unknown }) => ({ ...p, price: Number(p.price) })));
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving expiring products"));
  }
};

// Dead stock: no sales in the past N days
export const getDeadStockProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const q = req.query?.days;
    const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
    const days = Number.isFinite(qNum) && qNum > 0 ? qNum : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Find latest purchase per product since forever
    // @ts-ignore Prisma groupBy typing verbosity
    const grouped = await prisma.customerPurchases.groupBy({
      by: ['productId'],
      where: { tenantId },
      _max: { timestamp: true },
    });
    const latestByProduct = new Map<string, Date | null>(grouped.map((g: any) => [g.productId, g._max.timestamp ? new Date(g._max.timestamp) : null]));

    const allProducts = await prisma.products.findMany({ where: { tenantId, ...nonInventoryFilter }, select: { productId: true, name: true, price: true, stockQuantity: true, expiryDate: true, category: true, packSize: true } });
    const dead = allProducts.filter((p: { productId: string }) => {
      const last = latestByProduct.get(p.productId) || null;
      return !last || last < since;
    });
    res.set("Cache-Control", "public, max-age=30");
    res.json(dead.map((d: { price: unknown }) => ({ ...d, price: Number(d.price) })));
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving dead stock products"));
  }
};

// Top customers by purchase value
export const getTopCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const q = req.query?.limit;
    const qNum = typeof q === 'string' ? Number(q) : Array.isArray(q) ? Number(q[0]) : NaN;
    const limit = Number.isFinite(qNum) && qNum > 0 ? Math.min(50, qNum) : 5;

    // @ts-ignore Prisma groupBy typing verbosity
    const grouped = await prisma.customerPurchases.groupBy({
      by: ['customerId'],
      where: { tenantId },
      _sum: { totalCost: true },
      orderBy: { _sum: { totalCost: 'desc' } },
      take: limit,
    });
    const ids = grouped.map((g: any) => g.customerId);
    const customers = await prisma.customers.findMany({ where: { tenantId, customerId: { in: ids } }, select: { customerId: true, name: true, mobile: true, city: true, state: true, country: true } });
    const result = customers.map((c: { customerId: string }) => ({
      ...c,
      totalPurchaseValue: Number(grouped.find((g: any) => g.customerId === c.customerId)?._sum.totalCost || 0),
    })).sort((a: any, b: any) => b.totalPurchaseValue - a.totalPurchaseValue);
    res.set("Cache-Control", "public, max-age=60");
    res.json(result);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving top customers"));
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
    const rawPage = req.query?.page?.toString();
    const rawSearch = req.query?.search?.toString() ?? "";
    const limit = rawLimit ? Math.min(500, Math.max(1, Number(rawLimit))) : undefined;
    const page = rawPage ? Math.max(1, Number(rawPage)) : undefined;
    const offset = rawOffset ? Math.max(0, Number(rawOffset)) : (page && typeof limit === 'number' ? (page - 1) * limit : undefined);
    const search = rawSearch.trim().toLowerCase();

    const low = await withCache(`lowPcs:${threshold}:lim=${limit}:off=${offset}:q=${search}`, 30, async () => {
      const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
      const pcs = await readPcsInventory(tenantId);
      const filtered = pcs
        // Only items currently in inventory: quantity > 0
        .filter((e) => (e.quantity || 0) > 0)
        // Low-stock threshold: 1..threshold (inclusive)
        .filter((e) => (e.quantity || 0) <= threshold)
        .filter((e) => (search ? e.name.toLowerCase().includes(search) : true))
        .map((e: { name: string; quantity: number; packSize?: string | null; productId?: string | null }) => ({
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
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving low-stock PCS items"));
  }
};
