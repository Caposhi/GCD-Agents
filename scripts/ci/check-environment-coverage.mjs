import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const sourceFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src/**/*.ts"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const declared = new Set(
  readFileSync(resolve(root, ".env.example"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
);
const readBySource = new Map();

function record(name, file) {
  if (!readBySource.has(name)) readBySource.set(name, new Set());
  readBySource.get(name).add(file);
}

for (const file of sourceFiles) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) record(match[1], file);
  for (const match of text.matchAll(/\b(?:num|requireEnv)\(\s*["']([A-Z][A-Z0-9_]*)["']/g)) record(match[1], file);
}

const testOrProcessOnly = new Set([
  "LANG",
  "PATH",
  "PHASE0A_DISPOSABLE_POSTGRES",
  "PHASE0A_POSTGRES_ADMIN_URL",
  "TMPDIR",
  "TZ",
]);
const missing = [...readBySource]
  .filter(([name]) => !declared.has(name) && !testOrProcessOnly.has(name))
  .map(([name, files]) => `${name} (${[...files].join(", ")})`);

if (missing.length) {
  console.error("Environment coverage failed; active reads missing from .env.example:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`Environment coverage passed: ${readBySource.size} active/test process variables checked.`);
