import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Explicitly set schema and migrations locations
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // Use ts-node to run the existing TypeScript seed script
    seed: "ts-node prisma/seed.ts",
  },
});