import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { chromium } from "playwright";

const origin = "https://crm-api.147-15-27-235.nip.io";
const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("A database URL is required");

const id = randomUUID();
const email = `ec10-browser-test-${id}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 2 });
let browser;
let created = false;
try {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, $3, now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"full_name":"EC10 Browser Test"}'::jsonb, now(), now())`,
    [id, email, hash],
  );
  created = true;

  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const pageErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 160)));
  page.on("requestfailed", (request) => failedRequests.push({
    path: new URL(request.url()).pathname,
    failure: request.failure()?.errorText,
  }));

  await page.goto(`${origin}/login`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /entrar agora/i }).click();
  await page.waitForTimeout(8000);

  const body = (await page.locator("body").innerText()).slice(0, 600);
  const path = new URL(page.url()).pathname;
  const authCalls = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/auth/v1/"))
    .map((entry) => new URL(entry.name).pathname));
  assert.ok(authCalls.includes("/auth/v1/token"), "Browser did not submit login to the gateway");
  assert.doesNotMatch(body, /exceed_egress_quota/i, "Supabase quota must not block preview login");
  console.log(JSON.stringify({ ok: true, path, body, authCalls, pageErrors, failedRequests }));
} finally {
  if (browser) await browser.close();
  if (created) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from ec10_gateway_private.auth_sessions where user_id = $1", [id]);
      await client.query("delete from public.profiles where auth_user_id = $1 and email = $2", [id, email]);
      await client.query("delete from auth.users where id = $1 and email = $2", [id, email]);
      await client.query("commit");
      const remaining = await client.query(
        "select (select count(*) from auth.users where id = $1) + (select count(*) from public.profiles where auth_user_id = $1) as count",
        [id],
      );
      assert.equal(Number(remaining.rows[0].count), 0, "Temporary browser identity must be removed");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.end();
}
