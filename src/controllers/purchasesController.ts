import { Request, Response } from "express";
import prisma from "../db/prisma";
import { randomUUID } from "crypto";
import { adjustPcsQuantity } from "../services/pcsInventoryService";
import { withCache, cacheDeletePattern } from "../services/cache";
import { appendNotification } from "../services/notificationService";
import { upsertSupplierMeta, addSupplierPayment } from "../services/supplierPurchasesService";
import * as XLSX from "xlsx";
import multer from "multer";
import { createErrorResponse } from "../utils/errorHandler";
export const upload = multer({ storage: multer.memoryStorage() });

const CTNX_UNITS = [
  "ctnx24",
  "ctnx30",
  "ctnx20",
  "ctnx26",
  "ctnx48",
  "ctnx9",
  "ctnx96",
  "ctnx14",
  "ctnx12",
  "ctnx16",
  "ctnx50",
  "ctnx4",
  "ctnx8",
  "ctnx10",
  "ctnx18",
  "ctnx28",
] as const;

const ALLOWED_UNITS = new Set<string>(["ctn", "pcs", ...CTNX_UNITS]);

function parseCtnxMultiplier(unit: string): number | null {
  const m = /^ctnx(\d+)$/i.exec(String(unit || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// GET /purchases - list all customer purchases with joined names
// GET /purchases - list all procurement purchases (supplier-side)
export const getPurchases = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, invoiceNumber } = (req.query || {}) as { from?: string; to?: string; invoiceNumber?: string };
    const page = Math.max(1, Number((req.query as any)?.page) || 1);
    const limit = Math.max(1, Math.min(200, Number((req.query as any)?.limit) || 20));
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";

    const metaWhere: any = { tenantId };
    if (invoiceNumber) {
      metaWhere.invoiceNumber = { contains: invoiceNumber };
    }
    if (from || to) {
      let toDateStr;
      if (to) {
        const d = new Date(to);
        d.setHours(23, 59, 59, 999);
        toDateStr = d.toISOString();
      }
      
      metaWhere.date = {
        ...(from ? { gte: new Date(from).toISOString() } : {}),
        ...(to ? { lte: toDateStr } : {}),
      };
      // Note: This assumes stored date is ISO string. If comparison fails, date filter might be inaccurate.
    }

    // Use cache with version v4 to force refresh
    const cacheKey = `purchases:invoices:v4:${from || "all"}:${to || "all"}:${invoiceNumber || "all"}:p=${page}:lim=${limit}`;
    const { list, total } = await withCache(cacheKey, 30, async () => {
      // 1. Get Distinct Invoices (Paginated)
      const distinctInvoices = await prisma.supplierPurchaseMeta.findMany({
        where: metaWhere,
        distinct: ['invoiceNumber'],
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { invoiceNumber: true, date: true, supplierName: true, supplierMobile: true, paymentTerm: true, dueDate: true }
      });

      const totalGrouped = await prisma.supplierPurchaseMeta.groupBy({
        by: ['invoiceNumber'],
        where: metaWhere,
      });
      const totalCount = totalGrouped.length;

      const invoiceNumbers = distinctInvoices.map(d => d.invoiceNumber).filter(Boolean) as string[];

      // 2. Fetch Details for Aggregation
      const allInvoiceMetas = await prisma.supplierPurchaseMeta.findMany({ 
          where: { invoiceNumber: { in: invoiceNumbers }, tenantId },
          select: { invoiceNumber: true, purchaseId: true }
      });

      const allInvoicePurchaseIds = allInvoiceMetas.map((m: any) => m.purchaseId);
      
      const allInvoicePurchases = await prisma.purchases.findMany({
          where: { purchaseId: { in: allInvoicePurchaseIds }, tenantId },
          select: { purchaseId: true, totalCost: true, unitCost: true, quantity: true, productId: true, timestamp: true, expiryDate: true }
      });

      const productIds = Array.from(new Set(allInvoicePurchases.map((p: any) => p.productId)));
      const products = await prisma.products.findMany({
        where: { productId: { in: productIds }, tenantId },
        select: { productId: true, name: true }
      });
      const productMap = new Map(products.map(p => [p.productId, p.name]));
      
      const allInvoicePayments = await prisma.supplierPayments.findMany({
          where: { purchaseId: { in: allInvoicePurchaseIds }, tenantId },
          select: { purchaseId: true, amount: true }
      });

      // 3. Aggregate
      const invoiceStats = new Map<string, { items: any[]; totalCost: number; totalPaid: number; totalQuantity: number; purchaseId: string; timestamp: Date }>();

      const purchaseIdsByInvoice = new Map<string, string[]>();
      for (const m of allInvoiceMetas as any[]) {
        const inv = String(m.invoiceNumber || "").trim();
        if (!inv) continue;
        const list = purchaseIdsByInvoice.get(inv) || [];
        list.push(String(m.purchaseId));
        purchaseIdsByInvoice.set(inv, list);
      }

      const purchaseById = new Map<string, any>();
      for (const p of allInvoicePurchases as any[]) {
        purchaseById.set(String(p.purchaseId), p);
      }

      const paidByPurchaseId = new Map<string, number>();
      for (const pay of allInvoicePayments as any[]) {
        const pid = String(pay.purchaseId);
        const prev = paidByPurchaseId.get(pid) || 0;
        paidByPurchaseId.set(pid, prev + Number(pay.amount || 0));
      }
      
      for (const invNum of invoiceNumbers) {
          const pIds = purchaseIdsByInvoice.get(invNum) || [];
          const relatedPurchases = pIds.map((pid) => purchaseById.get(pid)).filter(Boolean);
          relatedPurchases.sort((a: any, b: any) => String(a.purchaseId).localeCompare(String(b.purchaseId)));

          const items = relatedPurchases.map((p: any) => {
            const quantity = Number(p.quantity) || 1;
            // Robust calculation logic matching reportController
            let unitCost = Number(p.unitCost || 0);
            let totalCost = Number(p.totalCost || 0);

            if (totalCost === 0 && unitCost > 0) {
              totalCost = unitCost * quantity;
            }
            if (unitCost === 0 && totalCost > 0 && quantity > 0) {
              unitCost = totalCost / quantity;
            }

            return {
              purchaseId: p.purchaseId,
              productId: p.productId,
              productName: productMap.get(p.productId) || p.productId || "Unknown Product (Fixed)",
              quantity,
              unitCost,
              totalCost,
              expiryDate: p.expiryDate ? new Date(p.expiryDate).toISOString() : undefined
            };
          });

          const totalCost = items.reduce((sum, item) => sum + (item.totalCost || 0), 0);
          const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
          const totalPaid = pIds.reduce((sum, pid) => sum + (paidByPurchaseId.get(pid) || 0), 0);
          
          const rep = relatedPurchases[0] || {};
          
          invoiceStats.set(invNum, { 
              items,
              totalCost, 
              totalPaid, 
              totalQuantity, 
              purchaseId: rep.purchaseId, 
              timestamp: rep.timestamp 
          });
      }

      const pageList = distinctInvoices.map(meta => {
        const stats = meta.invoiceNumber ? invoiceStats.get(meta.invoiceNumber) : undefined;
        return {
          purchaseId: stats?.purchaseId || "", 
          items: stats?.items || [],
          quantity: stats?.totalQuantity || 0,
          totalCost: stats?.totalCost || 0,
          timestamp: stats?.timestamp || new Date(meta.date || Date.now()),
          supplierName: meta.supplierName,
          supplierMobile: meta.supplierMobile,
          invoiceNumber: meta.invoiceNumber,
          paymentTerm: meta.paymentTerm,
          dueDate: meta.dueDate,
          invoiceTotal: stats?.totalCost || 0,
          invoicePaid: stats?.totalPaid || 0
        };
      });

      // Manual deduplication
      const uniquePageList: typeof pageList = [];
      const seenInvoices = new Set<string>();
      
      for (const p of pageList) {
          if (p.invoiceNumber) {
              const norm = p.invoiceNumber.trim().toLowerCase();
              if (!seenInvoices.has(norm)) {
                  seenInvoices.add(norm);
                  uniquePageList.push(p);
              }
          } else {
              uniquePageList.push(p);
          }
      }

      return { list: uniquePageList, total: totalCount };
    });

    res.json({ purchases: list, total });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to load purchases"));
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
    let metaRow: any = null;
    try {
      const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
      metaRow = await prisma.supplierPurchaseMeta.findFirst({ where: { purchaseId: id, tenantId } });
      const unit = ((metaRow?.unit === "pcs" ? "pcs" : "ctn") as "ctn" | "pcs");
      const p = await prisma.products.findFirst({ where: { productId: existing.productId, tenantId } });
      if (p) {
        const qty = Math.max(0, Number(existing.quantity) || 0);
        if (unit === "ctn") {
          const newQty = Math.max(0, Number(p.stockQuantity) - qty);
          await prisma.products.update({ where: { productId: existing.productId }, data: { stockQuantity: newQty } });
        } else {
          await adjustPcsQuantity({ name: p.name, delta: -qty, tenantId });
        }
      }
    } catch (e) {
      // If adjustment fails, continue with delete; log for visibility
      console.warn("Inventory adjustment on deletePurchase failed", e);
    }
    // NEW: Delete related records first
    await prisma.supplierPurchaseMeta.deleteMany({ where: { purchaseId: id } });
    await prisma.supplierPayments.deleteMany({ where: { purchaseId: id } });

    await prisma.purchases.delete({ where: { purchaseId: id } });
    // Notify: purchase deleted
    const label = metaRow?.invoiceNumber ? `invoice #${metaRow.invoiceNumber}` : (metaRow?.supplierName ? `purchase from ${metaRow.supplierName}` : "purchase");
    appendNotification({ type: "purchase", message: `Deleted ${label}`, tenantId, actorUserId: req.user?.userId });

    try {
      const io = req.app.get("io");
      io.emit("purchase:deleted", { purchaseId: id });
      io.emit("dashboard:refresh", { tenantId });
    } catch (err) {
      console.warn("Socket emission failed for deletePurchase", err);
    }

    await cacheDeletePattern("purchases:invoices:*");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to delete purchase"));
  }
};

