import prisma from "../db/prisma";
import { randomUUID } from "crypto";

/**
 * Ensure baseline entities exist for first-run UX.
 * - Creates a default Location and Sales Agent if tables are empty.
 */
export async function ensureDefaults(): Promise<void> {
  try {
    const locCount = await prisma.locations.count();
    if (locCount === 0) {
      try {
        await prisma.locations.create({ data: { id: randomUUID(), name: "Main Warehouse" } });
        console.log("[bootstrap] Created default Location: Main Warehouse");
      } catch (err) {
        console.warn("[bootstrap] Failed creating default Location:", err);
      }
    } else if (locCount > 1) {
      // Remove placeholder if real locations exist
      try {
        const placeholder = await prisma.locations.findFirst({ where: { name: "Main Warehouse" } });
        if (placeholder) {
          await prisma.locations.delete({ where: { id: placeholder.id } });
          console.log("[bootstrap] Removed placeholder Location: Main Warehouse");
        }
        // Normalize capitalization for user-provided locations
        const CAP_FIXES: Array<{ from: string; to: string }> = [
          { from: "open market", to: "Open Market" },
          { from: "distribution", to: "Distribution" },
          { from: "amagzy global", to: "Amagzy Global" },
          { from: "amagzy global ventures", to: "Amagzy Global Ventures" },
        ];
        for (const fix of CAP_FIXES) {
          const fromLoc = await prisma.locations.findFirst({ where: { name: fix.from } });
          if (!fromLoc) continue;

          // If target already exists, migrate references and delete the duplicate to avoid unique constraint violations
          const toLoc = await prisma.locations.findFirst({ where: { name: fix.to } });
          if (toLoc) {
            // Repoint invoices to canonical location id and name
            const migrated = await prisma.invoices.updateMany({
              where: { locationId: fromLoc.id },
              data: { locationId: toLoc.id, location: fix.to },
            });
            // Also fix free-text invoices that used the lowercase name without a locationId
            await prisma.invoices.updateMany({
              where: { location: fix.from, locationId: null },
              data: { location: fix.to },
            });
            await prisma.locations.delete({ where: { id: fromLoc.id } });
            console.log(`[bootstrap] Merged duplicate location: ${fix.from} -> ${fix.to} (migrated ${migrated.count} invoices)`);
          } else {
            await prisma.locations.update({ where: { id: fromLoc.id }, data: { name: fix.to } });
            console.log(`[bootstrap] Normalized location name: ${fix.from} -> ${fix.to}`);
          }
        }
      } catch (err) {
        console.warn("[bootstrap] Failed removing placeholder Location:", err);
      }
    }

    const agentCount = await prisma.salesAgents.count();
    if (agentCount === 0) {
      try {
        await prisma.salesAgents.create({ data: { id: randomUUID(), name: "Default Sales Agent" } });
        console.log("[bootstrap] Created default Sales Agent: Default Sales Agent");
      } catch (err) {
        console.warn("[bootstrap] Failed creating default Sales Agent:", err);
      }
    } else if (agentCount > 1) {
      // Remove placeholder if real agents exist
      try {
        const placeholder = await prisma.salesAgents.findFirst({ where: { name: "Default Sales Agent" } });
        if (placeholder) {
          await prisma.salesAgents.delete({ where: { id: placeholder.id } });
          console.log("[bootstrap] Removed placeholder Sales Agent: Default Sales Agent");
        }
        // Fix known typo introduced in seed data
        const typo = await prisma.salesAgents.findFirst({ where: { name: "Beatuty Benson" } });
        if (typo) {
          await prisma.salesAgents.update({ where: { id: typo.id }, data: { name: "Beauty Benson" } });
          console.log("[bootstrap] Corrected sales agent name: Beatuty -> Beauty Benson");
        }
      } catch (err) {
        console.warn("[bootstrap] Failed removing placeholder Sales Agent:", err);
      }
    }
  } catch (err) {
    console.warn("[bootstrap] ensureDefaults encountered an error:", err);
  }
}