import { Router } from "express";
import prisma from "../db/prisma";
import { z } from "zod";
import { requirePermission } from "../middleware/permissionMiddleware";
import { getInvoiceMeta } from "../services/invoiceMetaService";

const router = Router();

router.get("/customers/search", requirePermission("statements", "view"), async (req, res) => {
  try {
    const Query = z.object({ query: z.string().optional() });
    const { query } = Query.parse(req.query);
    const q = (query || "").toString().trim();
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const where: any = { tenantId };
    if (q) where.name = { contains: q, mode: "insensitive" };
    const rows = await prisma.customers.findMany({ where, orderBy: { name: "asc" }, select: { customerId: true, name: true, mobile: true } });
    res.json({ customers: rows.map((r: any) => ({ customerId: r.customerId, name: r.name, mobile: r.mobile || undefined })) });
  } catch {
    res.status(500).json({ customers: [] });
  }
});

router.get("/customers/:customerId", requirePermission("statements", "view"), async (req, res) => {
  try {
    const Params = z.object({ customerId: z.string().min(1) });
    const { customerId } = Params.parse(req.params);
    const Query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.enum(["paid", "unpaid", "partial"]).optional(),
      bank: z.string().optional(),
    });
    const { from, to, status, bank } = Query.parse(req.query);
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const where: any = { tenantId, customerId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const invoices = await prisma.invoices.findMany({
      where,
      select: {
        invoiceId: true,
        date: true,
        status: true,
        totalWithVAT: true,
        payments: true,
      },
      orderBy: { date: "desc" },
    });
    const entries: Array<{
      invoiceId: string;
      invoiceNumber?: string;
      date: string;
      status: string;
      total: number;
      paid: number;
      balance: number;
      payments: Array<{ date: string; amount: number; bankName: string; bankAccount: string }>;
    }> = [];
    for (const inv of invoices as any[]) {
      const paid = (inv.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
      const balance = Math.max(0, Number(inv.totalWithVAT || 0) - paid);
      const meta = await getInvoiceMeta(inv.invoiceId);
      const payments = (inv.payments || []).map((p: any) => ({
        date: new Date(p.date).toISOString(),
        amount: Number(p.amount || 0),
        bankName: String(p.bankName || ""),
        bankAccount: String(p.bankAccount || ""),
      }));
      entries.push({
        invoiceId: inv.invoiceId,
        invoiceNumber: meta?.invoiceNumber || undefined,
        date: inv.date.toISOString(),
        status: inv.status,
        total: Number(inv.totalWithVAT || 0),
        paid,
        balance,
        payments,
      });
    }
    let filtered = entries;
    if (status) {
      filtered = filtered.filter((e) => {
        if (status === "paid") return e.paid >= e.total;
        if (status === "unpaid") return e.paid <= 0;
        return e.paid > 0 && e.paid < e.total;
      });
    }
    if (bank && bank.trim()) {
      const b = bank.trim().toLowerCase();
      filtered = filtered.filter((e) => e.payments.some((p) => p.bankName.toLowerCase().includes(b) || p.bankAccount.toLowerCase().includes(b)));
    }
    const summary = {
      totalInvoices: filtered.length,
      totalBilled: filtered.reduce((s, e) => s + e.total, 0),
      totalPaid: filtered.reduce((s, e) => s + e.paid, 0),
      balanceDue: filtered.reduce((s, e) => s + e.balance, 0),
      countSales: filtered.length,
    };
    res.json({ summary, entries: filtered });
  } catch {
    res.status(500).json({ summary: { totalInvoices: 0, totalBilled: 0, totalPaid: 0, balanceDue: 0, countSales: 0 }, entries: [] });
  }
});

router.get("/suppliers/search", requirePermission("statements", "view"), async (req, res) => {
  try {
    const Query = z.object({ query: z.string().optional() });
    const { query } = Query.parse(req.query);
    const q = (query || "").toString().trim();
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const rows = await prisma.suppliers.findMany({
      where: q ? { tenantId, name: { contains: q, mode: "insensitive" } } : { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, mobile: true },
    });
    res.json({ suppliers: rows.map((r: any) => ({ id: r.id, name: r.name, mobile: r.mobile || undefined })) });
  } catch {
    res.status(500).json({ suppliers: [] });
  }
});

