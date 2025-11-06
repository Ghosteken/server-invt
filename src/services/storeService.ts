import fs from "fs";
import path from "path";

const STORES_PATH = path.join(__dirname, "../../assets/stores.json");

export type StoreEntry = { store: string; branches: string[] };
export type StoresData = { stores: StoreEntry[] };

// In-memory cache with debounced disk flush
let storesCache: StoresData | null = null;
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 500;

export function readStores(): StoresData {
  try {
    if (storesCache) return storesCache;
    if (!fs.existsSync(STORES_PATH)) {
      storesCache = { stores: [] };
      return storesCache;
    }
    const raw = fs.readFileSync(STORES_PATH, "utf-8");
    const data = JSON.parse(raw);
    const stores = Array.isArray(data?.stores) ? data.stores : [];
    storesCache = { stores };
    return storesCache;
  } catch {
    storesCache = { stores: [] };
    return storesCache;
  }
}

export function writeStores(payload: StoresData): void {
  storesCache = payload;
  const dir = path.dirname(STORES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STORES_PATH, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      // ignore write errors
    }
  }, FLUSH_DELAY_MS);
}