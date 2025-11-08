import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";
import { appendNotification } from "../services/notificationService";
import { getInvoiceMeta, upsertInvoiceMeta, removeInvoiceMeta } from "../services/invoiceMetaService";
import { adjustPcsQuantity } from "../services/pcsInventoryService";

type CreateInvoiceBody = {
  customerId?: string;
  customerName?: string;
  date?: string;
  location: string;
  salesAgent: string;
  locationId?: string;
  salesAgentId?: string;
  vatPercent?: number;
  discountPercent?: number;
  paymentTermType: "immediate" | "due_date";
  dueDate?: string;
  notes?: string;
  // Optional client-provided invoice number for display
  invoiceNumber?: string;
  items: Array<{ productId?: string; name: string; unit: "ctn" | "pcs"; quantity: number; unitPrice?: number }>;
};

function computeTotals(items: Array<{ quantity: number; unitPrice: number }>, vatPercent: number, discountPercent: number) {
  const totalWithoutVAT = items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0);
  const discountAmount = discountPercent > 0 ? (totalWithoutVAT * discountPercent) / 100 : 0;
  const base = Math.max(0, totalWithoutVAT - discountAmount);
  const vatAmount = vatPercent > 0 ? (base * vatPercent) / 100 : 0;
  const totalWithVAT = base + vatAmount;
  return { totalWithoutVAT, vatAmount, totalWithVAT };
}

function statusFromPayments(totalWithVAT: number, paymentsSum: number): "unpaid" | "partial" | "paid" {
  if (paymentsSum <= 0) return "unpaid";
  if (paymentsSum >= totalWithVAT) return "paid";
  return "partial";
}

function daysUntil(date: Date): number {
  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

async function maybeNotifyDueSoon(inv: { invoiceId: string; customerId: string; status: string; dueDate: Date | null; dueSoonNotifiedAt: Date | null }, actorUserId?: string) {
  if (!inv.dueDate) return;
  if (inv.status === "paid") return;
  const days = daysUntil(inv.dueDate);
  if (days === 5 && !inv.dueSoonNotifiedAt) {
    appendNotification({
      type: "invoice",
      message: `Invoice ${inv.invoiceId} for customer ${inv.customerId} has 5 days remaining to complete payment`,
      actorUserId,
    });
    await prisma.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueSoonNotifiedAt: new Date() } });
  }
}