// POST /purchases - create a procurement purchase entry and add to stock
// Body: { date?: string; supplierName?: string; supplierMobile?: string; paymentTerm?: string; items: Array<{ productId?: string; name?: string; unit: "ctn"|"pcs"; quantity: number; unitCost: number }> }
export const createPurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    
    let date = body.date ? new Date(body.date) : new Date();
    if (body.date) {
       const now = new Date();
       const d = new Date(body.date);
       if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
         date = now;
       }
    }
      const supplierName: string | undefined = body.supplierName ? String(body.supplierName) : undefined;
      const supplierMobile: string | undefined = body.supplierMobile ? String(body.supplierMobile) : undefined;
      const paymentTerm: string | undefined = body.paymentTerm ? String(body.paymentTerm) : undefined;
      const dueDate: string | undefined = body.dueDate ? String(body.dueDate) : undefined;
      let invoiceNumber: string | undefined = body.invoiceNumber ? String(body.invoiceNumber) : undefined;
    const items: Array<{ productId?: string; name?: string; unit?: string; quantity: number; unitCost?: number; expiryDate?: string; pcsPurchasePrice?: number }> = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      res.status(400).json({ message: "No items provided" });
      return;
    }

    // Auto-generate invoice number if not provided
    if (!invoiceNumber) {
      const timestamp = Date.now().toString().slice(-6);
      invoiceNumber = `PUR-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${timestamp}`;
    }

    const created: Array<{ purchaseId: string; productId: string; productName: string; quantity: number; unitCost: number; totalCost: number; timestamp: Date; expiryDate?: Date }> = [];
    const pcsPriceUpserts = new Map<string, { productId: string; name: string; pcsPurchasePrice: number; packSize?: string | null }>();
    for (const it of items) {
      const quantity = Math.max(1, Number(it.quantity) || 1);
      const unitCostProvided = it.unitCost !== undefined && it.unitCost !== null && !isNaN(Number(it.unitCost));
      let unitCost = unitCostProvided ? Math.max(0, Number(it.unitCost) || 0) : 0;
      const unit = String(it.unit || "").trim().toLowerCase();
      if (!ALLOWED_UNITS.has(unit)) {
        res.status(400).json({ message: `Invalid unit: ${String(it.unit)}` });
        return;
      }
      const multiplier = parseCtnxMultiplier(unit);
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

      const explicitPcsPurchasePrice = it.pcsPurchasePrice !== undefined && it.pcsPurchasePrice !== null && !isNaN(Number(it.pcsPurchasePrice))
        ? Math.max(0, Number(it.pcsPurchasePrice) || 0)
        : undefined;
      if (explicitPcsPurchasePrice !== undefined) {
        pcsPriceUpserts.set(String(p.name || "").toLowerCase(), {
          productId: p.productId,
          name: p.name,
          pcsPurchasePrice: explicitPcsPurchasePrice,
          packSize: p.packSize ?? null,
        });
      }
      const pcsRow = await prisma.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name: p.name } }, select: { purchasePrice: true } });
      const pack = Number(String(p.packSize || "").replace(/\D+/g, "")) || 0;
      const derivedPcsCost = p.purchasePrice != null && pack > 0 ? Number(p.purchasePrice) / Math.max(pack, 1) : undefined;
      const basePcsCost = explicitPcsPurchasePrice ?? (pcsRow?.purchasePrice ?? undefined) ?? derivedPcsCost;

      if (!unitCostProvided) {
        if (unit === "pcs") {
          if (basePcsCost === undefined) {
            res.status(400).json({ message: `Missing PCS purchase price for: ${p.name}` });
            return;
          }
          unitCost = basePcsCost;
        } else if (multiplier !== null) {
          if (basePcsCost === undefined) {
            res.status(400).json({ message: `Missing PCS purchase price for: ${p.name}` });
            return;
          }
          unitCost = basePcsCost * multiplier;
        }
      }

      // Adjust stock: purchases add to stock; handle cartons and pcs
      if (unit === "pcs") {
        // pcs: adjust pcs inventory positively
        await adjustPcsQuantity({ name: p.name, delta: quantity, tenantId });
        // Optionally update expiryDate on product for reference
        if (it.expiryDate) {
          await prisma.products.update({ where: { productId }, data: { expiryDate: new Date(it.expiryDate) } });
        }
      } else {
        const newQty = Math.max(0, Number(p.stockQuantity) + quantity);
        await prisma.products.update({ where: { productId }, data: { stockQuantity: newQty, expiryDate: it.expiryDate ? new Date(it.expiryDate) : p.expiryDate } });
      }

      const purchaseId = randomUUID();
      const totalCost = unitCost * quantity;
      await prisma.purchases.create({ data: { purchaseId, productId, timestamp: date, quantity, unitCost, totalCost, expiryDate: it.expiryDate ? new Date(it.expiryDate) : undefined, tenantId } });
      // Persist supplier-side metadata for UI enrichment
      await upsertSupplierMeta({
        purchaseId,
        tenantId,
        supplierName: supplierName ?? null,
        supplierMobile: supplierMobile ?? null,
        invoiceNumber: invoiceNumber ?? null,
        paymentTerm: paymentTerm ?? null,
        date: date.toISOString(),
        dueDate: dueDate ?? null,
        unit,
      });
      created.push({ purchaseId, productId, productName: p.name, quantity, unitCost, totalCost, timestamp: date, expiryDate: it.expiryDate ? new Date(it.expiryDate) : undefined });
      // Notify: purchase item created
      const label = invoiceNumber ? `invoice #${invoiceNumber}` : `purchase of ${p.name}`;
      appendNotification({ type: "purchase", message: `Created ${label} (${quantity} ${unit})`, tenantId, actorUserId: req.user?.userId });
    }

    if (pcsPriceUpserts.size) {
      for (const up of pcsPriceUpserts.values()) {
        const prev = await prisma.pcsInventory.findUnique({ where: { tenantId_name: { tenantId, name: up.name } } });
        const qty = prev?.quantity ?? 0;
        await prisma.pcsInventory.upsert({
          where: { tenantId_name: { tenantId, name: up.name } },
          create: {
            id: randomUUID(),
            tenantId,
            name: up.name,
            quantity: qty,
            productId: up.productId,
            packSize: up.packSize ?? null,
            purchasePrice: up.pcsPurchasePrice,
          },
          update: {
            productId: up.productId,
            packSize: up.packSize ?? null,
            purchasePrice: up.pcsPurchasePrice,
          },
        });
      }
    }

    try {
      const io = req.app.get("io");
      
      if (created.length > 0) {
          // Sort to ensure deterministic representative matching getPurchases
          created.sort((a, b) => a.purchaseId.localeCompare(b.purchaseId));

          const totalCost = created.reduce((sum, item) => sum + Number(item.totalCost), 0);
          const totalQuantity = created.reduce((sum, item) => sum + Number(item.quantity), 0);
          const first = created[0];
          
          const payload = {
              purchaseId: first.purchaseId,
              items: created,
              supplierName: supplierName || undefined,
              supplierMobile: supplierMobile || undefined,
              invoiceNumber: invoiceNumber,
              paymentTerm: paymentTerm || undefined,
              dueDate: dueDate || undefined,
              quantity: totalQuantity,
              totalCost: totalCost,
              invoiceTotal: totalCost,
              invoicePaid: 0,
              timestamp: first.timestamp,
              tenantId
          };
          
          io.emit("purchase:created", payload);
      }
      
      io.emit("dashboard:refresh", { tenantId });
    } catch (err) {
      console.warn("Socket emission failed for createPurchase", err);
    }

    await cacheDeletePattern("purchases:invoices:*");

    res.json({ success: true, purchases: created });
  } catch (err) {
    console.error("createPurchase error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create purchase";
    res.status(500).json(createErrorResponse(err, "purchase", msg));
  }
};

