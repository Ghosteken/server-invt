import fs from "node:fs";
import path from "node:path";

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

const LAYOUT_PATH = path.join(__dirname, "../../prisma/seedData/invoiceLayout.json");

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

let cache: InvoiceLayout | null = null;
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 500;

function ensureDir() {
  const dir = path.dirname(LAYOUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readInvoiceLayout(): InvoiceLayout {
  try {
    if (cache) return cache;
    ensureDir();
    if (!fs.existsSync(LAYOUT_PATH)) {
      cache = DEFAULT_LAYOUT;
      return cache;
    }
    const raw = fs.readFileSync(LAYOUT_PATH, "utf-8");
    const data = JSON.parse(raw || "{}");
    cache = { ...DEFAULT_LAYOUT, ...(data || {}) };
    return cache as InvoiceLayout;
  } catch {
    cache = DEFAULT_LAYOUT;
    return cache;
  }
}

export function writeInvoiceLayout(next: InvoiceLayout): void {
  cache = { ...DEFAULT_LAYOUT, ...(next || {}) };
  ensureDir();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(LAYOUT_PATH, JSON.stringify(cache, null, 2), "utf-8");
    } catch {
      // ignore write errors
    }
  }, FLUSH_DELAY_MS);
}