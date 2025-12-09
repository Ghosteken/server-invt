"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importStoresBranchesSample = exports.importStoresBranches = exports.upload = exports.getStoreBranchSales = exports.getStores = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const storeService_1 = require("../services/storeService");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
// Use shared Prisma client
// Canonical store chains to present in UI
const CANONICAL_CHAINS = [
    { name: "WINNIE", token: "winnie" },
    { name: "UBA", token: "uba" },
    { name: "TWINS", token: "twins" },
    { name: "SHOPPERS", token: "shoppers" },
    { name: "SAHAD", token: "sahad" },
    { name: "RYTE", token: "ryte" },
    { name: "QMB", token: "qmb" },
    { name: "OZZY STORE", token: "ozzy" },
    { name: "LIZZY STORE", token: "lizzy" },
    { name: "HOSTS SUPERMARKET", token: "hosts" },
    { name: "HEALTHRITE", token: "healthrite" },
    { name: "GLOBUS SUPERMARKET", token: "globus" },
    { name: "GLAMOUR SUPERMARKET", token: "glamour" },
    { name: "CITY SUPERMARKET", token: "city" },
    // Prefer short, deduped display names for duplicates
    { name: "BLENCO", token: "blenco" },
    { name: "TEMPLE", token: "temple" },
    { name: "MEGA", token: "mega" },
    { name: "MANO", token: "mano" },
    { name: "JENDOL", token: "jendol" },
    { name: "HYPERCITY", token: "hypercity" },
    { name: "HUTOOS SUPERMARKET", token: "hutoos" },
    { name: "GRAND", token: "grand" },
    { name: "DELIGHT", token: "delight" },
    { name: "AMAGZY", token: "amagzy" },
    { name: "PRINCE", token: "prince" },
    { name: "SHOPRITE", token: "shoprite" },
    { name: "GLOBUS", token: "globus" },
    { name: "SUPERSAVER", token: "supersaver" },
    { name: "SPAR", token: "spar" },
    { name: "JUSTRITE", token: "justrite" },
];
// Map common display names to canonical tokens to collapse duplicates
const NAME_TO_TOKEN = {
    "BLENCO": "blenco",
    "BLENCO SUPERMARKET": "blenco",
    "GLOBUS": "globus",
    "GLOBUS SUPERMARKET": "globus",
    "JENDOL": "jendol",
    "JENDOL SUPERMARKET": "jendol",
    "JENDOL SUPERSTORE": "jendol",
    "PRINCE": "prince",
    "PRINCE SUPERMARKET": "prince",
    "SHOPRITE": "shoprite",
    "SUPERSAVER": "supersaver",
    "SPAR": "spar",
    "JUSTRITE": "justrite",
};
const PRIMARY_DISPLAY_BY_TOKEN = {
    blenco: "BLENCO",
    globus: "GLOBUS",
    jendol: "JENDOL",
    prince: "PRINCE",
    shoprite: "SHOPRITE",
    supersaver: "SUPERSAVER",
    spar: "SPAR",
    justrite: "JUSTRITE",
    winnie: "WINNIE",
    uba: "UBA",
    twins: "TWINS",
    shoppers: "SHOPPERS",
    sahad: "SAHAD",
    ryte: "RYTE",
    qmb: "QMB",
    ozzy: "OZZY STORE",
    lizzy: "LIZZY STORE",
    hosts: "HOSTS SUPERMARKET",
    healthrite: "HEALTHRITE",
    glamour: "GLAMOUR SUPERMARKET",
    city: "CITY SUPERMARKET",
    temple: "TEMPLE",
    mega: "MEGA",
    mano: "MANO",
    hypercity: "HYPERCITY",
    hutoos: "HUTOOS",
    grand: "GRAND",
    delight: "DELIGHT",
    amagzy: "AMAGZY",
};
function normalizeStoreTokenFromName(name) {
    const trimmed = String(name || "").trim();
    const upper = trimmed.toUpperCase();
    if (NAME_TO_TOKEN[upper])
        return NAME_TO_TOKEN[upper];
    let lower = trimmed.toLowerCase();
    // Remove common suffixes
    lower = lower.replace(/\b(supermarket|superstore|market)\b/g, "").trim();
    // Pick token by substring match
    const tokens = Object.keys(PRIMARY_DISPLAY_BY_TOKEN);
    for (const t of tokens) {
        if (lower.includes(t))
            return t;
    }
    return lower; // fallback
}
function aggregateBranchesByToken(token) {
    const data = (0, storeService_1.readStores)();
    const tokenLc = token.toLowerCase();
    const branchesSet = new Set();
    for (const entry of data.stores) {
        const nameLc = String(entry.store).toLowerCase();
        if (nameLc.includes(tokenLc)) {
            for (const b of entry.branches || []) {
                const bb = String(b).trim();
                if (bb)
                    branchesSet.add(bb);
            }
            // Optionally add the entry.store itself when it looks like a branch location variant
            // e.g., "blenco lekki" should count as a branch under BLENCO
            if (nameLc !== tokenLc && /\s/.test(nameLc)) {
                branchesSet.add(entry.store.toUpperCase());
            }
        }
    }
    return Array.from(branchesSet.values());
}
const getStores = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const customers = await prisma_1.default.customers.findMany({ where: { tenantId }, select: { name: true } });
        const grouped = new Map();
        for (const c of customers) {
            const branch = String(c.name || '').trim();
            if (!branch)
                continue;
            const token = normalizeStoreTokenFromName(branch);
            const set = grouped.get(token) || new Set();
            set.add(branch);
            grouped.set(token, set);
        }
        const tokens = Array.from(grouped.keys());
        const stores = tokens.map((token) => ({
            store: PRIMARY_DISPLAY_BY_TOKEN[token] || token.toUpperCase(),
            branches: Array.from((grouped.get(token) || new Set()).values()),
        }));
        res.json({ stores });
    }
    catch (err) {
        console.error("getStores error:", err);
        res.status(500).json({ message: "Failed to load stores" });
    }
};
exports.getStores = getStores;
const getStoreBranchSales = async (req, res) => {
    try {
        const store = String(req.query.store || "");
        const branch = String(req.query.branch || "");
        if (!store || !branch) {
            res.status(400).json({ message: "Missing store or branch" });
            return;
        }
        // Find canonical token by matching provided store name (case-insensitive)
        const token = (CANONICAL_CHAINS.find((c) => c.name.toLowerCase() === store.toLowerCase())?.token) || store.toLowerCase();
        // Find the customer that matches this branch name
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const customer = await prisma_1.default.customers.findFirst({ where: { tenantId, name: branch } });
        if (!customer) {
            res.json({ sales: [] });
            return;
        }
        const purchases = await prisma_1.default.customerPurchases.findMany({
            where: { tenantId, customerId: customer.customerId },
            orderBy: { timestamp: "desc" },
        });
        const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
        const products = await prisma_1.default.products.findMany({
            where: { tenantId, productId: { in: productIds } },
            select: { productId: true, name: true, expiryDate: true },
        });
        const productMap = new Map(products.map((p) => [p.productId, p]));
        const sales = purchases.map((p) => ({
            id: p.id,
            productId: p.productId,
            productName: productMap.get(p.productId)?.name || undefined,
            quantity: p.quantity,
            expiryDate: productMap.get(p.productId)?.expiryDate || null,
            timestamp: p.timestamp,
        }));
        res.json({ sales });
    }
    catch (err) {
        console.error("getStoreBranchSales error:", err);
        res.status(500).json({ message: "Failed to load store branch sales" });
    }
};
exports.getStoreBranchSales = getStoreBranchSales;
// Multer instance used by routes file
exports.upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
const importStoresBranches = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        const normalizeKey = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        const grouped = new Map();
        for (const row of rows) {
            const kv = {};
            for (const k of Object.keys(row)) {
                kv[normalizeKey(k)] = row[k];
            }
            const storeRaw = kv["store"] ?? kv["chain"] ?? kv["market"];
            const branchRaw = kv["branch"] ?? kv["location"] ?? kv["name"];
            if (!storeRaw || !branchRaw)
                continue;
            const store = normalizeStoreTokenFromName(String(storeRaw));
            const branch = String(branchRaw).trim();
            const set = grouped.get(store) || new Set();
            set.add(branch);
            grouped.set(store, set);
        }
        const stores = Array.from(grouped.entries()).map(([token, set]) => ({ store: token, branches: Array.from(set.values()) }));
        (0, storeService_1.writeStores)({ stores });
        res.json({ importedStores: stores.length });
    }
    catch (err) {
        console.error("importStoresBranches error:", err);
        res.status(500).json({ message: "Failed to import stores/branches" });
    }
};
exports.importStoresBranches = importStoresBranches;
/**
 * Import stores and branches from server sample Customers1.xlsx.
 * Assumes sheet lists store names each followed by its branches, then unmatched customers.
 */
