"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adjustPcsQuantity = exports.reloadPcsInventory = exports.upsertPcsEntries = exports.readPcsInventory = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const readPcsInventory = async (tenantId = "default") => {
    try {
        const rows = await prisma_1.default.pcsInventory.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        return rows.map((r) => ({ name: r.name, quantity: r.quantity, productId: r.productId ?? null, packSize: r.packSize ?? null, tenantId: r.tenantId }));
    }
    catch {
        try {
            const jsonPath = node_path_1.default.join(__dirname, "../../prisma/seedData/pcsInventory.json");
            if (!node_fs_1.default.existsSync(jsonPath))
                return [];
            const raw = node_fs_1.default.readFileSync(jsonPath, "utf-8");
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr))
                return [];
            return arr.map((e) => ({
                name: String(e?.name || "").trim(),
                quantity: Math.max(0, Number(e?.quantity) || 0),
                productId: e?.productId ?? null,
                packSize: e?.packSize ?? null,
                tenantId,
            }));
        }
        catch {
            return [];
        }
    }
};
exports.readPcsInventory = readPcsInventory;
const upsertPcsEntries = async (incoming, tenantId = "default") => {
    const existing = await (0, exports.readPcsInventory)(tenantId);
    const map = new Map();
    for (const e of existing)
        map.set(e.name.toLowerCase(), { ...e });
    for (const inc of incoming) {
        const key = inc.name.toLowerCase();
        const prev = map.get(key);
        const nextQty = Math.max(0, Number(inc.quantity) || 0);
        const next = { name: inc.name, quantity: nextQty, productId: prev?.productId ?? null, packSize: inc.packSize ?? prev?.packSize ?? null, tenantId };
        map.set(key, next);
        await prisma_1.default.pcsInventory.upsert({
            where: { tenantId_name: { tenantId, name: inc.name } },
            create: { id: cryptoRandom(), tenantId, name: inc.name, quantity: nextQty, productId: next.productId ?? null, packSize: next.packSize ?? null },
            update: { quantity: nextQty, packSize: next.packSize ?? null },
        });
    }
    return Array.from(map.values());
};
exports.upsertPcsEntries = upsertPcsEntries;
// Force reloading PCS inventory from disk by clearing cache
const reloadPcsInventory = async (tenantId = "default") => {
    return (0, exports.readPcsInventory)(tenantId);
};
exports.reloadPcsInventory = reloadPcsInventory;
const adjustPcsQuantity = async ({ name, delta, tenantId = "default" }) => {
    const prev = await prisma_1.default.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name } } });
    const nextQty = Math.max(0, (prev?.quantity || 0) + delta);
    await prisma_1.default.pcsInventory.upsert({
        where: { tenantId_name: { tenantId, name } },
        create: { id: cryptoRandom(), tenantId, name, quantity: nextQty },
        update: { quantity: nextQty },
    });
};
exports.adjustPcsQuantity = adjustPcsQuantity;
function cryptoRandom() {
    try {
        const { randomUUID } = require("crypto");
        return randomUUID();
    }
    catch {
        return Math.random().toString(36).slice(2);
    }
}
