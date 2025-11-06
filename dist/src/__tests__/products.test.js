"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
process.env.RATE_LIMIT_MAX = '9999';
// Minimal products fixture used by mocks
const productsFixture = [
    { productId: 'p1', name: 'Alpha Soap', price: 10, stockQuantity: 2, expiryDate: new Date('2025-12-31'), category: 'hygiene', packSize: '1ct' },
    { productId: 'p2', name: 'Beta Milk', price: 5, stockQuantity: 10, expiryDate: null, category: 'dairy', packSize: '12ct' },
];
jest.mock('@prisma/client', () => {
    const m = {
        products: {
            findMany: jest.fn(async (opts) => {
                if (opts?.where?.productId?.in) {
                    const set = new Set(opts.where.productId.in);
                    return productsFixture.filter(p => set.has(p.productId));
                }
                return productsFixture.slice();
            }),
            findUnique: jest.fn(async ({ where }) => {
                return productsFixture.find(p => p.productId === where.productId) || null;
            }),
            update: jest.fn(async ({ where, data }) => {
                const idx = productsFixture.findIndex(p => p.productId === where.productId);
                if (idx >= 0) {
                    productsFixture[idx] = { ...productsFixture[idx], ...data };
                    return productsFixture[idx];
                }
                throw new Error('not found');
            }),
        },
    };
    return { PrismaClient: jest.fn(() => m) };
});
// Mock audit service used by getProductUpdatesLast
jest.mock('../services/productUpdateAuditService', () => ({
    getLastFieldUpdates: () => ({ p1: { name: '2025-01-01T00:00:00.000Z' }, p2: { price: '2025-01-02T00:00:00.000Z' } }),
    recordFieldUpdates: jest.fn(),
}));
const app_1 = __importDefault(require("../app"));
function buildApp() {
    return (0, app_1.default)();
}
describe('Product routes core behaviors', () => {
    test('GET /products returns list', async () => {
        const app = buildApp();
        const res = await (0, supertest_1.default)(app).get('/products');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(2);
        expect(res.body[0]).toHaveProperty('name');
    });
    test('PUT /products/:id with invalid expiryDate returns 400', async () => {
        const app = buildApp();
        const res = await (0, supertest_1.default)(app)
            .put('/products/p1')
            .send({ expiryDate: 'not-a-date' });
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('message');
    });
    test('GET /products/updates/last returns enriched payload with product names', async () => {
        const app = buildApp();
        const res = await (0, supertest_1.default)(app).get('/products/updates/last');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        const entry = res.body.find((x) => x.productId === 'p1');
        expect(entry).toBeTruthy();
        expect(entry.name).toBe('Alpha Soap');
        expect(entry.last).toHaveProperty('name');
    });
});
