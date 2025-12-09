"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSupplierMeta = readSupplierMeta;
exports.upsertSupplierMeta = upsertSupplierMeta;
exports.getSupplierMetaFor = getSupplierMetaFor;
exports.readSupplierPayments = readSupplierPayments;
exports.addSupplierPayment = addSupplierPayment;
exports.getPaymentsForPurchase = getPaymentsForPurchase;
exports.readSuppliers = readSuppliers;
exports.writeSuppliers = writeSuppliers;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const META_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/supplierPurchases.json");
const PAYMENTS_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/supplierPurchasePayments.json");
const SUPPLIERS_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/suppliers.json");
let cache = null;
let flushTimer = null;
const FLUSH_DELAY_MS = 500;
let paymentsCache = null;
let paymentsFlushTimer = null;
function ensureDir() {
    const dir = node_path_1.default.dirname(META_PATH);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
}
function readSupplierMeta() {
    try {
        if (cache)
            return cache;
        if (!node_fs_1.default.existsSync(META_PATH)) {
            cache = [];
            return cache;
        }
        const raw = node_fs_1.default.readFileSync(META_PATH, "utf-8");
        const data = JSON.parse(raw);
        cache = Array.isArray(data) ? data : [];
        return cache;
    }
    catch {
        cache = [];
        return cache;
    }
}
function writeSupplierMeta(next) {
    cache = next;
    ensureDir();
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        try {
            node_fs_1.default.writeFileSync(META_PATH, JSON.stringify(next, null, 2), "utf-8");
        }
        catch {
            // ignore
        }
    }, FLUSH_DELAY_MS);
}
function upsertSupplierMeta(entry) {
    const list = readSupplierMeta();
    const map = new Map(list.map((e) => [e.purchaseId, e]));
    const prev = map.get(entry.purchaseId);
    const next = {
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
function getSupplierMetaFor(purchaseId) {
    const list = readSupplierMeta();
    return list.find((e) => e.purchaseId === purchaseId);
}
// Payments helpers
function readSupplierPayments() {
    try {
        if (paymentsCache)
            return paymentsCache;
        ensureDir();
        if (!node_fs_1.default.existsSync(PAYMENTS_PATH)) {
            paymentsCache = [];
            return paymentsCache;
        }
        const raw = node_fs_1.default.readFileSync(PAYMENTS_PATH, "utf-8");
        const data = JSON.parse(raw);
        paymentsCache = Array.isArray(data) ? data : [];
        return paymentsCache;
    }
    catch {
        paymentsCache = [];
        return paymentsCache;
    }
}
function writeSupplierPayments(next) {
    paymentsCache = next;
    ensureDir();
    if (paymentsFlushTimer)
        clearTimeout(paymentsFlushTimer);
    paymentsFlushTimer = setTimeout(() => {
        try {
            node_fs_1.default.writeFileSync(PAYMENTS_PATH, JSON.stringify(next, null, 2), "utf-8");
        }
        catch {
            // ignore
        }
    }, FLUSH_DELAY_MS);
}
function addSupplierPayment(entry) {
    const list = readSupplierPayments();
    const next = [...list, entry];
    writeSupplierPayments(next);
    return entry;
}
function getPaymentsForPurchase(purchaseId) {
    const list = readSupplierPayments();
    return list.filter((p) => p.purchaseId === purchaseId);
}
function readSuppliers() {
    try {
        ensureDir();
        if (!node_fs_1.default.existsSync(SUPPLIERS_PATH))
            return [];
        const raw = node_fs_1.default.readFileSync(SUPPLIERS_PATH, "utf-8");
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    }
    catch {
        return [];
    }
}
function writeSuppliers(next) {
    try {
        ensureDir();
        node_fs_1.default.writeFileSync(SUPPLIERS_PATH, JSON.stringify(next, null, 2), "utf-8");
    }
    catch {
        // ignore
    }
}