// POST /purchases/:id/payments - add a supplier payment record for a purchase
export const addPurchasePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    // Ensure the purchase exists
    const existing = await prisma.purchases.findFirst({ where: { purchaseId: id, tenantId } });
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
    // Notify: supplier payment added
    // Fetch meta for label
    const meta = await prisma.supplierPurchaseMeta.findFirst({ where: { purchaseId: id, tenantId } });
    const label = meta?.invoiceNumber ? `invoice #${meta.invoiceNumber}` : (meta?.supplierName ? `purchase from ${meta.supplierName}` : "purchase");
    appendNotification({ type: "purchase", message: `Payment of ₦${amount.toLocaleString("en")} added to ${label}`, tenantId, actorUserId: req.user?.userId });

    try {
      const io = req.app.get("io");
      const updatedWithMeta = await prisma.purchases.findUnique({ where: { purchaseId: id }, include: { payments: true } });
      if (updatedWithMeta) {
        io.emit("purchase:updated", updatedWithMeta);
        const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
        io.emit("dashboard:refresh", { tenantId });
      }
    } catch (err) {
      console.warn("Socket emission failed for addPurchasePayment", err);
    }

    await cacheDeletePattern("purchases:invoices:*");

    res.status(201).json({ payment });
  } catch (err) {
    console.error("addPurchasePayment error:", err);
    const msg = err instanceof Error ? err.message : "Failed to add payment";
    res.status(500).json(createErrorResponse(err, "purchase", msg));
  }
};

