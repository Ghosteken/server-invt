import request from "supertest";

// Minimal Prisma mock
const prismaMock = {
  $transaction: jest.fn(async (fn: any) => fn(prismaMock)),
  expenses: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  expenseBanks: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  auditLogs: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
} as any;

jest.mock("../db/prisma", () => ({
  __esModule: true,
  default: prismaMock,
  prisma: prismaMock,
}));

// Mock socket.io
const ioMock = {
  emit: jest.fn(),
};

jest.mock("socket.io", () => {
  return {
    Server: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      emit: jest.fn(),
    })),
  };
});

// Mock auth middleware to bypass checks
jest.mock("../middleware/authMiddleware", () => ({
  authenticateToken: (req: any, res: any, next: any) => next(),
  requireAdmin: (req: any, res: any, next: any) => next(),
}));

// Mock permission middleware
jest.mock("../middleware/permissionMiddleware", () => ({
  requirePermission: (module: string, action: string) => (req: any, res: any, next: any) => next(),
}));

import createApp from "../app";

describe("Expense Status Logic", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
    // Inject mock io
    app.set("io", ioMock);
    jest.clearAllMocks();
  });

  it("createExpense sets default status to pending", async () => {
    const expenseData = { category: "Office", name: "Paper", amount: 500, date: "2023-01-01" };
    const createdExpense = { ...expenseData, expenseId: "123", timestamp: new Date(expenseData.date), tenantId: "default", status: "pending" };
    
    prismaMock.expenses.create.mockResolvedValueOnce(createdExpense);

    const res = await request(app).post("/expenses").send(expenseData).expect(201);
    
    expect(res.body.expense.status).toBe("pending");
    expect(prismaMock.expenses.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "pending" })
    }));
    expect(ioMock.emit).toHaveBeenCalledWith("expense:created", expect.objectContaining({ status: "pending" }));
  });

  it("approveExpense updates status to approved", async () => {
    const expenseId = "123";
    const existing = { expenseId, category: "Office", amount: 500, timestamp: new Date(), tenantId: "default", status: "pending" };
    const updated = { ...existing, status: "approved" };

    prismaMock.expenses.findFirst.mockResolvedValueOnce(existing);
    prismaMock.expenses.update.mockResolvedValueOnce(updated);

    const res = await request(app).put(`/expenses/${expenseId}/approve`).expect(200);

    expect(res.body.expense.status).toBe("approved");
    expect(prismaMock.expenses.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { expenseId },
      data: { status: "approved" }
    }));
    expect(ioMock.emit).toHaveBeenCalledWith("expense:updated", { id: expenseId, status: "approved" });
  });

  it("listExpenses returns status from DB", async () => {
    const expenses = [
      { expenseId: "1", category: "A", amount: 100, timestamp: new Date(), tenantId: "default", status: "approved" },
      { expenseId: "2", category: "B", amount: 200, timestamp: new Date(), tenantId: "default", status: "rejected" },
      { expenseId: "3", category: "C", amount: 300, timestamp: new Date(), tenantId: "default", status: "pending" },
    ];

    prismaMock.expenses.findMany.mockResolvedValueOnce(expenses);

    // Call /expenses/list NOT /expenses
    const res = await request(app).get("/expenses/list").expect(200);

    expect(res.body.expenses).toHaveLength(3);
    expect(res.body.expenses[0].status).toBe("approved");
    expect(res.body.expenses[1].status).toBe("rejected");
    expect(res.body.expenses[2].status).toBe("pending");
    
    // Ensure we are NOT querying audit logs anymore (optimization check)
    expect(prismaMock.auditLogs.findMany).not.toHaveBeenCalled();
  });
});
