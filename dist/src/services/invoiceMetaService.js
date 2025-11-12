"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertInvoiceMeta = upsertInvoiceMeta;
exports.getInvoiceMeta = getInvoiceMeta;
exports.removeInvoiceMeta = removeInvoiceMeta;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const META_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/invoiceMeta.json");
let cache = null;
let flushTimer = null;
const FLUSH_DELAY_MS = 500;
function ensureDir() {
    const dir = node_path_1.default.dirname(META_PATH);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
}
function readAll() {
    try {
        if (cache)
            return cache;
        ensureDir();
        if (!node_fs_1.default.existsSync(META_PATH)) {
            cache = [];
            return cache;
        }
        const raw = node_fs_1.default.readFileSync(META_PATH, "utf-8");
        const data = raw.trim() ? JSON.parse(raw) : [];
        cache = Array.isArray(data) ? data : [];
        return cache;
    }
    catch {
        cache = [];
        return cache;
    }
}
function writeAll(next) {
    cache = next;
    ensureDir();
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        try {
            node_fs_1.default.writeFileSync(META_PATH, JSON.stringify(cache, null, 2));
        }
        catch (e) {
            console.warn("invoiceMeta write failed", e);
        }
    }, FLUSH_DELAY_MS);
}
function upsertInvoiceMeta(entry) {
    const list = readAll();
    const map = new Map(list.map((e) => [e.invoiceId, e]));
    const prev = map.get(entry.invoiceId);
    const next = {
        invoiceId: entry.invoiceId,
        invoiceNumber: entry.invoiceNumber ?? prev?.invoiceNumber ?? null,
    };
    map.set(entry.invoiceId, next);
    writeAll(Array.from(map.values()));
}
function getInvoiceMeta(id) {
    const list = readAll();
    return list.find((e) => e.invoiceId === id);
}
function removeInvoiceMeta(id) {
    const list = readAll();
    const next = list.filter((e) => e.invoiceId !== id);
    writeAll(next);
}
