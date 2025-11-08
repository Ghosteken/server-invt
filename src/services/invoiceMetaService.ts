import fs from "node:fs";
import path from "node:path";

// Lightweight meta store for invoices without DB migrations.
// Schema: array of { invoiceId, invoiceNumber? }
export type InvoiceMeta = {
  invoiceId: string;
  invoiceNumber?: string | null;
};

const META_PATH = path.join(__dirname, "../../prisma/seedData/invoiceMeta.json");

let cache: InvoiceMeta[] | null = null;
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 500;

function ensureDir() {
  const dir = path.dirname(META_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAll(): InvoiceMeta[] {
  try {
    if (cache) return cache;
    ensureDir();
    if (!fs.existsSync(META_PATH)) {
      cache = [];
      return cache;
    }
    const raw = fs.readFileSync(META_PATH, "utf-8");
    const data = raw.trim() ? JSON.parse(raw) : [];
    cache = Array.isArray(data) ? data : [];
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function writeAll(next: InvoiceMeta[]): void {
  cache = next;
  ensureDir();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(META_PATH, JSON.stringify(cache, null, 2));
    } catch (e) {
      console.warn("invoiceMeta write failed", e);
    }
  }, FLUSH_DELAY_MS);
}

export function upsertInvoiceMeta(entry: InvoiceMeta): void {
  const list = readAll();
  const map = new Map<string, InvoiceMeta>(list.map((e) => [e.invoiceId, e]));
  const prev = map.get(entry.invoiceId);
  const next: InvoiceMeta = {
    invoiceId: entry.invoiceId,
    invoiceNumber: entry.invoiceNumber ?? prev?.invoiceNumber ?? null,
  };
  map.set(entry.invoiceId, next);
  writeAll(Array.from(map.values()));
}

export function getInvoiceMeta(id: string): InvoiceMeta | undefined {
  const list = readAll();
  return list.find((e) => e.invoiceId === id);
}

export function removeInvoiceMeta(id: string): void {
  const list = readAll();
  const next = list.filter((e) => e.invoiceId !== id);
  writeAll(next);
}