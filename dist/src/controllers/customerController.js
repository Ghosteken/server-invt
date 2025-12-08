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
exports.exportCustomersExcel = exports.importCustomersSample = exports.importCustomers = exports.deleteCustomer = exports.updateCustomer = exports.purgeCustomerPurchases = exports.createCustomer = exports.deleteCustomerPurchase = exports.getCustomers = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const XLSX = __importStar(require("xlsx"));
const crypto_1 = require("crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const storeService_1 = require("../services/storeService");
// Use shared Prisma client
const getCustomers = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const search = String(req.query.search || "").trim();
        const where = { tenantId };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { mobile: { contains: search, mode: "insensitive" } },
                { address: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
                { state: { contains: search, mode: "insensitive" } },
                { country: { contains: search, mode: "insensitive" } },
            ];
        }
        const customers = await prisma_1.default.customers.findMany({ where, orderBy: { createdAt: "desc" } });
        // Fetch purchases grouped by customer
        const purchases = await prisma_1.default.customerPurchases.findMany({ where: { tenantId } });
        const productIds = Array.from(new Set(purchases.map(p => p.productId)));
        const products = await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } });
        const nameById = new Map(products.map(p => [p.productId, p.name]));
        const byCustomer = new Map();
        for (const p of purchases) {
            const list = byCustomer.get(p.customerId) || [];
            list.push({ id: p.id, productId: p.productId, productName: nameById.get(p.productId) || p.productId, quantity: p.quantity, totalCost: p.totalCost });
            byCustomer.set(p.customerId, list);
        }
        const result = customers.map((c) => ({
            customerId: c.customerId,
            name: c.name,
            mobile: c.mobile,
            address: c.address,
            city: c.city,
            state: c.state,
            country: c.country,
            createdAt: c.createdAt,
            purchases: byCustomer.get(c.customerId) || [],
        }));
        res.json(result);
    }
    catch (error) {
        console.error("getCustomers error:", error);
        res.status(500).json({ message: "Error retrieving customers" });
    }
};
exports.getCustomers = getCustomers;
// DELETE /customers/purchases/:id - delete a specific customer purchase (customer sale)
const deleteCustomerPurchase = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.customerPurchases.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Customer purchase not found" });
            return;
        }
        if (existing.tenantId !== tenantId) {
            res.status(404).json({ message: "Customer purchase not found" });
            return;
        }
        await prisma_1.default.customerPurchases.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error("deleteCustomerPurchase error:", error);
        res.status(500).json({ message: "Failed to delete customer purchase" });
    }
};
exports.deleteCustomerPurchase = deleteCustomerPurchase;
// POST /customers - create an individual customer
const createCustomer = async (req, res) => {
    try {
        const { name, mobile, address, city, state, country, } = req.body || {};
        const trimmedName = String(name || "").trim();
        if (!trimmedName) {
            res.status(400).json({ message: "Name is required" });
            return;
        }
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const normName = trimmedName.toLowerCase();
        const normMobile = mobile ? String(mobile).trim() : "";
        // Check duplicates by mobile or case-insensitive name
        const existing = await prisma_1.default.customers.findFirst({
            where: normMobile
                ? { tenantId, OR: [{ mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } }] }
                : { tenantId, name: { equals: normName, mode: "insensitive" } },
        });
        if (existing) {
            res.status(409).json({ message: "Customer already exists" });
            return;
        }
        const created = await prisma_1.default.customers.create({
            data: {
                customerId: (0, crypto_1.randomUUID)(),
                name: trimmedName,
                mobile: normMobile || null,
                address: address ? String(address).trim() : null,
                city: city ? String(city).trim() : null,
                state: state ? String(state).trim() : null,
                country: country ? String(country).trim() : null,
                tenantId,
            },
        });
        res.status(201).json({
            customerId: created.customerId,
            name: created.name,
            mobile: created.mobile || undefined,
            address: created.address || undefined,
            city: created.city || undefined,
            state: created.state || undefined,
            country: created.country || undefined,
            createdAt: created.createdAt,
            purchases: [],
        });
    }
    catch (error) {
        console.error("createCustomer error:", error);
        res.status(500).json({ message: "Failed to create customer" });
    }
};
exports.createCustomer = createCustomer;
const purgeCustomerPurchases = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const result = await prisma_1.default.customerPurchases.deleteMany({ where: { tenantId } });
        res.json({ message: "Purged customer purchases", deletedCount: result.count });
    }
    catch (error) {
        console.error("purgeCustomerPurchases error:", error);
        res.status(500).json({ message: "Error purging customer purchases" });
    }
};
exports.purgeCustomerPurchases = purgeCustomerPurchases;
// PUT /customers/:id - update a specific customer
const updateCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, mobile, address, city, state, country, } = req.body || {};
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.customers.findFirst({ where: { customerId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Customer not found" });
            return;
        }
        const updates = {};
        if (typeof name === "string") {
            const trimmed = name.trim();
            if (!trimmed) {
                res.status(400).json({ message: "Name cannot be empty" });
                return;
            }
            // prevent duplicate name on another record (case-insensitive)
            const dup = await prisma_1.default.customers.findFirst({
                where: { tenantId, name: { equals: trimmed.toLowerCase(), mode: "insensitive" }, NOT: { customerId: id } },
            });
            if (dup) {
                res.status(409).json({ message: "Another customer already uses this name" });
                return;
            }
            updates.name = trimmed;
        }
        if (typeof mobile === "string") {
            const mv = mobile.trim();
            if (mv) {
                const dupMobile = await prisma_1.default.customers.findFirst({ where: { tenantId, mobile: mv, NOT: { customerId: id } } });
                if (dupMobile) {
                    res.status(409).json({ message: "Another customer already uses this mobile" });
                    return;
                }
                updates.mobile = mv;
            }
            else {
                updates.mobile = null;
            }
        }
        if (typeof address === "string")
            updates.address = address.trim() || null;
        if (typeof city === "string")
            updates.city = city.trim() || null;
        if (typeof state === "string")
            updates.state = state.trim() || null;
        if (typeof country === "string")
            updates.country = country.trim() || null;
        const updated = await prisma_1.default.customers.update({ where: { customerId: id }, data: updates });
        res.json({
            customerId: updated.customerId,
            name: updated.name,
            mobile: updated.mobile || undefined,
            address: updated.address || undefined,
            city: updated.city || undefined,
            state: updated.state || undefined,
            country: updated.country || undefined,
            createdAt: updated.createdAt,
            purchases: [], // client will refetch list
        });
    }
    catch (error) {
        console.error("updateCustomer error:", error);
        res.status(500).json({ message: "Failed to update customer" });
    }
};
exports.updateCustomer = updateCustomer;
// DELETE /customers/:id - delete a customer
const deleteCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.customers.findFirst({ where: { customerId: id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Customer not found" });
            return;
        }
        // Optionally: cascade delete purchases or keep historical records.
        // Here we keep purchases history and only remove the customer record.
        await prisma_1.default.customers.delete({ where: { customerId: id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error("deleteCustomer error:", error);
        res.status(500).json({ message: "Failed to delete customer" });
    }
};
exports.deleteCustomer = deleteCustomer;
const importCustomers = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        const arrayRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        const normalizeKey = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        let created = 0;
        let updated = 0;
        let skippedExisting = 0;
        let skippedDuplicateInFile = 0;
        const importedSnapshot = [];
        const seenKeys = new Set();
        for (const row of rows) {
            const kv = {};
            for (const k of Object.keys(row))
                kv[normalizeKey(k)] = row[k];
            const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
            const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
            const address = kv["address"] ?? kv["street"];
            const city = kv["city"];
            const state = kv["state"];
            const country = kv["country"];
            const netBalanceDueRaw = kv["net balance due"] ?? kv["balance"] ?? kv["net due"];
            const netBalanceDue = (() => {
                if (netBalanceDueRaw == null)
                    return null;
                if (typeof netBalanceDueRaw === "number" && Number.isFinite(netBalanceDueRaw))
                    return netBalanceDueRaw;
                const s = String(netBalanceDueRaw);
                const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
                if (!m)
                    return null;
                const n = Number(m[0]);
                return Number.isFinite(n) ? n : null;
            })();
            if (!name)
                continue;
            const normName = String(name).trim().toLowerCase();
            const normMobile = mobile ? String(mobile).trim() : "";
            const key = normMobile ? `m:${normMobile}` : `n:${normName}`;
            if (seenKeys.has(key)) {
                skippedDuplicateInFile += 1;
                continue;
            }
            seenKeys.add(key);
            // Try to find existing by mobile first, else by name
            const existing = await prisma_1.default.customers.findFirst({
                where: normMobile
                    ? { tenantId, OR: [{ mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } }] }
                    : { tenantId, name: { equals: normName, mode: "insensitive" } },
            });
            if (existing) {
                // Skip duplicates in DB: do not update existing customers
                skippedExisting += 1;
            }
            else {
                await prisma_1.default.customers.create({
                    data: {
                        customerId: (0, crypto_1.randomUUID)(),
                        name: String(name).trim(),
                        mobile: mobile ? String(mobile).trim() : null,
                        address: address ? String(address).trim() : null,
                        city: city ? String(city).trim() : null,
                        state: state ? String(state).trim() : null,
                        country: country ? String(country).trim() : null,
                        tenantId,
                    },
                });
                created += 1;
            }
            // Collect snapshot for seed JSON (DB does not store netBalanceDue)
            importedSnapshot.push({
                name: String(name).trim(),
                mobile: mobile ? String(mobile).trim() : null,
                netBalanceDue,
            });
        }
        // Attempt to parse store/branch mapping from top rows (sample format)
        try {
            const grouped = new Map();
            let currentStore = null;
            const toText = (v) => (v == null ? "" : String(v).trim());
            for (const row of arrayRows) {
                const cell = toText(row[0]);
                if (!cell)
                    continue;
                const isLikelyStore = /^[A-Z][A-Za-z0-9\s&.'()-]+$/.test(cell) && cell.split(" ").length <= 3;
                const isLikelyBranch = !isLikelyStore && /[A-Za-z]/.test(cell);
                if (isLikelyStore) {
                    currentStore = cell.toLowerCase();
                    if (!grouped.has(currentStore))
                        grouped.set(currentStore, new Set());
                    continue;
                }
                if (isLikelyBranch && currentStore) {
                    grouped.get(currentStore).add(cell);
                    continue;
                }
                if (currentStore && !isLikelyBranch && !isLikelyStore) {
                    break;
                }
            }
            const stores = Array.from(grouped.entries()).map(([store, set]) => ({ store, branches: Array.from(set.values()) }));
            if (stores.length) {
                (0, storeService_1.writeStores)({ stores });
            }
        }
        catch (e) {
            console.warn("Skipping store/branch parsing during importCustomers:", e);
        }
        // Persist imported customers to seed JSON for audit and optional future seeding
        try {
            const seedDir = node_path_1.default.join(__dirname, "../../prisma/seedData");
            const outPath = node_path_1.default.join(seedDir, "importedCustomers.json");
            if (!node_fs_1.default.existsSync(seedDir)) {
                node_fs_1.default.mkdirSync(seedDir, { recursive: true });
            }
            let existing = [];
            if (node_fs_1.default.existsSync(outPath)) {
                try {
                    existing = JSON.parse(node_fs_1.default.readFileSync(outPath, "utf-8"));
                }
                catch {
                    existing = [];
                }
            }
            const map = new Map();
            for (const item of existing) {
                if (item && item.name)
                    map.set(String(item.name).toLowerCase(), item);
            }
            for (const item of importedSnapshot) {
                const key = String(item.name).toLowerCase();
                map.set(key, item);
            }
            const merged = Array.from(map.values());
            node_fs_1.default.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
        }
        catch (persistErr) {
            console.warn("Failed to persist imported customers to JSON:", persistErr);
        }
        res.json({ created, updated, skippedExisting, skippedDuplicateInFile });
    }
    catch (error) {
        console.error("importCustomers error:", error);
        res.status(500).json({ message: "Failed to import customers" });
    }
};
exports.importCustomers = importCustomers;
/**
 * Import customers from the server sample Excel located at assets/Customers1.xlsx
 */
const importCustomersSample = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const samplePath = node_path_1.default.join(__dirname, "../../assets/Customers1.xlsx");
        if (!node_fs_1.default.existsSync(samplePath)) {
            res.status(404).json({ message: "Sample Customers1.xlsx not found in server/assets" });
            return;
        }
        const buffer = node_fs_1.default.readFileSync(samplePath);
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        const normalizeKey = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
        let created = 0;
        let updated = 0;
        let skippedExisting = 0;
        let skippedDuplicateInFile = 0;
        const seenKeys = new Set();
        for (const row of rows) {
            const kv = {};
            for (const k of Object.keys(row))
                kv[normalizeKey(k)] = row[k];
            const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
            const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
            const address = kv["address"] ?? kv["street"];
            const city = kv["city"];
            const state = kv["state"];
            const country = kv["country"];
            if (!name)
                continue;
            const normName = String(name).trim().toLowerCase();
            const normMobile = mobile ? String(mobile).trim() : "";
            const key = normMobile ? `m:${normMobile}` : `n:${normName}`;
            if (seenKeys.has(key)) {
                skippedDuplicateInFile += 1;
                continue;
            }
            seenKeys.add(key);
            const existing = await prisma_1.default.customers.findFirst({
                where: normMobile
                    ? { tenantId, OR: [{ mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } }] }
                    : { tenantId, name: { equals: normName, mode: "insensitive" } },
            });
            if (existing) {
                // Skip duplicates in DB: do not update existing customers
                skippedExisting += 1;
            }
            else {
                await prisma_1.default.customers.create({
                    data: {
                        customerId: (0, crypto_1.randomUUID)(),
                        name: String(name).trim(),
                        mobile: mobile ? String(mobile).trim() : null,
                        address: address ? String(address).trim() : null,
                        city: city ? String(city).trim() : null,
                        state: state ? String(state).trim() : null,
                        country: country ? String(country).trim() : null,
                        tenantId,
                    },
                });
                created += 1;
            }
        }
        res.json({ created, updated, skippedExisting, skippedDuplicateInFile });
    }
    catch (error) {
        console.error("importCustomersSample error:", error);
        res.status(500).json({ message: "Failed to import customers from sample" });
    }
};
exports.importCustomersSample = importCustomersSample;
/**
 * Export customers and their purchases to an Excel workbook
 */
