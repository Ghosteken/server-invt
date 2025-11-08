// Import data from server/assets Excel files into DB and seed JSONs
// Products: barcode-products.xlsx
// Customers: Customers1.xlsx
// PCS: PCS-sample.xlsx
// Expenses Category: ExpensesCat.xlsx

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { PrismaClient } = require("@prisma/client");
const { randomUUID } = require("crypto");

// Load environment safely
(() => {
  try {
    const envPaths = [
      path.join(__dirname, "../.env.development"),
      path.join(__dirname, "../.env"),
      path.join(__dirname, "../.env.development.example"),
    ];
    const dotenv = require("dotenv");
    for (const p of envPaths) {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        break;
      }
    }
  } catch {}
})();

const prisma = new PrismaClient();
const ASSETS_DIR = path.join(__dirname, "../assets");
const SEED_DIR = path.join(__dirname, "../prisma/seedData");

const normKey = (k) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
const coerceNumber = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const s = String(val);
  const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
};
const parseDate = (val) => {
  if (val == null || val === "") return null;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  // Try ISO first
  const dIso = new Date(s);
  if (!isNaN(dIso)) return dIso;
  // Try DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yyyy = Number(m[3].length === 2 ? (Number(m[3]) + 2000) : m[3]);
    const d = new Date(yyyy, mm, dd);
    return isNaN(d) ? null : d;
  }
  return null;
};

const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

async function importProducts() {
  const filePath = path.join(ASSETS_DIR, "barcode-products.xlsx");
  if (!fs.existsSync(filePath)) {
    console.log("[products] assets/barcode-products.xlsx not found; skipping");
    return;
  }
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  let inserted = 0;
  const snapshot = [];
  for (const row of rows) {
    const kv = {};
    for (const k of Object.keys(row)) kv[normKey(k)] = row[k];
    const productId = (kv["productid"] ?? kv["sku"] ?? randomUUID()).toString();
    const name = (kv["productdescription"] ?? kv["name"] ?? kv["product"] ?? kv["item"] ?? kv["description"] ?? "").toString().trim();
    if (!name) continue;
    const barcode = kv["barcode"] ? String(kv["barcode"]) : null;
    const packSize = kv["packsize"] ?? kv["pack size"] ?? kv["pack"] ?? null;
    const category = kv["category"] ? String(kv["category"]) : null;
    const purchasePrice = coerceNumber(kv["purchaseprice"]);
    const salesPrice = coerceNumber(kv["salesprice"]);
    const quantity = coerceNumber(kv["quantity"]) ?? coerceNumber(kv["stockquantity"]) ?? 0;
    const expiryDate = parseDate(kv["expirydate"]);
    const description = kv["description"] ? String(kv["description"]) : null;

    try {
      await prisma.products.upsert({
        where: { productId },
        update: {
          name,
          price: Number(salesPrice ?? 0),
          stockQuantity: Math.max(0, Number(quantity ?? 0)),
          category,
          description,
          packSize: packSize ? String(packSize).trim() : null,
          barcode,
          purchasePrice: purchasePrice != null ? Number(purchasePrice) : null,
          expiryDate: expiryDate || undefined,
        },
        create: {
          productId,
          name,
          price: Number(salesPrice ?? 0),
          stockQuantity: Math.max(0, Number(quantity ?? 0)),
          category,
          description,
          packSize: packSize ? String(packSize).trim() : null,
          barcode,
          purchasePrice: purchasePrice != null ? Number(purchasePrice) : null,
          expiryDate: expiryDate || undefined,
        },
      });
      inserted += 1;
      snapshot.push({
        productId,
        name,
        price: Number(salesPrice ?? 0),
        purchasePrice: purchasePrice != null ? Number(purchasePrice) : undefined,
        stockQuantity: Math.max(0, Number(quantity ?? 0)),
        expiryDate: expiryDate ? expiryDate.toISOString() : undefined,
        category: category ?? undefined,
        description: description ?? undefined,
        packSize: packSize ? String(packSize).trim() : undefined,
        barcode: barcode ?? undefined,
      });
    } catch (e) {
      console.warn("[products] upsert failed for", productId, e.message || e);
    }
  }
  ensureDir(SEED_DIR);
  const outPath = path.join(SEED_DIR, "importedProducts.json");
  let existing = [];
  if (fs.existsSync(outPath)) {
    try { existing = JSON.parse(fs.readFileSync(outPath, "utf-8")); } catch {}
  }
  const map = new Map(existing.map((x) => [String(x.productId), x]));
  for (const s of snapshot) map.set(String(s.productId), s);
  fs.writeFileSync(outPath, JSON.stringify(Array.from(map.values()), null, 2), "utf-8");
  console.log(`[products] Imported ${inserted} products`);
}

