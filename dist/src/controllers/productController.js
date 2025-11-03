"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getImportSample = exports.importProducts = exports.exportProducts = exports.updateProduct = exports.getProductById = exports.createProduct = exports.getProducts = void 0;
const client_1 = require("@prisma/client");
const notificationService_1 = require("../services/notificationService");
const xlsx_1 = __importDefault(require("xlsx"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const crypto_1 = require("crypto");
const prisma = new client_1.PrismaClient();
const getProducts = async (req, res) => {
    try {
        const rawSearch = req.query.search?.toString() ?? "";
        const search = rawSearch.trim();
        // If a search term is provided, perform a case-insensitive contains match.
        // If no search term, return all products.
        const products = await prisma.products.findMany({
            where: search
                ? {
                    name: {
                        contains: search,
                        mode: "insensitive",
                    },
                }
                : undefined,
            orderBy: {
                name: "asc",
            },
        });
        res.json(products);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving products" });
    }
};
exports.getProducts = getProducts;
const createProduct = async (req, res) => {
    try {
        const { name, price, stockQuantity } = req.body;
        const product = await prisma.products.create({
            data: {
                productId: (0, crypto_1.randomUUID)(),
                name,
                price,
                stockQuantity,
            },
        });
        // Log notification for product creation
        (0, notificationService_1.appendNotification)({
            type: "product",
            message: `Product created: ${name} (qty: ${stockQuantity})`,
            actorUserId: req.user?.userId,
        });
        res.status(201).json(product);
    }
    catch (error) {
        res.status(500).json({ message: "Error creating product" });
    }
};
exports.createProduct = createProduct;
const getProductById = async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await prisma.products.findUnique({ where: { productId } });
        if (!product) {
            res.status(404).json({ message: "Product not found" });
            return;
        }
        res.json(product);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving product" });
    }
};
exports.getProductById = getProductById;
const updateProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const { name, price, stockQuantity, expiryDate } = req.body;
        const existing = await prisma.products.findUnique({ where: { productId } });
        if (!existing) {
            res.status(404).json({ message: "Product not found" });
            return;
        }
        const data = {};
        if (typeof name === "string")
            data.name = name;
        if (price !== undefined && price !== null && !isNaN(Number(price)))
            data.price = Number(price);
        if (stockQuantity !== undefined && stockQuantity !== null && !isNaN(Number(stockQuantity)))
            data.stockQuantity = Number(stockQuantity);
        if (expiryDate !== undefined) {
            if (expiryDate === null || expiryDate === "") {
                data.expiryDate = null;
            }
            else {
                const d = new Date(expiryDate);
                if (isNaN(d.getTime())) {
                    res.status(400).json({ message: "Invalid expiryDate" });
                    return;
                }
                data.expiryDate = d;
            }
        }
        const updated = await prisma.products.update({ where: { productId }, data });
        (0, notificationService_1.appendNotification)({
            type: "product",
            message: `Product updated: ${updated.name}`,
            actorUserId: req.user?.userId,
        });
        res.json(updated);
    }
    catch (error) {
        console.error("updateProduct error:", error);
        res.status(500).json({ message: "Error updating product" });
    }
};
exports.updateProduct = updateProduct;
const exportProducts = async (req, res) => {
    try {
        const products = await prisma.products.findMany({ orderBy: { name: "asc" } });
        const json = JSON.stringify(products, null, 2);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", "attachment; filename=products.json");
        res.status(200).send(json);
    }
    catch (error) {
        console.error("exportProducts error:", error);
        res.status(500).json({ message: "Failed to export products" });
    }
};
exports.exportProducts = exportProducts;
/**
 * Bulk import products from an uploaded Excel file.
 * Accepts a single file under field name "file". The Excel sheet should contain
 * columns that map to product fields. Supported column headers (case-insensitive):
 * - productId | id | sku (optional; if missing, a UUID is generated)
 * - name (required)
 * - price (required)
 * - rating (optional)
 * - stockQuantity | quantity (required)
 */
