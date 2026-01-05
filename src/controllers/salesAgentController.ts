import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";
import { createErrorResponse } from "../utils/errorHandler";

export const getSalesAgents = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const search = String(req.query.search || "").trim().toLowerCase();
    const invs = await prisma.invoices.findMany({ where: { tenantId }, select: { salesAgentId: true, salesAgent: true } });
    const ids = Array.from(new Set(invs.map((i: any) => i.salesAgentId).filter(Boolean))) as string[];
    const byKey = new Map<string, { id: string; name: string; mobile?: string | null; email?: string | null }>();
    const normalized = (s: string) => s.trim().toLowerCase();
    // Include all manually created agents for this tenant
    const tenantAgents = await prisma.salesAgents.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    for (const a of tenantAgents) {
      const key = normalized(a.name || "");
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { id: a.id, name: a.name, mobile: a.mobile ?? null, email: a.email ?? null });
    }
    // Also include agents referenced by invoices (may include legacy entries)
    if (ids.length) {
      const fromIds = await prisma.salesAgents.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
      for (const a of fromIds) {
        const key = normalized(a.name || "");
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, { id: a.id, name: a.name, mobile: a.mobile ?? null, email: a.email ?? null });
      }
    }
    for (const i of invs as any[]) {
      const n = String(i.salesAgent || "").trim();
      if (!n) continue;
      const key = normalized(n);
      if (!byKey.has(key)) byKey.set(key, { id: i.salesAgentId || randomUUID(), name: n });
    }
    let list = Array.from(byKey.values());
    if (search) list = list.filter((a) => a.name.toLowerCase().includes(search));
    list.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ agents: list });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "salesAgent", "Failed to load sales agents"));
  }
};

export const createSalesAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = String(req.body?.name || '').trim();
    const mobile = req.body?.mobile ? String(req.body.mobile) : undefined;
    const email = req.body?.email ? String(req.body.email) : undefined;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    if (!name) {
      res.status(400).json({ message: "Agent name is required" });
      return;
    }
    // Enforce per-tenant uniqueness on name
    const existing = await prisma.salesAgents.findFirst({ where: { tenantId, name } });
    if (existing) { res.status(409).json({ message: "Sales agent already exists" }); return; }
    const created = await prisma.salesAgents.create({ data: { id: randomUUID(), name, mobile, email, tenantId } });
    res.status(201).json(created);
  } catch (err) {
    console.error("createSalesAgent error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create sales agent";
    res.status(500).json(createErrorResponse(err, "salesAgent", msg));
  }
};

export const updateSalesAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.salesAgents.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Sales agent not found" }); return; }
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const mobile = req.body?.mobile ? String(req.body.mobile) : undefined;
    const email = req.body?.email ? String(req.body.email) : undefined;
    const updated = await prisma.salesAgents.update({ where: { id }, data: { ...(name ? { name } : {}), mobile, email } });
    res.json(updated);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "salesAgent", "Failed to update sales agent"));
  }
};

export const deleteSalesAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.salesAgents.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Sales agent not found" }); return; }
    await prisma.salesAgents.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "salesAgent", "Failed to delete sales agent"));
  }
};

export const getAgentInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) { res.status(400).json({ message: "Agent id is required" }); return; }
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const agent = await prisma.salesAgents.findUnique({ where: { id } });
    if (!agent) { res.status(404).json({ message: "Sales agent not found" }); return; }

    const dateWhere: any = {};
    if (from) dateWhere.gte = from;
    if (to) dateWhere.lte = to;

    const invoices = await prisma.invoices.findMany({
      where: {
        OR: [
          { salesAgentId: id },
          { salesAgent: agent.name },
        ],
        ...(from || to ? { date: dateWhere } : {}),
      },
      include: { items: true, payments: true },
      orderBy: { date: "desc" },
    });

    // Hydrate customer names
    const customerIds = Array.from(new Set(invoices.map((i: any) => i.customerId))).filter(Boolean);
    const customers = customerIds.length ? await prisma.customers.findMany({ where: { customerId: { in: customerIds } } }) : [];
    const customerMap = new Map<string, string>(customers.map((c: any) => [c.customerId, c.name] as const));

    // Hydrate invoice numbers from meta store
    const invoiceIds = invoices.map((inv: any) => inv.invoiceId);
    const metas = invoiceIds.length ? await prisma.invoiceMeta.findMany({ where: { invoiceId: { in: invoiceIds } } }) : [];
    const metaMap = new Map<string, string | null>(metas.map((m: any) => [m.invoiceId, m.invoiceNumber ?? null] as const));

    const list = invoices.map((inv: any) => ({
      ...inv,
      customerName: customerMap.get(inv.customerId),
      invoiceNumber: metaMap.get(inv.invoiceId) ?? undefined,
    }));
    res.json({ invoices: list });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "salesAgent", "Failed to load agent invoices"));
  }
};
