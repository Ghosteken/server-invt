"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adjustPcsQuantity = exports.upsertPcsEntries = exports.readPcsInventory = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const PCS_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/pcsInventory.json");
const readPcsInventory = () => {
    try {
        if (!node_fs_1.default.existsSync(PCS_PATH))
            return [];
        const data = JSON.parse(node_fs_1.default.readFileSync(PCS_PATH, "utf-8"));
        if (!Array.isArray(data))
            return [];
        return data.map((e) => ({
            name: String(e.name || "").trim(),
            quantity: Math.max(0, Number(e.quantity) || 0),
            productId: e.productId ?? null,
            packSize: e.packSize ?? null,
        }));
    }
    catch {
        return [];
    }
};
exports.readPcsInventory = readPcsInventory;
const writePcsInventory = (entries) => {
    const dir = node_path_1.default.dirname(PCS_PATH);
    if (!node_fs_1.default.existsSync(dir))
        node_fs_1.default.mkdirSync(dir, { recursive: true });
    node_fs_1.default.writeFileSync(PCS_PATH, JSON.stringify(entries, null, 2), "utf-8");
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
