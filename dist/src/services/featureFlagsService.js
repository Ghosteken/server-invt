"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFlags = exports.readFlags = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const FLAGS_PATH = path_1.default.join(__dirname, "../../assets/featureFlags.json");
const readFlags = () => {
    try {
        const raw = fs_1.default.readFileSync(FLAGS_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
};
exports.readFlags = readFlags;
const writeFlags = (flags) => {
    const dir = path_1.default.dirname(FLAGS_PATH);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(FLAGS_PATH, JSON.stringify(flags, null, 2), "utf-8");
};
exports.writeFlags = writeFlags;