export const createInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const body: CreateInvoiceBody = req.body || {};
    const { customerId, customerName, date, location, salesAgent, locationId, salesAgentId, vatPercent = 7.5, discountPercent = 0, paymentTermType, dueDate, notes, items, invoiceNumber } = body;
    if (!location || !salesAgent || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }
    // Resolve customer
    let resolvedCustomerId = customerId || "";
    if (!resolvedCustomerId) {
      const normalizedName = (customerName || "").trim();
      if (!normalizedName) {
        res.status(400).json({ message: "customerName or customerId is required" });
        return;
      }
      const existing = await prisma.customers.findFirst({ where: { name: normalizedName } });
      if (existing) {
        resolvedCustomerId = existing.customerId;
      } else {
        const created = await prisma.customers.create({ data: { customerId: randomUUID(), name: normalizedName } });
        resolvedCustomerId = created.customerId;
      }
    }

    // Hydrate items with default prices if missing
    const hydrated = await Promise.all(
      items.map(async (it) => {
        let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
        let displayName = it.name;
        if (it.productId) {
          const p = await prisma.products.findUnique({ where: { productId: it.productId } });
          if (p) {
            displayName = displayName || p.name;
            if (unitPrice === undefined) {
              if (it.unit === "pcs") {
                const pack = Number((p.packSize || "").replace(/\D+/g, "")) || 1;
                unitPrice = p.price / Math.max(pack, 1);
              } else {
                unitPrice = p.price;
              }
            }
          }
        }
        unitPrice = unitPrice ?? 0;
        const quantity = Math.max(1, Number(it.quantity) || 1);
        return { productId: it.productId, name: displayName, unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
      })
    );

    const totals = computeTotals(hydrated, vatPercent, discountPercent);
    const invoiceId = randomUUID();
    // Resolve normalized names if IDs provided
    let resolvedLocation = location;
    let resolvedSalesAgent = salesAgent;
    if (locationId) {
      const loc = await prisma.locations.findUnique({ where: { id: locationId } });
      resolvedLocation = loc?.name || location;
    }
    if (salesAgentId) {
      const agent = await prisma.salesAgents.findUnique({ where: { id: salesAgentId } });
      resolvedSalesAgent = agent?.name || salesAgent;
    }
    const created = await prisma.invoices.create({
      data: {
        invoiceId,
        customerId: resolvedCustomerId,
        date: date ? new Date(date) : new Date(),
        location: resolvedLocation,
        salesAgent: resolvedSalesAgent,
        locationId: locationId || null,
        salesAgentId: salesAgentId || null,
        vatPercent,
        discountPercent,
        paymentTermType: paymentTermType === "due_date" ? "due_date" : "immediate",
        dueDate: dueDate ? new Date(dueDate) : null,
        status: "unpaid",
        totalWithoutVAT: totals.totalWithoutVAT,
        vatAmount: totals.vatAmount,
        totalWithVAT: totals.totalWithVAT,
        notes: notes || null,
        items: { create: hydrated.map((h) => ({ id: randomUUID(), productId: h.productId || null, name: h.name, unit: h.unit, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal })) },
      },
      include: { items: true, payments: true },
    });

    // Persist optional invoice number in meta store
    if (invoiceNumber && invoiceNumber.trim()) {
      upsertInvoiceMeta({ invoiceId, invoiceNumber: invoiceNumber.trim() });
    }

    // After creating invoice, deduct stock and record purchases for each item
    for (const h of hydrated) {
      const qty = Math.max(0, Number(h.quantity) || 0);
      const unitPrice = Number(h.unitPrice || 0);
      const totalCost = unitPrice * qty;

      if (h.unit === "pcs") {
        const nameForPcs = (h.name || "").trim();
        if (nameForPcs) {
          // Adjust PCS inventory maintained in JSON store
          adjustPcsQuantity({ name: nameForPcs, delta: -qty });
        }
        // Record purchase if linked to a product
        if (h.productId) {
          await prisma.customerPurchases.create({
            data: {
              id: randomUUID(),
              customerId: resolvedCustomerId,
              productId: h.productId,
              timestamp: created.date,
              quantity: qty,
              unitPrice,
              totalCost,
            },
          });
        }
      } else {
        // Carton unit: deduct from product stock (clamped at 0) and record purchase
        if (h.productId) {
          const p = await prisma.products.findUnique({ where: { productId: h.productId } });
          if (p) {
            const newQty = Math.max(0, Number(p.stockQuantity) - qty);
            await prisma.products.update({ where: { productId: h.productId }, data: { stockQuantity: newQty } });
            await prisma.customerPurchases.create({
              data: {
                id: randomUUID(),
                customerId: resolvedCustomerId,
                productId: h.productId,
                timestamp: created.date,
                quantity: qty,
                unitPrice,
                totalCost,
              },
            });
          }
        }
      }
    }

    appendNotification({ type: "invoice", message: `Invoice created: ${created.invoiceId} (${created.location})`, actorUserId: req.user?.userId });
    await maybeNotifyDueSoon(created as any, req.user?.userId);
    res.status(201).json(created);
  } catch (err) {
    console.error("createInvoice error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create invoice";
    res.status(500).json({ message: msg });
  }
};