// PUT /purchases/:id/meta - update supplier-side metadata for a purchase
export const updatePurchaseMeta = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.purchases.findFirst({ where: { purchaseId: id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    const body = req.body || {};
    const supplierName = body.supplierName !== undefined ? (body.supplierName ? String(body.supplierName) : null) : undefined;
    const supplierMobile = body.supplierMobile !== undefined ? (body.supplierMobile ? String(body.supplierMobile) : null) : undefined;
    const paymentTerm = body.paymentTerm !== undefined ? (body.paymentTerm ? String(body.paymentTerm) : null) : undefined;
    const dueDate = body.dueDate !== undefined ? (body.dueDate ? String(body.dueDate) : null) : undefined;
    
    // Sync timestamp if date is provided
    if (body.date) {
        await prisma.purchases.update({ where: { purchaseId: id }, data: { timestamp: new Date(body.date) } });
    }

    await upsertSupplierMeta({ purchaseId: id, tenantId, supplierName, supplierMobile, paymentTerm, dueDate, date: body.date });
      const meta = { purchaseId: id, supplierName: supplierName ?? null, supplierMobile: supplierMobile ?? null, paymentTerm: paymentTerm ?? null, dueDate: dueDate ?? null };
      appendNotification({ type: "purchase", message: `Updated purchase ${id} meta: supplier=${meta.supplierName || "-"}, term=${meta.paymentTerm || "-"}`, tenantId, actorUserId: req.user?.userId });
      
      await cacheDeletePattern("purchases:invoices:*");

      res.json({ meta });
  } catch (err) {
    console.error("updatePurchaseMeta error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update purchase meta";
    res.status(500).json(createErrorResponse(err, "purchase", msg));
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
        await adjustPcsQuantity({ name: oldProduct.name, delta: -oldQty, tenantId });
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
        await adjustPcsQuantity({ name: newProduct.name, delta: newQty, tenantId });
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
        expiryDate: nextExpiryDate ? new Date(nextExpiryDate) : undefined,
      },
    });

    // Update meta fields if provided (unit and date)
    await upsertSupplierMeta({ purchaseId: id, tenantId, unit: nextUnit ?? undefined, date: nextDate ? nextDate.toISOString() : undefined });

    // Notify
    const label = metaRow?.invoiceNumber ? `invoice #${metaRow.invoiceNumber}` : (metaRow?.supplierName ? `purchase from ${metaRow.supplierName}` : "purchase");
    appendNotification({ type: "purchase", message: `Updated ${label}: ${newQty} ${effectiveNewUnit} of '${newProduct.name}'`, tenantId, actorUserId: req.user?.userId });

    await cacheDeletePattern("purchases:invoices:*");

    res.json({ purchase: updated });
  } catch (err) {
    console.error("updatePurchase error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update purchase";
    res.status(500).json(createErrorResponse(err, "purchase", msg));
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
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to load print options"));
  }
};

