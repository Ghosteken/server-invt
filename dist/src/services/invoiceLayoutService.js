"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInvoiceLayout = readInvoiceLayout;
exports.writeInvoiceLayout = writeInvoiceLayout;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const LAYOUT_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/invoiceLayout.json");
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
let cache = null;
let flushTimer = null;
const FLUSH_DELAY_MS = 500;
function ensureDir() {
    const dir = node_path_1.default.dirname(LAYOUT_PATH);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
}
function readInvoiceLayout() {
    try {
        if (cache)
            return cache;
        ensureDir();
        if (!node_fs_1.default.existsSync(LAYOUT_PATH)) {
            cache = DEFAULT_LAYOUT;
            return cache;
        }
        const raw = node_fs_1.default.readFileSync(LAYOUT_PATH, "utf-8");
        const data = JSON.parse(raw || "{}");
        cache = { ...DEFAULT_LAYOUT, ...(data || {}) };
        return cache;
    }
    catch {
        cache = DEFAULT_LAYOUT;
        return cache;
    }
}
function writeInvoiceLayout(next) {
    cache = { ...DEFAULT_LAYOUT, ...(next || {}) };
    ensureDir();
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        try {
            node_fs_1.default.writeFileSync(LAYOUT_PATH, JSON.stringify(cache, null, 2), "utf-8");
        }
        catch {
            // ignore write errors
        }
    }, FLUSH_DELAY_MS);
}