export const getInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search || "").toString().trim().toLowerCase();
    const agentId = (req.query.agentId || "").toString().trim();
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const where: any = {};
    if (agentId) {
      where.OR = [ { salesAgentId: agentId } ];
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }
    const invoices = await prisma.invoices.findMany({ where, include: { items: true, payments: true }, orderBy: { date: "desc" } });
    for (const inv of invoices) {
      await maybeNotifyDueSoon(inv as any, req.user?.userId);
    }
    if (!invoices.length) {
      res.json({ invoices: [] });
      return;
    }
    const customerIds = Array.from(new Set(invoices.map((i) => i.customerId))).filter(Boolean);
    const customers = customerIds.length
      ? await prisma.customers.findMany({ where: { customerId: { in: customerIds } } })
      : [];
    const customerMap = new Map(customers.map((c) => [c.customerId, c.name] as const));
    const list = invoices
      .map((inv) => {
        const paymentsSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
        const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
        const meta = getInvoiceMeta(inv.invoiceId);
        return { ...inv, status, customerName: customerMap.get(inv.customerId), invoiceNumber: meta?.invoiceNumber || undefined } as any;
      })
      .filter((inv) => {
        if (!search) return true;
        return (
          inv.invoiceId.toLowerCase().includes(search) ||
          (inv.invoiceNumber || "").toLowerCase().includes(search) ||
          (inv.customerName || "").toLowerCase().includes(search) ||
          inv.location.toLowerCase().includes(search)
        );
      });
    res.json({ invoices: list });
  } catch (err) {
    console.error("getInvoices error:", err);
    const msg = err instanceof Error ? err.message : "Failed to load invoices";
    res.status(500).json({ message: msg });
  }
};

export const getInvoiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const inv = await prisma.invoices.findUnique({ where: { invoiceId: id }, include: { items: true, payments: true } });
    if (!inv) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const paymentsSum = inv.payments.reduce((acc, p) => acc + p.amount, 0);
    const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
    const meta = getInvoiceMeta(inv.invoiceId);
    res.json({ ...inv, status, invoiceNumber: meta?.invoiceNumber || undefined });
  } catch (err) {
    console.error("getInvoiceById error:", err);
    res.status(500).json({ message: "Failed to load invoice" });
  }
};

