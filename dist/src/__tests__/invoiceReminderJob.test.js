"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prismaMock = {
    invoices: {
        findMany: jest.fn(),
        update: jest.fn(),
    },
};
jest.mock("../db/prisma", () => ({
    __esModule: true,
    default: prismaMock,
    prisma: prismaMock,
}));
const appendNotificationMock = jest.fn();
jest.mock("../services/notificationService", () => ({
    __esModule: true,
    appendNotification: (...args) => appendNotificationMock(...args),
}));
const getInvoiceMetaMock = jest.fn();
jest.mock("../services/invoiceMetaService", () => ({
    __esModule: true,
    getInvoiceMeta: (...args) => getInvoiceMetaMock(...args),
}));
const invoiceReminderJob_1 = require("../jobs/invoiceReminderJob");
describe("runInvoiceReminderScan", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it("notifies 3 days before due date and marks dueSoonNotifiedAt", async () => {
        getInvoiceMetaMock.mockResolvedValueOnce({ invoiceNumber: "123" });
        prismaMock.invoices.findMany.mockResolvedValueOnce([
            {
                invoiceId: "inv1",
                customerId: "c1",
                dueDate: new Date("2026-01-17T01:00:00.000Z"),
                status: "unpaid",
                tenantId: "default",
                dueSoonNotifiedAt: null,
                dueDateNotifiedAt: null,
                customer: { name: "Alice" },
            },
        ]);
        prismaMock.invoices.update.mockResolvedValueOnce({});
        await (0, invoiceReminderJob_1.runInvoiceReminderScan)(new Date("2026-01-14T15:00:00.000Z"));
        expect(appendNotificationMock).toHaveBeenCalledTimes(1);
        expect(appendNotificationMock).toHaveBeenCalledWith({
            type: "invoice",
            message: "Invoice #123 for Alice has 3 days remaining to complete payment",
            tenantId: "default",
        });
        expect(prismaMock.invoices.update).toHaveBeenCalledWith({
            where: { invoiceId: "inv1" },
            data: { dueSoonNotifiedAt: expect.any(Date) },
        });
    });
    it("notifies on due date day and marks dueDateNotifiedAt", async () => {
        getInvoiceMetaMock.mockResolvedValueOnce({ invoiceNumber: "9" });
        prismaMock.invoices.findMany.mockResolvedValueOnce([
            {
                invoiceId: "inv2",
                customerId: "c2",
                dueDate: new Date("2026-01-14T00:01:00.000Z"),
                status: "partial",
                tenantId: "default",
                dueSoonNotifiedAt: null,
                dueDateNotifiedAt: null,
                customer: { name: "Bob" },
            },
        ]);
        prismaMock.invoices.update.mockResolvedValueOnce({});
        await (0, invoiceReminderJob_1.runInvoiceReminderScan)(new Date("2026-01-14T15:00:00.000Z"));
        expect(appendNotificationMock).toHaveBeenCalledTimes(1);
        expect(appendNotificationMock).toHaveBeenCalledWith({
            type: "invoice",
            message: "Invoice #9 for Bob is due today and is still unpaid",
            tenantId: "default",
        });
        expect(prismaMock.invoices.update).toHaveBeenCalledWith({
            where: { invoiceId: "inv2" },
            data: { dueDateNotifiedAt: expect.any(Date) },
        });
    });
    it("does not notify if already marked as notified", async () => {
        prismaMock.invoices.findMany.mockResolvedValueOnce([
            {
                invoiceId: "inv3",
                customerId: "c3",
                dueDate: new Date("2026-01-17T00:00:00.000Z"),
                status: "unpaid",
                tenantId: "default",
                dueSoonNotifiedAt: new Date("2026-01-10T00:00:00.000Z"),
                dueDateNotifiedAt: new Date("2026-01-14T00:00:00.000Z"),
                customer: { name: "Cara" },
            },
        ]);
        await (0, invoiceReminderJob_1.runInvoiceReminderScan)(new Date("2026-01-14T15:00:00.000Z"));
        expect(appendNotificationMock).toHaveBeenCalledTimes(0);
        expect(prismaMock.invoices.update).toHaveBeenCalledTimes(0);
    });
});
