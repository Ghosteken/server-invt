"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prismaMock = {
    pcsInventory: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
    },
};
jest.mock("../db/prisma", () => ({
    __esModule: true,
    default: prismaMock,
    prisma: prismaMock,
}));
const pcsInventoryService_1 = require("../services/pcsInventoryService");
describe("pcsInventoryService.adjustPcsQuantity", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it("does not create a new row when it would result in 0", async () => {
        prismaMock.pcsInventory.findUnique.mockResolvedValueOnce(null);
        await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: "Unknown Item", delta: -5, tenantId: "t1" });
        expect(prismaMock.pcsInventory.upsert).not.toHaveBeenCalled();
    });
    it("creates/updates when next quantity is positive", async () => {
        prismaMock.pcsInventory.findUnique.mockResolvedValueOnce(null);
        await (0, pcsInventoryService_1.adjustPcsQuantity)({ name: "New Item", delta: 3, tenantId: "t1" });
        expect(prismaMock.pcsInventory.upsert).toHaveBeenCalledTimes(1);
        expect(prismaMock.pcsInventory.upsert.mock.calls[0][0]).toMatchObject({
            where: { tenantId_name: { tenantId: "t1", name: "New Item" } },
            create: { tenantId: "t1", name: "New Item", quantity: 3 },
            update: { quantity: 3 },
        });
    });
});