export const updateInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body: Partial<CreateInvoiceBody> & { items?: Array<{ id?: string; productId?: string; name: string; unit: "ctn" | "pcs"; quantity: number; unitPrice?: number }> } = req.body || {};
    const existing = await prisma.invoices.findUnique({ where: { invoiceId: id }, include: { items: true, payments: true } });
    if (!existing) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const vatPercent = typeof body.vatPercent === "number" ? body.vatPercent : existing.vatPercent;
    const discountPercent = typeof body.discountPercent === "number" ? body.discountPercent : existing.discountPercent;
    const updatedItems = body.items ? await Promise.all(body.items.map(async (it) => {
      let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
      let displayName = it.name;
      if (it.productId) {
        const p = await prisma.products.findUnique({ where: { productId: it.productId } });
        if (p) {
          displayName = displayName || p.name;
          if (unitPrice === undefined) {
            if (it.unit === "pcs") {
              const pack = Number((p.packSize || "").replace(/\D+/g, "")) || 1;
              unitPrice = p.price / Math.max(pack, 1);
            } else {
              unitPrice = p.price;
            }
          }
        }
      }
      unitPrice = unitPrice ?? 0;
      const quantity = Math.max(1, Number(it.quantity) || 1);
      return { id: randomUUID(), productId: it.productId || null, name: displayName, unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
    })) : existing.items;

    const totals = computeTotals(updatedItems.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })), vatPercent, discountPercent);
    // Resolve normalized display names if IDs provided
    let nextLocation = body.location ?? existing.location;
    let nextSalesAgent = body.salesAgent ?? existing.salesAgent;
    let nextLocationId = body.locationId ?? existing.locationId ?? null;
    let nextSalesAgentId = body.salesAgentId ?? existing.salesAgentId ?? null;
    if (body.locationId) {
      const loc = await prisma.locations.findUnique({ where: { id: body.locationId } });
      nextLocation = loc?.name || nextLocation;
      nextLocationId = body.locationId;
    }
    if (body.salesAgentId) {
      const agent = await prisma.salesAgents.findUnique({ where: { id: body.salesAgentId } });
      nextSalesAgent = agent?.name || nextSalesAgent;
      nextSalesAgentId = body.salesAgentId;
    }

    const updated = await prisma.invoices.update({
      where: { invoiceId: id },
      data: {
        location: nextLocation,
        salesAgent: nextSalesAgent,
        locationId: nextLocationId,
        salesAgentId: nextSalesAgentId,
        // Allow updating the invoice date if provided
        date: body.date ? new Date(body.date) : existing.date,
        vatPercent,
        discountPercent,
        paymentTermType: body.paymentTermType ? (body.paymentTermType === "due_date" ? "due_date" : "immediate") : existing.paymentTermType,
        dueDate: body.dueDate ? new Date(body.dueDate) : existing.dueDate,
        notes: body.notes ?? existing.notes,
        totalWithoutVAT: totals.totalWithoutVAT,
        vatAmount: totals.vatAmount,
        totalWithVAT: totals.totalWithVAT,
        items: body.items ? {
          deleteMany: { invoiceId: id },
          create: updatedItems.map((h) => ({ id: h.id, productId: h.productId || null, name: h.name, unit: h.unit, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal })),
        } : undefined,
      },
      include: { items: true, payments: true },
    });

    // Update invoice number in meta store if provided
    if (typeof body.invoiceNumber === "string") {
      const normalized = body.invoiceNumber.trim();
      upsertInvoiceMeta({ invoiceId: id, invoiceNumber: normalized || null });
    }

    // Reconcile inventory changes based on item diffs (carton stock and PCS inventory)
    const prevMap = new Map<string, { qty: number }>();
    for (const it of existing.items) {
      if (it.unit === "ctn" && it.productId) {
        prevMap.set(`ctn:${it.productId}`, { qty: (prevMap.get(`ctn:${it.productId}`)?.qty || 0) + Number(it.quantity || 0) });
      } else if (it.unit === "pcs") {
        const keyName = String(it.name || "").trim();
        if (keyName) prevMap.set(`pcs:${keyName.toLowerCase()}`, { qty: (prevMap.get(`pcs:${keyName.toLowerCase()}`)?.qty || 0) + Number(it.quantity || 0) });
      }
    }

    const nextMap = new Map<string, { qty: number; unitPrice?: number; productId?: string; name?: string }>();
    for (const it of updated.items) {
      if (it.unit === "ctn" && it.productId) {
        const k = `ctn:${it.productId}`;
        const prev = nextMap.get(k);
        nextMap.set(k, { qty: (prev?.qty || 0) + Number(it.quantity || 0), unitPrice: it.unitPrice, productId: it.productId || undefined });
      } else if (it.unit === "pcs") {
        const keyName = String(it.name || "").trim().toLowerCase();
        if (!keyName) continue;
        const k = `pcs:${keyName}`;
        const prev = nextMap.get(k);
        nextMap.set(k, { qty: (prev?.qty || 0) + Number(it.quantity || 0), unitPrice: it.unitPrice, name: it.name });
      }
    }

    const keys = new Set<string>([...prevMap.keys(), ...nextMap.keys()]);
    let changedCount = 0;
    for (const k of keys) {
      const prevQty = prevMap.get(k)?.qty || 0;
      const nextQty = nextMap.get(k)?.qty || 0;
      const delta = nextQty - prevQty;
      if (!delta) continue;
      changedCount += 1;
      if (k.startsWith("ctn:")) {
        const productId = k.slice(4);
        const p = await prisma.products.findUnique({ where: { productId } });
        if (p) {
          const newQty = Math.max(0, Number(p.stockQuantity) - delta); // delta>0 deduct; delta<0 add back
          await prisma.products.update({ where: { productId }, data: { stockQuantity: newQty } });
          // Record additional purchases only when quantity increases
          if (delta > 0) {
            const unitPrice = Number(nextMap.get(k)?.unitPrice || p.price);
            await prisma.customerPurchases.create({ data: {
              id: randomUUID(),
              customerId: updated.customerId,
              productId,
              timestamp: updated.date,
              quantity: delta,
              unitPrice,
              totalCost: unitPrice * delta,
            } });
          }
        }
      } else if (k.startsWith("pcs:")) {
        const name = k.slice(4);
        adjustPcsQuantity({ name, delta: -delta });
      }
    }
    if (changedCount > 0) {
      appendNotification({ type: "inventory", message: `Reconciled inventory for invoice ${id}; ${changedCount} item group(s) adjusted.`, actorUserId: req.user?.userId });
    }
    await maybeNotifyDueSoon(updated as any, req.user?.userId);
    const meta = getInvoiceMeta(id);
    res.json({ ...updated, invoiceNumber: meta?.invoiceNumber || undefined });
  } catch (err) {
    console.error("updateInvoice error:", err);
    res.status(500).json({ message: "Failed to update invoice" });
  }
};

