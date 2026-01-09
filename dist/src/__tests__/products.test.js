"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Minimal Prisma mock used by product controller.
// Define mock and register it BEFORE importing the app to ensure it takes effect.
const prismaMock = {
    products: {
        findMany: jest.fn(),
    },
};
jest.mock("../db/prisma", () => ({
    __esModule: true,
    default: prismaMock,
    prisma: prismaMock,
}));
const app_1 = __importDefault(require("../app"));
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";
const generateToken = (userId, tenantId = "default") => {
    return jsonwebtoken_1.default.sign({ userId, tenantId, role: "user", email: "test@example.com" }, JWT_SECRET, { expiresIn: "1h" });
};
describe("GET /products search", () => {
    let app;
    let token;
    beforeEach(() => {
        app = (0, app_1.default)();
        token = generateToken("test-user", "default");
        jest.clearAllMocks();
    });
    it("returns products filtered by search and caches repeated queries", async () => {
        const result = [
            { productId: "p1", name: "Hazelnut Nutella 350g", price: 100, stockQuantity: 10 },
            { productId: "p2", name: "Hazelnut Nutella 750g", price: 200, stockQuantity: 5 },
        ];
        prismaMock.products.findMany.mockResolvedValueOnce(result);
        const res1 = await (0, supertest_1.default)(app).get("/products").query({ search: "nutella" }).set("Authorization", `Bearer ${token}`).expect(200);
        expect(res1.body).toEqual(result);
        expect(prismaMock.products.findMany).toHaveBeenCalledTimes(1);
        // Verify search filter shape
        const callArgs = prismaMock.products.findMany.mock.calls[0][0];
        expect(callArgs).toMatchObject({
            where: {
                OR: [
                    { name: { contains: "nutella", mode: "insensitive" } },
                    { category: { contains: "nutella", mode: "insensitive" } },
                    { description: { contains: "nutella", mode: "insensitive" } },
                    { barcode: { contains: "nutella", mode: "insensitive" } },
                    { packSize: { contains: "nutella", mode: "insensitive" } },
                ],
                tenantId: "default",
            },
            orderBy: { name: "asc" },
        });
        // Second call should hit the in-memory cache and not call Prisma again
        const res2 = await (0, supertest_1.default)(app).get("/products").query({ search: "nutella" }).set("Authorization", `Bearer ${token}`).expect(200);
        expect(res2.body).toEqual(result);
        expect(prismaMock.products.findMany).toHaveBeenCalledTimes(1);
    });
});
