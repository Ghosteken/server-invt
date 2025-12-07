import prisma from "../db/prisma";
import fs from "node:fs";
import path from "node:path";

export type PcsEntry = {
  name: string;
  quantity: number;
  productId?: string | null;
  packSize?: string | null;
  tenantId?: string;
};

export const readPcsInventory = async (tenantId = "default"): Promise<PcsEntry[]> => {
  try {
    const rows = await prisma.pcsInventory.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map((r) => ({ name: r.name, quantity: r.quantity, productId: r.productId ?? null, packSize: r.packSize ?? null, tenantId: r.tenantId }));
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
        tenantId,
      }));
    } catch {
      return [];
    }
  }
};

export const upsertPcsEntries = async (
  incoming: { name: string; quantity: number; packSize?: string | null }[],
  tenantId = "default"
): Promise<PcsEntry[]> => {
  const existing = await readPcsInventory(tenantId);
  const map = new Map<string, PcsEntry>();
  for (const e of existing) map.set(e.name.toLowerCase(), { ...e });
  for (const inc of incoming) {
    const key = inc.name.toLowerCase();
    const prev = map.get(key);
    const nextQty = Math.max(0, Number(inc.quantity) || 0);
    const next: PcsEntry = { name: inc.name, quantity: nextQty, productId: prev?.productId ?? null, packSize: inc.packSize ?? prev?.packSize ?? null, tenantId };
    map.set(key, next);
    await prisma.pcsInventory.upsert({
      where: { tenantId_name: { tenantId, name: inc.name } },
      create: { id: cryptoRandom(), tenantId, name: inc.name, quantity: nextQty, productId: next.productId ?? null, packSize: next.packSize ?? null },
      update: { quantity: nextQty, packSize: next.packSize ?? null },
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
