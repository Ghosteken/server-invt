import fs from "fs";
import path from "path";

type FeatureFlags = Record<string, string[]>; // userId -> features

const FLAGS_PATH = path.join(__dirname, "../../assets/featureFlags.json");

export const readFlags = (): FeatureFlags => {
  try {
    const raw = fs.readFileSync(FLAGS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export const writeFlags = (flags: FeatureFlags) => {
  fs.writeFileSync(FLAGS_PATH, JSON.stringify(flags, null, 2), "utf-8");
};