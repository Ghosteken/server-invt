import { Request, Response } from "express";
import prisma from "../db/prisma";
import { randomUUID } from "crypto";
import { adjustPcsQuantity } from "../services/pcsInventoryService";
import { withCache } from "../services/cache";
import { appendNotification } from "../services/notificationService";
import { upsertSupplierMeta, addSupplierPayment } from "../services/supplierPurchasesService";
import * as XLSX from "xlsx";
import multer from "multer";
export const upload = multer({ storage: multer.memoryStorage() });

// GET /purchases - list all customer purchases with joined names
// GET /purchases - list all procurement purchases (supplier-side)
export const getPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    // Optional date range filters: from/to (ISO date strings)
    const { from, to } = (req.query || {}) as { from?: string; to?: string };
    // Pagination params: page (1-based) and limit (items per page)
    const page = Math.max(1, Number((req.query as any)?.page) || 1);
    const limit = Math.max(1, Math.min(200, Number((req.query as any)?.limit) || 20));
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const where: Record<string, unknown> = { tenantId };
    if (from || to) {
      where.timestamp = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const cacheKey = `purchases:list:${from || "all"}:${to || "all"}:p=${page}:lim=${limit}`;
    const { list, total } = await withCache(cacheKey, 30, async () => {
      const totalCount = await prisma.purchases.count({ where });
      const purchases = await prisma.purchases.findMany({ where, orderBy: { timestamp: "desc" }, skip: (page - 1) * limit, take: limit });
      const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
      const products = await prisma.products.findMany({ where: { tenantId, productId: { in: productIds } }, select: { productId: true, name: true } });
      const productMap = new Map(products.map((p) => [p.productId, p.name] as const));
      const metaRows = await prisma.supplierPurchaseMeta.findMany({ where: { purchaseId: { in: purchases.map((p) => p.purchaseId) } } });
      const metaMap = new Map(metaRows.map((m) => [m.purchaseId, m]));
      const pageList = purchases.map((p) => ({
        purchaseId: p.purchaseId,
        productId: p.productId,
        productName: productMap.get(p.productId) || undefined,
        quantity: p.quantity,
        unitCost: p.unitCost,
        totalCost: p.totalCost,
        timestamp: p.timestamp,
        supplierName: metaMap.get(p.purchaseId)?.supplierName || undefined,
        supplierMobile: metaMap.get(p.purchaseId)?.supplierMobile || undefined,
      }));
      return { list: pageList, total: totalCount };
    });

    res.json({ purchases: list, total });
  } catch (err) {
    console.error("getPurchases error:", err);
    res.status(500).json({ message: "Failed to load purchases" });
  }
};

