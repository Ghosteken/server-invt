import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";
import { appendNotification } from "../services/notificationService";
import { createErrorResponse } from "../utils/errorHandler";

export const getLocations = async (_req: Request, res: Response): Promise<void> => {
  try {
    const reqAny = _req as any;
    const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
    const where: any = { tenantId, name: { not: "Main Warehouse" } };
    const locations = await prisma.locations.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true } });
    res.json({ locations: locations.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })) });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "location", "Failed to load locations"));
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
    try { appendNotification({ type: "location", message: `Location created: ${created.name}`, actorUserId: req.user?.userId }); } catch {}
    res.status(201).json(created);
  } catch (err: any) {
    console.error("createLocation error:", err);
    const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to create location');
    res.status(500).json(createErrorResponse(err, "location", msg));
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
    try { appendNotification({ type: "location", message: `Location updated: ${existing.name} → ${updated.name}`, actorUserId: req.user?.userId }); } catch {}
    res.json({ id: updated.id, name: updated.name });
  } catch (err: any) {
    const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to update location');
    res.status(500).json(createErrorResponse(err, "location", msg));
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
    try { appendNotification({ type: "location", message: `Location deleted: ${existing.name}`, actorUserId: req.user?.userId }); } catch {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "location", "Failed to delete location"));
  }
};