const importProducts = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
            return;
        }
        // Parse Excel buffer
        const workbook = xlsx_1.default.read(file.buffer, { type: "buffer" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = xlsx_1.default.utils.sheet_to_json(worksheet, { defval: null });
        if (!rows.length) {
            res.status(400).json({ message: "Uploaded sheet is empty." });
            return;
        }
        // Normalize header keys to lower-case for flexible matching
        const normalizeKey = (k) => k.toString().trim().toLowerCase();
        const productsToInsert = rows
            .map((row) => {
            const keys = Object.keys(row);
            const kv = {};
            for (const k of keys)
                kv[normalizeKey(k)] = row[k];
            const productId = kv["productid"] ?? kv["id"] ?? kv["sku"] ?? (0, crypto_1.randomUUID)();
            const name = kv["name"];
            const priceRaw = kv["price"];
            const stockRaw = kv["stockquantity"] ?? kv["quantity"];
            // Basic validation
            if (!name || priceRaw === null || priceRaw === undefined || stockRaw === null || stockRaw === undefined) {
                return null; // skip invalid rows
            }
            const price = typeof priceRaw === "string" ? parseFloat(priceRaw) : Number(priceRaw);
            const stockQuantity = typeof stockRaw === "string" ? parseInt(stockRaw, 10) : Number(stockRaw);
            if (!isFinite(price) || !Number.isFinite(stockQuantity)) {
                return null;
            }
            return {
                productId: String(productId),
                name: String(name),
                price,
                stockQuantity,
            };
        })
            .filter(Boolean);
        if (!productsToInsert.length) {
            res.status(400).json({ message: "No valid product rows found in the sheet." });
            return;
        }
        // Bulk insert; skip duplicates by primary key (productId)
        const result = await prisma.products.createMany({
            data: productsToInsert,
            skipDuplicates: true,
        });
        // Persist imported products to JSON file for audit and optional future seeding
        try {
            const seedDir = node_path_1.default.join(__dirname, "../../prisma/seedData");
            const outPath = node_path_1.default.join(seedDir, "importedProducts.json");
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
                if (item && item.productId)
                    map.set(String(item.productId), item);
            }
            for (const item of productsToInsert) {
                map.set(item.productId, {
                    productId: item.productId,
                    name: item.name,
                    price: item.price,
                    stockQuantity: item.stockQuantity,
                });
            }
            const merged = Array.from(map.values());
            node_fs_1.default.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
        }
        catch (persistErr) {
            console.warn("Failed to persist imported products to JSON:", persistErr);
        }
        (0, notificationService_1.appendNotification)({
            type: "product",
            message: `Imported ${result.count} products from Excel`,
            actorUserId: req.user?.userId,
        });
        res.status(201).json({ insertedCount: result.count, attempted: productsToInsert.length });
    }
    catch (error) {
        console.error("importProducts error:", error);
        res.status(500).json({ message: "Error importing products" });
    }
};
exports.importProducts = importProducts;
/**
 * Generate and send a sample Excel file for inventory import testing.
 */
const getImportSample = async (req, res) => {
    try {
        const sampleRows = [
            { name: "Sample Widget", price: 12.99, quantity: 50 },
            { name: "Sample Gadget", price: 5.5, quantity: 200 },
            { name: "Example Item", price: 99.0, quantity: 10 },
        ];
        const wb = xlsx_1.default.utils.book_new();
        const ws = xlsx_1.default.utils.json_to_sheet(sampleRows, { skipHeader: false });
        xlsx_1.default.utils.book_append_sheet(wb, ws, "Inventory");
        const buffer = xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=sample-inventory.xlsx");
        res.status(200).send(buffer);
    }
    catch (err) {
        console.error("getImportSample error:", err);
        res.status(500).json({ message: "Failed to generate sample file" });
    }
};
exports.getImportSample = getImportSample;
