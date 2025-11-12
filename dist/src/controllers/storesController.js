"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBranch = exports.updateBranch = exports.createBranch = exports.listBranches = exports.deleteStore = exports.updateStore = exports.createStore = exports.listStores = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const listStores = async (req, res) => {
    try {
        const search = (req.query.search || "").toString().trim().toLowerCase();
        const stores = await prisma_1.default.stores.findMany({ include: { branches: true }, orderBy: { name: "asc" } });
        const filtered = search
            ? stores.filter((s) => s.name.toLowerCase().includes(search))
            : stores;
        res.json({ stores: filtered });
    }
    catch (err) {
        console.error("listStores error:", err);
        res.status(500).json({ message: "Failed to list stores" });
    }
};
exports.listStores = listStores;
const createStore = async (req, res) => {
    try {
        const name = (req.body?.name || "").toString().trim();
        if (!name) {
            res.status(400).json({ message: "Store name is required" });
            return;
        }
        const created = await prisma_1.default.stores.create({ data: { id: (0, crypto_1.randomUUID)(), name } });
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createStore error:", err);
        const msg = err?.code === "P2002" ? "Store name must be unique" : "Failed to create store";
        res.status(500).json({ message: msg });
    }
};
exports.createStore = createStore;
const updateStore = async (req, res) => {
    try {
        const { id } = req.params;
        const name = (req.body?.name || "").toString().trim();
        if (!name) {
            res.status(400).json({ message: "Store name is required" });
            return;
        }
        const updated = await prisma_1.default.stores.update({ where: { id }, data: { name } });
        res.json(updated);
    }
    catch (err) {
        console.error("updateStore error:", err);
        res.status(500).json({ message: "Failed to update store" });
    }
};
exports.updateStore = updateStore;
const deleteStore = async (req, res) => {
    try {
        const { id } = req.params;
        // Cascade delete branches first
        await prisma_1.default.branches.deleteMany({ where: { storeId: id } });
        await prisma_1.default.stores.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (err) {
        console.error("deleteStore error:", err);
        res.status(500).json({ message: "Failed to delete store" });
    }
};
exports.deleteStore = deleteStore;
const listBranches = async (req, res) => {
    try {
        const { storeId } = req.params;
        const branches = await prisma_1.default.branches.findMany({ where: { storeId }, orderBy: { name: "asc" } });
        res.json({ branches });
    }
    catch (err) {
        console.error("listBranches error:", err);
        res.status(500).json({ message: "Failed to list branches" });
    }
};
exports.listBranches = listBranches;
const createBranch = async (req, res) => {
    try {
        const { storeId } = req.params;
        const name = (req.body?.name || "").toString().trim();
        const city = (req.body?.city || "").toString().trim() || null;
        const state = (req.body?.state || "").toString().trim() || null;
        const address = (req.body?.address || "").toString().trim() || null;
        if (!name) {
            res.status(400).json({ message: "Branch name is required" });
            return;
        }
        // Validate store exists
        const store = await prisma_1.default.stores.findUnique({ where: { id: storeId } });
        if (!store) {
            res.status(404).json({ message: "Store not found" });
            return;
        }
        const created = await prisma_1.default.branches.create({ data: { id: (0, crypto_1.randomUUID)(), storeId, name, city, state, address } });
        res.status(201).json(created);
    }
    catch (err) {
        console.error("createBranch error:", err);
        const msg = err?.code === "P2002" ? "Branch name must be unique per store" : "Failed to create branch";
        res.status(500).json({ message: msg });
    }
};
exports.createBranch = createBranch;
const updateBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const name = (req.body?.name || "").toString().trim();
        const city = (req.body?.city || "").toString().trim() || null;
        const state = (req.body?.state || "").toString().trim() || null;
        const address = (req.body?.address || "").toString().trim() || null;
        const isActiveRaw = req.body?.isActive;
        const isActive = typeof isActiveRaw === "boolean" ? isActiveRaw : undefined;
        const updated = await prisma_1.default.branches.update({ where: { id }, data: { ...(name ? { name } : {}), city, state, address, ...(isActive === undefined ? {} : { isActive }) } });
        res.json(updated);
    }
    catch (err) {
        console.error("updateBranch error:", err);
        res.status(500).json({ message: "Failed to update branch" });
    }
};
exports.updateBranch = updateBranch;
const deleteBranch = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.default.branches.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (err) {
        console.error("deleteBranch error:", err);
        res.status(500).json({ message: "Failed to delete branch" });
    }
};
exports.deleteBranch = deleteBranch;
