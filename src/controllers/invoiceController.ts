import { Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";
import { appendNotification } from "../services/notificationService";
import { getInvoiceMeta, upsertInvoiceMeta, removeInvoiceMeta } from "../services/invoiceMetaService";
import { adjustPcsQuantity } from "../services/pcsInventoryService";
import { createErrorResponse } from "../utils/errorHandler";

const CreateInvoiceBodySchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  date: z.string().optional(),
  location: z.string().min(1),
  salesAgent: z.string().min(1),
  locationId: z.string().optional(),
  salesAgentId: z.string().optional(),
  vatPercent: z.coerce.number().nonnegative().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  paymentTermType: z.enum(["immediate", "due_date"]),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  invoiceNumber: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().optional(),
    name: z.string().min(1),
    unit: z.enum(["ctn", "pcs"]),
    quantity: z.coerce.number().int().min(1),
    unitPrice: z.coerce.number().nonnegative().optional(),
  })),
});

const UpdateInvoiceBodySchema = z.object({
  date: z.string().optional(),
  location: z.string().optional(),
  salesAgent: z.string().optional(),
  locationId: z.string().optional(),
  salesAgentId: z.string().optional(),
  vatPercent: z.coerce.number().nonnegative().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  paymentTermType: z.enum(["immediate", "due_date"]).optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  invoiceNumber: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        productId: z.string().optional(),
        name: z.string().optional(),
        unit: z.enum(["ctn", "pcs"]),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().nonnegative().optional(),
      })
    )
    .optional(),
});

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
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const body = CreateInvoiceBodySchema.parse(req.body || {});
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
      const existing = await prisma.customers.findFirst({ where: { name: normalizedName, tenantId } });
      if (existing) {
        resolvedCustomerId = existing.customerId;
      } else {
        const created = await prisma.customers.create({ data: { customerId: randomUUID(), name: normalizedName, tenantId } });
        resolvedCustomerId = created.customerId;
      }
    }

    const productIds = Array.from(new Set(items.map((it) => it.productId).filter(Boolean))) as string[];
    const products = productIds.length ? await prisma.products.findMany({ where: { tenantId, productId: { in: productIds } } }) : [];
    const byId = new Map<string, any>(products.map((p: any) => [p.productId, p]));
    const hydrated = items.map((it) => {
      let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
      const p = it.productId ? byId.get(it.productId) : undefined;
      let displayName = it.name || (p ? p.name : undefined);
      if (unitPrice === undefined) {
        if (p) {
          if (it.unit === "pcs") {
            const pack = Number(String(p.packSize || "").replace(/\D+/g, "")) || 1;
            unitPrice = Number(p.price) / Math.max(pack, 1);
          } else {
            unitPrice = Number(p.price);
          }
        } else {
          unitPrice = 0;
        }
      }
      unitPrice = unitPrice ?? 0;
      const quantity = Math.max(1, Number(it.quantity) || 1);
      return { productId: it.productId, name: displayName, unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
    });

    const totals = computeTotals(hydrated, vatPercent, discountPercent);
    const invoiceId = randomUUID();
    // Resolve normalized names if IDs provided
    let resolvedLocation = location;
    let resolvedSalesAgent = salesAgent;
    if (locationId) {
      const loc = await prisma.locations.findFirst({ where: { id: locationId, tenantId } });
      resolvedLocation = loc?.name || location;
    }
    if (salesAgentId) {
      const agent = await prisma.salesAgents.findFirst({ where: { id: salesAgentId, tenantId } });
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
        tenantId,
        items: { create: hydrated.map((h) => ({ id: randomUUID(), productId: h.productId || null, name: h.name, unit: h.unit, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal, tenantId })) },
      },
      include: { items: true, payments: true },
    });

    // Persist optional invoice number in meta store
    if (invoiceNumber && invoiceNumber.trim()) {
      await upsertInvoiceMeta({ invoiceId, invoiceNumber: invoiceNumber.trim(), tenantId });
    }

    const createdWithMeta = {
      ...created,
      invoiceNumber: invoiceNumber?.trim() || undefined,
      customerName: resolvedCustomerId ? (await prisma.customers.findFirst({ where: { customerId: resolvedCustomerId, tenantId } }))?.name : undefined
    };

    try {
      const io = req.app.get("io");
      io.emit("invoice:created", createdWithMeta);
      io.emit("dashboard:refresh", { tenantId });
    } catch (err) {
      console.warn("Socket emission failed for createInvoice", err);
    }

    const pcsTotals = new Map<string, number>();
    const ctnTotals = new Map<string, { qty: number }>();
    const purchaseRows: Array<{ id: string; customerId: string; productId: string; timestamp: Date; quantity: number; unitPrice: number; totalCost: number; tenantId: string }> = [];
    for (const h of hydrated) {
      const qty = Math.max(0, Number(h.quantity) || 0);
      const unitPrice = Number(h.unitPrice || 0);
      const totalCost = unitPrice * qty;
      if (h.unit === "pcs") {
        const key = String(h.name || "").trim().toLowerCase();
        if (key) pcsTotals.set(key, (pcsTotals.get(key) || 0) + qty);
        if (h.productId) {
          purchaseRows.push({ id: randomUUID(), customerId: resolvedCustomerId, productId: h.productId, timestamp: created.date, quantity: qty, unitPrice, totalCost, tenantId });
        }
      } else {
        if (h.productId) {
          ctnTotals.set(h.productId, { qty: (ctnTotals.get(h.productId)?.qty || 0) + qty });
          purchaseRows.push({ id: randomUUID(), customerId: resolvedCustomerId, productId: h.productId, timestamp: created.date, quantity: qty, unitPrice, totalCost, tenantId });
        }
      }
    }
    const pcsPromises: Promise<any>[] = [];
    for (const [name, qty] of pcsTotals.entries()) {
      pcsPromises.push(adjustPcsQuantity({ name, delta: -qty, tenantId }));
    }
    if (pcsPromises.length) await Promise.all(pcsPromises);
    if (ctnTotals.size) {
      const ids = Array.from(ctnTotals.keys());
      const prods = ids.length ? await prisma.products.findMany({ where: { tenantId, productId: { in: ids } } }) : [];
      const map = new Map<string, any>(prods.map((p: any) => [p.productId, p]));
      const updates = ids
        .map((pid) => {
          const p = map.get(pid);
          if (!p) return null;
          const nextQty = Math.max(0, Number(p.stockQuantity) - Number(ctnTotals.get(pid)?.qty || 0));
          return prisma.products.update({ where: { productId: pid }, data: { stockQuantity: nextQty } });
        })
        .filter(Boolean) as any[];
      if (updates.length) await prisma.$transaction(updates);
    }
    if (purchaseRows.length) {
      await prisma.customerPurchases.createMany({ data: purchaseRows });
    }

    appendNotification({ type: "invoice", message: `Invoice created: ${created.invoiceId} (${created.location})`, actorUserId: req.user?.userId });
    await maybeNotifyDueSoon(created as any, req.user?.userId);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to create invoice"));
  }
};

