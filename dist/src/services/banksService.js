"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBanks = readBanks;
exports.addBank = addBank;
exports.updateBank = updateBank;
exports.removeBank = removeBank;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const BANKS_PATH = path_1.default.join(__dirname, "../../assets/banks.json");
function readFile() {
    try {
        if (!fs_1.default.existsSync(BANKS_PATH))
            return { tenants: {} };
        const raw = fs_1.default.readFileSync(BANKS_PATH, "utf-8");
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
        const dir = path_1.default.dirname(BANKS_PATH);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        fs_1.default.writeFileSync(BANKS_PATH, JSON.stringify(payload, null, 2), "utf-8");
    }
    catch {
        // ignore write errors
    }
}
function readBanks(tenantId) {
    const file = readFile();
    const list = file.tenants[tenantId] || [];
    return Array.isArray(list) ? list : [];
}
function addBank(tenantId, bank) {
    const file = readFile();
    const list = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
    const exists = list.find((b) => b.name === bank.name && b.account === bank.account);
    if (!exists)
        list.push({ name: String(bank.name).trim(), account: String(bank.account).trim() });
    file.tenants[tenantId] = list;
    writeFile(file);
    return list;
}
function updateBank(tenantId, oldBank, nextBank) {
    const file = readFile();
    const list = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
    const idx = list.findIndex((b) => b.name === oldBank.name && b.account === oldBank.account);
    if (idx === -1)
        return list;
    const next = { name: String(nextBank.name).trim(), account: String(nextBank.account).trim() };
    list[idx] = next;
    const seen = new Set();
    const deduped = [];
    for (const b of list) {
        const key = `${String(b.name).trim()}|${String(b.account).trim()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push({ name: String(b.name).trim(), account: String(b.account).trim() });
    }
    file.tenants[tenantId] = deduped;
    writeFile(file);
    return deduped;
}
function removeBank(tenantId, bank) {
    const file = readFile();
    const list = Array.isArray(file.tenants[tenantId]) ? file.tenants[tenantId] : [];
    const filtered = list.filter((b) => !(b.name === bank.name && b.account === bank.account));
    file.tenants[tenantId] = filtered.map((b) => ({ name: String(b.name).trim(), account: String(b.account).trim() }));
    writeFile(file);
    return file.tenants[tenantId];
}
