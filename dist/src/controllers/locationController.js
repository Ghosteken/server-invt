"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocation = exports.getLocations = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const getLocations = async (_req, res) => {
    try {
        const reqAny = _req;
        const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
        const invs = await prisma_1.default.invoices.findMany({ where: { tenantId }, select: { locationId: true } });
        const ids = Array.from(new Set(invs.map((i) => i.locationId).filter(Boolean)));
        const locations = ids.length
            ? await prisma_1.default.locations.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } })
            : await prisma_1.default.locations.findMany({ orderBy: { name: "asc" } });
        res.json({ locations: locations.map((l) => ({ id: l.id, name: l.name })) });
    }
    catch (err) {
        console.error("getLocations error:", err);
        res.status(500).json({ message: "Failed to load locations" });
    }
};
exports.getLocations = getLocations;
const createLocation = async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name) {
            res.status(400).json({ message: "Location name is required" });
            return;
        }
        const created = await prisma_1.default.locations.create({ data: { id: (0, crypto_1.randomUUID)(), name } });
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createLocation error:", err);
        const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to create location');
        res.status(500).json({ message: msg });
    }
};
exports.createLocation = createLocation;
