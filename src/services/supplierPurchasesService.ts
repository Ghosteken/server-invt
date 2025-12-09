import fs from "node:fs";
import path from "node:path";

// Store supplier metadata for procurement purchases without DB migrations
// Schema: array of { purchaseId, supplierName?, supplierMobile?, paymentTerm?, date?, dueDate? }
export type SupplierPurchaseMeta = {
  purchaseId: string;
  supplierName?: string | null;
  supplierMobile?: string | null;
  paymentTerm?: string | null;
  date?: string | null; // ISO string
  dueDate?: string | null; // ISO string
  // Track purchase unit (ctn or pcs) per entry to support inventory reversal on delete
  unit?: string | null;
};

const META_PATH = path.join(__dirname, "../../prisma/seedData/supplierPurchases.json");

// Lightweight supplier payment tracking for purchases
export type SupplierPayment = {
  id: string;
  purchaseId: string;
  date: string; // ISO
  amount: number;
  bankName: string;
  bankAccount: string;
  notes?: string | null;
};
const PAYMENTS_PATH = path.join(__dirname, "../../prisma/seedData/supplierPurchasePayments.json");
const SUPPLIERS_PATH = path.join(__dirname, "../../prisma/seedData/suppliers.json");
function ensureDirFor(p: string) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function suppliersPathForTenant(tenantId: string): string {
  return path.join(__dirname, "../../prisma/seedData/suppliers", `${tenantId}.json`);
}

let cache: SupplierPurchaseMeta[] | null = null;
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 500;

let paymentsCache: SupplierPayment[] | null = null;
let paymentsFlushTimer: NodeJS.Timeout | null = null;

function ensureDir() {
  const dir = path.dirname(META_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readSupplierMeta(): SupplierPurchaseMeta[] {
  try {
    if (cache) return cache;
    if (!fs.existsSync(META_PATH)) {
      cache = [];
      return cache;
    }
    const raw = fs.readFileSync(META_PATH, "utf-8");
    const data = JSON.parse(raw);
    cache = Array.isArray(data) ? data : [];
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function writeSupplierMeta(next: SupplierPurchaseMeta[]): void {
  cache = next;
  ensureDir();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(META_PATH, JSON.stringify(next, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }, FLUSH_DELAY_MS);
}

export function upsertSupplierMeta(entry: SupplierPurchaseMeta): void {
  const list = readSupplierMeta();
  const map = new Map<string, SupplierPurchaseMeta>(list.map((e) => [e.purchaseId, e]));
  const prev = map.get(entry.purchaseId);
  const next: SupplierPurchaseMeta = {
    purchaseId: entry.purchaseId,
    supplierName: entry.supplierName ?? prev?.supplierName ?? null,
    supplierMobile: entry.supplierMobile ?? prev?.supplierMobile ?? null,
    paymentTerm: entry.paymentTerm ?? prev?.paymentTerm ?? null,
    date: entry.date ?? prev?.date ?? null,
    dueDate: entry.dueDate ?? prev?.dueDate ?? null,
    unit: entry.unit ?? prev?.unit ?? null,
  };
  map.set(entry.purchaseId, next);
  writeSupplierMeta(Array.from(map.values()));
}

export function getSupplierMetaFor(purchaseId: string): SupplierPurchaseMeta | undefined {
  const list = readSupplierMeta();
  return list.find((e) => e.purchaseId === purchaseId);
}

// Payments helpers
export function readSupplierPayments(): SupplierPayment[] {
  try {
    if (paymentsCache) return paymentsCache;
    ensureDir();
    if (!fs.existsSync(PAYMENTS_PATH)) {
      paymentsCache = [];
      return paymentsCache;
    }
    const raw = fs.readFileSync(PAYMENTS_PATH, "utf-8");
    const data = JSON.parse(raw);
    paymentsCache = Array.isArray(data) ? data : [];
    return paymentsCache;
  } catch {
    paymentsCache = [];
    return paymentsCache;
  }
}

function writeSupplierPayments(next: SupplierPayment[]): void {
  paymentsCache = next;
  ensureDir();
  if (paymentsFlushTimer) clearTimeout(paymentsFlushTimer);
  paymentsFlushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(PAYMENTS_PATH, JSON.stringify(next, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }, FLUSH_DELAY_MS);
}

export function addSupplierPayment(entry: SupplierPayment): SupplierPayment {
  const list = readSupplierPayments();
  const next = [...list, entry];
  writeSupplierPayments(next);
  return entry;
}

export function getPaymentsForPurchase(purchaseId: string): SupplierPayment[] {
  const list = readSupplierPayments();
  return list.filter((p) => p.purchaseId === purchaseId);
}

export type SupplierEntry = { name: string; mobile?: string | null };

export function readSuppliers(): SupplierEntry[] {
  try {
    ensureDir();
    if (!fs.existsSync(SUPPLIERS_PATH)) return [];
    const raw = fs.readFileSync(SUPPLIERS_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as SupplierEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeSuppliers(next: SupplierEntry[]): void {
  try {
    ensureDir();
    fs.writeFileSync(SUPPLIERS_PATH, JSON.stringify(next, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

export function readSuppliersForTenant(tenantId: string): SupplierEntry[] {
  try {
    const p = suppliersPathForTenant(tenantId);
    ensureDirFor(p);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as SupplierEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeSuppliersForTenant(tenantId: string, next: SupplierEntry[]): void {
  try {
    const p = suppliersPathForTenant(tenantId);
    ensureDirFor(p);
    fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  } catch {
  }
}
