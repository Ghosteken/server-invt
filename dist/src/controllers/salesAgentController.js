"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentInvoices = exports.createSalesAgent = exports.getSalesAgents = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const getSalesAgents = async (req, res) => {
    try {
        const search = String(req.query.search || "").trim().toLowerCase();
        const agents = await prisma_1.default.salesAgents.findMany({ orderBy: { name: "asc" } });
        // Deduplicate by case-insensitive name and normalize display casing
        const toTitle = (s) => s
            .trim()
            .split(/\s+/)
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
            .join(" ");
        const byKey = new Map();
        for (const a of agents) {
            const key = (a.name || "").trim().toLowerCase();
            if (!key)
                continue;
            if (!byKey.has(key)) {
                byKey.set(key, { id: a.id, name: toTitle(a.name), mobile: a.mobile ?? null, email: a.email ?? null });
            }
        }
        let unique = Array.from(byKey.values());
        if (search)
            unique = unique.filter((a) => a.name.toLowerCase().includes(search));
        unique.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ agents: unique });
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
        if (!name) {
            res.status(400).json({ message: "Agent name is required" });
            return;
        }
        const created = await prisma_1.default.salesAgents.create({ data: { id: (0, crypto_1.randomUUID)(), name, mobile, email } });
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createSalesAgent error:", err);
        const msg = err instanceof Error ? err.message : "Failed to create sales agent";
        res.status(500).json({ message: msg });
    }
};
exports.createSalesAgent = createSalesAgent;
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
