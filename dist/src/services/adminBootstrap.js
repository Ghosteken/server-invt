"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAdminUser = ensureAdminUser;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = require("node:crypto");
// Ensure an admin user exists and matches configured credentials.
// Call this on server startup to keep admin in sync with environment.
async function ensureAdminUser() {
    const prisma = new client_1.PrismaClient();
    try {
        const configuredEmail = process.env.ADMIN_EMAIL;
        const configuredPassword = process.env.ADMIN_PASSWORD;
        if (!configuredEmail || !configuredPassword) {
            console.log("adminBootstrap: ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin ensure.");
            return;
        }
        const adminEmail = configuredEmail.toLowerCase().trim();
        const adminPassword = configuredPassword;
        const existing = await prisma.users.findFirst({ where: { email: adminEmail } });
        const hashedPassword = bcryptjs_1.default.hashSync(String(adminPassword), 10);
        if (!existing) {
            await prisma.users.create({
                data: {
                    userId: (0, node_crypto_1.randomUUID)(),
                    name: "Admin User",
                    email: adminEmail,
                    password: hashedPassword,
                    role: "admin",
                },
            });
            console.log(`adminBootstrap: created admin ${adminEmail}`);
        }
        else {
            const passwordMatches = bcryptjs_1.default.compareSync(String(adminPassword), existing.password);
            if (existing.role !== "admin" || !passwordMatches) {
                await prisma.users.update({
                    where: { userId: existing.userId },
                    data: { role: "admin", password: hashedPassword },
                });
                console.log(`adminBootstrap: updated admin ${adminEmail}`);
            }
            else {
                console.log(`adminBootstrap: admin already up-to-date: ${adminEmail}`);
            }
        }
    }
    catch (e) {
        console.error("adminBootstrap: failed ensuring admin user", e);
    }
    finally {
        await prisma.$disconnect();
    }
}
