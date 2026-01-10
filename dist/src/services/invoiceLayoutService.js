"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInvoiceLayout = readInvoiceLayout;
exports.writeInvoiceLayout = writeInvoiceLayout;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const prisma_1 = __importDefault(require("../db/prisma"));
// Base path for all layout files
const DATA_DIR = node_path_1.default.join(__dirname, "../../prisma/seedData");
const DEFAULT_LAYOUT = {
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
const cache = new Map();
// Flush timers: tenantId -> Timeout
const flushTimers = new Map();
const FLUSH_DELAY_MS = 500;
function ensureDir() {
    if (!node_fs_1.default.existsSync(DATA_DIR))
        node_fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
}
function getFilePath(tenantId) {
    // Sanitize tenantId to avoid path traversal
    const safeId = tenantId.replace(/[^a-zA-Z0-9-]/g, "");
    // Fallback for legacy global file if tenant is "default" or missing
    if (!safeId || safeId === "default")
        return node_path_1.default.join(DATA_DIR, "invoiceLayout.json");
    return node_path_1.default.join(DATA_DIR, `invoiceLayout_${safeId}.json`);
}
async function readInvoiceLayout(tenantId) {
    try {
        if (cache.has(tenantId))
            return cache.get(tenantId);
        ensureDir();
        const filePath = getFilePath(tenantId);
        if (!node_fs_1.default.existsSync(filePath)) {
            // Dynamic Default: Fetch Organization Name
            let businessName = DEFAULT_LAYOUT.header?.businessName;
            if (tenantId && tenantId !== "default") {
                try {
                    const org = await prisma_1.default.organizations.findUnique({ where: { id: tenantId } });
                    if (org)
                        businessName = org.name;
                }
                catch { }
            }
            const defaults = {
                ...DEFAULT_LAYOUT,
                header: { ...DEFAULT_LAYOUT.header, businessName }
            };
            cache.set(tenantId, defaults);
            return defaults;
        }
        const raw = node_fs_1.default.readFileSync(filePath, "utf-8");
        const data = JSON.parse(raw || "{}");
        const merged = { ...DEFAULT_LAYOUT, ...(data || {}) };
        // Deep merge header/footer to preserve defaults for missing fields
        if (data.header)
            merged.header = { ...DEFAULT_LAYOUT.header, ...data.header };
        if (data.footer)
            merged.footer = { ...DEFAULT_LAYOUT.footer, ...data.footer };
        cache.set(tenantId, merged);
        return merged;
    }
    catch {
        return DEFAULT_LAYOUT;
    }
}
function writeInvoiceLayout(tenantId, next) {
    // Merge with existing to ensure partial updates don't wipe data
    const current = cache.get(tenantId) || DEFAULT_LAYOUT;
    const merged = { ...current, ...next };
    if (next.header)
        merged.header = { ...current.header, ...next.header };
    if (next.footer)
        merged.footer = { ...current.footer, ...next.footer };
    if (next.logo)
        merged.logo = { ...current.logo, ...next.logo };
    cache.set(tenantId, merged);
    ensureDir();
    const timer = flushTimers.get(tenantId);
    if (timer)
        clearTimeout(timer);
    const newTimer = setTimeout(() => {
        try {
            const filePath = getFilePath(tenantId);
            node_fs_1.default.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
            flushTimers.delete(tenantId);
        }
        catch {
            // ignore write errors
        }
    }, FLUSH_DELAY_MS);
    flushTimers.set(tenantId, newTimer);
}
