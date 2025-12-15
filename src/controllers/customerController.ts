import { Request, Response } from "express";
import prisma from "../db/prisma";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { writeStores } from "../services/storeService";

// Use shared Prisma client

export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const search = String(req.query.search || "").trim();
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { mobile: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
        { state: { contains: search, mode: "insensitive" } },
        { country: { contains: search, mode: "insensitive" } },
      ];
    }
    const customers = await prisma.customers.findMany({ where, orderBy: { createdAt: "desc" } });

    // Fetch purchases grouped by customer
    const purchases = await prisma.customerPurchases.findMany({ where: { tenantId } });
    const productIds = Array.from(new Set(purchases.map((p: any) => p.productId)));
    const products = await prisma.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } });
    const nameById = new Map<string, string>(products.map((p: { productId: string; name: string }) => [p.productId, p.name]));
    const byCustomer = new Map<string, Array<{ id: string; productId: string; productName: string; quantity: number; totalCost: number }>>();
    for (const p of purchases) {
      const list = byCustomer.get(p.customerId) || [];
      list.push({ id: p.id, productId: p.productId, productName: nameById.get(p.productId) || p.productId, quantity: p.quantity, totalCost: p.totalCost });
      byCustomer.set(p.customerId, list);
    }

    const result = customers.map((c: any) => ({
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

// DELETE /customers/purchases/:id - delete a specific customer purchase (customer sale)
export const deleteCustomerPurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.customerPurchases.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Customer purchase not found" });
      return;
    }
    if (existing.tenantId !== tenantId) {
      res.status(404).json({ message: "Customer purchase not found" });
      return;
    }
    await prisma.customerPurchases.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error("deleteCustomerPurchase error:", error);
    res.status(500).json({ message: "Failed to delete customer purchase" });
  }
};

// POST /customers - create an individual customer
export const createCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      mobile,
      address,
      city,
      state,
      country,
    } = req.body || {};

    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      res.status(400).json({ message: "Name is required" });
      return;
    }

    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const normName = trimmedName.toLowerCase();
    const normMobile = mobile ? String(mobile).trim() : "";

    // Check duplicates by mobile or case-insensitive name
    const existing = await prisma.customers.findFirst({
      where: normMobile
        ? { tenantId, OR: [ { mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } } ] }
        : { tenantId, name: { equals: normName, mode: "insensitive" } },
    });

    if (existing) {
      res.status(409).json({ message: "Customer already exists" });
      return;
    }

    const created = await prisma.customers.create({
      data: {
        customerId: randomUUID(),
        name: trimmedName,
        mobile: normMobile || null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        state: state ? String(state).trim() : null,
        country: country ? String(country).trim() : null,
        tenantId,
      },
    });

    res.status(201).json({
      customerId: created.customerId,
      name: created.name,
      mobile: created.mobile || undefined,
      address: created.address || undefined,
      city: created.city || undefined,
      state: created.state || undefined,
      country: created.country || undefined,
      createdAt: created.createdAt,
      purchases: [],
    });
  } catch (error) {
    console.error("createCustomer error:", error);
    res.status(500).json({ message: "Failed to create customer" });
  }
};

export const purgeCustomerPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const result = await prisma.customerPurchases.deleteMany({ where: { tenantId } });
    res.json({ message: "Purged customer purchases", deletedCount: result.count });
  } catch (error) {
    console.error("purgeCustomerPurchases error:", error);
    res.status(500).json({ message: "Error purging customer purchases" });
  }
};

// PUT /customers/:id - update a specific customer
export const updateCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      name,
      mobile,
      address,
      city,
      state,
      country,
    } = req.body || {};

    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.customers.findFirst({ where: { customerId: id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const updates: any = {};
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (!trimmed) { res.status(400).json({ message: "Name cannot be empty" }); return; }
      // prevent duplicate name on another record (case-insensitive)
      const dup = await prisma.customers.findFirst({
        where: { tenantId, name: { equals: trimmed.toLowerCase(), mode: "insensitive" }, NOT: { customerId: id } },
      });
      if (dup) { res.status(409).json({ message: "Another customer already uses this name" }); return; }
      updates.name = trimmed;
    }
    if (typeof mobile === "string") {
      const mv = mobile.trim();
      if (mv) {
        const dupMobile = await prisma.customers.findFirst({ where: { tenantId, mobile: mv, NOT: { customerId: id } } });
        if (dupMobile) { res.status(409).json({ message: "Another customer already uses this mobile" }); return; }
        updates.mobile = mv;
      } else {
        updates.mobile = null;
      }
    }
    if (typeof address === "string") updates.address = address.trim() || null;
    if (typeof city === "string") updates.city = city.trim() || null;
    if (typeof state === "string") updates.state = state.trim() || null;
    if (typeof country === "string") updates.country = country.trim() || null;

    const updated = await prisma.customers.update({ where: { customerId: id }, data: updates });
    res.json({
      customerId: updated.customerId,
      name: updated.name,
      mobile: updated.mobile || undefined,
      address: updated.address || undefined,
      city: updated.city || undefined,
      state: updated.state || undefined,
      country: updated.country || undefined,
      createdAt: updated.createdAt,
      purchases: [], // client will refetch list
    });
  } catch (error) {
    console.error("updateCustomer error:", error);
    res.status(500).json({ message: "Failed to update customer" });
  }
};

