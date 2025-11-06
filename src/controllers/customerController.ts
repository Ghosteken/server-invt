import { Request, Response } from "express";
import prisma from "../db/prisma";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { writeStores } from "../services/storeService";

// Use shared Prisma client

export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = String(req.query.search || "").trim();
    const customers = await prisma.customers.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { mobile: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
              { state: { contains: search, mode: "insensitive" } },
              { country: { contains: search, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
    });

    // Fetch purchases grouped by customer
    const purchases = await prisma.customerPurchases.findMany({});
    const productIds = Array.from(new Set(purchases.map(p => p.productId)));
    const products = await prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } });
    const nameById = new Map(products.map(p => [p.productId, p.name] as const));
    const byCustomer = new Map<string, Array<{ productId: string; productName: string; quantity: number; totalCost: number }>>();
    for (const p of purchases) {
      const list = byCustomer.get(p.customerId) || [];
      list.push({ productId: p.productId, productName: nameById.get(p.productId) || p.productId, quantity: p.quantity, totalCost: p.totalCost });
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
  } catch (error) {
    console.error("getCustomers error:", error);
    res.status(500).json({ message: "Error retrieving customers" });
  }
};

export const purgeCustomerPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.customerPurchases.deleteMany({});
    res.json({ message: "Purged customer purchases", deletedCount: result.count });
  } catch (error) {
    console.error("purgeCustomerPurchases error:", error);
    res.status(500).json({ message: "Error purging customer purchases" });
  }
};

export const importCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
      return;
    }
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    const arrayRows: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    const normalizeKey = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    let created = 0;
    let updated = 0;
    let skippedExisting = 0;
    let skippedDuplicateInFile = 0;
    const seenKeys = new Set<string>();

    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[normalizeKey(k)] = row[k];
      const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
      const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
      const address = kv["address"] ?? kv["street"];
      const city = kv["city"];
      const state = kv["state"];
      const country = kv["country"];
      if (!name) continue;

      const normName = String(name).trim().toLowerCase();
      const normMobile = mobile ? String(mobile).trim() : "";
      const key = normMobile ? `m:${normMobile}` : `n:${normName}`;
      if (seenKeys.has(key)) {
        skippedDuplicateInFile += 1;
        continue;
      }
      seenKeys.add(key);

      // Try to find existing by mobile first, else by name
      const existing = await prisma.customers.findFirst({
        where: normMobile
          ? { OR: [ { mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } } ] }
          : { name: { equals: normName, mode: "insensitive" } },
      });

      if (existing) {
        // Skip duplicates in DB: do not update existing customers
        skippedExisting += 1;
      } else {
        await prisma.customers.create({
          data: {
            customerId: randomUUID(),
            name: String(name).trim(),
            mobile: mobile ? String(mobile).trim() : null,
            address: address ? String(address).trim() : null,
            city: city ? String(city).trim() : null,
            state: state ? String(state).trim() : null,
            country: country ? String(country).trim() : null,
          },
        });
        created += 1;
      }
    }

    // Attempt to parse store/branch mapping from top rows (sample format)
    try {
      const grouped = new Map<string, Set<string>>();
      let currentStore: string | null = null;
      const toText = (v: any) => (v == null ? "" : String(v).trim());
      for (const row of arrayRows) {
        const cell = toText(row[0]);
        if (!cell) continue;
        const isLikelyStore = /^[A-Z][A-Za-z0-9\s&.'()-]+$/.test(cell) && cell.split(" ").length <= 3;
        const isLikelyBranch = !isLikelyStore && /[A-Za-z]/.test(cell);
        if (isLikelyStore) {
          currentStore = cell.toLowerCase();
          if (!grouped.has(currentStore)) grouped.set(currentStore, new Set());
          continue;
        }
        if (isLikelyBranch && currentStore) {
          grouped.get(currentStore)!.add(cell);
          continue;
        }
        if (currentStore && !isLikelyBranch && !isLikelyStore) {
          break;
        }
      }
      const stores = Array.from(grouped.entries()).map(([store, set]) => ({ store, branches: Array.from(set.values()) }));
      if (stores.length) {
        writeStores({ stores });
      }
    } catch (e) {
      console.warn("Skipping store/branch parsing during importCustomers:", e);
    }

    res.json({ created, updated, skippedExisting, skippedDuplicateInFile });
  } catch (error) {
    console.error("importCustomers error:", error);
    res.status(500).json({ message: "Failed to import customers" });
  }
};

/**
 * Import customers from the server sample Excel located at assets/Customers1.xlsx
 */
export const importCustomersSample = async (req: Request, res: Response): Promise<void> => {
  try {
    const samplePath = path.join(__dirname, "../../assets/Customers1.xlsx");
    if (!fs.existsSync(samplePath)) {
      res.status(404).json({ message: "Sample Customers1.xlsx not found in server/assets" });
      return;
    }
    const buffer = fs.readFileSync(samplePath);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    const normalizeKey = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    let created = 0;
    let updated = 0;
    let skippedExisting = 0;
    let skippedDuplicateInFile = 0;
    const seenKeys = new Set<string>();

    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[normalizeKey(k)] = row[k];
      const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
      const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
      const address = kv["address"] ?? kv["street"];
      const city = kv["city"]; 
      const state = kv["state"]; 
      const country = kv["country"]; 
      if (!name) continue;

      const normName = String(name).trim().toLowerCase();
      const normMobile = mobile ? String(mobile).trim() : "";
      const key = normMobile ? `m:${normMobile}` : `n:${normName}`;
      if (seenKeys.has(key)) {
        skippedDuplicateInFile += 1;
        continue;
      }
      seenKeys.add(key);

      const existing = await prisma.customers.findFirst({
        where: normMobile
          ? { OR: [ { mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } } ] }
          : { name: { equals: normName, mode: "insensitive" } },
      });

      if (existing) {
        // Skip duplicates in DB: do not update existing customers
        skippedExisting += 1;
      } else {
        await prisma.customers.create({
          data: {
            customerId: randomUUID(),
            name: String(name).trim(),
            mobile: mobile ? String(mobile).trim() : null,
            address: address ? String(address).trim() : null,
            city: city ? String(city).trim() : null,
            state: state ? String(state).trim() : null,
            country: country ? String(country).trim() : null,
          },
        });
        created += 1;
      }
    }

    res.json({ created, updated, skippedExisting, skippedDuplicateInFile });
  } catch (error) {
    console.error("importCustomersSample error:", error);
    res.status(500).json({ message: "Failed to import customers from sample" });
  }
};

/**
 * Export customers and their purchases to an Excel workbook
 */
export const exportCustomersExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const customers = await prisma.customers.findMany({ orderBy: { name: "asc" } });
    const purchases = await prisma.customerPurchases.findMany({ orderBy: { timestamp: "desc" } });
    const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
    const products = await prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } });
    const nameById = new Map(products.map((p) => [p.productId, p.name] as const));

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
  } catch (error) {
    console.error("exportCustomersExcel error:", error);
    res.status(500).json({ message: "Failed to export customers as Excel" });
  }
};