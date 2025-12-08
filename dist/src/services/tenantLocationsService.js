"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addTenantLocation = addTenantLocation;
exports.getTenantLocations = getTenantLocations;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const MAP_PATH = path_1.default.join(__dirname, "../../assets/tenant_locations.json");
function readFile() {
    try {
        if (!fs_1.default.existsSync(MAP_PATH))
            return { tenants: {} };
        const raw = fs_1.default.readFileSync(MAP_PATH, "utf-8");
        const json = JSON.parse(raw);
        const tenants = typeof json?.tenants === 'object' && json.tenants ? json.tenants : {};
        return { tenants };
    }
    catch {
        return { tenants: {} };
    }
}
function writeFile(payload) {
    try {
        const dir = path_1.default.dirname(MAP_PATH);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        fs_1.default.writeFileSync(MAP_PATH, JSON.stringify(payload, null, 2), "utf-8");
    }
    catch { }
}
function addTenantLocation(tenantId, locationId) {
    const file = readFile();
    const current = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
    if (!current.includes(locationId))
        current.push(locationId);
    file.tenants[tenantId] = current;
    writeFile(file);
    return current;
}
function getTenantLocations(tenantId) {
    const file = readFile();
    const current = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
    return current;
}