const exportCustomersExcel = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const customers = await prisma_1.default.customers.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        const purchases = await prisma_1.default.customerPurchases.findMany({ where: { tenantId }, orderBy: { timestamp: "desc" } });
        const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
        const products = await prisma_1.default.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } });
        const nameById = new Map(products.map((p) => [p.productId, p.name]));
        const customersSheetRows = customers.map((c) => ({
            CustomerId: c.customerId,
            Name: c.name,
            Mobile: c.mobile ?? "",
            Address: c.address ?? "",
            City: c.city ?? "",
            State: c.state ?? "",
            Country: c.country ?? "",
            CreatedAt: c.createdAt.toISOString(),
        }));
        const purchasesSheetRows = purchases.map((p) => ({
            CustomerId: p.customerId,
            CustomerName: customers.find((c) => c.customerId === p.customerId)?.name ?? "",
            ProductId: p.productId,
            ProductName: nameById.get(p.productId) ?? "",
            Quantity: p.quantity,
            UnitPrice: p.unitPrice,
            TotalCost: p.totalCost,
            Timestamp: p.timestamp.toISOString(),
        }));
        const wb = XLSX.utils.book_new();
        const wsCustomers = XLSX.utils.json_to_sheet(customersSheetRows, {
            header: ["CustomerId", "Name", "Mobile", "Address", "City", "State", "Country", "CreatedAt"],
        });
        const wsPurchases = XLSX.utils.json_to_sheet(purchasesSheetRows, {
            header: ["CustomerId", "CustomerName", "ProductId", "ProductName", "Quantity", "UnitPrice", "TotalCost", "Timestamp"],
        });
        XLSX.utils.book_append_sheet(wb, wsCustomers, "Customers");
        XLSX.utils.book_append_sheet(wb, wsPurchases, "Purchases");
        const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=customers.xlsx");
        res.status(200).send(buf);
    }
    catch (error) {
        console.error("exportCustomersExcel error:", error);
        res.status(500).json({ message: "Failed to export customers as Excel" });
    }
};
exports.exportCustomersExcel = exportCustomersExcel;
