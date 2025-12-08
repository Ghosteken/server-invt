import fs from "fs";
import path from "path";

type Bank = { name: string; account: string };
type BanksFile = { tenants: Record<string, Bank[]> };

const BANKS_PATH = path.join(__dirname, "../../assets/banks.json");

function readFile(): BanksFile {
  try {
    if (!fs.existsSync(BANKS_PATH)) return { tenants: {} };
    const raw = fs.readFileSync(BANKS_PATH, "utf-8");
    const json = JSON.parse(raw);
    const tenants = typeof json?.tenants === 'object' && json.tenants ? json.tenants as Record<string, Bank[]> : {};
    return { tenants };
  } catch {
    return { tenants: {} };
  }
}

function writeFile(payload: BanksFile): void {
  try {
    const dir = path.dirname(BANKS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BANKS_PATH, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // ignore write errors
  }
}

export function readBanks(tenantId: string): Bank[] {
  const file = readFile();
  const list = file.tenants[tenantId] || [];
  return Array.isArray(list) ? list : [];
}

export function addBank(tenantId: string, bank: Bank): Bank[] {
  const file = readFile();
  const list = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] as Bank[] : [];
  const exists = list.find((b) => b.name === bank.name && b.account === bank.account);
  if (!exists) list.push({ name: String(bank.name).trim(), account: String(bank.account).trim() });
  file.tenants[tenantId] = list;
  writeFile(file);
  return list;
}

