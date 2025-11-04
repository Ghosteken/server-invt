import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const seedDir = path.join(__dirname, "../../prisma/seedData");
const productsJsonPath = path.join(seedDir, "products.json");
const importedProductsJsonPath = path.join(seedDir, "importedProducts.json");

function ensureSeedDir() {
  if (!fs.existsSync(seedDir)) fs.mkdirSync(seedDir, { recursive: true });
}

export function writeEmptyProductsJson() {
  try {
    ensureSeedDir();
    fs.writeFileSync(productsJsonPath, "[]", "utf-8");
  } catch (e) {
    console.warn("writeEmptyProductsJson failed:", e);
  }
}

export function writeEmptyImportedProductsJson() {
  try {
    ensureSeedDir();
    fs.writeFileSync(importedProductsJsonPath, "[]", "utf-8");
  } catch (e) {
    console.warn("writeEmptyImportedProductsJson failed:", e);
  }
}

export async function syncProductsJsonFromDb(prisma: PrismaClient) {
  try {
    ensureSeedDir();
    const products = await prisma.products.findMany({
      orderBy: { name: "asc" },
      select: { productId: true, name: true, price: true, stockQuantity: true },
    });
    fs.writeFileSync(productsJsonPath, JSON.stringify(products, null, 2), "utf-8");
  } catch (e) {
    console.warn("syncProductsJsonFromDb failed:", e);
  }
}