import prisma from "../db/prisma";

type FeatureFlags = Record<string, string[]>; // userId -> features

export const readFlags = async (tenantId = "default"): Promise<FeatureFlags> => {
  const rows = await prisma.featureFlags.findMany({ where: { tenantId } });
  const out: FeatureFlags = {};
  for (const r of rows) {
    const arr = Array.isArray(r.features) ? (r.features as unknown as string[]) : [];
    out[r.userId] = arr;
  }
  return out;
};

export const writeFlags = async (flags: FeatureFlags, tenantId = "default") => {
  const ids = Object.keys(flags);
  for (const userId of ids) {
    const features = flags[userId] || [];
    await prisma.featureFlags.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { id: cryptoRandom(), tenantId, userId, features },
      update: { features },
    });
  }
};

function cryptoRandom(): string {
  try { const { randomUUID } = require("crypto"); return randomUUID(); } catch { return Math.random().toString(36).slice(2); }
}
