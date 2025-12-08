"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBanks = readBanks;
exports.addBank = addBank;
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