export const getInvoicePrintOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.invoices.findFirst({ where: { invoiceId: id, tenantId } });
    if (!existing) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    res.json({
      invoiceId: id,
      options: {
        includePrices: true,
        includeDiscounts: true,
        includeVAT: true,
        pageSizes: ["A4", "Letter"],
        orientation: ["portrait", "landscape"],
      },
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to load print options"));
  }
};

export const getInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search || "").toString().trim().toLowerCase();
    const agentId = (req.query.agentId || "").toString().trim();
    const customerIdQ = (req.query.customerId || "").toString().trim();
    const customerQ = (req.query.customer || "").toString().trim().toLowerCase();
    const locationQ = (req.query.location || "").toString().trim();
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const statusQ = (req.query.status || "").toString().trim().toLowerCase();
    const limit = Math.max(0, Number(req.query.limit || 0));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const where: any = { tenantId };
    if (agentId) {
      where.OR = [ { salesAgentId: agentId } ];
    }
    if (customerIdQ) {
      where.customerId = customerIdQ;
    }
    if (locationQ) {
      where.location = { contains: locationQ, mode: "insensitive" };
    }
    if (customerQ) {
      where.customer = { name: { contains: customerQ, mode: "insensitive" } };
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }
    if (statusQ === "paid" || statusQ === "unpaid" || statusQ === "partial") {
      where.status = statusQ;
    }
    const invoices = await prisma.invoices.findMany({
      where,
      select: {
        invoiceId: true,
        customerId: true,
        date: true,
        location: true,
        salesAgent: true,
        status: true,
        totalWithoutVAT: true,
        vatAmount: true,
        totalWithVAT: true,
        dueDate: true,
        dueSoonNotifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { date: "desc" },
    });
    for (const inv of invoices) {
      await maybeNotifyDueSoon(inv as any, req.user?.userId);
    }
    if (!invoices.length) {
      res.json({ invoices: [], total: 0 });
      return;
    }
    const customerIds = Array.from(new Set(invoices.map((i: any) => i.customerId))).filter(Boolean);
    const customers = customerIds.length
      ? await prisma.customers.findMany({ where: { tenantId, customerId: { in: customerIds } } })
      : [];
    const customerMap = new Map(customers.map((c: any) => [c.customerId, c.name] as const));
    const list = await Promise.all(
      invoices.map(async (inv: any) => {
        const meta = await getInvoiceMeta(inv.invoiceId);
        return { ...inv, customerName: customerMap.get(inv.customerId), invoiceNumber: meta?.invoiceNumber || undefined } as any;
      })
    );
    let filtered = list.filter((inv) => {
      if (!search) return true;
      return (
        inv.invoiceId.toLowerCase().includes(search) ||
        (inv.invoiceNumber || "").toLowerCase().includes(search) ||
        (inv.customerName || "").toLowerCase().includes(search) ||
        inv.location.toLowerCase().includes(search)
      );
    });
    if (statusQ === "paid" || statusQ === "unpaid" || statusQ === "partial") {
      filtered = filtered.filter((inv) => inv.status === statusQ);
    }
    const total = filtered.length;
    const pageSlice = limit > 0 ? filtered.slice(offset, offset + limit) : filtered;
    res.json({ invoices: pageSlice, total });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to load invoices"));
  }
};

