import prisma from "../db/prisma";
import fs from "node:fs";
import path from "node:path";

export type PcsEntry = {
  name: string;
  quantity: number;
  productId?: string | null;
  packSize?: string | null;
  salesPrice?: number | null;
  purchasePrice?: number | null;
  tenantId?: string;
};

export const readPcsInventory = async (tenantId = "default"): Promise<PcsEntry[]> => {
  try {
    const rows = await prisma.pcsInventory.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map((r: any) => ({
      name: r.name,
      quantity: r.quantity,
      productId: r.productId ?? null,
      packSize: r.packSize ?? null,
      salesPrice: r.salesPrice ?? null,
      purchasePrice: r.purchasePrice ?? null,
      tenantId: r.tenantId
    }));
  } catch {
    try {
      const jsonPath = path.join(__dirname, "../../prisma/seedData/pcsInventory.json");
      if (!fs.existsSync(jsonPath)) return [];
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map((e: any) => ({
        name: String(e?.name || "").trim(),
        quantity: Math.max(0, Number(e?.quantity) || 0),
        productId: e?.productId ?? null,
        packSize: e?.packSize ?? null,
        salesPrice: e?.salesPrice ?? null,
        purchasePrice: e?.purchasePrice ?? null,
        tenantId,
      }));
    } catch {
      return [];
    }
  }
};

export const upsertPcsEntries = async (
  incoming: { name: string; quantity: number; packSize?: string | null; salesPrice?: number | null; purchasePrice?: number | null; productId?: string | null }[],
  tenantId = "default"
): Promise<PcsEntry[]> => {
  const existing = await readPcsInventory(tenantId);
  const map = new Map<string, PcsEntry>();
  for (const e of existing) map.set(e.name.toLowerCase(), { ...e });
  for (const inc of incoming) {
    const key = inc.name.toLowerCase();
    const prev = map.get(key);
    const nextQty = Math.max(0, Number(inc.quantity) || 0);
    
    // Try to resolve productId if not provided
    let resolvedProductId = inc.productId ?? prev?.productId ?? null;
    if (!resolvedProductId) {
      const product = await prisma.products.findFirst({
        where: { tenantId, name: { equals: inc.name } } // Exact match first
      });
      if (product) {
        resolvedProductId = product.productId;
      } else {
         // Fallback to case insensitive match if needed, but exact is safer for linking
         const productLoose = await prisma.products.findFirst({
            where: { tenantId, name: inc.name } 
         });
         if (productLoose) resolvedProductId = productLoose.productId;
      }
    }

    const next: PcsEntry = {
      name: inc.name,
      quantity: nextQty,
      productId: resolvedProductId,
      packSize: inc.packSize ?? prev?.packSize ?? null,
      salesPrice: inc.salesPrice !== undefined ? inc.salesPrice : (prev?.salesPrice ?? null),
      purchasePrice: inc.purchasePrice !== undefined ? inc.purchasePrice : (prev?.purchasePrice ?? null),
      tenantId
    };
    map.set(key, next);
    await prisma.pcsInventory.upsert({
      where: { tenantId_name: { tenantId, name: inc.name } },
      create: {
        id: cryptoRandom(),
        tenantId,
        name: inc.name,
        quantity: nextQty,
        openingStock: nextQty,
        productId: next.productId ?? null,
        packSize: next.packSize ?? null,
        salesPrice: next.salesPrice ?? null,
        purchasePrice: next.purchasePrice ?? null
      },
      update: {
        quantity: nextQty,
        productId: next.productId ?? null,
        packSize: next.packSize ?? null,
        salesPrice: next.salesPrice ?? null,
        purchasePrice: next.purchasePrice ?? null
      },
    });
  }
  return Array.from(map.values());
};

// Force reloading PCS inventory from disk by clearing cache
export const reloadPcsInventory = async (tenantId = "default"): Promise<PcsEntry[]> => {
  return readPcsInventory(tenantId);
};

export const adjustPcsQuantity = async ({ name, delta, tenantId = "default" }: { name: string; delta: number; tenantId?: string }): Promise<void> => {
  const prev = await prisma.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name } } });
  const nextQty = Math.max(0, (prev?.quantity || 0) + delta);
  await prisma.pcsInventory.upsert({
    where: { tenantId_name: { tenantId, name } },
    create: { id: cryptoRandom(), tenantId, name, quantity: nextQty },
    update: { quantity: nextQty },
  });
};

function cryptoRandom(): string {
  try { const { randomUUID } = require("crypto"); return randomUUID(); } catch { return Math.random().toString(36).slice(2); }
}
