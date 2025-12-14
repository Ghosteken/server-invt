import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
    // Seed normalized entities so dropdowns have values
    "locations.json",
    "salesAgents.json",
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
    // Also clear Stores/Branches as they are seeded outside of createOrder
    try {
      await prisma.branches.deleteMany({});
      await prisma.stores.deleteMany({});
      console.log("Cleared data from branches and stores (destructive mode)");
    } catch (e) {
      console.warn("Failed clearing branches/stores in destructive mode:", e);
    }
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
                category: item.category != null ? String(item.category) : null,
                packSize: item.packSize != null ? String(item.packSize) : null,
                barcode: item.barcode != null ? String(item.barcode) : null,
              },
              create: {
                productId: String(item.productId),
                name: String(item.name),
                price: Number(item.price),
                stockQuantity: Number(item.stockQuantity ?? 0),
                expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
                category: item.category != null ? String(item.category) : null,
                packSize: item.packSize != null ? String(item.packSize) : null,
                barcode: item.barcode != null ? String(item.barcode) : null,
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
    let jsonData: any[] = [];
    try {
      const rawText = fs.readFileSync(filePath, "utf-8");
      jsonData = JSON.parse(rawText);
      if (!Array.isArray(jsonData)) {
        console.warn(`Seed file ${fileName} is not an array; skipping`);
        continue;
      }
    } catch (e) {
      console.warn(`Failed to parse ${fileName}; skipping`, e);
      continue;
    }
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
        // Ensure IDs for normalized entities if not provided
        if (lowerModel === "locations") {
          if (typeof data.name === "string") data.name = data.name.trim();
          const name = String(data.name);
          const existingLoc = await prisma.locations.findFirst({ where: { name } as any });
          if (!existingLoc) {
            await prisma.locations.create({ data: { id: data.id || randomUUID(), name } as any });
          }
          continue;
        }
        if (lowerModel === "salesagents") {
          if (typeof data.name === "string") data.name = data.name.trim();
          const name = String(data.name);
          const existing = await prisma.salesAgents.findFirst({ where: { name } });
          if (!existing) {
            await prisma.salesAgents.create({
              data: {
                id: data.id || randomUUID(),
                name,
                mobile: data.mobile ?? null,
                email: data.email ?? null,
              },
            });
          }
          continue;
        }
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
        if (lowerModel === "expenses") {
          const transformed = {
            expenseId: data.expenseId || randomUUID(),
            category: String(data.category ?? data.name ?? "misc").trim(),
            amount: Number(data.amount ?? 0),
            timestamp: data.timestamp
              ? new Date(data.timestamp)
              : data.date
              ? new Date(data.date)
              : new Date(),
          };
          await prisma.expenses.create({ data: transformed });
        } else {
          await model.create({ data });
        }
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
              category: item.category != null ? String(item.category) : null,
              packSize: item.packSize != null ? String(item.packSize) : null,
              barcode: item.barcode != null ? String(item.barcode) : null,
            },
            create: {
              productId: String(item.productId),
              name: String(item.name),
              price: Number(item.price),
              stockQuantity: Number(item.stockQuantity),
              category: item.category != null ? String(item.category) : null,
              packSize: item.packSize != null ? String(item.packSize) : null,
              barcode: item.barcode != null ? String(item.barcode) : null,
            },
          });
        } catch (e) {
          console.warn("Seed upsert imported product failed:", e);
        }
      }
      console.log("Merged importedProducts.json into Products table");
    }
  }

  // Seed Stores and Branches from assets/stores.json
  try {
    const storesAssetPath = path.resolve(__dirname, "../assets/stores.json");
    if (fs.existsSync(storesAssetPath)) {
      const raw = JSON.parse(fs.readFileSync(storesAssetPath, "utf-8"));
      const entries: Array<{ store: string; branches: string[] }> = Array.isArray(raw?.stores)
        ? raw.stores
        : [];
      let seededStores = 0;
      let seededBranches = 0;
      for (const entry of entries) {
        const storeName = String(entry?.store || "").trim();
        if (!storeName || storeName.toLowerCase() === "name") continue; // skip placeholders
        // Upsert store by unique name
        const storeId = randomUUID();
        const store = await prisma.stores.upsert({
          where: { name: storeName },
          update: {},
          create: { id: storeId, name: storeName, tenantId: "default" },
        });
        seededStores += 1;
        // Seed branches under this store
        const branchList = Array.isArray(entry?.branches) ? entry.branches : [];
        for (const b of branchList) {
          const branchName = String(b || "").trim();
          if (!branchName) continue;
          try {
            await prisma.branches.upsert({
              where: { storeId_name: { storeId: store.id, name: branchName } },
              update: {},
              create: { id: randomUUID(), storeId: store.id, name: branchName, tenantId: "default" },
            });
            seededBranches += 1;
          } catch (e) {
            console.warn("Failed upserting branch", branchName, "for store", storeName, e);
          }
        }
      }
      console.log(`Seeded Stores/Branches from assets: stores=${seededStores}, branches=${seededBranches}`);
    } else {
      console.log("No assets/stores.json present; skipping Stores/Branches seeding");
    }
  } catch (e) {
    console.warn("Failed seeding Stores/Branches from assets:", e);
  }

  // Hardcoded admin seeding removed
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