async function importCustomers() {
  const filePath = path.join(ASSETS_DIR, "Customers1.xlsx");
  if (!fs.existsSync(filePath)) {
    console.log("[customers] assets/Customers1.xlsx not found; skipping");
    return;
  }
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  let created = 0;
  const snapshot = [];
  const seen = new Set();
  for (const row of rows) {
    const kv = {}; for (const k of Object.keys(row)) kv[normKey(k)] = row[k];
    const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
    const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
    const netBalanceRaw = kv["net balance due"] ?? kv["balance"] ?? kv["net due"];
    const netBalanceDue = coerceNumber(netBalanceRaw);
    if (!name) continue;
    const normName = String(name).trim().toLowerCase();
    const normMobile = mobile ? String(mobile).trim() : "";
    const key = normMobile ? `m:${normMobile}` : `n:${normName}`;
    if (seen.has(key)) continue; seen.add(key);

    const existing = await prisma.customers.findFirst({
      where: normMobile
        ? { OR: [{ mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } }] }
        : { name: { equals: normName, mode: "insensitive" } },
    });
    if (!existing) {
      try {
        await prisma.customers.create({
          data: {
            customerId: randomUUID(),
            name: String(name).trim(),
            mobile: mobile ? String(mobile).trim() : null,
          },
        });
        created += 1;
      } catch (e) {
        console.warn("[customers] create failed for", name, e.message || e);
      }
    }
    snapshot.push({ name: String(name).trim(), mobile: mobile ? String(mobile).trim() : null, netBalanceDue });
  }
  ensureDir(SEED_DIR);
  const outPath = path.join(SEED_DIR, "importedCustomers.json");
  let existingSnap = [];
  if (fs.existsSync(outPath)) {
    try { existingSnap = JSON.parse(fs.readFileSync(outPath, "utf-8")); } catch {}
  }
  const map = new Map(existingSnap.map((x) => [String(x.name).toLowerCase(), x]));
  for (const s of snapshot) map.set(String(s.name).toLowerCase(), s);
  fs.writeFileSync(outPath, JSON.stringify(Array.from(map.values()), null, 2), "utf-8");
  console.log(`[customers] Imported ${created} new customers (others existed)`);
}

