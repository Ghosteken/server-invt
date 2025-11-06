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
exports.importStoresBranches = exports.upload = exports.getStoreBranchSales = exports.getStores = void 0;
const client_1 = require("@prisma/client");
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const storeService_1 = require("../services/storeService");
const prisma = new client_1.PrismaClient();
// Fallback defaults if no JSON exists
const DEFAULT_STORE_CONFIG = {
    blenco: ["Blenco Lekki", "Blenco Ikeja", "Blenco Ajah"],
    spar: ["Spar Victoria Island", "Spar Ikeja", "Spar Ilupeju"],
};
const getStores = async (_req, res) => {
    try {
        const data = (0, storeService_1.readStores)();
        const stores = data.stores.length
            ? data.stores
            : Object.entries(DEFAULT_STORE_CONFIG).map(([store, branches]) => ({ store, branches }));
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
        const store = String(req.query.store || "").toLowerCase();
        const branch = String(req.query.branch || "");
        if (!store || !branch) {
            res.status(400).json({ message: "Missing store or branch" });
            return;
        }
        const data = (0, storeService_1.readStores)();
        const map = new Map(data.stores.map((s) => [s.store.toLowerCase(), s.branches]));
        const branches = map.get(store) || DEFAULT_STORE_CONFIG[store] || [];
        if (!branches.includes(branch)) {
            res.status(404).json({ message: "Unknown branch for store" });
            return;
        }
        // Find the customer that matches this branch name
        const customer = await prisma.customers.findFirst({ where: { name: branch } });
        if (!customer) {
            res.json({ sales: [] });
            return;
        }
        const purchases = await prisma.customerPurchases.findMany({
            where: { customerId: customer.customerId },
            orderBy: { timestamp: "desc" },
        });
        const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
        const products = await prisma.products.findMany({
            where: { productId: { in: productIds } },
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
            const store = String(storeRaw).trim().toLowerCase();
            const branch = String(branchRaw).trim();
            const set = grouped.get(store) || new Set();
            set.add(branch);
            grouped.set(store, set);
        }
        const stores = Array.from(grouped.entries()).map(([store, set]) => ({ store, branches: Array.from(set.values()) }));
        (0, storeService_1.writeStores)({ stores });
        res.json({ importedStores: stores.length });
    }
    catch (err) {
        console.error("importStoresBranches error:", err);
        res.status(500).json({ message: "Failed to import stores/branches" });
    }
};
exports.importStoresBranches = importStoresBranches;
