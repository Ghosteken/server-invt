import request from "supertest";

// Mock Prisma used by productController.
// Register the mock BEFORE importing the app to avoid TDZ errors.
const prismaMock = {
  customers: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  products: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  customerPurchases: {
    create: jest.fn(),
  },
} as any;

jest.mock("../db/prisma", () => ({
  __esModule: true,
  default: prismaMock,
  prisma: prismaMock,
}));

// Mock PCS inventory service to avoid file I/O and just record calls
const adjustPcsQuantityMock = jest.fn();
jest.mock("../services/pcsInventoryService", () => ({
  __esModule: true,
  readPcsInventory: () => [],
  upsertPcsEntries: (x: any) => x,
  adjustPcsQuantity: adjustPcsQuantityMock,
}));

import { processInvoiceManual } from "../controllers/productController";

describe("POST /products/invoice/manual", () => {
  let consoleSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    // Safe defaults for product lookups in tests
    prismaMock.products.findMany.mockResolvedValue([]);
  });
  afterEach(() => {
    consoleSpy?.mockRestore();
  });

  it("deducts stock for carton items and records purchases", async () => {
    // Customer flow
    prismaMock.customers.findFirst.mockResolvedValueOnce(null);
    prismaMock.customers.create.mockResolvedValueOnce({ customerId: "c1", name: "Alice" });

    // Products
    prismaMock.products.findUnique.mockResolvedValueOnce({ productId: "p1", name: "Nutella", price: 50, stockQuantity: 20 });
    prismaMock.products.update.mockResolvedValueOnce({ productId: "p1", stockQuantity: 18 });

    prismaMock.customerPurchases.create.mockResolvedValueOnce({ id: "cp1" });

    const payload = {
      customerName: "Alice",
      items: [
        { productId: "p1", quantity: 2, unit: "ctn" },
      ],
    };

    const req = { body: payload, user: { userId: "tester" } } as any;
    const res: any = {
      statusCode: 200,
      body: null,
      status(n: number) { this.statusCode = n; return this; },
      json(obj: any) { this.body = obj; },
    };
    await processInvoiceManual(req as any, res as any);
    if (res.statusCode !== 200) {
      // Debug: print captured error calls
      // eslint-disable-next-line no-console
      console.log("manualInvoice error calls:", (consoleSpy as any).mock?.calls);
      // eslint-disable-next-line no-console
      console.log("manualInvoice response body:", res.body);
      // eslint-disable-next-line no-console
      console.log("calls customers.findFirst:", prismaMock.customers.findFirst.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log("calls customers.create:", prismaMock.customers.create.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log("calls products.findUnique:", prismaMock.products.findUnique.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log("calls products.update:", prismaMock.products.update.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log("calls customerPurchases.create:", prismaMock.customerPurchases.create.mock.calls.length);
      // eslint-disable-next-line no-console
      // no pcs adjustment in this first test
    }
    expect(res.statusCode).toBe(200);
    expect(res.body?.customer?.name).toBe("Alice");
    expect(res.body?.updates).toEqual([{ productId: "p1", name: "Nutella", deducted: 2 }]);

    // Stock deduction called once for carton item
    expect(prismaMock.products.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.products.update).toHaveBeenCalledWith({
      where: { productId: "p1" },
      data: { stockQuantity: 18 },
    });

    // Purchase recorded for matched product
    expect(prismaMock.customerPurchases.create).toHaveBeenCalledTimes(1);
    const purchaseCall = prismaMock.customerPurchases.create.mock.calls[0][0];
    expect(purchaseCall.data).toMatchObject({ customerId: "c1", productId: "p1", quantity: 2, unitPrice: 50, totalCost: 100 });

    // No PCS adjustment for carton-only request
    expect(adjustPcsQuantityMock).toHaveBeenCalledTimes(0);
  });

  it("adjusts PCS quantity for loose item only", async () => {
    prismaMock.customers.findFirst.mockResolvedValueOnce({ customerId: "c1", name: "Alice" });

    const payload = {
      customerName: "Alice",
      items: [
        { name: "Loose Yogurt", quantity: 3, unit: "pcs" },
      ],
    };

    const req = { body: payload, user: { userId: "tester" } } as any;
    const res: any = {
      statusCode: 200,
      body: null,
      status(n: number) { this.statusCode = n; return this; },
      json(obj: any) { this.body = obj; },
    };
    await processInvoiceManual(req as any, res as any);
    if (res.statusCode !== 200) {
      console.log("console.error calls:", consoleSpy.mock.calls.map((c) => (c[1] && (c[1].message || c[1].toString())) || c[0]));
    }
    expect(res.statusCode).toBe(200);
    expect(adjustPcsQuantityMock).toHaveBeenCalledWith({ name: "Loose Yogurt", delta: -3 });
    expect(res.body?.updates).toEqual([]);
  });

  it("validates required fields and returns 400 on missing customerName/items", async () => {
    const makeRes = () => ({ statusCode: 200, body: null, status(n: number) { this.statusCode = n; return this; }, json(obj: any) { this.body = obj; } });
    const r1: any = makeRes();
    await processInvoiceManual({ body: { customerName: "", items: [] } } as any, r1 as any);
    expect(r1.statusCode).toBe(400);

    const r2: any = makeRes();
    await processInvoiceManual({ body: { customerName: "Bob" } } as any, r2 as any);
    expect(r2.statusCode).toBe(400);

    const r3: any = makeRes();
    await processInvoiceManual({ body: { items: [] } } as any, r3 as any);
    expect(r3.statusCode).toBe(400);
  });
});