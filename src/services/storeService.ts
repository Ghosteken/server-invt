import fs from "fs";
import path from "path";

const STORES_PATH = path.join(__dirname, "../../assets/stores.json");

export type StoreEntry = { store: string; branches: string[] };
export type StoresData = { stores: StoreEntry[] };

export function readStores(): StoresData {
  try {
    if (!fs.existsSync(STORES_PATH)) return { stores: [] };
    const raw = fs.readFileSync(STORES_PATH, "utf-8");
    const data = JSON.parse(raw);
    const stores = Array.isArray(data?.stores) ? data.stores : [];
    return { stores };
  } catch {
    return { stores: [] };
  }
}

export function writeStores(payload: StoresData): void {
  const dir = path.dirname(STORES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORES_PATH, JSON.stringify(payload, null, 2), "utf-8");
}