"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentInvoices = exports.deleteSalesAgent = exports.updateSalesAgent = exports.createSalesAgent = exports.getSalesAgents = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const getSalesAgents = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const search = String(req.query.search || "").trim().toLowerCase();
        const invs = await prisma_1.default.invoices.findMany({ where: { tenantId }, select: { salesAgentId: true, salesAgent: true } });
        const ids = Array.from(new Set(invs.map((i) => i.salesAgentId).filter(Boolean)));
        const byKey = new Map();
        const normalized = (s) => s.trim().toLowerCase();
        // Include all manually created agents for this tenant
        const tenantAgents = await prisma_1.default.salesAgents.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        for (const a of tenantAgents) {
            const key = normalized(a.name || "");
            if (!key)
                continue;
            if (!byKey.has(key))
                byKey.set(key, { id: a.id, name: a.name, mobile: a.mobile ?? null, email: a.email ?? null });
        }
        // Also include agents referenced by invoices (may include legacy entries)
        if (ids.length) {
            const fromIds = await prisma_1.default.salesAgents.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
            for (const a of fromIds) {
                const key = normalized(a.name || "");
                if (!key)
                    continue;
                if (!byKey.has(key))
                    byKey.set(key, { id: a.id, name: a.name, mobile: a.mobile ?? null, email: a.email ?? null });
            }
        }
        for (const i of invs) {
            const n = String(i.salesAgent || "").trim();
            if (!n)
                continue;
            const key = normalized(n);
            if (!byKey.has(key))
                byKey.set(key, { id: i.salesAgentId || (0, crypto_1.randomUUID)(), name: n });
        }
        let list = Array.from(byKey.values());
        if (search)
            list = list.filter((a) => a.name.toLowerCase().includes(search));
        list.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ agents: list });
    }
    catch (err) {
        console.error("getSalesAgents error:", err);
        res.status(500).json({ message: "Failed to load sales agents" });
    }
};
exports.getSalesAgents = getSalesAgents;
const createSalesAgent = async (req, res) => {
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
        const existing = await prisma_1.default.salesAgents.findFirst({ where: { tenantId, name } });
        if (existing) {
            res.status(409).json({ message: "Sales agent already exists" });
            return;
        }
        const created = await prisma_1.default.salesAgents.create({ data: { id: (0, crypto_1.randomUUID)(), name, mobile, email, tenantId } });
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createSalesAgent error:", err);
        const msg = err instanceof Error ? err.message : "Failed to create sales agent";
        res.status(500).json({ message: msg });
    }
};
exports.createSalesAgent = createSalesAgent;
const updateSalesAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.salesAgents.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Sales agent not found" });
            return;
        }
        const name = req.body?.name ? String(req.body.name).trim() : undefined;
        const mobile = req.body?.mobile ? String(req.body.mobile) : undefined;
        const email = req.body?.email ? String(req.body.email) : undefined;
        const updated = await prisma_1.default.salesAgents.update({ where: { id }, data: { ...(name ? { name } : {}), mobile, email } });
        res.json(updated);
    }
    catch (err) {
        console.error("updateSalesAgent error:", err);
        res.status(500).json({ message: "Failed to update sales agent" });
    }
};
exports.updateSalesAgent = updateSalesAgent;
const deleteSalesAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.salesAgents.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Sales agent not found" });
            return;
        }
        await prisma_1.default.salesAgents.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (err) {
        console.error("deleteSalesAgent error:", err);
        res.status(500).json({ message: "Failed to delete sales agent" });
    }
};
exports.deleteSalesAgent = deleteSalesAgent;
const getAgentInvoices = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ message: "Agent id is required" });
            return;
        }
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const agent = await prisma_1.default.salesAgents.findUnique({ where: { id } });
        if (!agent) {
            res.status(404).json({ message: "Sales agent not found" });
            return;
        }
        const dateWhere = {};
        if (from)
            dateWhere.gte = from;
        if (to)
            dateWhere.lte = to;
        const invoices = await prisma_1.default.invoices.findMany({
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
        const customers = customerIds.length ? await prisma_1.default.customers.findMany({ where: { customerId: { in: customerIds } } }) : [];
        const customerMap = new Map(customers.map((c) => [c.customerId, c.name]));
        const list = invoices.map((inv) => ({ ...inv, customerName: customerMap.get(inv.customerId) }));
        res.json({ invoices: list });
    }
    catch (err) {
        console.error("getAgentInvoices error:", err);
        res.status(500).json({ message: "Failed to load agent invoices" });
    }
};
exports.getAgentInvoices = getAgentInvoices;