// DELETE /customers/:id - delete a customer
export const deleteCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.customers.findFirst({ where: { customerId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Customer not found" }); return; }

    // Optionally: cascade delete purchases or keep historical records.
    // Here we keep purchases history and only remove the customer record.
    await prisma.customers.delete({ where: { customerId: id } });
    res.json({ success: true });
  } catch (error) {
    console.error("deleteCustomer error:", error);
    res.status(500).json({ message: "Failed to delete customer" });
  }
};

export const importCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
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
    const importedSnapshot: Array<{ name: string; mobile?: string | null; netBalanceDue?: number | null }> = [];
    const seenKeys = new Set<string>();

    const mobilesSet = new Set<string>();
    const namesNoMobileSet = new Set<string>();
    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[normalizeKey(k)] = row[k];
      const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
      const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
      if (!name) continue;
      const normNamePre = String(name).trim().toLowerCase();
      const normMobilePre = mobile ? String(mobile).trim() : "";
      if (normMobilePre) mobilesSet.add(normMobilePre);
      else namesNoMobileSet.add(normNamePre);
    }

    const existingByMobile = mobilesSet.size
      ? await prisma.customers.findMany({ where: { tenantId, mobile: { in: Array.from(mobilesSet.values()) } }, select: { mobile: true } })
      : [];
    const existingMobileSet = new Set<string>(existingByMobile.map((e: any) => String(e.mobile)));

    const nameOrClauses = Array.from(namesNoMobileSet.values()).map((n) => ({ name: { equals: n, mode: "insensitive" as const } }));
    const existingByName = nameOrClauses.length
      ? await prisma.customers.findMany({ where: { tenantId, OR: nameOrClauses }, select: { name: true } })
      : [];
    const existingNameSet = new Set<string>(existingByName.map((e: { name: string | null }) => String(e.name).toLowerCase()));

    const toCreate: Array<{ customerId: string; name: string; mobile: string | null; address: string | null; city: string | null; state: string | null; country: string | null; tenantId: string }> = [];

    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[normalizeKey(k)] = row[k];
      const name = kv["name"] ?? kv["customer name"] ?? kv["customer"];
      const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"];
      const address = kv["address"] ?? kv["street"];
      const city = kv["city"];
      const state = kv["state"];
      const country = kv["country"];
      const netBalanceDueRaw = kv["net balance due"] ?? kv["balance"] ?? kv["net due"];
      const netBalanceDue = (() => {
        if (netBalanceDueRaw == null) return null;
        if (typeof netBalanceDueRaw === "number" && Number.isFinite(netBalanceDueRaw)) return netBalanceDueRaw;
        const s = String(netBalanceDueRaw);
        const m = s.replace(/[,]/g, "").match(/-?\d+(?:\.\d+)?/);
        if (!m) return null;
        const n = Number(m[0]);
        return Number.isFinite(n) ? n : null;
      })();
      if (!name) continue;

      const normName = String(name).trim().toLowerCase();
      const normMobile = mobile ? String(mobile).trim() : "";
      const key = normMobile ? `m:${normMobile}` : `n:${normName}`;
      if (seenKeys.has(key)) {
        skippedDuplicateInFile += 1;
        continue;
      }
      seenKeys.add(key);

      const exists = normMobile ? existingMobileSet.has(normMobile) : existingNameSet.has(normName);
      if (exists) {
        skippedExisting += 1;
      } else {
        toCreate.push({
          customerId: randomUUID(),
          name: String(name).trim(),
          mobile: normMobile ? normMobile : null,
          address: address ? String(address).trim() : null,
          city: city ? String(city).trim() : null,
          state: state ? String(state).trim() : null,
          country: country ? String(country).trim() : null,
          tenantId,
        });
        created += 1;
      }

      // Collect snapshot for seed JSON (DB does not store netBalanceDue)
      importedSnapshot.push({
        name: String(name).trim(),
        mobile: mobile ? String(mobile).trim() : null,
        netBalanceDue,
      });
    }

    if (toCreate.length) {
      await prisma.customers.createMany({ data: toCreate });
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

    // Persist imported customers to seed JSON for audit and optional future seeding
    try {
      const seedDir = path.join(__dirname, "../../prisma/seedData");
      const outPath = path.join(seedDir, "importedCustomers.json");
      if (!fs.existsSync(seedDir)) {
        fs.mkdirSync(seedDir, { recursive: true });
      }
      let existing: any[] = [];
      if (fs.existsSync(outPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
        } catch {
          existing = [];
        }
      }
      const map = new Map<string, any>();
      for (const item of existing) {
        if (item && item.name) map.set(String(item.name).toLowerCase(), item);
      }
      for (const item of importedSnapshot) {
        const key = String(item.name).toLowerCase();
        map.set(key, item);
      }
      const merged = Array.from(map.values());
      fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");
    } catch (persistErr) {
      console.warn("Failed to persist imported customers to JSON:", persistErr);
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
    const tenantId = req.tenantId || req.user?.tenantId || "default";
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
          ? { tenantId, OR: [ { mobile: normMobile }, { name: { equals: normName, mode: "insensitive" } } ] }
          : { tenantId, name: { equals: normName, mode: "insensitive" } },
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
            tenantId,
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
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const customers = await prisma.customers.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    const purchases = await prisma.customerPurchases.findMany({ where: { tenantId }, orderBy: { timestamp: "desc" } });
    const productIds = Array.from(new Set(purchases.map((p: any) => p.productId)));
    const products = await prisma.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } });
    const nameById = new Map<string, string>(products.map((p: any) => [p.productId, p.name] as const));

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

    const purchasesSheetRows = purchases.map((p: any) => ({
      CustomerId: p.customerId,
      CustomerName: customers.find((c: any) => c.customerId === p.customerId)?.name ?? "",
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

// Customer Groups CRUD
export const getCustomerGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const search = String(req.query.search || "").trim().toLowerCase();
    const groups = await prisma.customerGroups.findMany({
      where: { tenantId, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) },
      orderBy: { createdAt: "desc" },
      include: { customers: { select: { customerId: true, name: true } } },
    });
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ message: "Failed to load customer groups" });
  }
};

