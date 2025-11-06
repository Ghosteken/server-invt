import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const customers = await prisma.customers.findMany({
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

    const normalizeKey = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    let created = 0;
    let updated = 0;

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

      // Try to find existing by mobile first, else by name
      const existing = await prisma.customers.findFirst({
        where: mobile
          ? { OR: [{ mobile: String(mobile).trim() }, { name: String(name).trim() }] }
          : { name: String(name).trim() },
      });

      if (existing) {
        await prisma.customers.update({
          where: { customerId: existing.customerId },
          data: {
            name: String(name).trim(),
            mobile: mobile ? String(mobile).trim() : existing.mobile,
            address: address ? String(address).trim() : existing.address,
            city: city ? String(city).trim() : existing.city,
            state: state ? String(state).trim() : existing.state,
            country: country ? String(country).trim() : existing.country,
          },
        });
        updated += 1;
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

    res.json({ created, updated });
  } catch (error) {
    console.error("importCustomers error:", error);
    res.status(500).json({ message: "Failed to import customers" });
  }
};