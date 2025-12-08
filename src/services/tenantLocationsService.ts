import fs from "fs";
import path from "path";

type TenantLocationsFile = { tenants: Record<string, string[]> };
const MAP_PATH = path.join(__dirname, "../../assets/tenant_locations.json");

function readFile(): TenantLocationsFile {
  try {
    if (!fs.existsSync(MAP_PATH)) return { tenants: {} };
    const raw = fs.readFileSync(MAP_PATH, "utf-8");
    const json = JSON.parse(raw);
    const tenants = typeof json?.tenants === 'object' && json.tenants ? json.tenants as Record<string, string[]> : {};
    return { tenants };
  } catch {
    return { tenants: {} };
  }
}

function writeFile(payload: TenantLocationsFile): void {
  try {
    const dir = path.dirname(MAP_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MAP_PATH, JSON.stringify(payload, null, 2), "utf-8");
  } catch {}
}

export function addTenantLocation(tenantId: string, locationId: string): string[] {
  const file = readFile();
  const current = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
  if (!current.includes(locationId)) current.push(locationId);
  file.tenants[tenantId] = current;
  writeFile(file);
  return current;
}

export function getTenantLocations(tenantId: string): string[] {
  const file = readFile();
  const current = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
  return current;
}

export function removeTenantLocation(tenantId: string, locationId: string): string[] {
  const file = readFile();
  const current = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
  const next = current.filter((id) => id !== locationId);
  file.tenants[tenantId] = next;
  writeFile(file);
  return next;
}
