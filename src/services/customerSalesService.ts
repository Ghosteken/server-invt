import fs from 'fs';
import path from 'path';

const salesFilePath = path.join(__dirname, '../../prisma/seedData/customerSales.json');

function ensureFile() {
  const dir = path.dirname(salesFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(salesFilePath)) {
    fs.writeFileSync(salesFilePath, '[]', { encoding: 'utf-8' });
  }
}

export type CustomerSalesEntry = {
  id: string;
  timestamp: string;
  customer: {
    id?: number | null;
    name?: string | null;
    mobile?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  };
  itemsParsed?: Array<{ raw: string; productName?: string; quantity?: number }>;
  matchedUpdates?: Array<{ productId: number; name: string; deducted: number }>;
};

export function appendCustomerSales(entry: Omit<CustomerSalesEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) {
  try {
    ensureFile();
    const content = fs.readFileSync(salesFilePath, 'utf-8');
    const data: CustomerSalesEntry[] = JSON.parse(content || '[]');
    const id = entry.id ?? `sale_${Date.now()}`;
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const record: CustomerSalesEntry = { id, timestamp, ...entry } as CustomerSalesEntry;
    data.push(record);
    fs.writeFileSync(salesFilePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  } catch (err) {
    // Best-effort logging; do not throw to avoid breaking main flow
    console.error('Failed to append customer sales record:', err);
  }
}

export function getCustomerSales(): CustomerSalesEntry[] {
  try {
    ensureFile();
    const content = fs.readFileSync(salesFilePath, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('Failed to read customer sales records:', err);
    return [];
  }
}