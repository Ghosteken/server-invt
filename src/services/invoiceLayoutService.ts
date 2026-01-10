import fs from "node:fs";
import path from "node:path";
import prisma from "../db/prisma";

export type InvoiceLayout = {
  template?: "standard" | "compact" | "detailed";
  header?: {
    businessName?: string;
    address?: string;
    phone?: string;
    position?: "left" | "center" | "right";
  };
  footer?: {
    text?: string;
    position?: "left" | "center" | "right";
  };
  logo?: {
    url?: string | null;
    position?: "left" | "center" | "right";
  };
  showTotals?: boolean;
};

// Base path for all layout files
const DATA_DIR = path.join(__dirname, "../../prisma/seedData");

const DEFAULT_LAYOUT: InvoiceLayout = {
  template: "standard",
  header: {
    businessName: "Your Business Name",
    address: "Address line",
    phone: "",
    position: "center",
  },
  footer: {
    text: "Thank you for your business",
    position: "center",
  },
  logo: { url: null, position: "left" },
  showTotals: true,
};

// In-memory cache: tenantId -> InvoiceLayout
const cache = new Map<string, InvoiceLayout>();
// Flush timers: tenantId -> Timeout
const flushTimers = new Map<string, NodeJS.Timeout>();
const FLUSH_DELAY_MS = 500;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(tenantId: string) {
  // Sanitize tenantId to avoid path traversal
  const safeId = tenantId.replace(/[^a-zA-Z0-9-]/g, "");
  // Fallback for legacy global file if tenant is "default" or missing
  if (!safeId || safeId === "default") return path.join(DATA_DIR, "invoiceLayout.json");
  return path.join(DATA_DIR, `invoiceLayout_${safeId}.json`);
}

export async function readInvoiceLayout(tenantId: string): Promise<InvoiceLayout> {
  try {
    if (cache.has(tenantId)) return cache.get(tenantId)!;
    
    ensureDir();
    const filePath = getFilePath(tenantId);
    
    if (!fs.existsSync(filePath)) {
      // Dynamic Default: Fetch Organization Name
      let businessName = DEFAULT_LAYOUT.header?.businessName;
      if (tenantId && tenantId !== "default") {
        try {
           const org = await prisma.organizations.findUnique({ where: { id: tenantId } });
           if (org) businessName = org.name;
        } catch {}
      }
      
      const defaults = { 
        ...DEFAULT_LAYOUT, 
        header: { ...DEFAULT_LAYOUT.header, businessName } 
      };
      
      cache.set(tenantId, defaults);
      return defaults;
    }
    
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw || "{}");
    const merged = { ...DEFAULT_LAYOUT, ...(data || {}) };
    // Deep merge header/footer to preserve defaults for missing fields
    if (data.header) merged.header = { ...DEFAULT_LAYOUT.header, ...data.header };
    if (data.footer) merged.footer = { ...DEFAULT_LAYOUT.footer, ...data.footer };
    
    cache.set(tenantId, merged as InvoiceLayout);
    return merged as InvoiceLayout;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function writeInvoiceLayout(tenantId: string, next: InvoiceLayout): void {
  // Merge with existing to ensure partial updates don't wipe data
  const current = cache.get(tenantId) || DEFAULT_LAYOUT;
  const merged = { ...current, ...next };
  if (next.header) merged.header = { ...current.header, ...next.header };
  if (next.footer) merged.footer = { ...current.footer, ...next.footer };
  if (next.logo) merged.logo = { ...current.logo, ...next.logo };

  cache.set(tenantId, merged);
  ensureDir();
  
  const timer = flushTimers.get(tenantId);
  if (timer) clearTimeout(timer);
  
  const newTimer = setTimeout(() => {
    try {
      const filePath = getFilePath(tenantId);
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
      flushTimers.delete(tenantId);
    } catch {
      // ignore write errors
    }
  }, FLUSH_DELAY_MS);
  
  flushTimers.set(tenantId, newTimer);
}