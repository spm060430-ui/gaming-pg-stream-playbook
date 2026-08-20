// Tiny .env loader — no dependency. Reads agents/.env (if present) and copies
// any KEY=VALUE pairs into process.env without overwriting existing vars.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