export const addPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body: { customerId?: string; date?: string; amount: number; bankName: string; bankAccount: string } = req.body || ({} as any);
    const inv = await prisma.invoices.findUnique({ where: { invoiceId: id }, include: { payments: true } });
    if (!inv) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const payment = await prisma.payments.create({
      data: {
        id: randomUUID(),
        invoiceId: id,
        customerId: body.customerId || inv.customerId,
        date: body.date ? new Date(body.date) : new Date(),
        amount: Number(body.amount) || 0,
        bankName: body.bankName,
        bankAccount: body.bankAccount,
      },
    });
    const paymentsSum = (inv.payments || []).reduce((acc, p) => acc + p.amount, 0) + payment.amount;
    const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
    const updatedInv = await prisma.invoices.update({ where: { invoiceId: id }, data: { status } });
    appendNotification({ type: "invoice", message: `Payment added for invoice ${id}: ₦${payment.amount.toFixed(2)} (${payment.bankName})`, actorUserId: req.user?.userId });
    res.status(201).json({ payment, invoice: updatedInv });
  } catch (err) {
    console.error("addPayment error:", err);
    res.status(500).json({ message: "Failed to add payment" });
  }
};

// DELETE /invoices/:id - delete an invoice and reconcile inventory & related records
export const deleteInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const inv = await prisma.invoices.findUnique({ where: { invoiceId: id }, include: { items: true, payments: true } });
    if (!inv) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    // Revert inventory adjustments and remove customer purchase records linked by timestamp & productId
    for (const it of inv.items) {
      const qty = Math.max(0, Number(it.quantity) || 0);
      if (it.unit === "ctn" && it.productId) {
        const p = await prisma.products.findUnique({ where: { productId: it.productId } });
        if (p) {
          const newQty = Math.max(0, Number(p.stockQuantity) + qty);
          await prisma.products.update({ where: { productId: it.productId }, data: { stockQuantity: newQty } });
        }
      } else if (it.unit === "pcs") {
        const nameForPcs = String(it.name || "").trim();
        if (nameForPcs) {
          await adjustPcsQuantity({ name: nameForPcs, delta: qty });
        }
      }

      // Remove any recorded customer purchases for this invoice item (matching customer, date, product)
      await prisma.customerPurchases.deleteMany({
        where: {
          customerId: inv.customerId,
          timestamp: inv.date,
          productId: it.productId ?? undefined,
        },
      });
    }

    // Remove dependent records first to satisfy FK constraints
    await prisma.payments.deleteMany({ where: { invoiceId: id } });
    await prisma.invoiceItems.deleteMany({ where: { invoiceId: id } });

    await prisma.invoices.delete({ where: { invoiceId: id } });
    // Remove meta on delete for cleanliness
    try { removeInvoiceMeta(id); } catch {}
    appendNotification({ type: "invoice", message: `Invoice deleted: ${id}`, actorUserId: req.user?.userId });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteInvoice error:", err);
    const msg = err instanceof Error ? err.message : "Failed to delete invoice";
    res.status(500).json({ message: msg });
  }
};