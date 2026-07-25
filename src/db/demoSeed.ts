import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import prisma from "./prisma";

// Hand-crafted, presentable dataset for the DEMO_MODE deployment (SQLite,
// no external DB service). Seeds once — if the demo tenant already has
// products, this is a no-op so re-deploys don't duplicate data mid-session.
//
// Uses the app's existing "default" fallback tenant (not a distinct "demo"
// tenant) because some routes (e.g. dashboardRoutes) skip authenticateToken
// entirely and derive tenantId from a best-effort resolver in index.ts that
// can't jwt.decode our non-JWT sentinel token — it falls back to "default".
const DEMO_TENANT_ID = "default";

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export async function seedDemoData(): Promise<void> {
  const existing = await prisma.products.count({ where: { tenantId: DEMO_TENANT_ID } });
  if (existing > 0) {
    console.log("demo: seed skipped, demo tenant already has data");
    return;
  }

  console.log("demo: seeding demo tenant with sample data...");

  const passwordHash = await bcrypt.hash("demo1234", 10);
  await prisma.users.upsert({
    where: { email: "demo@stockstudio.app" },
    update: {},
    create: {
      userId: "demo-user",
      name: "Demo Admin",
      email: "demo@stockstudio.app",
      password: passwordHash,
      role: "admin",
      status: "approved",
      tenantId: DEMO_TENANT_ID,
    },
  });

  const products = [
    { productId: randomUUID(), name: "Premium Basmati Rice 25kg", price: 42500, stockQuantity: 120, openingStock: 150, category: "Grains", packSize: "25kg bag", purchasePrice: 36000 },
    { productId: randomUUID(), name: "Vegetable Oil 5L", price: 8500, stockQuantity: 80, openingStock: 100, category: "Cooking Oil", packSize: "5L", purchasePrice: 6800 },
    { productId: randomUUID(), name: "Granulated Sugar 50kg", price: 55000, stockQuantity: 40, openingStock: 60, category: "Sugar & Sweeteners", packSize: "50kg bag", purchasePrice: 47000 },
    { productId: randomUUID(), name: "All-Purpose Flour 10kg", price: 12000, stockQuantity: 95, openingStock: 100, category: "Baking", packSize: "10kg bag", purchasePrice: 9500 },
    { productId: randomUUID(), name: "Canned Tomatoes 400g (24pk)", price: 9600, stockQuantity: 60, openingStock: 80, category: "Canned Goods", packSize: "24-pack ctn", purchasePrice: 7800 },
    { productId: randomUUID(), name: "Long Life Milk 1L (12pk)", price: 14400, stockQuantity: 6, openingStock: 50, category: "Dairy", packSize: "12-pack ctn", purchasePrice: 11500 },
    { productId: randomUUID(), name: "Instant Noodles Family Pack (40pk)", price: 6800, stockQuantity: 200, openingStock: 220, category: "Instant Foods", packSize: "40-pack ctn", purchasePrice: 5200 },
    { productId: randomUUID(), name: "Bottled Water 60cl (24pk)", price: 3200, stockQuantity: 300, openingStock: 300, category: "Beverages", packSize: "24-pack ctn", purchasePrice: 2400 },
  ];
  await prisma.products.createMany({
    data: products.map((p) => ({ ...p, tenantId: DEMO_TENANT_ID, createdAt: daysAgo(30) })),
  });

  const salesAgent = { id: randomUUID(), name: "Amaka Obi", mobile: "08012345678", tenantId: DEMO_TENANT_ID };
  await prisma.salesAgents.create({ data: salesAgent });

  const location = { id: randomUUID(), name: "Main Warehouse", tenantId: DEMO_TENANT_ID };
  await prisma.locations.create({ data: location });

  await prisma.sales.createMany({
    data: products.slice(0, 6).flatMap((p, i) =>
      [10, 4, 1].map((daysBack, j) => ({
        saleId: randomUUID(),
        productId: p.productId,
        timestamp: daysAgo(daysBack),
        quantity: 3 + i + j,
        unitPrice: p.price,
        totalAmount: p.price * (3 + i + j),
        tenantId: DEMO_TENANT_ID,
      }))
    ),
  });

  await prisma.purchases.createMany({
    data: products.slice(0, 5).map((p, i) => ({
      purchaseId: randomUUID(),
      productId: p.productId,
      timestamp: daysAgo(15 + i),
      quantity: 20 + i * 5,
      unitCost: p.purchasePrice || p.price * 0.8,
      totalCost: (p.purchasePrice || p.price * 0.8) * (20 + i * 5),
      tenantId: DEMO_TENANT_ID,
    })),
  });

  const customers = [
    { customerId: randomUUID(), name: "Blue Ocean Retail Ltd", mobile: "08023456789", city: "Lagos", country: "Nigeria" },
    { customerId: randomUUID(), name: "Greenfield Supermarket", mobile: "08034567890", city: "Abuja", country: "Nigeria" },
    { customerId: randomUUID(), name: "Sunrise Foods & Provisions", mobile: "08045678901", city: "Ibadan", country: "Nigeria" },
  ];
  await prisma.customers.createMany({
    data: customers.map((c) => ({ ...c, tenantId: DEMO_TENANT_ID, createdAt: daysAgo(25) })),
  });

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const items = products.slice(i, i + 2);
    const invoiceId = randomUUID();
    const totalWithoutVAT = items.reduce((sum, p) => sum + p.price * 2, 0);
    const vatAmount = Math.round(totalWithoutVAT * 0.075);
    await prisma.invoices.create({
      data: {
        invoiceId,
        customerId: customer.customerId,
        date: daysAgo(7 - i),
        location: location.name,
        salesAgent: salesAgent.name,
        locationId: location.id,
        salesAgentId: salesAgent.id,
        status: i === 0 ? "paid" : i === 1 ? "partial" : "unpaid",
        totalWithoutVAT,
        vatAmount,
        totalWithVAT: totalWithoutVAT + vatAmount,
        tenantId: DEMO_TENANT_ID,
        items: {
          create: items.map((p) => ({
            id: randomUUID(),
            productId: p.productId,
            name: p.name,
            unit: "ctn",
            quantity: 2,
            unitPrice: p.price,
            subtotal: p.price * 2,
            tenantId: DEMO_TENANT_ID,
          })),
        },
      },
    });
  }

  await prisma.expenseCategories.createMany({
    data: ["Logistics", "Utilities", "Staff Salaries"].map((name) => ({ id: randomUUID(), name, tenantId: DEMO_TENANT_ID })),
  });

  await prisma.expenses.createMany({
    data: [
      { expenseId: randomUUID(), category: "Logistics", name: "Delivery truck fuel", amount: 45000, timestamp: daysAgo(6), status: "approved" },
      { expenseId: randomUUID(), category: "Utilities", name: "Warehouse electricity bill", amount: 120000, timestamp: daysAgo(12), status: "approved" },
      { expenseId: randomUUID(), category: "Staff Salaries", name: "Warehouse staff wages", amount: 350000, timestamp: daysAgo(20), status: "pending" },
    ].map((e) => ({ ...e, tenantId: DEMO_TENANT_ID })),
  });

  await prisma.banks.create({
    data: { id: randomUUID(), name: "Demo Bank", account: "0123456789", balance: 500000, tenantId: DEMO_TENANT_ID },
  });

  console.log("demo: seed complete");
}
