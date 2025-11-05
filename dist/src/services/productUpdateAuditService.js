"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLastFieldUpdates = exports.recordFieldUpdates = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const AUDIT_PATH = node_path_1.default.join(__dirname, "../../prisma/seedData/productFieldUpdates.json");
const normalizeField = (f) => f.toLowerCase().replace(/[^a-z]/g, "");
const recordFieldUpdates = (productId, fields, source) => {
    if (!productId || !Array.isArray(fields) || fields.length === 0)
        return;
    const entries = fields.map((f) => ({
        productId: String(productId),
        field: normalizeField(f),
        updatedAt: new Date().toISOString(),
        source,
    }));
    try {
        let existing = [];
        if (node_fs_1.default.existsSync(AUDIT_PATH)) {
            try {
                existing = JSON.parse(node_fs_1.default.readFileSync(AUDIT_PATH, "utf-8"));
            }
            catch {
                existing = [];
            }
        }
        const merged = existing.concat(entries);
        const dir = node_path_1.default.dirname(AUDIT_PATH);
        if (!node_fs_1.default.existsSync(dir))
            node_fs_1.default.mkdirSync(dir, { recursive: true });
        node_fs_1.default.writeFileSync(AUDIT_PATH, JSON.stringify(merged, null, 2), "utf-8");
    }
    catch (err) {
        // Non-fatal: logging should not break primary flows
        console.warn("Failed to record field updates:", err);
    }
};
exports.recordFieldUpdates = recordFieldUpdates;
const getLastFieldUpdates = () => {
    try {
        if (!node_fs_1.default.existsSync(AUDIT_PATH))
            return {};
        const entries = JSON.parse(node_fs_1.default.readFileSync(AUDIT_PATH, "utf-8"));
        const map = {};
        for (const e of entries) {
            if (!map[e.productId])
                map[e.productId] = {};
            const field = normalizeField(e.field);
            const prev = map[e.productId][field];
            if (!prev || new Date(e.updatedAt).getTime() > new Date(prev).getTime()) {
                map[e.productId][field] = e.updatedAt;
            }
        }
        return map;
    }
    catch {
        return {};
    }
};
exports.getLastFieldUpdates = getLastFieldUpdates;
