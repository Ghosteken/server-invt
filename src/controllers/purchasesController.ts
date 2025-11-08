import { Request, Response } from "express";
import prisma from "../db/prisma";
import { randomUUID } from "crypto";
import { adjustPcsQuantity } from "../services/pcsInventoryService";
import { getSupplierMetaFor, upsertSupplierMeta, addSupplierPayment } from "../services/supplierPurchasesService";

// GET /purchases - list all customer purchases with joined names
// GET /purchases - list all procurement purchases (supplier-side)
export const getPurchases = async (_req: Request, res: Response): Promise<void> => {
  try {
    const purchases = await prisma.purchases.findMany({ orderBy: { timestamp: "desc" } });
    const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
    const products = await prisma.products.findMany({ where: { productId: { in: productIds } }, select: { productId: true, name: true } });
    const productMap = new Map(products.map((p) => [p.productId, p.name] as const));

    const list = purchases.map((p) => ({
      purchaseId: p.purchaseId,
      productId: p.productId,
      productName: productMap.get(p.productId) || undefined,
      quantity: p.quantity,
      unitCost: p.unitCost,
      totalCost: p.totalCost,
      timestamp: p.timestamp,
      supplierName: getSupplierMetaFor(p.purchaseId)?.supplierName || undefined,
      supplierMobile: getSupplierMetaFor(p.purchaseId)?.supplierMobile || undefined,
    }));

    res.json({ purchases: list });
  } catch (err) {
    console.error("getPurchases error:", err);
    res.status(500).json({ message: "Failed to load purchases" });
  }
};

// DELETE /purchases/:id - delete a specific procurement purchase
export const deletePurchase = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.purchases.findUnique({ where: { purchaseId: id } });
    if (!existing) {
      res.status(404).json({ message: "Purchase not found" });
      return;
    }
    await prisma.purchases.delete({ where: { purchaseId: id } });
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
        const p = await prisma.products.findFirst({ where: { name }, select: { productId: true } });
        if (p) productId = p.productId;
      }
      if (!productId) {
        res.status(400).json({ message: "Missing productId for an item" });
        return;
      }

      const p = await prisma.products.findUnique({ where: { productId } });
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
      await prisma.purchases.create({ data: { purchaseId, productId, timestamp: date, quantity, unitCost, totalCost } });
      // Persist supplier-side metadata for UI enrichment
      upsertSupplierMeta({
        purchaseId,
        supplierName: supplierName ?? null,
        supplierMobile: supplierMobile ?? null,
        paymentTerm: paymentTerm ?? null,
        date: date.toISOString(),
        dueDate: dueDate ?? null,
      });
      created.push({ purchaseId, productId, quantity, unitCost, totalCost, timestamp: date });
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
    const meta = getSupplierMetaFor(id);
    res.json({ meta });
  } catch (err) {
    console.error("updatePurchaseMeta error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update purchase meta";
    res.status(500).json({ message: msg });
  }
};