router.get("/suppliers/:supplierId", requirePermission("statements", "view"), async (req, res) => {
  try {
    const Params = z.object({ supplierId: z.string().min(1) });
    const { supplierId } = Params.parse(req.params);
    const Query = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.enum(["paid", "unpaid", "partial"]).optional(),
      bank: z.string().optional(),
    });
    const { from, to, status, bank } = Query.parse(req.query);
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || req.user?.tenantId || "default";
    const supplier = await prisma.suppliers.findFirst({ where: { id: supplierId, tenantId } });
    const supplierName = supplier?.name || "";
    const metaWhere: any = { tenantId, supplierName: supplierName ? { equals: supplierName } : undefined };
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
    }
    const metas = await prisma.supplierPurchaseMeta.findMany({ where: metaWhere, select: { invoiceNumber: true, purchaseId: true, date: true } });
    const purchaseIds = metas.map((m: any) => m.purchaseId);
    const purchases = await prisma.purchases.findMany({
      where: { tenantId, purchaseId: { in: purchaseIds } },
      select: { purchaseId: true, totalCost: true, unitCost: true, quantity: true },
    });
    const payments = await prisma.supplierPayments.findMany({
      where: { tenantId, purchaseId: { in: purchaseIds } },
      select: { purchaseId: true, amount: true, date: true, bankName: true, bankAccount: true },
    });
    const paidByPurchaseId = new Map<string, number>();
    for (const p of payments as any[]) {
      const pid = String(p.purchaseId);
      paidByPurchaseId.set(pid, (paidByPurchaseId.get(pid) || 0) + Number(p.amount || 0));
    }
    const paymentsByInvoice = new Map<string, Array<{ date: string; amount: number; bankName: string; bankAccount: string }>>();
    for (const p of payments as any[]) {
      const meta = metas.find((m: any) => String(m.purchaseId) === String(p.purchaseId));
      const inv = meta?.invoiceNumber || "";
      const arr = paymentsByInvoice.get(inv) || [];
      arr.push({ date: new Date(p.date).toISOString(), amount: Number(p.amount || 0), bankName: String(p.bankName || ""), bankAccount: String(p.bankAccount || "") });
      paymentsByInvoice.set(inv, arr);
    }
    const totalsByInvoice = new Map<string, { total: number; timestamp: Date }>();
    for (const m of metas as any[]) {
      const pid = String(m.purchaseId);
      const p = purchases.find((x: any) => String(x.purchaseId) === pid);
      if (!p) continue;
      const quantity = Number(p.quantity) || 1;
      let unitCost = Number(p.unitCost || 0);
      let totalCost = Number(p.totalCost || 0);
      if (totalCost === 0 && unitCost > 0) totalCost = unitCost * quantity;
      if (unitCost === 0 && totalCost > 0 && quantity > 0) unitCost = totalCost / quantity;
      const prev = totalsByInvoice.get(String(m.invoiceNumber || ""));
      const nextTotal = (prev?.total || 0) + totalCost;
      totalsByInvoice.set(String(m.invoiceNumber || ""), { total: nextTotal, timestamp: new Date(m.date || Date.now()) });
    }
    let entries = Array.from(totalsByInvoice.entries()).map(([invoiceNumber, t]) => {
      const paid = (paymentsByInvoice.get(invoiceNumber) || []).reduce((sum, x) => sum + x.amount, 0);
      const balance = Math.max(0, t.total - paid);
      return {
        invoiceNumber,
        date: t.timestamp.toISOString(),
        total: t.total,
        paid,
        balance,
        payments: paymentsByInvoice.get(invoiceNumber) || [],
      };
    });
    if (status) {
      entries = entries.filter((e) => {
        if (status === "paid") return e.paid >= e.total;
        if (status === "unpaid") return e.paid <= 0;
        return e.paid > 0 && e.paid < e.total;
      });
    }
    if (bank && bank.trim()) {
      const b = bank.trim().toLowerCase();
      entries = entries.filter((e) => e.payments.some((p) => p.bankName.toLowerCase().includes(b) || p.bankAccount.toLowerCase().includes(b)));
    }
    const summary = {
      totalInvoices: entries.length,
      totalBilled: entries.reduce((s, e) => s + e.total, 0),
      totalPaid: entries.reduce((s, e) => s + e.paid, 0),
      balanceDue: entries.reduce((s, e) => s + e.balance, 0),
      countPurchases: entries.length,
    };
    res.json({ summary, entries });
  } catch {
    res.status(500).json({ summary: { totalInvoices: 0, totalBilled: 0, totalPaid: 0, balanceDue: 0, countPurchases: 0 }, entries: [] });
  }
});

export default router;
