import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";

export const getLocations = async (_req: Request, res: Response): Promise<void> => {
  try {
    const reqAny = _req as any;
    const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
    const where: any = { tenantId };
    const locations = await prisma.locations.findMany({ where, orderBy: { name: "asc" } });
    res.json({ locations: locations.map((l) => ({ id: l.id, name: l.name })) });
  } catch (err) {
    console.error("getLocations error:", err);
    res.status(500).json({ message: "Failed to load locations" });
  }
};

export const createLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) { res.status(400).json({ message: "Location name is required" }); return; }
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.locations.findFirst({ where: { name, tenantId } as any });
    if (existing) { res.status(409).json({ message: "Location already exists" }); return; }
    const created = await prisma.locations.create({ data: { id: randomUUID(), name, tenantId } as any });
    res.status(201).json(created);
  } catch (err: any) {
    console.error("createLocation error:", err);
    const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to create location');
    res.status(500).json({ message: msg });
  }
};

export const updateLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const name = String(req.body?.name || '').trim();
    if (!name) { res.status(400).json({ message: "Location name is required" }); return; }
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.locations.findFirst({ where: { id, tenantId } as any });
    if (!existing) { res.status(404).json({ message: "Location not found" }); return; }
    const updated = await prisma.locations.update({ where: { id }, data: { name } });
    res.json({ id: updated.id, name: updated.name });
  } catch (err: any) {
    const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to update location');
    res.status(500).json({ message: msg });
  }
};

export const deleteLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.locations.findFirst({ where: { id, tenantId } as any });
    if (!existing) { res.status(404).json({ message: "Location not found" }); return; }
    const invCount = await prisma.invoices.count({ where: { locationId: id } });
    if (invCount > 0) { res.status(400).json({ message: "Cannot delete a location used by invoices" }); return; }
    await prisma.locations.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete location" });
  }
};