async function importPcs() {
  const filePath = path.join(ASSETS_DIR, "PCS-sample.xlsx");
  if (!fs.existsSync(filePath)) {
    console.log("[pcs] assets/PCS-sample.xlsx not found; skipping");
    return;
  }
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const snapshot = [];
  const invPath = path.join(SEED_DIR, "pcsInventory.json");
  ensureDir(SEED_DIR);
  let inventory = [];
  if (fs.existsSync(invPath)) {
    try { inventory = JSON.parse(fs.readFileSync(invPath, "utf-8")); } catch { inventory = []; }
  }
  const invMap = new Map(inventory.map((e) => [String(e.name).toLowerCase(), e]));

  let imported = 0;
  for (const row of rows) {
    const kv = {}; for (const k of Object.keys(row)) kv[normKey(k)] = row[k];
    const name = (kv["product description"] ?? kv["name"] ?? kv["product"] ?? kv["item"] ?? kv["description"] ?? "").toString().trim();
    if (!name) continue;
    const qty = coerceNumber(kv["pcs quantity"]) ?? coerceNumber(kv["pcs"]) ?? coerceNumber(kv["quantity"]) ?? 0;
    const packSize = kv["pack size"] ?? kv["pack"] ?? kv["packsize"] ?? null;
    const productId = kv["productid"] ?? kv["sku"] ?? null;
    const barcode = kv["barcode"] ?? null;
    const category = kv["category"] ?? null;
    const purchasePrice = coerceNumber(kv["purchaseprice"]);
    const salesPrice = coerceNumber(kv["salesprice"]);
    const expiryDate = kv["expirydate"] ? String(kv["expirydate"]).trim() : null;
    const description = kv["description"] ? String(kv["description"]).trim() : null;

    invMap.set(name.toLowerCase(), { name, quantity: Math.max(0, Number(qty) || 0), productId: productId ? String(productId) : null, packSize: packSize ? String(packSize).trim() : null });
    snapshot.push({
      productId: productId ? String(productId) : undefined,
      name,
      barcode: barcode ? String(barcode) : undefined,
      packSize: packSize ? String(packSize).trim() : null,
      category: category ? String(category) : undefined,
      pcsQuantity: Math.max(0, Number(qty) || 0),
      purchasePrice: purchasePrice ?? null,
      salesPrice: salesPrice ?? null,
      expiryDate,
      description,
    });
    imported += 1;
  }
  fs.writeFileSync(invPath, JSON.stringify(Array.from(invMap.values()), null, 2), "utf-8");
  const pcsSnapPath = path.join(SEED_DIR, "importedPcs.json");
  let existingSnap = [];
  if (fs.existsSync(pcsSnapPath)) {
    try { existingSnap = JSON.parse(fs.readFileSync(pcsSnapPath, "utf-8")); } catch {}
  }
  const keyOf = (r) => `${String(r.name).toLowerCase()}|${String(r.packSize ?? "").toLowerCase()}`;
  const map = new Map(existingSnap.map((x) => [keyOf(x), x]));
  for (const s of snapshot) map.set(keyOf(s), s);
  fs.writeFileSync(pcsSnapPath, JSON.stringify(Array.from(map.values()), null, 2), "utf-8");
  console.log(`[pcs] Imported ${imported} PCS rows; inventory updated`);
}

async function importExpenseCategories() {
  const filePath = path.join(ASSETS_DIR, "ExpensesCat.xlsx");
  if (!fs.existsSync(filePath)) {
    console.log("[expenses] assets/ExpensesCat.xlsx not found; skipping");
    return;
  }
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const cats = [];
  for (const row of rows) {
    const kv = {}; for (const k of Object.keys(row)) kv[normKey(k)] = row[k];
    const cat = kv["category name"] ?? kv["category"] ?? kv["name"];
    if (!cat) continue;
    const cleaned = String(cat).trim(); if (!cleaned) continue;
    cats.push(cleaned);
  }
  const unique = Array.from(new Set(cats.map((c) => c.toLowerCase())));
  ensureDir(SEED_DIR);
  const outPath = path.join(SEED_DIR, "expenseCategories.json");
  fs.writeFileSync(outPath, JSON.stringify(unique.map((c) => ({ name: c })), null, 2), "utf-8");
  const summaryId = randomUUID();
  const now = new Date();
  try {
    await prisma.expenseSummary.create({ data: { expenseSummaryId: summaryId, totalExpenses: 0, date: now } });
  } catch (e) {
    console.warn("[expenses] failed to create summary:", e.message || e);
  }
  for (const catLower of unique) {
    try {
      await prisma.expenseByCategory.create({
        data: {
          expenseByCategoryId: randomUUID(),
          expenseSummaryId: summaryId,
          category: catLower,
          amount: BigInt(0),
          date: now,
        },
      });
    } catch (e) {
      console.warn("[expenses] failed to insert category", catLower, e.message || e);
    }
  }
  console.log(`[expenses] Registered ${unique.length} categories`);
}

async function main() {
  try {
    console.log("Starting import from assets...");
    await importProducts();
    await importCustomers();
    await importPcs();
    await importExpenseCategories();
    console.log("Import completed.");
  } catch (e) {
    console.error("Import failed:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();