export const getInvoiceStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const where: any = { tenantId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }
    const [paid, unpaid, partial] = await Promise.all([
      prisma.invoices.count({ where: { ...where, status: "paid" } }),
      prisma.invoices.count({ where: { ...where, status: "unpaid" } }),
      prisma.invoices.count({ where: { ...where, status: "partial" } }),
    ]);
    res.json({ counts: { paid, unpaid, partial } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to load invoice stats"));
  }
};

export const getInvoiceById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const inv = await prisma.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: true, payments: true } });
    if (!inv) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const paymentsSum = inv.payments.reduce((acc: number, p: any) => acc + p.amount, 0);
    const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
    const meta = await getInvoiceMeta(inv.invoiceId);
    res.json({ ...inv, status, invoiceNumber: meta?.invoiceNumber || undefined });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to load invoice"));
  }
};

export const updateInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const { id } = req.params;
    const body = UpdateInvoiceBodySchema.parse(req.body || {});
    const existing = await prisma.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: true, payments: true } });
    if (!existing) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }
    const vatPercent = typeof body.vatPercent === "number" ? body.vatPercent : existing.vatPercent;
    const discountPercent = typeof body.discountPercent === "number" ? body.discountPercent : existing.discountPercent;
    const updatedItems = body.items ? await Promise.all(body.items.map(async (it: { id?: string; productId?: string; name?: string; unit: "ctn" | "pcs"; quantity: number; unitPrice?: number }) => {
      let unitPrice = typeof it.unitPrice === "number" ? it.unitPrice : undefined;
      let displayName = it.name;
      if (it.productId) {
        const p = await prisma.products.findFirst({ where: { productId: it.productId, tenantId } });
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
      return { id: randomUUID(), productId: it.productId || null, name: displayName || "", unit: it.unit, quantity, unitPrice, subtotal: quantity * unitPrice };
    })) : existing.items;

    const totals = computeTotals(updatedItems.map((i: any) => ({ quantity: i.quantity, unitPrice: i.unitPrice })), vatPercent, discountPercent);
    // Resolve normalized display names if IDs provided
    let nextLocation = body.location ?? existing.location;
    let nextSalesAgent = body.salesAgent ?? existing.salesAgent;
    let nextLocationId = body.locationId ?? existing.locationId ?? null;
    let nextSalesAgentId = body.salesAgentId ?? existing.salesAgentId ?? null;
    if (body.locationId) {
      const loc = await prisma.locations.findFirst({ where: { id: body.locationId, tenantId } });
      nextLocation = loc?.name || nextLocation;
      nextLocationId = body.locationId;
    }
    if (body.salesAgentId) {
      const agent = await prisma.salesAgents.findFirst({ where: { id: body.salesAgentId, tenantId } });
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
          create: updatedItems.map((h: any) => ({ id: h.id, productId: h.productId || null, name: h.name, unit: h.unit, quantity: h.quantity, unitPrice: h.unitPrice, subtotal: h.subtotal })),
        } : undefined,
      },
      include: { items: true, payments: true },
    });

    // Update invoice number in meta store if provided
    if (typeof body.invoiceNumber === "string") {
      const normalized = body.invoiceNumber.trim();
      await upsertInvoiceMeta({ invoiceId: id, invoiceNumber: normalized || null, tenantId });
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
        const p = await prisma.products.findFirst({ where: { productId, tenantId } });
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
        await adjustPcsQuantity({ name, delta: -delta, tenantId });
      }
    }
    if (changedCount > 0) {
      appendNotification({ type: "inventory", message: `Reconciled inventory for invoice ${id}; ${changedCount} item group(s) adjusted.`, actorUserId: req.user?.userId });
    }
    await maybeNotifyDueSoon(updated as any, req.user?.userId);
    const meta = await getInvoiceMeta(id, req.tenantId || req.user?.tenantId || "default");
    
    const updatedWithMeta = { ...updated, invoiceNumber: meta?.invoiceNumber || undefined };
    try {
        const io = req.app.get("io");
        io.emit("invoice:updated", updatedWithMeta);
        io.emit("dashboard:refresh", { tenantId: req.tenantId || req.user?.tenantId || "default" });
    } catch (err) {
        console.warn("Socket emission failed for updateInvoice", err);
    }
    
    res.json(updatedWithMeta);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to update invoice"));
  }
};