export const createCustomerGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const name = String(req.body?.name || "").trim();
    const description = req.body?.description ? String(req.body.description) : undefined;
    if (!name) { res.status(400).json({ message: "Group name is required" }); return; }
    const existing = await prisma.customerGroups.findFirst({ where: { tenantId, name } });
    if (existing) { res.status(409).json({ message: "Group already exists" }); return; }
    const created = await prisma.customerGroups.create({ data: { groupId: randomUUID(), name, description, tenantId } });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ message: "Failed to create customer group" });
  }
};

export const updateCustomerGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const { id } = req.params;
    const existing = await prisma.customerGroups.findFirst({ where: { groupId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Group not found" }); return; }
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const description = req.body?.description ? String(req.body.description) : undefined;
    const updated = await prisma.customerGroups.update({ where: { groupId: id }, data: { ...(name ? { name } : {}), description } });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Failed to update customer group" });
  }
};

export const deleteCustomerGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const { id } = req.params;
    const existing = await prisma.customerGroups.findFirst({ where: { groupId: id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Group not found" }); return; }
    await prisma.customerGroups.delete({ where: { groupId: id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete customer group" });
  }
};

export const addCustomerToGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const { id } = req.params;
    const customerId = String(req.body?.customerId || "").trim();
    if (!customerId) { res.status(400).json({ message: "customerId is required" }); return; }
    const group = await prisma.customerGroups.findFirst({ where: { groupId: id, tenantId } });
    if (!group) { res.status(404).json({ message: "Group not found" }); return; }
    const customer = await prisma.customers.findFirst({ where: { customerId, tenantId } });
    if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }
    const updated = await prisma.customerGroups.update({
      where: { groupId: id },
      data: { customers: { connect: { customerId } } },
      include: { customers: { select: { customerId: true, name: true } } },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Failed to add customer to group" });
  }
};

export const removeCustomerFromGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const { id, customerId } = req.params as { id: string; customerId: string };
    const group = await prisma.customerGroups.findFirst({ where: { groupId: id, tenantId } });
    if (!group) { res.status(404).json({ message: "Group not found" }); return; }
    const customer = await prisma.customers.findFirst({ where: { customerId, tenantId } });
    if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }
    const updated = await prisma.customerGroups.update({
      where: { groupId: id },
      data: { customers: { disconnect: { customerId } } },
      include: { customers: { select: { customerId: true, name: true } } },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Failed to remove customer from group" });
  }
};
