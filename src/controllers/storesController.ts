import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";
import { createErrorResponse } from "../utils/errorHandler";

export const listStores = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const search = (req.query.search || "").toString().trim().toLowerCase();
    const stores = await prisma.stores.findMany({ where: { tenantId }, include: { branches: true }, orderBy: { name: "asc" } });
    const filtered = search
      ? stores.filter((s: any) => s.name.toLowerCase().includes(search))
      : stores;
    res.json({ stores: filtered });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "store", "Failed to list stores"));
  }
};

export const createStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const name = (req.body?.name || "").toString().trim();
    if (!name) {
      res.status(400).json({ message: "Store name is required" });
      return;
    }
    const created = await prisma.stores.create({ data: { id: randomUUID(), name, tenantId } });
    res.status(201).json(created);
  } catch (err) {
    console.error("createStore error:", err);
    const msg = (err as any)?.code === "P2002" ? "Store name must be unique" : "Failed to create store";
    res.status(500).json(createErrorResponse(err, "store", msg));
  }
};

export const updateStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const name = (req.body?.name || "").toString().trim();
    if (!name) {
      res.status(400).json({ message: "Store name is required" });
      return;
    }
    const existing = await prisma.stores.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Store not found" }); return; }
    const updated = await prisma.stores.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "store", "Failed to update store"));
  }
};

export const deleteStore = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.stores.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Store not found" }); return; }
    // Cascade delete branches first
    await prisma.branches.deleteMany({ where: { storeId: id, tenantId } });
    await prisma.stores.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "store", "Failed to delete store"));
  }
};

export const listBranches = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const store = await prisma.stores.findFirst({ where: { id: storeId, tenantId } });
    if (!store) { res.status(404).json({ message: "Store not found" }); return; }
    const branches = await prisma.branches.findMany({ where: { storeId, tenantId }, orderBy: { name: "asc" } });
    res.json({ branches });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "store", "Failed to list branches"));
  }
};

export const createBranch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const name = (req.body?.name || "").toString().trim();
    const city = (req.body?.city || "").toString().trim() || null;
    const state = (req.body?.state || "").toString().trim() || null;
    const address = (req.body?.address || "").toString().trim() || null;
    if (!name) {
      res.status(400).json({ message: "Branch name is required" });
      return;
    }
    // Validate store exists
    const store = await prisma.stores.findFirst({ where: { id: storeId, tenantId } });
    if (!store) {
      res.status(404).json({ message: "Store not found" });
      return;
    }
    const created = await prisma.branches.create({ data: { id: randomUUID(), storeId, name, city, state, address, tenantId } });
    res.status(201).json(created);
  } catch (err) {
    console.error("createBranch error:", err);
    const msg = (err as any)?.code === "P2002" ? "Branch name must be unique per store" : "Failed to create branch";
    res.status(500).json(createErrorResponse(err, "store", msg));
  }
};

export const updateBranch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const name = (req.body?.name || "").toString().trim();
    const city = (req.body?.city || "").toString().trim() || null;
    const state = (req.body?.state || "").toString().trim() || null;
    const address = (req.body?.address || "").toString().trim() || null;
    const isActiveRaw = req.body?.isActive;
    const isActive = typeof isActiveRaw === "boolean" ? isActiveRaw : undefined;
    const existing = await prisma.branches.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Branch not found" }); return; }
    const updated = await prisma.branches.update({ where: { id }, data: { ...(name ? { name } : {}), city, state, address, ...(isActive === undefined ? {} : { isActive }) } });
    res.json(updated);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "store", "Failed to update branch"));
  }
};

export const deleteBranch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const existing = await prisma.branches.findFirst({ where: { id, tenantId } });
    if (!existing) { res.status(404).json({ message: "Branch not found" }); return; }
    await prisma.branches.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "store", "Failed to delete branch"));
  }
};
