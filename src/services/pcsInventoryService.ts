import fs from "node:fs";
import path from "node:path";

export type PcsEntry = {
  name: string;
  quantity: number;
  productId?: string | null;
  packSize?: string | null;
};

const PCS_PATH = path.join(__dirname, "../../prisma/seedData/pcsInventory.json");

export const readPcsInventory = (): PcsEntry[] => {
  try {
    if (!fs.existsSync(PCS_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(PCS_PATH, "utf-8"));
    if (!Array.isArray(data)) return [];
    return data.map((e: any) => ({
      name: String(e.name || "").trim(),
      quantity: Math.max(0, Number(e.quantity) || 0),
      productId: e.productId ?? null,
      packSize: e.packSize ?? null,
    }));
  } catch {
    return [];
  }
};

const writePcsInventory = (entries: PcsEntry[]): void => {
  const dir = path.dirname(PCS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PCS_PATH, JSON.stringify(entries, null, 2), "utf-8");
};

export const upsertPcsEntries = (
  incoming: { name: string; quantity: number; packSize?: string | null }[]
): PcsEntry[] => {
  const existing = readPcsInventory();
  const map = new Map<string, PcsEntry>();
  for (const e of existing) {
    map.set(e.name.toLowerCase(), { ...e });
  }
  for (const inc of incoming) {
    const key = inc.name.toLowerCase();
    const prev = map.get(key);
    const nextQty = Math.max(0, Number(inc.quantity) || 0);
    map.set(key, {
      name: inc.name,
      quantity: nextQty,
      productId: prev?.productId ?? null,
      packSize: inc.packSize ?? prev?.packSize ?? null,
    });
  }
  const merged = Array.from(map.values());
  writePcsInventory(merged);
  return merged;
};

export const adjustPcsQuantity = ({ name, delta }: { name: string; delta: number }): void => {
  const existing = readPcsInventory();
  const key = name.toLowerCase();
  const map = new Map<string, PcsEntry>(existing.map((e) => [e.name.toLowerCase(), e]));
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { name, quantity: Math.max(0, 0 + delta), productId: null, packSize: null });
  } else {
    map.set(key, { ...prev, quantity: Math.max(0, (prev.quantity || 0) + delta) });
  }
  writePcsInventory(Array.from(map.values()));
};