import fs from "node:fs";
import path from "node:path";

export type FieldUpdateEntry = {
  productId: string;
  field: string; // normalized lower-case field key
  updatedAt: string; // ISO string
  source?: string; // e.g., import | api | invoice
};

const AUDIT_PATH = path.join(__dirname, "../../prisma/seedData/productFieldUpdates.json");

const normalizeField = (f: string) => f.toLowerCase().replace(/[^a-z]/g, "");

export const recordFieldUpdates = (productId: string, fields: string[], source?: string): void => {
  if (!productId || !Array.isArray(fields) || fields.length === 0) return;
  recordFieldUpdatesBulk([{ productId, fields, source }]);
};

export const recordFieldUpdatesBulk = (updates: { productId: string; fields: string[]; source?: string }[]): void => {
  if (!updates.length) return;
  const entries: FieldUpdateEntry[] = [];
  const now = new Date().toISOString();
  
  for (const u of updates) {
    if (!u.productId || !Array.isArray(u.fields) || u.fields.length === 0) continue;
    for (const f of u.fields) {
      entries.push({
        productId: String(u.productId),
        field: normalizeField(f),
        updatedAt: now,
        source: u.source,
      });
    }
  }
  if (!entries.length) return;

  try {
    let existing: FieldUpdateEntry[] = [];
    if (fs.existsSync(AUDIT_PATH)) {
      try {
        existing = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf-8"));
      } catch {
        existing = [];
      }
    }
    // Append and keep only last 50k entries to prevent infinite growth
    const merged = existing.concat(entries);
    if (merged.length > 50000) {
      merged.splice(0, merged.length - 50000);
    }
    const dir = path.dirname(AUDIT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUDIT_PATH, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    // Non-fatal: logging should not break primary flows
    console.warn("Failed to record field updates:", err);
  }
};

export const getLastFieldUpdates = (): Record<string, Record<string, string>> => {
  try {
    if (!fs.existsSync(AUDIT_PATH)) return {};
    const entries: FieldUpdateEntry[] = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf-8"));
    const map: Record<string, Record<string, string>> = {};
    for (const e of entries) {
      if (!map[e.productId]) map[e.productId] = {} as Record<string, string>;
      const field = normalizeField(e.field);
      const prev = map[e.productId][field];
      if (!prev || new Date(e.updatedAt).getTime() > new Date(prev).getTime()) {
        map[e.productId][field] = e.updatedAt;
      }
    }
    return map;
  } catch {
    return {};
  }
};