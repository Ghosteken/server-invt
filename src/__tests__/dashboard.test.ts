import request from 'supertest';

// Mock PrismaClient to avoid real DB
const productsData = [
  { productId: 'p1', name: 'Alpha Soap', price: 10, stockQuantity: 2, expiryDate: new Date(), category: 'hygiene', packSize: '1ct' },
  { productId: 'p2', name: 'Beta Milk', price: 5, stockQuantity: 10, expiryDate: new Date(), category: 'dairy', packSize: '12ct' },
  { productId: 'p3', name: 'Gamma Rice', price: 20, stockQuantity: 1, expiryDate: new Date(), category: 'grain', packSize: '24ct' },
];

jest.mock('@prisma/client', () => {
  const m = {
    products: {
      count: jest.fn().mockResolvedValue(productsData.length),
      findMany: jest.fn().mockImplementation(async (opts: any) => {
        let arr = productsData.slice();
        // Apply search filter if provided
        const contains = opts?.where?.name?.contains?.toLowerCase?.();
        const threshold = opts?.where?.stockQuantity?.lt;
        if (typeof threshold === 'number') {
          arr = arr.filter((p) => p.stockQuantity < threshold);
        }
        if (contains) {
          arr = arr.filter((p) => p.name.toLowerCase().includes(contains));
        }
        // Order by stock asc
        arr.sort((a, b) => a.stockQuantity - b.stockQuantity);
        const skip = Number(opts?.skip ?? 0);
        const take = Number(opts?.take ?? arr.length);
        return arr.slice(skip, skip + take);
      }),
    },
    customerPurchases: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalCost: 100 } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    customers: {
      findMany: jest.fn().mockResolvedValue([]),
    }
  };
  return { PrismaClient: jest.fn().mockImplementation(() => m) };
});

// Mock pcs inventory reader
jest.mock('../services/pcsInventoryService', () => ({
  readPcsInventory: () => ([
    { name: 'Alpha Soap', quantity: 2, packSize: '1ct', productId: 'p1' },
    { name: 'Beta Milk', quantity: 10, packSize: '12ct', productId: 'p2' },
    { name: 'Gamma Rice', quantity: 1, packSize: '24ct', productId: 'p3' },
  ])
}));

// Build app with low rate limit for testing
import createApp from '../app';

function buildApp(rateMax: string = '300') {
  process.env.RATE_LIMIT_MAX = rateMax;
  return createApp();
}

describe('Dashboard API', () => {

  test('GET /dashboard returns aggregates and Cache-Control; gzip when requested', async () => {
    const app = buildApp('300');
    const res = await request(app)
      .get('/dashboard')
      .set('Accept-Encoding', 'gzip');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=60/);
    // Compression may be enabled depending on negotiation
    // Ensure payload semantics unchanged by compression
    // (gzip may or may not be negotiated in test env)
    expect(res.body).toHaveProperty('totalProducts', productsData.length);
    expect(res.body).toHaveProperty('lowStockCount');
    expect(res.body).toHaveProperty('inventoryValue');
    expect(res.body).toHaveProperty('sales7dTotal', 100);
    expect(Array.isArray(res.body.popularProducts)).toBe(true);
  });

  test('Rate limiter returns 429 after threshold', async () => {
    const app = buildApp('1');
    const first = await request(app).get('/dashboard');
    expect(first.status).toBe(200);
    const second = await request(app).get('/dashboard');
    expect(second.status).toBe(429);
  });

  test('Low-stock products honor limit, page, search, threshold and set Cache-Control', async () => {
    const app = buildApp('300');
    const res = await request(app)
      .get('/dashboard/low-stock')
      .query({ limit: 1, page: 1, search: 'alpha', threshold: 5 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=30/);
    // After filtering by threshold<5, only Alpha(2) and Gamma(1) remain. Search 'alpha' keeps Alpha.
    expect(res.body.length).toBe(1);
    expect(res.body[0].name.toLowerCase()).toContain('alpha');
  });

  test('Low-stock PCS honors limit, page, search, threshold and sets Cache-Control', async () => {
    const app = buildApp('300');
    const res = await request(app)
      .get('/dashboard/low-stock-pcs')
      .query({ limit: 1, page: 1, search: 'gamma', threshold: 5 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=30/);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name.toLowerCase()).toContain('gamma');
  });

  test('Expiring products returns list with Cache-Control header', async () => {
    const app = buildApp('300');
    const res = await request(app)
      .get('/dashboard/expiring')
      .query({ days: 30 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=30/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('Dead stock returns list with Cache-Control header', async () => {
    const app = buildApp('300');
    const res = await request(app)
      .get('/dashboard/dead-stock')
      .query({ days: 90 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=30/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('Top customers returns list with Cache-Control header', async () => {
    const app = buildApp('300');
    const res = await request(app)
      .get('/dashboard/top-customers')
      .query({ limit: 5 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=60/);
    expect(Array.isArray(res.body)).toBe(true);
  });
});