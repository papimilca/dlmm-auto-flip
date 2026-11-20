import { readFileSync } from "node:fs";
import { configSchema, type AppConfig } from "./schema.js";

/** Load and validate config JSON; throws (fail-fast) on any invalid value. */
export function loadConfig(path: string): AppConfig {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config at ${path}: ${issues}`);
  }
  return result.data;
}
