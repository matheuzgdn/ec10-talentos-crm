import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
).split(/\r?\n/).filter(Boolean);

const textExtensions = new Set([
  "", ".cjs", ".css", ".env", ".example", ".html", ".ini", ".js", ".json",
  ".jsx", ".md", ".mjs", ".ps1", ".py", ".sh", ".sql", ".toml", ".ts",
  ".tsx", ".txt", ".yaml", ".yml",
]);

const checks = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ["google-api-key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["groq-api-key", /gsk_[0-9A-Za-z_-]{20,}/g],
  ["github-token", /gh(?:p|o|u|s|r)_[0-9A-Za-z]{20,}/g],
  ["openai-key", /sk-(?:proj-)?[0-9A-Za-z_-]{40,}/g],
  ["xai-key", /xai-[0-9A-Za-z_-]{20,}/g],
  ["supabase-secret", /sb_secret_[0-9A-Za-z_-]{20,}/g],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  ["database-url-with-password", /(?:postgres(?:ql)?|mysql):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi],
  ["nonempty-secret-env", /^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|EC10_BOOKING_DB_URL|GEMINI_API_KEY|GROQ_API_KEY|META_SYSTEM_USER_ACCESS_TOKEN|META_CAPI_ACCESS_TOKEN|GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_OAUTH_REFRESH_TOKEN)[ \t]*=[ \t]*[^\s#][^\r\n]*$/gmi],
];

const findings = [];
for (const file of files) {
  let info;
  try { info = statSync(file); } catch { continue; }
  if (!info.isFile() || info.size > 8 * 1024 * 1024) continue;
  if (!textExtensions.has(extname(file).toLowerCase()) && !file.endsWith(".env.example")) continue;
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  for (const [name, regex] of checks) {
    regex.lastIndex = 0;
    const count = [...content.matchAll(regex)].length;
    if (count) findings.push({ file, check: name, count });
  }
}

if (findings.length) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, filesScanned: files.length }));
