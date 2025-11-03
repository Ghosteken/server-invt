import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

dotenv.config();

async function seedAdmin() {
  const prisma = new PrismaClient();
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
    const hashedPassword = bcrypt.hashSync("admin123", 10);
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
  } catch (error) {
    console.error("Error seeding admin user:", error);
  } finally {
    try {
      await prisma.$disconnect();
    } catch (e) {
      console.error('seed: error disconnecting prisma', e);
    }
  }
}

seedAdmin();