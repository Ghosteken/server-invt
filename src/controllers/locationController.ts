import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";

export const getLocations = async (_req: Request, res: Response): Promise<void> => {
  try {
    const reqAny = _req as any;
    const tenantId = reqAny.tenantId || _req.user?.tenantId || "default";
    const invs = await prisma.invoices.findMany({ where: { tenantId }, select: { locationId: true } });
    const ids = Array.from(new Set(invs.map((i) => i.locationId).filter(Boolean))) as string[];
    if (!ids.length) { res.json({ locations: [] }); return; }
    const locations = await prisma.locations.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
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
    const created = await prisma.locations.create({ data: { id: randomUUID(), name } });
    res.status(201).json(created);
  } catch (err: any) {
    console.error("createLocation error:", err);
    const msg = err?.code === 'P2002' ? 'Location name must be unique' : (err instanceof Error ? err.message : 'Failed to create location');
    res.status(500).json({ message: msg });
  }
};