const importStoresBranchesSample = async (_req, res) => {
    try {
        const samplePath = node_path_1.default.join(__dirname, "../../assets/Customers1.xlsx");
        if (!node_fs_1.default.existsSync(samplePath)) {
            res.status(404).json({ message: "Sample Customers1.xlsx not found" });
            return;
        }
        const buffer = node_fs_1.default.readFileSync(samplePath);
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const ws = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const grouped = new Map();
        let currentToken = null;
        const toText = (v) => (v == null ? "" : String(v).trim());
        for (const row of rows) {
            const cell = toText(row[0]);
            if (!cell)
                continue;
            const isLikelyStore = /^[A-Z][A-Za-z0-9\s&.'()-]+$/.test(cell) && cell.split(" ").length <= 3;
            // Heuristic: a branch often contains a location with spaces and is not all uppercase single token
            const isLikelyBranch = !isLikelyStore && /[A-Za-z]/.test(cell);
            if (isLikelyStore) {
                currentToken = normalizeStoreTokenFromName(cell);
                if (!grouped.has(currentToken))
                    grouped.set(currentToken, new Set());
                continue;
            }
            if (isLikelyBranch && currentToken) {
                grouped.get(currentToken).add(cell);
                continue;
            }
            // If neither, we may have reached unmatched customers; stop parsing
            if (currentToken && !isLikelyBranch && !isLikelyStore) {
                break;
            }
        }
        const stores = Array.from(grouped.entries()).map(([token, set]) => ({ store: token, branches: Array.from(set.values()) }));
        if (stores.length) {
            (0, storeService_1.writeStores)({ stores });
            res.json({ importedStores: stores.length });
        }
        else {
            res.status(400).json({ message: "No stores parsed from sample" });
        }
    }
    catch (err) {
        console.error("importStoresBranchesSample error:", err);
        res.status(500).json({ message: "Failed to import stores/branches from sample" });
    }
};
exports.importStoresBranchesSample = importStoresBranchesSample;
