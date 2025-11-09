import { Request, Response } from "express";
import { randomUUID } from "crypto";
import prisma from "../db/prisma";

export const getLocations = async (_req: Request, res: Response): Promise<void> => {
  try {
    const locations = await prisma.locations.findMany({ orderBy: { name: "asc" } });
    // Deduplicate by case-insensitive name and normalize display casing
    const toTitle = (s: string) => s
      .trim()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(" ");
    const byKey = new Map<string, { id: string; name: string }>();
    for (const loc of locations) {
      const key = (loc.name || "").trim().toLowerCase();
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, { id: loc.id, name: toTitle(loc.name) });
      }
    }
    const unique = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ locations: unique });
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