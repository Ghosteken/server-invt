"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adjustPcsQuantity = exports.reloadPcsInventory = exports.upsertPcsEntries = exports.readPcsInventory = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
// In-memory cache to avoid repeated disk I/O
let pcsCache = null;
let flushTimer = null;
const FLUSH_DELAY_MS = 500; // debounce disk writes
const PCS_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/pcsInventory.json");
const readPcsInventory = () => {
    try {
        if (pcsCache)
            return pcsCache;
        if (!node_fs_1.default.existsSync(PCS_PATH)) {
            pcsCache = [];
            return pcsCache;
        }
        const data = JSON.parse(node_fs_1.default.readFileSync(PCS_PATH, "utf-8"));
        if (!Array.isArray(data)) {
            pcsCache = [];
            return pcsCache;
        }
        pcsCache = data.map((e) => ({
            name: String(e.name || "").trim(),
            quantity: Math.max(0, Number(e.quantity) || 0),
            productId: e.productId ?? null,
            packSize: e.packSize ?? null,
        }));
        return pcsCache;
    }
    catch {
        pcsCache = [];
        return pcsCache;
    }
};
exports.readPcsInventory = readPcsInventory;
const writePcsInventory = (entries) => {
    pcsCache = entries;
    const dir = node_path_1.default.dirname(PCS_PATH);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    // Debounced flush to disk to reduce thrashing
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        try {
            node_fs_1.default.writeFileSync(PCS_PATH, JSON.stringify(entries, null, 2), "utf-8");
        }
        catch {
            // swallow
        }
    }, FLUSH_DELAY_MS);
};
const upsertPcsEntries = (incoming) => {
    const existing = (0, exports.readPcsInventory)();
    const map = new Map();
    for (const e of existing) {
        map.set(e.name.toLowerCase(), { ...e });
    }
    for (const inc of incoming) {
        const key = inc.name.toLowerCase();
        const prev = map.get(key);
        const nextQty = Math.max(0, Number(inc.quantity) || 0);
        map.set(key, {
            name: inc.name,
            quantity: nextQty,
            productId: prev?.productId ?? null,
            packSize: inc.packSize ?? prev?.packSize ?? null,
        });
    }
    const merged = Array.from(map.values());
    writePcsInventory(merged);
    return merged;
};
exports.upsertPcsEntries = upsertPcsEntries;
// Force reloading PCS inventory from disk by clearing cache
const reloadPcsInventory = () => {
    pcsCache = null;
    return (0, exports.readPcsInventory)();
};
exports.reloadPcsInventory = reloadPcsInventory;
const adjustPcsQuantity = ({ name, delta }) => {
    const existing = (0, exports.readPcsInventory)();
    const key = name.toLowerCase();
    const map = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
    const prev = map.get(key);
    if (!prev) {
        map.set(key, { name, quantity: Math.max(0, 0 + delta), productId: null, packSize: null });
    }
    else {
        map.set(key, { ...prev, quantity: Math.max(0, (prev.quantity || 0) + delta) });
    }
    writePcsInventory(Array.from(map.values()));
};
exports.adjustPcsQuantity = adjustPcsQuantity;