export const getSuppliers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    let list = await prisma.suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true, mobile: true } });
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
      list = Array.from(map.values()).map((s: any) => ({ id: randomUUID(), name: s.name, mobile: s.mobile ?? null })).sort((a, b) => a.name.localeCompare(b.name));
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
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to import suppliers"));
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
    const rows = list.map((s: any) => ({ Name: s.name, Mobile: s.mobile ?? "" }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["Name", "Mobile"] });
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=suppliers.xlsx");
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to export suppliers"));
  }
};

// Suppliers utilities for routes file
// `upload` is defined once at the top of this file for reuse

// Create a supplier
export const createSupplier = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const name = String((req.body || {}).name || "").trim();
    const mobile = String((req.body || {}).mobile || "").trim() || null;
    if (!name) { res.status(400).json({ message: "Supplier name is required" }); return; }
    const exists = await prisma.suppliers.findFirst({ where: { tenantId, name } });
    if (exists) { res.status(409).json({ message: "Supplier already exists" }); return; }
    await prisma.suppliers.create({ data: { id: randomUUID(), tenantId, name, mobile: mobile || undefined } });
    res.status(201).json({ supplier: { name, mobile } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to create supplier"));
  }
};

// Update a supplier
export const updateSupplier = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    const changes = req.body || {};
    const existing = await prisma.suppliers.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Supplier not found" }); return; }
    const next = await prisma.suppliers.update({
      where: { id },
      data: {
        ...(changes.name !== undefined ? { name: String(changes.name).trim() } : {}),
        ...(changes.mobile !== undefined ? { mobile: String(changes.mobile).trim() || null } : {}),
      },
    });
    res.json({ supplier: { id: next.id, name: next.name, mobile: next.mobile } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to update supplier"));
  }
};

// Delete a supplier
export const deleteSupplier = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const id = String(req.params.id || "").trim();
    const existing = await prisma.suppliers.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Supplier not found" }); return; }
    await prisma.suppliers.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "purchase", "Failed to delete supplier"));
  }
};
