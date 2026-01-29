const prismaMock = {
  products: {
    findMany: jest.fn(),
    update: jest.fn(),
    createMany: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
} as any;

jest.mock("../db/prisma", () => ({
  __esModule: true,
  default: prismaMock,
  prisma: prismaMock,
}));

jest.mock("../services/productUpdateAuditService", () => ({
  __esModule: true,
  recordFieldUpdates: () => {},
  recordFieldUpdatesBulk: () => {},
  getLastFieldUpdates: () => ({}),
}));

jest.mock("node:fs", () => {
  const existsSync = jest.fn(() => false);
  const mkdirSync = jest.fn();
  const promises = {
    readFile: jest.fn(async () => "[]"),
    writeFile: jest.fn(async () => undefined),
  };
  const fs = { existsSync, mkdirSync, promises };
  return { __esModule: true, default: fs, existsSync, mkdirSync, promises };
});

const sheetToJsonMock = jest.fn();
jest.mock("xlsx", () => ({
  __esModule: true,
  default: {
    read: jest.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
    utils: {
      sheet_to_json: (...args: any[]) => sheetToJsonMock(...args),
    },
  },
}));

import { importProducts } from "../controllers/productController";

const makeRes = () => {
  const res: any = {
    statusCode: 200,
    body: null,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(obj: any) {
      this.body = obj;
      return this;
    },
  };
  return res;
};

describe("POST /products/import (blank quantity handling)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
    prismaMock.products.update.mockResolvedValue({ ok: true });
    prismaMock.products.createMany.mockResolvedValue({ count: 0 });
    prismaMock.products.delete.mockResolvedValue({ ok: true });
  });

  it("clears existing stockQuantity to 0 when Quantity cell is blank", async () => {
    sheetToJsonMock.mockReturnValueOnce([
      { ProductId: "p1", Name: "Test Product", Price: 100, Quantity: null },
    ]);

    const existing = {
      productId: "p1",
      tenantId: "default",
      name: "Test Product",
      price: 100,
      purchasePrice: null,
      stockQuantity: 15,
      expiryDate: null,
      category: null,
      description: null,
      packSize: null,
      barcode: null,
    };

    prismaMock.products.findMany.mockImplementation(async (args: any) => {
      if (args?.select?.category) return [];
      if (args?.where?.barcode?.in) return [];
      if (args?.where?.tenantId) return [existing];
      return [];
    });

    const req: any = {
      tenantId: "default",
      user: { userId: "u1", tenantId: "default" },
      file: { originalname: "products.xlsx", size: 1, buffer: Buffer.from("x") },
      body: {},
    };
    const res = makeRes();

    await importProducts(req, res);

    expect(res.statusCode).toBe(201);
    const updateCalls = prismaMock.products.update.mock.calls.map((c: any[]) => c[0]);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { productId: "p1" },
          data: expect.objectContaining({ stockQuantity: 0 }),
        }),
      ])
    );
  });

  it("updates existing stockQuantity when Quantity cell has a value", async () => {
    sheetToJsonMock.mockReturnValueOnce([
      { ProductId: "p1", Name: "Test Product", Price: 100, Quantity: 7 },
    ]);

    const existing = {
      productId: "p1",
      tenantId: "default",
      name: "Test Product",
      price: 100,
      purchasePrice: null,
      stockQuantity: 15,
      expiryDate: null,
      category: null,
      description: null,
      packSize: null,
      barcode: null,
    };

    prismaMock.products.findMany.mockImplementation(async (args: any) => {
      if (args?.select?.category) return [];
      if (args?.where?.barcode?.in) return [];
      if (args?.where?.tenantId) return [existing];
      return [];
    });

    const req: any = {
      tenantId: "default",
      user: { userId: "u1", tenantId: "default" },
      file: { originalname: "products.xlsx", size: 1, buffer: Buffer.from("x") },
      body: {},
    };
    const res = makeRes();

    await importProducts(req, res);

    expect(res.statusCode).toBe(201);
    const updateCalls = prismaMock.products.update.mock.calls.map((c: any[]) => c[0]);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { productId: "p1" },
          data: expect.objectContaining({ stockQuantity: 7 }),
        }),
      ])
    );
  });
});
