"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteLocation = exports.updateLocation = exports.createLocation = exports.getLocations = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const tenantLocationsService_1 = require("../services/tenantLocationsService");
const getLocations = async (_req, res) => {
    try {
        const reqAny = _req;
        const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
        const invs = await prisma_1.default.invoices.findMany({ where: { tenantId }, select: { locationId: true } });
        const idsFromInvoices = Array.from(new Set(invs.map((i) => i.locationId).filter(Boolean)));
        const idsFromMapping = (0, tenantLocationsService_1.getTenantLocations)(tenantId);
        const ids = Array.from(new Set([...(idsFromInvoices || []), ...(idsFromMapping || [])]));
        const locations = ids.length
            ? await prisma_1.default.locations.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } })
            : [];
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
        try {
            const tenantId = req.tenantId || req.user?.tenantId || "default";
            (0, tenantLocationsService_1.addTenantLocation)(tenantId, created.id);
        }
        catch { }
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createLocation error:", err);
        const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to create location');
        res.status(500).json({ message: msg });
    }
};
exports.createLocation = createLocation;
const updateLocation = async (req, res) => {
    try {
        const { id } = req.params;
        const name = String(req.body?.name || '').trim();
        if (!name) {
            res.status(400).json({ message: "Location name is required" });
            return;
        }
        const existing = await prisma_1.default.locations.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Location not found" });
            return;
        }
        const updated = await prisma_1.default.locations.update({ where: { id }, data: { name } });
        res.json({ id: updated.id, name: updated.name });
    }
    catch (err) {
        const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to update location');
        res.status(500).json({ message: msg });
    }
};
exports.updateLocation = updateLocation;
const deleteLocation = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma_1.default.locations.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ message: "Location not found" });
            return;
        }
        const invCount = await prisma_1.default.invoices.count({ where: { locationId: id } });
        if (invCount > 0) {
            res.status(400).json({ message: "Cannot delete a location used by invoices" });
            return;
        }
        await prisma_1.default.locations.delete({ where: { id } });
        try {
            const tenantId = req.tenantId || req.user?.tenantId || "default";
            (0, tenantLocationsService_1.removeTenantLocation)(tenantId, id);
        }
        catch { }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to delete location" });
    }
};
exports.deleteLocation = deleteLocation;
