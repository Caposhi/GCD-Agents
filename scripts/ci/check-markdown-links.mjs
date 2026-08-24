import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const failures = [];

for (const file of files) {
  const text = readFileSync(resolve(root, file), "utf8");
  const links = text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g);
  for (const match of links) {
    const rawTarget = match[1];
    if (!rawTarget || rawTarget.startsWith("#")) continue;
    if (/^(?:https?:|mailto:)/i.test(rawTarget)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
      failures.push(`${file}: unsupported link scheme in ${rawTarget}`);
      continue;
    }
    const pathPart = decodeURIComponent(rawTarget.split("#", 1)[0]);
    if (!pathPart) continue;
    const target = resolve(root, dirname(file), pathPart);
    if (!existsSync(target)) failures.push(`${file}: missing local target ${rawTarget}`);
  }
}

if (failures.length) {
  console.error(`Markdown link validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Markdown link validation passed for ${files.length} files.`);
