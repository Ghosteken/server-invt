import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

async function deleteAllData(orderedFileNames: string[]) {
  // Prisma client properties are lowercased model names (e.g., `products`, `users`).
  const clientModelNames = orderedFileNames.map((fileName) => {
    return path.basename(fileName, path.extname(fileName));
  });

  for (const clientModelName of clientModelNames) {
    const model: any = (prisma as any)[clientModelName];
    if (model) {
      await model.deleteMany({});
      console.log(`Cleared data from ${clientModelName}`);
    } else {
      console.error(
        `Model ${clientModelName} not found. Please ensure the model name is correctly specified.`
      );
    }
  }
}

async function main() {
  const dataDirectory = path.join(__dirname, "seedData");

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
  ].filter(Boolean) as string[];

  // Delete order: children before parents (reverse of create)
  const deleteOrder = [...createOrder].reverse();

  await deleteAllData(deleteOrder);

  for (const fileName of createOrder) {
    const filePath = path.join(dataDirectory, fileName);
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const clientModelName = path.basename(fileName, path.extname(fileName));
    const model: any = (prisma as any)[clientModelName];

    if (!model) {
      console.error(`No Prisma model matches the file name: ${fileName}`);
      continue;
    }

    for (const rawData of jsonData) {
      const data: any = { ...rawData };

      // If seeding users, ensure a password is present and hashed.
      if (clientModelName.toLowerCase() === "users") {
        const plain = data.password || "password"; // default password if missing
        data.password = await bcrypt.hash(String(plain), 10);
        // ensure role exists
        if (!data.role) data.role = "user";
      }

      await model.create({ data });
    }
    console.log(`Seeded ${clientModelName} with data from ${fileName}`);
  }

  // Optionally seed products if SEED_PRODUCTS=true
  if (seedProducts) {
    const productsFilePath = path.join(dataDirectory, "products.json");
    if (fs.existsSync(productsFilePath)) {
      const jsonData = JSON.parse(fs.readFileSync(productsFilePath, "utf-8"));
      // Clear existing products ONLY when explicitly seeding products
      await prisma.products.deleteMany({});
      for (const raw of jsonData) {
        const data: any = { ...raw };
        await prisma.products.create({ data });
      }
      console.log("Seeded products from products.json (SEED_PRODUCTS=true)");
    }
    // Also merge any importedProducts.json into DB if present
    const importedPath = path.join(dataDirectory, "importedProducts.json");
    if (fs.existsSync(importedPath)) {
      const imported = JSON.parse(fs.readFileSync(importedPath, "utf-8"));
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
        } catch (e) {
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
      const hashedPassword = await bcrypt.hash(String(adminPassword), 10);
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
    } else if (existingAdmin.role !== "admin") {
      const hashedPassword = await bcrypt.hash(String(adminPassword), 10);
      await prisma.users.update({
        where: { userId: existingAdmin.userId },
        data: { role: "admin", password: hashedPassword },
      });
      console.log(`Updated existing user to admin: ${adminEmail}`);
    } else {
      console.log(`Admin user already present: ${adminEmail}`);
    }
  } catch (e) {
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
