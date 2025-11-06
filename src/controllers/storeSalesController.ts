import { Request, Response } from "express";
import prisma from "../db/prisma";
import multer from "multer";
import * as XLSX from "xlsx";
import { readStores, writeStores } from "../services/storeService";
import fs from "node:fs";
import path from "node:path";

// Use shared Prisma client

// Canonical store chains to present in UI
const CANONICAL_CHAINS: Array<{ name: string; token: string }> = [
  { name: "WINNIE", token: "winnie" },
  { name: "UBA", token: "uba" },
  { name: "TWINS", token: "twins" },
  { name: "SHOPPERS", token: "shoppers" },
  { name: "SAHAD", token: "sahad" },
  { name: "RYTE", token: "ryte" },
  { name: "QMB", token: "qmb" },
  { name: "OZZY STORE", token: "ozzy" },
  { name: "LIZZY STORE", token: "lizzy" },
  { name: "HOSTS SUPERMARKET", token: "hosts" },
  { name: "HEALTHRITE", token: "healthrite" },
  { name: "GLOBUS SUPERMARKET", token: "globus" },
  { name: "GLAMOUR SUPERMARKET", token: "glamour" },
  { name: "CITY SUPERMARKET", token: "city" },
  // Prefer short, deduped display names for duplicates
  { name: "BLENCO", token: "blenco" },
  { name: "TEMPLE", token: "temple" },
  { name: "MEGA", token: "mega" },
  { name: "MANO", token: "mano" },
  { name: "JENDOL", token: "jendol" },
  { name: "HYPERCITY", token: "hypercity" },
  { name: "HUTOOS SUPERMARKET", token: "hutoos" },
  { name: "GRAND", token: "grand" },
  { name: "DELIGHT", token: "delight" },
  { name: "AMAGZY", token: "amagzy" },
  { name: "PRINCE", token: "prince" },
  { name: "SHOPRITE", token: "shoprite" },
  { name: "GLOBUS", token: "globus" },
  { name: "SUPERSAVER", token: "supersaver" },
  { name: "SPAR", token: "spar" },
  { name: "JUSTRITE", token: "justrite" },
];

// Map common display names to canonical tokens to collapse duplicates
const NAME_TO_TOKEN: Record<string, string> = {
  "BLENCO": "blenco",
  "BLENCO SUPERMARKET": "blenco",
  "GLOBUS": "globus",
  "GLOBUS SUPERMARKET": "globus",
  "JENDOL": "jendol",
  "JENDOL SUPERMARKET": "jendol",
  "JENDOL SUPERSTORE": "jendol",
  "PRINCE": "prince",
  "PRINCE SUPERMARKET": "prince",
  "SHOPRITE": "shoprite",
  "SUPERSAVER": "supersaver",
  "SPAR": "spar",
  "JUSTRITE": "justrite",
};

const PRIMARY_DISPLAY_BY_TOKEN: Record<string, string> = {
  blenco: "BLENCO",
  globus: "GLOBUS",
  jendol: "JENDOL",
  prince: "PRINCE",
  shoprite: "SHOPRITE",
  supersaver: "SUPERSAVER",
  spar: "SPAR",
  justrite: "JUSTRITE",
  winnie: "WINNIE",
  uba: "UBA",
  twins: "TWINS",
  shoppers: "SHOPPERS",
  sahad: "SAHAD",
  ryte: "RYTE",
  qmb: "QMB",
  ozzy: "OZZY STORE",
  lizzy: "LIZZY STORE",
  hosts: "HOSTS SUPERMARKET",
  healthrite: "HEALTHRITE",
  glamour: "GLAMOUR SUPERMARKET",
  city: "CITY SUPERMARKET",
  temple: "TEMPLE",
  mega: "MEGA",
  mano: "MANO",
  hypercity: "HYPERCITY",
  hutoos: "HUTOOS",
  grand: "GRAND",
  delight: "DELIGHT",
  amagzy: "AMAGZY",
};

function normalizeStoreTokenFromName(name: string): string {
  const trimmed = String(name || "").trim();
  const upper = trimmed.toUpperCase();
  if (NAME_TO_TOKEN[upper]) return NAME_TO_TOKEN[upper];
  let lower = trimmed.toLowerCase();
  // Remove common suffixes
  lower = lower.replace(/\b(supermarket|superstore|market)\b/g, "").trim();
  // Pick token by substring match
  const tokens = Object.keys(PRIMARY_DISPLAY_BY_TOKEN);
  for (const t of tokens) {
    if (lower.includes(t)) return t;
  }
  return lower; // fallback
}

function aggregateBranchesByToken(token: string): string[] {
  const data = readStores();
  const tokenLc = token.toLowerCase();
  const branchesSet = new Set<string>();
  for (const entry of data.stores) {
    const nameLc = String(entry.store).toLowerCase();
    if (nameLc.includes(tokenLc)) {
      for (const b of entry.branches || []) {
        const bb = String(b).trim();
        if (bb) branchesSet.add(bb);
      }
      // Optionally add the entry.store itself when it looks like a branch location variant
      // e.g., "blenco lekki" should count as a branch under BLENCO
      if (nameLc !== tokenLc && /\s/.test(nameLc)) {
        branchesSet.add(entry.store.toUpperCase());
      }
    }
  }
  return Array.from(branchesSet.values());
}

