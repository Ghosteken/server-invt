"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteLocation = exports.updateLocation = exports.createLocation = exports.getLocations = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const notificationService_1 = require("../services/notificationService");
const getLocations = async (_req, res) => {
    try {
        const reqAny = _req;
        const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
        const where = { tenantId, name: { not: "Main Warehouse" } };
        const locations = await prisma_1.default.locations.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true } });
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
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.locations.findFirst({ where: { name, tenantId } });
        if (existing) {
            res.status(409).json({ message: "Location already exists" });
            return;
        }
        const created = await prisma_1.default.locations.create({ data: { id: (0, crypto_1.randomUUID)(), name, tenantId } });
        try {
            (0, notificationService_1.appendNotification)({ type: "location", message: `Location created: ${created.name}`, actorUserId: req.user?.userId });
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
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.locations.findFirst({ where: { id, tenantId } });
        if (!existing) {
            res.status(404).json({ message: "Location not found" });
            return;
        }
        const updated = await prisma_1.default.locations.update({ where: { id }, data: { name } });
        try {
            (0, notificationService_1.appendNotification)({ type: "location", message: `Location updated: ${existing.name} → ${updated.name}`, actorUserId: req.user?.userId });
        }
        catch { }
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
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.locations.findFirst({ where: { id, tenantId } });
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
            (0, notificationService_1.appendNotification)({ type: "location", message: `Location deleted: ${existing.name}`, actorUserId: req.user?.userId });
        }
        catch { }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ message: "Failed to delete location" });
    }
};
exports.deleteLocation = deleteLocation;
