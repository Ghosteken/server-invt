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
        const locations = await prisma_1.default.locations.findMany({ orderBy: { name: "asc" } });
        // Deduplicate by case-insensitive name and normalize display casing
        const toTitle = (s) => s
            .trim()
            .split(/\s+/)
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
            .join(" ");
        const byKey = new Map();
        for (const loc of locations) {
            const key = (loc.name || "").trim().toLowerCase();
            if (!key)
                continue;
            if (!byKey.has(key)) {
                byKey.set(key, { id: loc.id, name: toTitle(loc.name) });
            }
        }
        const unique = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
        res.json({ locations: unique });
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
