"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function deleteAllData(orderedFileNames) {
    // Prisma client properties are lowercased model names (e.g., `products`, `users`).
    const clientModelNames = orderedFileNames.map((fileName) => {
        return node_path_1.default.basename(fileName, node_path_1.default.extname(fileName));
    });
    for (const clientModelName of clientModelNames) {
        const model = prisma[clientModelName];
        if (model) {
            await model.deleteMany({});
            console.log(`Cleared data from ${clientModelName}`);
        }
        else {
            console.error(`Model ${clientModelName} not found. Please ensure the model name is correctly specified.`);
        }
    }
}
async function main() {
    const dataDirectory = node_path_1.default.join(__dirname, "seedData");
    // Create order: parents before children
    // By default, DO NOT reseed Products to avoid overwriting imported or live data.
    // To force seeding products, set SEED_PRODUCTS=true in environment.
    const seedProducts = (process.env.SEED_PRODUCTS || "").toLowerCase() === "true";
    const createOrder = [
        // seedProducts ? "products.json" : undefined,
        "sales.json",
        "purchases.json",
        "salesSummary.json",
        "purchaseSummary.json",
        "expenseSummary.json",
        "expenseByCategory.json",
        "expenses.json",
    ].filter(Boolean);
    // Delete order: children before parents (reverse of create)
    const deleteOrder = [...createOrder].reverse();
    await deleteAllData(deleteOrder);
    for (const fileName of createOrder) {
        const filePath = node_path_1.default.join(dataDirectory, fileName);
        const jsonData = JSON.parse(node_fs_1.default.readFileSync(filePath, "utf-8"));
        const clientModelName = node_path_1.default.basename(fileName, node_path_1.default.extname(fileName));
        const model = prisma[clientModelName];
        if (!model) {
            console.error(`No Prisma model matches the file name: ${fileName}`);
            continue;
        }
        for (const rawData of jsonData) {
            const data = { ...rawData };
            // If seeding users, ensure a password is present and hashed.
            if (clientModelName.toLowerCase() === "users") {
                const plain = data.password || "password"; // default password if missing
                data.password = await bcryptjs_1.default.hash(String(plain), 10);
                // ensure role exists
                if (!data.role)
                    data.role = "user";
            }
            await model.create({ data });
        }
        console.log(`Seeded ${clientModelName} with data from ${fileName}`);
    }
    // Optionally seed products if SEED_PRODUCTS=true
    if (seedProducts) {
        const productsFilePath = node_path_1.default.join(dataDirectory, "products.json");
        if (node_fs_1.default.existsSync(productsFilePath)) {
            const jsonData = JSON.parse(node_fs_1.default.readFileSync(productsFilePath, "utf-8"));
            // Clear existing products ONLY when explicitly seeding products
            await prisma.products.deleteMany({});
            for (const raw of jsonData) {
                const data = { ...raw };
                await prisma.products.create({ data });
            }
            console.log("Seeded products from products.json (SEED_PRODUCTS=true)");
        }
        // Also merge any importedProducts.json into DB if present
        const importedPath = node_path_1.default.join(dataDirectory, "importedProducts.json");
        if (node_fs_1.default.existsSync(importedPath)) {
            const imported = JSON.parse(node_fs_1.default.readFileSync(importedPath, "utf-8"));
            for (const item of imported) {
                try {
                    await prisma.products.upsert({
                        where: { productId: String(item.productId) },
                        update: {
                            name: String(item.name),
                            price: Number(item.price),
                            stockQuantity: Number(item.stockQuantity),
                        },
                        create: {
                            productId: String(item.productId),
                            name: String(item.name),
                            price: Number(item.price),
                            stockQuantity: Number(item.stockQuantity),
                        },
                    });
                }
                catch (e) {
                    console.warn("Seed upsert imported product failed:", e);
                }
            }
            console.log("Merged importedProducts.json into Products table");
        }
    }
    // Ensure an admin user exists AFTER seeding base data
    try {
        const adminEmail = (process.env.ADMIN_EMAIL || "admin@inventory.com").toLowerCase();
        const adminPassword = process.env.ADMIN_PASSWORD || "admin2@12ad";
        const existingAdmin = await prisma.users.findFirst({ where: { email: adminEmail } });
        if (!existingAdmin) {
            const hashedPassword = await bcryptjs_1.default.hash(String(adminPassword), 10);
            await prisma.users.create({
                data: {
                    userId: "admin-user-id-123456",
                    name: "Admin User",
                    email: adminEmail,
                    password: hashedPassword,
                    role: "admin",
                },
            });
            console.log(`Seeded admin user: ${adminEmail}`);
        }
        else if (existingAdmin.role !== "admin") {
            const hashedPassword = await bcryptjs_1.default.hash(String(adminPassword), 10);
            await prisma.users.update({
                where: { userId: existingAdmin.userId },
                data: { role: "admin", password: hashedPassword },
            });
            console.log(`Updated existing user to admin: ${adminEmail}`);
        }
        else {
            console.log(`Admin user already present: ${adminEmail}`);
        }
    }
    catch (e) {
        console.error("Failed ensuring admin user:", e);
    }
}
main()
    .catch((e) => {
    console.error(e);
})
    .finally(async () => {
    await prisma.$disconnect();
});
