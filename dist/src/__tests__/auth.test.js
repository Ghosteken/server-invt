"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Ensure consistent secrets for signing/verifying
process.env.JWT_SECRET = 'test-secret';
process.env.RATE_LIMIT_MAX = '9999';
// In-memory users fixture
const hashed = require('bcryptjs').hashSync('pass123', 10);
const usersFixture = [
    { userId: 'u1', name: 'Alice', email: 'user@example.com', password: hashed, role: 'user', isBlocked: false },
    { userId: 'u2', name: 'Bob Admin', email: 'admin@inventory.com', password: hashed, role: 'admin', isBlocked: false },
    { userId: 'u3', name: 'Charlie Blocked', email: 'blocked@example.com', password: hashed, role: 'user', isBlocked: true },
];
// Mock PrismaClient to avoid real DB access
jest.mock('@prisma/client', () => {
    const m = {
        users: {
            findFirst: jest.fn(async (opts) => {
                const where = opts?.where || {};
                const email = (where.email || '').toLowerCase();
                return usersFixture.find(u => u.email.toLowerCase() === email) || null;
            }),
            findUnique: jest.fn(async ({ where }) => {
                const id = where?.userId;
                return usersFixture.find(u => u.userId === id) || null;
            }),
            findMany: jest.fn(async () => usersFixture.slice()),
            update: jest.fn(async ({ where, data }) => {
                const idx = usersFixture.findIndex(u => u.userId === where.userId);
                if (idx >= 0) {
                    usersFixture[idx] = { ...usersFixture[idx], ...data };
                    return usersFixture[idx];
                }
                throw new Error('not found');
            }),
            create: jest.fn(async ({ data }) => {
                usersFixture.push(data);
                return data;
            }),
        },
        orgAdmins: {
            findFirst: jest.fn(async () => null),
        },
        organizations: {
            findUnique: jest.fn(async () => null),
            findFirst: jest.fn(async () => null),
        }
    };
    return { PrismaClient: jest.fn(() => m) };
});
const app_1 = __importDefault(require("../app"));
function buildApp() {
    return (0, app_1.default)();
}
describe('Auth and protected user routes', () => {
    test('POST /auth/login succeeds for regular user', async () => {
        const app = buildApp();
        const res = await (0, supertest_1.default)(app)
            .post('/auth/login')
            .send({ email: 'user@example.com', password: 'pass123' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toMatchObject({ email: 'user@example.com', role: 'user' });
    });
    test('POST /auth/login succeeds for admin credentials on regular route', async () => {
        process.env.ADMIN_EMAIL = 'admin@inventory.com';
        const app = buildApp();
        const res = await (0, supertest_1.default)(app)
            .post('/auth/login')
            .send({ email: 'admin@inventory.com', password: 'pass123' });
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ role: 'admin' });
    });
    test('POST /auth/login fails for blocked account', async () => {
        const app = buildApp();
        const res = await (0, supertest_1.default)(app)
            .post('/auth/login')
            .send({ email: 'blocked@example.com', password: 'pass123' });
        expect(res.status).toBe(403);
    });
    test('POST /auth/login returns admin token for admin user', async () => {
        const app = buildApp();
        const res = await (0, supertest_1.default)(app)
            .post('/auth/login')
            .send({ email: 'admin@inventory.com', password: 'pass123' });
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ role: 'admin' });
        expect(res.body).toHaveProperty('token');
    });
    test('GET /auth/verify returns decoded token info', async () => {
        const token = jsonwebtoken_1.default.sign({ userId: 'u1', email: 'user@example.com', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const app = buildApp();
        const res = await (0, supertest_1.default)(app)
            .get('/auth/verify')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({ email: 'user@example.com', role: 'user' });
    });
    test('GET /users requires auth and admin role', async () => {
        const app = buildApp();
        // No token
        const resNo = await (0, supertest_1.default)(app).get('/users');
        expect(resNo.status).toBe(401);
        // Non-admin token
        const userToken = jsonwebtoken_1.default.sign({ userId: 'u1', email: 'user@example.com', role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const resUser = await (0, supertest_1.default)(app).get('/users').set('Authorization', `Bearer ${userToken}`);
        expect(resUser.status).toBe(403);
        // Admin token
        const adminToken = jsonwebtoken_1.default.sign({ userId: 'u2', email: 'admin@inventory.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const resAdmin = await (0, supertest_1.default)(app).get('/users').set('Authorization', `Bearer ${adminToken}`);
        expect(resAdmin.status).toBe(200);
        expect(Array.isArray(resAdmin.body)).toBe(true);
    });
});
