"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeEmptyProductsJson = writeEmptyProductsJson;
exports.writeEmptyImportedProductsJson = writeEmptyImportedProductsJson;
exports.syncProductsJsonFromDb = syncProductsJsonFromDb;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const seedDir = path_1.default.join(__dirname, "../../prisma/seedData");
const productsJsonPath = path_1.default.join(seedDir, "products.json");
const importedProductsJsonPath = path_1.default.join(seedDir, "importedProducts.json");
function ensureSeedDir() {
    if (!fs_1.default.existsSync(seedDir))
        fs_1.default.mkdirSync(seedDir, { recursive: true });
}
function writeEmptyProductsJson() {
    try {
        ensureSeedDir();
        fs_1.default.writeFileSync(productsJsonPath, "[]", "utf-8");
    }
    catch (e) {
        console.warn("writeEmptyProductsJson failed:", e);
    }
}
function writeEmptyImportedProductsJson() {
    try {
        ensureSeedDir();
        fs_1.default.writeFileSync(importedProductsJsonPath, "[]", "utf-8");
    }
    catch (e) {
        console.warn("writeEmptyImportedProductsJson failed:", e);
    }
}
async function syncProductsJsonFromDb(prisma) {
    try {
        ensureSeedDir();
        const products = await prisma.products.findMany({
            orderBy: { name: "asc" },
            select: { productId: true, name: true, price: true, stockQuantity: true, category: true, packSize: true, barcode: true },
        });
        fs_1.default.writeFileSync(productsJsonPath, JSON.stringify(products, null, 2), "utf-8");
    }
    catch (e) {
        console.warn("syncProductsJsonFromDb failed:", e);
    }
}
