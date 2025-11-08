import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";

export const getSalesAgents = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const agents = await prisma.salesAgents.findMany({ orderBy: { name: "asc" } });
    const list = search
      ? agents.filter((a) => a.name.toLowerCase().includes(search))
      : agents;
    res.json({ agents: list });
  } catch (err) {
    console.error("getSalesAgents error:", err);
    res.status(500).json({ message: "Failed to load sales agents" });
  }
};

export const createSalesAgent = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = String(req.body?.name || '').trim();
    const mobile = req.body?.mobile ? String(req.body.mobile) : undefined;
    const email = req.body?.email ? String(req.body.email) : undefined;
    if (!name) {
      res.status(400).json({ message: "Agent name is required" });
      return;
    }
    const created = await prisma.salesAgents.create({ data: { id: randomUUID(), name, mobile, email } });
    res.status(201).json(created);
  } catch (err) {
    console.error("createSalesAgent error:", err);
    const msg = err instanceof Error ? err.message : "Failed to create sales agent";
    res.status(500).json({ message: msg });
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
    const customerIds = Array.from(new Set(invoices.map((i) => i.customerId))).filter(Boolean);
    const customers = customerIds.length ? await prisma.customers.findMany({ where: { customerId: { in: customerIds } } }) : [];
    const customerMap = new Map(customers.map((c) => [c.customerId, c.name] as const));

    const list = invoices.map((inv) => ({ ...inv, customerName: customerMap.get(inv.customerId) }));
    res.json({ invoices: list });
  } catch (err) {
    console.error("getAgentInvoices error:", err);
    res.status(500).json({ message: "Failed to load agent invoices" });
  }
};