export const addPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const body: { customerId?: string; date?: string; amount: number; bankName: string; bankAccount: string } = req.body || ({} as any);
    const inv = await prisma.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { payments: true } });
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
        tenantId,
      },
    });
    const paymentsSum = (inv.payments || []).reduce((acc: number, p: any) => acc + p.amount, 0) + payment.amount;
    const status = statusFromPayments(inv.totalWithVAT, paymentsSum);
    const updatedInv = await prisma.invoices.update({ where: { invoiceId: id }, data: { status } });
    appendNotification({ type: "invoice", message: `Payment added for invoice ${id}: ₦${payment.amount.toFixed(2)} (${payment.bankName})`, actorUserId: req.user?.userId });

    const fullInvoice = await prisma.invoices.findUnique({
      where: { invoiceId: id },
      include: { items: true, payments: true },
    });
    if (fullInvoice) {
      const meta = await getInvoiceMeta(id, tenantId);
      try {
        const io = req.app.get("io");
        io.emit("invoice:updated", { ...fullInvoice, invoiceNumber: meta?.invoiceNumber });
        io.emit("dashboard:refresh", { tenantId });
      } catch (err) {
        console.warn("Socket emission failed for addPayment", err);
      }
    }

    res.status(201).json({ payment, invoice: updatedInv });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to add payment"));
  }
};

// DELETE /invoices/:id - delete an invoice and reconcile inventory & related records
export const deleteInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const inv = await prisma.invoices.findFirst({ where: { invoiceId: id, tenantId }, include: { items: true, payments: true } });
    if (!inv) {
      res.status(404).json({ message: "Invoice not found" });
      return;
    }

    // Revert inventory adjustments and remove customer purchase records linked by timestamp & productId
    for (const it of inv.items) {
      const qty = Math.max(0, Number(it.quantity) || 0);
      if (it.unit === "ctn" && it.productId) {
        const p = await prisma.products.findFirst({ where: { productId: it.productId, tenantId } });
        if (p) {
          const newQty = Math.max(0, Number(p.stockQuantity) + qty);
          await prisma.products.update({ where: { productId: it.productId }, data: { stockQuantity: newQty } });
        }
      } else if (it.unit === "pcs") {
        const nameForPcs = String(it.name || "").trim();
        if (nameForPcs) {
          await adjustPcsQuantity({ name: nameForPcs, delta: qty, tenantId });
        }
      }

      // Remove any recorded customer purchases for this invoice item (matching customer, date, product)
      await prisma.customerPurchases.deleteMany({
        where: {
          customerId: inv.customerId,
          timestamp: inv.date,
          productId: it.productId ?? undefined,
          tenantId,
        },
      });
    }

    // Remove dependent records first to satisfy FK constraints
    await prisma.payments.deleteMany({ where: { invoiceId: id, tenantId } });
    await prisma.invoiceItems.deleteMany({ where: { invoiceId: id, tenantId } });

    await prisma.invoices.delete({ where: { invoiceId: id } });
    // Remove meta on delete for cleanliness
    try { await removeInvoiceMeta(id); } catch {}
    appendNotification({ type: "invoice", message: `Invoice deleted: ${id}`, actorUserId: req.user?.userId });
    
    try {
      const io = req.app.get("io");
      io.emit("invoice:deleted", { invoiceId: id });
      io.emit("dashboard:refresh", { tenantId });
    } catch (err) {
      console.warn("Socket emission failed for deleteInvoice", err);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "invoice", "Failed to delete invoice"));
  }
};
