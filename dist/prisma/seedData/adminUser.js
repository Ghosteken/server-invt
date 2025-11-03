"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
dotenv_1.default.config();
async function seedAdmin() {
    const prisma = new client_1.PrismaClient();
    try {
        console.log('seed: starting admin seed');
        // Check if admin already exists
        const existingAdmin = await prisma.users.findFirst({
            where: { email: "admin@inventory.com" },
        });
        if (existingAdmin) {
            console.log("Admin user already exists");
            return;
        }
        // Create admin user
        const hashedPassword = bcryptjs_1.default.hashSync("admin123", 10);
        console.log('seed: creating admin user with email=admin@inventory.com');
        await prisma.users.create({
            data: {
                userId: "admin-user-id-123456",
                name: "Admin User",
                email: "admin@inventory.com",
                password: hashedPassword,
                role: "admin",
            },
        });
        console.log("Admin user created successfully");
    }
    catch (error) {
        console.error("Error seeding admin user:", error);
    }
    finally {
        try {
            await prisma.$disconnect();
        }
        catch (e) {
            console.error('seed: error disconnecting prisma', e);
        }
    }
}
seedAdmin();