// DELETE /purchases/:id - delete a specific procurement purchase
export const deletePurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.purchases.findFirst({ where: { purchaseId: id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    // Reduce inventory based on stored unit meta (defaults to carton)
    try {
      const metaRow = await prisma.supplierPurchaseMeta.findUnique({ where: { purchaseId: id } });
      const unit = ((metaRow?.unit === "pcs" ? "pcs" : "ctn") as "ctn" | "pcs");
      const p = await prisma.products.findFirst({ where: { productId: existing.productId, tenantId } });
      if (p) {
        const qty = Math.max(0, Number(existing.quantity) || 0);
        if (unit === "ctn") {
          const newQty = Math.max(0, Number(p.stockQuantity) - qty);
          await prisma.products.update({ where: { productId: existing.productId }, data: { stockQuantity: newQty } });
        } else {
          await adjustPcsQuantity({ name: p.name, delta: -qty });
        }
      }
    } catch (e) {
      // If adjustment fails, continue with delete; log for visibility
      console.warn("Inventory adjustment on deletePurchase failed", e);
    }
    await prisma.purchases.delete({ where: { purchaseId: id } });
    // Notify: purchase deleted
    appendNotification({ type: "purchase", message: `Deleted purchase ${id}` });
    res.json({ success: true });
  } catch (err) {
    console.error("deletePurchase error:", err);
    res.status(500).json({ message: "Failed to delete purchase" });
  }
};

// POST /purchases - create a procurement purchase entry and add to stock
// Body: { date?: string; supplierName?: string; supplierMobile?: string; paymentTerm?: string; items: Array<{ productId?: string; name?: string; unit: "ctn"|"pcs"; quantity: number; unitCost: number }> }
export const createPurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const date = body.date ? new Date(body.date) : new Date();
      const supplierName: string | undefined = body.supplierName ? String(body.supplierName) : undefined;
      const supplierMobile: string | undefined = body.supplierMobile ? String(body.supplierMobile) : undefined;
      const paymentTerm: string | undefined = body.paymentTerm ? String(body.paymentTerm) : undefined;
      const dueDate: string | undefined = body.dueDate ? String(body.dueDate) : undefined;
    const items: Array<{ productId?: string; name?: string; unit: "ctn"|"pcs"; quantity: number; unitCost: number; expiryDate?: string }> = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      res.status(400).json({ message: "No items provided" });
      return;
    }

    const created: Array<{ purchaseId: string; productId: string; quantity: number; unitCost: number; totalCost: number; timestamp: Date }> = [];
    for (const it of items) {
      const quantity = Math.max(1, Number(it.quantity) || 1);
      const unitCost = Math.max(0, Number(it.unitCost) || 0);
      let productId = it.productId || "";
      let name = it.name || "";
      if (!productId && name) {
        const p = await prisma.products.findFirst({ where: { tenantId, name }, select: { productId: true } });
        if (p) productId = p.productId;
      }
      if (!productId) {
        res.status(400).json({ message: "Missing productId for an item" });
        return;
      }

      const p = await prisma.products.findFirst({ where: { productId, tenantId } });
      if (!p) {
        res.status(404).json({ message: `Product not found: ${productId}` });
        return;
      }

      // Adjust stock: purchases add to stock; handle cartons and pcs
      if (it.unit === "ctn") {
        const newQty = Math.max(0, Number(p.stockQuantity) + quantity);
        await prisma.products.update({ where: { productId }, data: { stockQuantity: newQty, expiryDate: it.expiryDate ? new Date(it.expiryDate) : p.expiryDate } });
      } else {
        // pcs: adjust pcs inventory positively
        await adjustPcsQuantity({ name: p.name, delta: quantity });
        // Optionally update expiryDate on product for reference
        if (it.expiryDate) {
          await prisma.products.update({ where: { productId }, data: { expiryDate: new Date(it.expiryDate) } });
        }
      }

      const purchaseId = randomUUID();
      const totalCost = unitCost * quantity;
      await prisma.purchases.create({ data: { purchaseId, productId, timestamp: date, quantity, unitCost, totalCost, tenantId } });
      // Persist supplier-side metadata for UI enrichment
      upsertSupplierMeta({
        purchaseId,
        supplierName: supplierName ?? null,
        supplierMobile: supplierMobile ?? null,
        paymentTerm: paymentTerm ?? null,
        date: date.toISOString(),
        dueDate: dueDate ?? null,
        unit: it.unit,
      });
      created.push({ purchaseId, productId, quantity, unitCost, totalCost, timestamp: date });
      // Notify: purchase item created
      appendNotification({ type: "purchase", message: `Purchased ${quantity} ${it.unit} of '${p.name}' for ₦${totalCost.toLocaleString("en")}` });
    }

    res.json({ success: true, purchases: created });
  } catch (err) {
    console.error("createPurchase error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create purchase";
    res.status(500).json({ message: msg });
  }
};

// POST /purchases/:id/payments - add a supplier payment record for a purchase
export const addPurchasePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // Ensure the purchase exists
    const existing = await prisma.purchases.findUnique({ where: { purchaseId: id } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    const body = req.body || {};
    const amount = Number(body.amount) || 0;
    const bankName = String(body.bankName || "").trim();
    // Allow missing bankAccount and auto-fill based on known banks mapping
    const KNOWN_BANKS: Array<{ name: string; account: string }> = [
      { name: "Amagzy global vic limited(Zenith bank) FOR SUPPLIES", account: "1017679715" },
      { name: "Amagzy global vic limited FCMB(FOR SUPPLIES)", account: "2002076509" },
      { name: "Amagzy global ventures(Sterling bank) FOR CHEQUES", account: "0501928477" },
      { name: "Amagzy global ventures(Stanbic bank) FOR OPERATIONS", account: "0034297097" },
      { name: "Amagzy global ventures(GTbank)FOR MANUFACTURING", account: "0240198526" },
    ];
    const providedAccount = String(body.bankAccount || "").trim();
    const bankAccount = providedAccount || (KNOWN_BANKS.find((b) => b.name === bankName)?.account || "");
    const notes = body.notes ? String(body.notes) : null;
    if (!amount || !bankName) {
      res.status(400).json({ message: "amount and bankName are required" });
      return;
    }
    const payment = addSupplierPayment({
      id: randomUUID(),
      purchaseId: id,
      date: body.date ? String(body.date) : new Date().toISOString(),
      amount,
      bankName,
      bankAccount,
      notes,
    });
    res.status(201).json({ payment });
    // Notify: supplier payment added
    appendNotification({ type: "purchase", message: `Added supplier payment ₦${amount.toLocaleString("en")} to purchase ${id} (${bankName})` });
  } catch (err) {
    console.error("addPurchasePayment error:", err);
    const msg = err instanceof Error ? err.message : "Failed to add payment";
    res.status(500).json({ message: msg });
  }
};

