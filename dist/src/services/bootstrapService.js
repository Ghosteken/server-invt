"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDefaults = ensureDefaults;
const prisma_1 = __importDefault(require("../db/prisma"));
/**
 * Ensure baseline entities exist for first-run UX.
 * - Creates a default Location and Sales Agent if tables are empty.
 */
async function ensureDefaults() {
    try {
        const locCount = await prisma_1.default.locations.count();
        if (locCount > 1) {
            // Remove placeholder if real locations exist
            try {
                const placeholder = await prisma_1.default.locations.findFirst({ where: { name: "Main Warehouse" } });
                if (placeholder) {
                    await prisma_1.default.locations.delete({ where: { id: placeholder.id } });
                    console.log("[bootstrap] Removed placeholder Location: Main Warehouse");
                }
                // Normalize capitalization for user-provided locations
                const CAP_FIXES = [
                    { from: "open market", to: "Open Market" },
                    { from: "distribution", to: "Distribution" },
                    { from: "amagzy global", to: "Amagzy Global" },
                    { from: "amagzy global ventures", to: "Amagzy Global Ventures" },
                ];
                for (const fix of CAP_FIXES) {
                    const fromLoc = await prisma_1.default.locations.findFirst({ where: { name: fix.from } });
                    if (!fromLoc)
                        continue;
                    // If target already exists, migrate references and delete the duplicate to avoid unique constraint violations
                    const toLoc = await prisma_1.default.locations.findFirst({ where: { name: fix.to } });
                    if (toLoc) {
                        // Repoint invoices to canonical location id and name
                        const migrated = await prisma_1.default.invoices.updateMany({
                            where: { locationId: fromLoc.id },
                            data: { locationId: toLoc.id, location: fix.to },
                        });
                        // Also fix free-text invoices that used the lowercase name without a locationId
                        await prisma_1.default.invoices.updateMany({
                            where: { location: fix.from, locationId: null },
                            data: { location: fix.to },
                        });
                        await prisma_1.default.locations.delete({ where: { id: fromLoc.id } });
                        console.log(`[bootstrap] Merged duplicate location: ${fix.from} -> ${fix.to} (migrated ${migrated.count} invoices)`);
                    }
                    else {
                        await prisma_1.default.locations.update({ where: { id: fromLoc.id }, data: { name: fix.to } });
                        console.log(`[bootstrap] Normalized location name: ${fix.from} -> ${fix.to}`);
                    }
                }
            }
            catch (err) {
                console.warn("[bootstrap] Failed removing placeholder Location:", err);
            }
        }
    }
    catch (err) {
        console.warn("[bootstrap] ensureDefaults encountered an error:", err);
    }
}
