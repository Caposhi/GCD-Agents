import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = process.cwd();
const textExtensions = new Set([
  "", ".cjs", ".env", ".example", ".js", ".json", ".md", ".mjs", ".sql", ".ts", ".txt", ".yaml", ".yml",
]);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => file && !file.startsWith("vendor/") && !file.startsWith("docs/archive/") && file !== "package-lock.json")
  .filter((file) => textExtensions.has(extname(file)) || file === ".env.example")
  .filter((file) => existsSync(resolve(root, file)));

const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Render API key", /\brnd_[A-Za-z0-9_-]{24,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{24,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Slack webhook", /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]{8,}\/[A-Z0-9]{8,}\/[A-Za-z0-9]{16,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["US SSN", /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/],
];
const findings = [];

for (const file of files) {
  const buffer = readFileSync(resolve(root, file));
  if (buffer.includes(0)) continue;
  const lines = buffer.toString("utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [label, pattern] of rules) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1}: ${label}`);
    }
    for (const match of line.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
      const prefix = line.slice(0, match.index);
      if (/https?:\/\/[^/\s]*:$/.test(prefix)) continue; // deliberate URL-userinfo rejection fixtures
      const domain = match[1].toLowerCase();
      if (!["example.com", "example.org", "example.net", "example.invalid"].includes(domain)) {
        findings.push(`${file}:${index + 1}: email address / possible PII`);
      }
    }
  });
}

if (findings.length) {
  console.error(`Sensitive-content scan failed (${findings.length}); values are intentionally suppressed:`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`Sensitive-content scan passed for ${files.length} tracked text files; matched values were never printed.`);
