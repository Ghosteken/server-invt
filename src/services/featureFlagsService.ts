import prisma from "../db/prisma";

type FeatureFlags = Record<string, string[]>; // userId -> features

export const readFlags = async (): Promise<FeatureFlags> => {
  const rows = await prisma.featureFlags.findMany({});
  const out: FeatureFlags = {};
  for (const r of rows) {
    const arr = Array.isArray(r.features) ? (r.features as unknown as string[]) : [];
    out[r.userId] = arr;
  }
  return out;
};

export const writeFlags = async (flags: FeatureFlags) => {
  const ids = Object.keys(flags);
  // Upsert each user features JSON atomically
  for (const userId of ids) {
    const features = flags[userId] || [];
    await prisma.featureFlags.upsert({
      where: { userId },
      create: { userId, features },
      update: { features },
    });
  }
};
