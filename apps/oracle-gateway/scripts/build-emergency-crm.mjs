import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = "https://ec10talentos.com";
const destination = "https://crm-api.147-15-27-235.nip.io";
const output = resolve(process.argv[2] || "tmp/ec10-emergency-crm");

async function download(path) {
  const response = await fetch(new URL(path, source), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed: ${path} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function save(path, buffer) {
  const local = resolve(output, `.${path}`);
  assert.ok(local.startsWith(`${output}\\`) || local.startsWith(`${output}/`));
  await mkdir(dirname(local), { recursive: true });
  await writeFile(local, buffer);
}

const html = (await download("/crm")).toString("utf8");
const assets = [...html.matchAll(/(?:src|href)="(\/crm-v2-assets\/[^"]+)"/g)].map((match) => match[1]);
assert.ok(assets.some((path) => path.endsWith(".js")), "CRM JavaScript not found");
assert.ok(assets.some((path) => path.endsWith(".css")), "CRM CSS not found");

const hashes = {};
for (const path of new Set(assets)) {
  let asset = await download(path);
  if (path.endsWith(".js")) {
    const original = asset.toString("utf8");
    const oldOrigin = "https://ptylfzhrkudaazcbsbwu.supabase.co";
    const count = original.split(oldOrigin).length - 1;
    assert.ok(count >= 1, "Expected Supabase endpoint not found in CRM bundle");
    asset = Buffer.from(original.replaceAll(oldOrigin, destination));
  }
  await save(path, asset);
  hashes[path] = createHash("sha256").update(asset).digest("hex");
}

await save("/ec10-content-protection.js", await download("/ec10-content-protection.js"));
await save("/crm/index.html", Buffer.from(html));
console.log(JSON.stringify({ ok: true, assets: Object.keys(hashes).length, hashes }));
