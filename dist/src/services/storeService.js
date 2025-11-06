"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readStores = readStores;
exports.writeStores = writeStores;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STORES_PATH = path_1.default.join(__dirname, "../../assets/stores.json");
// In-memory cache with debounced disk flush
let storesCache = null;
let flushTimer = null;
const FLUSH_DELAY_MS = 500;
function readStores() {
    try {
        if (storesCache)
            return storesCache;
        if (!fs_1.default.existsSync(STORES_PATH)) {
            storesCache = { stores: [] };
            return storesCache;
        }
        const raw = fs_1.default.readFileSync(STORES_PATH, "utf-8");
        const data = JSON.parse(raw);
        const stores = Array.isArray(data?.stores) ? data.stores : [];
        storesCache = { stores };
        return storesCache;
    }
    catch {
        storesCache = { stores: [] };
        return storesCache;
    }
}
function writeStores(payload) {
    storesCache = payload;
    const dir = path_1.default.dirname(STORES_PATH);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        try {
            fs_1.default.writeFileSync(STORES_PATH, JSON.stringify(payload, null, 2), "utf-8");
        }
        catch {
            // ignore write errors
        }
    }, FLUSH_DELAY_MS);
}
