"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("prisma/config");
exports.default = (0, config_1.defineConfig)({
    // Explicitly set schema and migrations locations
    schema: node_path_1.default.join("prisma", "schema.prisma"),
    migrations: {
        path: node_path_1.default.join("prisma", "migrations"),
        // Use ts-node to run the existing TypeScript seed script
        seed: "ts-node prisma/seed.ts",
    },
});
