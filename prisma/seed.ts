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
  const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
  const isDestructive = (process.env.SEED_DESTRUCTIVE || "").toLowerCase() === "true";

  // Create order: parents before children
  // By default, DO NOT reseed Products to avoid overwriting imported or live data.
  // To force seeding products, set SEED_PRODUCTS=true in environment.
  const seedProducts = (process.env.SEED_PRODUCTS || "").toLowerCase() === "true";
  const createOrder = [
    // Ensure products exist before any FKs reference them
    seedProducts ? "products.json" : undefined,
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

  // Only perform destructive deletes if explicitly allowed
  if (isDestructive) {
    await deleteAllData(deleteOrder);
  } else {
    console.log("Seed is non-destructive: skipping deleteMany on existing tables");
  }

  // If we have imported products, upsert them FIRST to satisfy FK constraints in sales/purchases
  if (seedProducts) {
    try {
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
                stockQuantity: Number(item.stockQuantity ?? 0),
                expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
              },
              create: {
                productId: String(item.productId),
                name: String(item.name),
                price: Number(item.price),
                stockQuantity: Number(item.stockQuantity ?? 0),
                expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
              },
            });
          } catch (e) {
            console.warn("Seed upsert imported product failed:", e);
          }
        }
        console.log("Pre-seeded importedProducts.json into Products table");
      } else {
        console.log("No importedProducts.json present; skipping pre-seed for products");
      }
    } catch (e) {
      console.warn("Failed pre-seeding imported products:", e);
    }
  }

  for (const fileName of createOrder) {
    const filePath = path.join(dataDirectory, fileName);
    if (!fs.existsSync(filePath)) {
      console.warn(`Seed file missing, skipping: ${fileName}`);
      continue;
    }
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

      // Use upsert for products to avoid duplicates and ensure FK readiness
      if (clientModelName.toLowerCase() === "products") {
        await prisma.products.upsert({
          where: { productId: String(data.productId) },
          update: {
            name: String(data.name),
            price: Number(data.price),
            stockQuantity: Number(data.stockQuantity ?? 0),
          },
          create: {
            productId: String(data.productId),
            name: String(data.name),
            price: Number(data.price),
            stockQuantity: Number(data.stockQuantity ?? 0),
          },
        });
      } else {
        // Guard foreign keys for sales/purchases; optionally allow dev-only stubs
        const allowStubs = !isProduction && (process.env.SEED_ALLOW_STUBS || "").toLowerCase() === "true";
        const lowerModel = clientModelName.toLowerCase();
        if ((lowerModel === "sales" || lowerModel === "purchases") && data.productId) {
          const pid = String(data.productId);
          const exists = await prisma.products.findUnique({ where: { productId: pid } });
          if (!exists) {
            if (allowStubs) {
              const name = String(data.name || `Unknown Product ${pid}`);
              const price = Number(data.unitPrice ?? 0) || 0;
              try {
                await prisma.products.upsert({
                  where: { productId: pid },
                  update: { name, price, stockQuantity: 0 },
                  create: { productId: pid, name, price, stockQuantity: 0 },
                });
                console.warn("[seed] Created stub product for missing", lowerModel, "productId:", pid);
              } catch (e) {
                console.warn("[seed] Failed to create stub product for", lowerModel, "productId", pid, e);
              }
            } else {
              console.warn(`Skipping ${lowerModel} with missing productId ${pid} (SEED_ALLOW_STUBS=false)`);
              continue;
            }
          }
        }
        await model.create({ data });
      }
    }
    console.log(`Seeded ${clientModelName} with data from ${fileName}`);
  }

  // If SEED_PRODUCTS=true, products.json has already been seeded via createOrder.
  // Still optionally merge any importedProducts.json into DB if present.
  if (seedProducts) {
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