export const getStores = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Return only canonical chains with aggregated branches, deduped by token
    const uniqueTokens = Array.from(new Set(CANONICAL_CHAINS.map((c) => c.token)));
    const stores = uniqueTokens.map((token) => ({
      store: PRIMARY_DISPLAY_BY_TOKEN[token] || token.toUpperCase(),
      branches: aggregateBranchesByToken(token),
    }));
    res.json({ stores });
  } catch (err) {
    console.error("getStores error:", err);
    res.status(500).json({ message: "Failed to load stores" });
  }
};

export const getStoreBranchSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const store = String(req.query.store || "");
    const branch = String(req.query.branch || "");
    if (!store || !branch) {
      res.status(400).json({ message: "Missing store or branch" });
      return;
    }
    // Find canonical token by matching provided store name (case-insensitive)
    const token = (CANONICAL_CHAINS.find((c) => c.name.toLowerCase() === store.toLowerCase())?.token) || store.toLowerCase();
    const branches = aggregateBranchesByToken(token);
    if (!branches.includes(branch)) {
      res.status(404).json({ message: "Unknown branch for store" });
      return;
    }

    // Find the customer that matches this branch name
    const customer = await prisma.customers.findFirst({ where: { name: branch } });
    if (!customer) {
      res.json({ sales: [] });
      return;
    }

    const purchases = await prisma.customerPurchases.findMany({
      where: { customerId: customer.customerId },
      orderBy: { timestamp: "desc" },
    });
    const productIds = Array.from(new Set(purchases.map((p) => p.productId)));
    const products = await prisma.products.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, name: true, expiryDate: true },
    });
    const productMap = new Map(products.map((p) => [p.productId, p] as const));

    const sales = purchases.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: productMap.get(p.productId)?.name || undefined,
      quantity: p.quantity,
      expiryDate: productMap.get(p.productId)?.expiryDate || null,
      timestamp: p.timestamp,
    }));

    res.json({ sales });
  } catch (err) {
    console.error("getStoreBranchSales error:", err);
    res.status(500).json({ message: "Failed to load store branch sales" });
  }
};

// Multer instance used by routes file
export const upload = multer({ storage: multer.memoryStorage() });

export const importStoresBranches = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ message: "No file uploaded. Use field name 'file'." });
      return;
    }
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    const normalizeKey = (k: string) => k.toString().replace(/[\u00A0\s]+/g, " ").trim().toLowerCase();

    const grouped = new Map<string, Set<string>>();
    for (const row of rows) {
      const kv: Record<string, any> = {};
      for (const k of Object.keys(row)) {
        kv[normalizeKey(k)] = row[k];
      }
      const storeRaw = kv["store"] ?? kv["chain"] ?? kv["market"];
      const branchRaw = kv["branch"] ?? kv["location"] ?? kv["name"];
      if (!storeRaw || !branchRaw) continue;
      const store = normalizeStoreTokenFromName(String(storeRaw));
      const branch = String(branchRaw).trim();
      const set = grouped.get(store) || new Set<string>();
      set.add(branch);
      grouped.set(store, set);
    }
    const stores = Array.from(grouped.entries()).map(([token, set]) => ({ store: token, branches: Array.from(set.values()) }));
    writeStores({ stores });
    res.json({ importedStores: stores.length });
  } catch (err) {
    console.error("importStoresBranches error:", err);
    res.status(500).json({ message: "Failed to import stores/branches" });
  }
};

/**
 * Import stores and branches from server sample Customers1.xlsx.
 * Assumes sheet lists store names each followed by its branches, then unmatched customers.
 */
export const importStoresBranchesSample = async (_req: Request, res: Response): Promise<void> => {
  try {
    const samplePath = path.join(__dirname, "../../assets/Customers1.xlsx");
    if (!fs.existsSync(samplePath)) {
      res.status(404).json({ message: "Sample Customers1.xlsx not found" });
      return;
    }
    const buffer = fs.readFileSync(samplePath);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    const grouped = new Map<string, Set<string>>();
    let currentToken: string | null = null;
    const toText = (v: any) => (v == null ? "" : String(v).trim());

    for (const row of rows) {
      const cell = toText(row[0]);
      if (!cell) continue;
      const isLikelyStore = /^[A-Z][A-Za-z0-9\s&.'()-]+$/.test(cell) && cell.split(" ").length <= 3;
      // Heuristic: a branch often contains a location with spaces and is not all uppercase single token
      const isLikelyBranch = !isLikelyStore && /[A-Za-z]/.test(cell);
      if (isLikelyStore) {
        currentToken = normalizeStoreTokenFromName(cell);
        if (!grouped.has(currentToken)) grouped.set(currentToken, new Set());
        continue;
      }
      if (isLikelyBranch && currentToken) {
        grouped.get(currentToken)!.add(cell);
        continue;
      }
      // If neither, we may have reached unmatched customers; stop parsing
      if (currentToken && !isLikelyBranch && !isLikelyStore) {
        break;
      }
    }

    const stores = Array.from(grouped.entries()).map(([token, set]) => ({ store: token, branches: Array.from(set.values()) }));
    if (stores.length) {
      writeStores({ stores });
      res.json({ importedStores: stores.length });
    } else {
      res.status(400).json({ message: "No stores parsed from sample" });
    }
  } catch (err) {
    console.error("importStoresBranchesSample error:", err);
    res.status(500).json({ message: "Failed to import stores/branches from sample" });
  }
};