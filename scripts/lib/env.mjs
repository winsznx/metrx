import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Loads .env without clobbering anything already set in the real environment. */
export function loadEnv() {
  const env = {...process.env};
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

export function require_(env, key, hint) {
  const value = (env[key] || "").trim();
  if (!value) {
    console.error(`\nMissing ${key}.${hint ? ` ${hint}` : ""}\n`);
    process.exit(1);
  }
  return value;
}

export const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
