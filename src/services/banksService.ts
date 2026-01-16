import prisma from "../db/prisma";

type Bank = { name: string; account: string; balance?: number };
type BanksFile = { tenants: Record<string, Bank[]> };

// Prisma-backed persistence replacing JSON file storage

export async function readBanks(tenantId: string): Promise<Bank[]> {
  try {
    const db = prisma as any;
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  } catch {
    return [];
  }
}

export async function addBank(tenantId: string, bank: Bank): Promise<Bank[]> {
  const name = String(bank.name).trim();
  const account = String(bank.account).trim();
  const balance = bank.balance;
  try {
    const db = prisma as any;
    const existing = await db.banks.findFirst({ where: { tenantId, name, account } });
    if (!existing) {
      await db.banks.create({
        data: {
          id: cryptoRandom(),
          tenantId,
          name,
          account,
          balance: balance !== undefined ? Number(balance) : 0,
        } as any,
      });
    }
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  } catch {
    const db = prisma as any;
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } }).catch(() => []);
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  }
}

export async function updateBank(tenantId: string, oldBank: Bank, nextBank: Bank): Promise<Bank[]> {
  const oldName = String(oldBank.name).trim();
  const oldAccount = String(oldBank.account).trim();
  const name = String(nextBank.name).trim();
  const account = String(nextBank.account).trim();
  const balance = nextBank.balance;
  try {
    const db = prisma as any;
    const existing = await db.banks.findFirst({ where: { tenantId, name: oldName, account: oldAccount } });
    if (existing) {
      await db.banks.update({
        where: { id: existing.id },
        data: {
          name,
          account,
          ...(balance !== undefined ? { balance: Number(balance) } : {}),
        },
      });
    }
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  } catch {
    const db = prisma as any;
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } }).catch(() => []);
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  }
}

function cryptoRandom(): string {
  try {
    const { randomUUID } = require("crypto");
    return randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export async function removeBank(tenantId: string, bank: Bank): Promise<Bank[]> {
  const name = String(bank.name).trim();
  const account = String(bank.account).trim();
  try {
    const db = prisma as any;
    const existing = await db.banks.findFirst({ where: { tenantId, name, account } });
    if (existing) {
      await db.banks.delete({ where: { id: existing.id } });
    }
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  } catch {
    const db = prisma as any;
    const rows: any[] = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } }).catch(() => []);
    return rows.map((r: any) => ({ name: r.name, account: r.account, balance: Number(r.balance || 0) }));
  }
}