// PUT /purchases/:id/meta - update supplier-side metadata for a purchase
export const updatePurchaseMeta = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.purchases.findUnique({ where: { purchaseId: id } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    const body = req.body || {};
    const supplierName = body.supplierName !== undefined ? (body.supplierName ? String(body.supplierName) : null) : undefined;
    const supplierMobile = body.supplierMobile !== undefined ? (body.supplierMobile ? String(body.supplierMobile) : null) : undefined;
    const paymentTerm = body.paymentTerm !== undefined ? (body.paymentTerm ? String(body.paymentTerm) : null) : undefined;
    const dueDate = body.dueDate !== undefined ? (body.dueDate ? String(body.dueDate) : null) : undefined;
    upsertSupplierMeta({ purchaseId: id, supplierName, supplierMobile, paymentTerm, dueDate });
      const meta = { purchaseId: id, supplierName: supplierName ?? null, supplierMobile: supplierMobile ?? null, paymentTerm: paymentTerm ?? null, dueDate: dueDate ?? null };
      appendNotification({ type: "purchase", message: `Updated purchase ${id} meta: supplier=${meta.supplierName || "-"}, term=${meta.paymentTerm || "-"}` });
      res.json({ meta });
  } catch (err) {
    console.error("updatePurchaseMeta error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update purchase meta";
    res.status(500).json({ message: msg });
  }
};

// PUT /purchases/:id - update core purchase entry (product, quantity, unitCost, timestamp)
export const updatePurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.purchases.findFirst({ where: { purchaseId: id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }

    const body = req.body || {};
    const nextDate: Date | undefined = body.date ? new Date(String(body.date)) : undefined;
    const nextProductId: string | undefined = body.productId ? String(body.productId) : undefined;
    const nextQuantity: number | undefined = body.quantity !== undefined ? Math.max(0, Number(body.quantity) || 0) : undefined;
    const nextUnitCost: number | undefined = body.unitCost !== undefined ? Math.max(0, Number(body.unitCost) || 0) : undefined;
    const nextUnit: "ctn" | "pcs" | undefined = body.unit === "pcs" ? "pcs" : (body.unit === "ctn" ? "ctn" : undefined);
    const nextExpiryDate: string | undefined = body.expiryDate ? String(body.expiryDate) : undefined;

    // Determine old unit from meta (defaults to 'ctn' for backwards compat)
    const metaRow = await prisma.supplierPurchaseMeta.findUnique({ where: { purchaseId: id } });
    const oldUnit: "ctn" | "pcs" = (metaRow?.unit === "pcs" ? "pcs" : "ctn");

    // Fetch product records for inventory adjustments
    const oldProduct = await prisma.products.findFirst({ where: { productId: existing.productId, tenantId } });
    if (!oldProduct) {
      res.status(404).json({ message: `Product not found: ${existing.productId}` });
      return;
    }

    const newProductId = nextProductId || existing.productId;
    const newProduct = await prisma.products.findFirst({ where: { productId: newProductId, tenantId } });
    if (!newProduct) {
      res.status(404).json({ message: `Product not found: ${newProductId}` });
      return;
    }

    const oldQty = Math.max(0, Number(existing.quantity) || 0);
    const newQty = nextQuantity !== undefined ? Math.max(0, Number(nextQuantity) || 0) : oldQty;
    const effectiveOldUnit = oldUnit;
    const effectiveNewUnit: "ctn" | "pcs" = nextUnit || effectiveOldUnit;

    // Reverse old inventory effect on old product
    try {
      if (effectiveOldUnit === "ctn") {
        const revertQty = Math.max(0, Number(oldProduct.stockQuantity) - oldQty);
        await prisma.products.update({ where: { productId: oldProduct.productId }, data: { stockQuantity: revertQty } });
      } else {
        await adjustPcsQuantity({ name: oldProduct.name, delta: -oldQty });
      }
    } catch (invErr) {
      console.warn("Inventory reversal failed on updatePurchase", invErr);
    }

    // Apply new inventory effect on new product
    try {
      if (effectiveNewUnit === "ctn") {
        const applyQty = Math.max(0, Number(newProduct.stockQuantity) + newQty);
        await prisma.products.update({ where: { productId: newProduct.productId }, data: { stockQuantity: applyQty, expiryDate: nextExpiryDate ? new Date(nextExpiryDate) : newProduct.expiryDate } });
      } else {
        await adjustPcsQuantity({ name: newProduct.name, delta: newQty });
        if (nextExpiryDate) {
          await prisma.products.update({ where: { productId: newProduct.productId }, data: { expiryDate: new Date(nextExpiryDate) } });
        }
      }
    } catch (invErr) {
      console.warn("Inventory application failed on updatePurchase", invErr);
    }

    // Persist updated purchase entry
    const updated = await prisma.purchases.update({
      where: { purchaseId: id },
      data: {
        productId: newProductId,
        timestamp: nextDate || existing.timestamp,
        quantity: newQty,
        unitCost: nextUnitCost !== undefined ? nextUnitCost : existing.unitCost,
        totalCost: (nextUnitCost !== undefined ? nextUnitCost : existing.unitCost) * newQty,
      },
    });

    // Update meta fields if provided (unit and date)
    upsertSupplierMeta({ purchaseId: id, unit: nextUnit ?? undefined, date: nextDate ? nextDate.toISOString() : undefined });

    // Notify
    appendNotification({ type: "purchase", message: `Updated purchase ${id}: ${newQty} ${effectiveNewUnit} of '${newProduct.name}'` });

    res.json({ purchase: updated });
  } catch (err) {
    console.error("updatePurchase error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update purchase";
    res.status(500).json({ message: msg });
  }
};

export const getPurchasePrintOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.purchases.findFirst({ where: { purchaseId: id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    res.json({
      purchaseId: id,
      options: {
        includePrices: true,
        includeSupplierDetails: true,
        pageSizes: ["A4", "Letter"],
        orientation: ["portrait", "landscape"],
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load print options" });
  }
};

export const getSuppliers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    let list = await prisma.suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { name: true, mobile: true } });
    if (!list.length) {
      const purchases = await prisma.purchases.findMany({ where: { tenantId } });
      const map = new Map<string, { name: string; mobile?: string | null }>();
      for (const p of purchases) {
        const m = await prisma.supplierPurchaseMeta.findUnique({ where: { purchaseId: p.purchaseId } });
        const n = String(m?.supplierName || "").trim();
        if (!n) continue;
        const key = n.toLowerCase();
        const mobile = m?.supplierMobile ?? null;
        const prev = map.get(key);
        map.set(key, { name: n, mobile: mobile ?? prev?.mobile ?? null });
      }
      list = Array.from(map.values()).map((s) => ({ name: s.name, mobile: s.mobile ?? null })).sort((a, b) => a.name.localeCompare(b.name));
    }
    res.json({ suppliers: list });
  } catch {
    res.json({ suppliers: [] });
  }
};

export const importSuppliers = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ message: "No file uploaded. Use field name 'file'." }); return; }
    const wb = XLSX.read(file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: null });
    const norm = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();
    const out: Array<{ name: string; mobile?: string | null }> = [];
    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) kv[norm(k)] = row[k];
      const name = kv["supplier"] ?? kv["name"] ?? kv["supplier name"];
      const mobile = kv["mobile"] ?? kv["phone"] ?? kv["phone number"] ?? null;
      const n = String(name || "").trim();
      if (!n) continue;
      out.push({ name: n, mobile: mobile == null ? null : String(mobile) });
    }
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.suppliers.findMany({ where: { tenantId }, select: { name: true, mobile: true } });
    const byName = new Map<string, { name: string; mobile?: string | null }>();
    const add = (s: { name: string; mobile?: string | null }) => {
      const key = s.name.toLowerCase();
      const prev = byName.get(key);
      byName.set(key, { name: s.name, mobile: s.mobile ?? prev?.mobile ?? null });
    };
    existing.forEach(add);
    out.forEach(add);
    const merged = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    for (const s of merged) {
      await prisma.suppliers.upsert({
        where: { tenantId_name: { tenantId, name: s.name } },
        update: { mobile: s.mobile ?? undefined },
        create: { id: randomUUID(), tenantId, name: s.name, mobile: s.mobile ?? undefined },
      });
    }
    res.json({ importedSuppliers: out.length });
  } catch (err) {
    res.status(500).json({ message: "Failed to import suppliers" });
  }
};

export const exportSuppliersExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    let list = await prisma.suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { name: true, mobile: true } });
    if (!list.length) {
      const purchases = await prisma.purchases.findMany({ where: { tenantId } });
      const map = new Map<string, { name: string; mobile?: string | null }>();
      for (const p of purchases) {
        const m = await prisma.supplierPurchaseMeta.findUnique({ where: { purchaseId: p.purchaseId } });
        const n = String(m?.supplierName || "").trim();
        if (!n) continue;
        const key = n.toLowerCase();
        const mobile = m?.supplierMobile ?? null;
        const prev = map.get(key);
        map.set(key, { name: n, mobile: mobile ?? prev?.mobile ?? null });
      }
      list = Array.from(map.values()).map((s) => ({ name: s.name, mobile: s.mobile ?? null })).sort((a, b) => a.name.localeCompare(b.name));
    }
    const rows = list.map((s) => ({ Name: s.name, Mobile: s.mobile ?? "" }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["Name", "Mobile"] });
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=suppliers.xlsx");
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ message: "Failed to export suppliers" });
  }
};

// Suppliers utilities for routes file
// `upload` is defined once at the top of this file for reuse
