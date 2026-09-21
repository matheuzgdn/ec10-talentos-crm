import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const secret = randomBytes(48).toString("hex");
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || "postgres://invalid:invalid@127.0.0.1:1/invalid",
  JWT_SECRET: secret,
  GATEWAY_PUBLIC_ORIGIN: "http://127.0.0.1:3299",
  PORT: "3299",
};

const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));
const child = spawn(process.execPath, [serverPath], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("gateway start timeout")), 5000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes('"event":"started"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => reject(new Error(`gateway exited with ${code}`)));
  });
  const live = await fetch("http://127.0.0.1:3299/health/live");
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { ok: true, service: "ec10-crm-gateway" });
  const options = await fetch("http://127.0.0.1:3299/auth/v1/token", { method: "OPTIONS" });
  assert.equal(options.status, 204);
  const missing = await fetch("http://127.0.0.1:3299/missing");
  assert.equal(missing.status, 404);
  console.log(JSON.stringify({ ok: true, checks: 3 }));
} finally {
  child.kill("SIGTERM");
}
