"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendCustomerSales = appendCustomerSales;
exports.getCustomerSales = getCustomerSales;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const salesFilePath = path_1.default.join(__dirname, '../../prisma/seedData/customerSales.json');
function ensureFile() {
    const dir = path_1.default.dirname(salesFilePath);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    if (!fs_1.default.existsSync(salesFilePath)) {
        fs_1.default.writeFileSync(salesFilePath, '[]', { encoding: 'utf-8' });
    }
}
function appendCustomerSales(entry) {
    try {
        ensureFile();
        const content = fs_1.default.readFileSync(salesFilePath, 'utf-8');
        const data = JSON.parse(content || '[]');
        const id = entry.id ?? `sale_${Date.now()}`;
        const timestamp = entry.timestamp ?? new Date().toISOString();
        const record = { id, timestamp, ...entry };
        data.push(record);
        fs_1.default.writeFileSync(salesFilePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    }
    catch (err) {
        // Best-effort logging; do not throw to avoid breaking main flow
        console.error('Failed to append customer sales record:', err);
    }
}
function getCustomerSales() {
    try {
        ensureFile();
        const content = fs_1.default.readFileSync(salesFilePath, 'utf-8');
        return JSON.parse(content || '[]');
    }
    catch (err) {
        console.error('Failed to read customer sales records:', err);
        return [];
    }
}
