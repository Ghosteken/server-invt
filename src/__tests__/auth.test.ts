import request from 'supertest';
import jwt from 'jsonwebtoken';

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
      findFirst: jest.fn(async (opts: any) => {
        const where = opts?.where || {};
        const email = (where.email || '').toLowerCase();
        return usersFixture.find(u => u.email.toLowerCase() === email) || null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const id = where?.userId;
        return usersFixture.find(u => u.userId === id) || null;
      }),
      findMany: jest.fn(async () => usersFixture.slice()),
      update: jest.fn(async ({ where, data }: any) => {
        const idx = usersFixture.findIndex(u => u.userId === where.userId);
        if (idx >= 0) {
          usersFixture[idx] = { ...usersFixture[idx], ...data } as any;
          return usersFixture[idx];
        }
        throw new Error('not found');
      }),
      create: jest.fn(async ({ data }: any) => {
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

import createApp from '../app';

function buildApp() {
  return createApp();
}

describe('Auth and protected user routes', () => {
  test('POST /auth/login succeeds for regular user', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'pass123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ email: 'user@example.com', role: 'user' });
  });

  test('POST /auth/login succeeds for admin credentials on regular route', async () => {
    process.env.ADMIN_EMAIL = 'admin@inventory.com';
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@inventory.com', password: 'pass123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'admin' });
  });

  test('POST /auth/login fails for blocked account', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'blocked@example.com', password: 'pass123' });
    expect(res.status).toBe(403);
  });

  test('POST /auth/login returns admin token for admin user', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@inventory.com', password: 'pass123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'admin' });
    expect(res.body).toHaveProperty('token');
  });

  test('GET /auth/verify returns decoded token info', async () => {
    const token = jwt.sign({ userId: 'u1', email: 'user@example.com', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const app = buildApp();
    const res = await request(app)
      .get('/auth/verify')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'user@example.com', role: 'user' });
  });

  test('GET /users requires auth and admin role', async () => {
    const app = buildApp();
    // No token
    const resNo = await request(app).get('/users');
    expect(resNo.status).toBe(401);

    // Non-admin token
    const userToken = jwt.sign({ userId: 'u1', email: 'user@example.com', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const resUser = await request(app).get('/users').set('Authorization', `Bearer ${userToken}`);
    expect(resUser.status).toBe(403);

    // Admin token
    const adminToken = jwt.sign({ userId: 'u2', email: 'admin@inventory.com', role: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const resAdmin = await request(app).get('/users').set('Authorization', `Bearer ${adminToken}`);
    expect(resAdmin.status).toBe(200);
    expect(Array.isArray(resAdmin.body)).toBe(true);
  });
});
