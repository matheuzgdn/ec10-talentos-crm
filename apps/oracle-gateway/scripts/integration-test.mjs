import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import pg from "pg";

const origin = process.env.GATEWAY_PUBLIC_ORIGIN;
const secret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!origin || !secret || !databaseUrl) throw new Error("Gateway environment is incomplete");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (claims) => {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
try {
  const profile = await pool.query(
    `select auth_user_id from public.profiles
      where role = 'superadmin' and is_active is true and auth_user_id is not null
      limit 1`,
  );
  assert.equal(profile.rowCount, 1, "An active superadmin profile is required for the test");

  const live = await fetch(`${origin}/health/ready`);
  assert.equal(live.status, 200, "Gateway readiness");

  const anonymous = await fetch(`${origin}/rest/v1/profiles?select=id&limit=1`);
  assert.equal(anonymous.status, 200, "Anonymous PostgREST request");
  assert.deepEqual(await anonymous.json(), [], "Anonymous access must not expose profiles");

  const now = Math.floor(Date.now() / 1000);
  const jwt = sign({
    aud: "authenticated",
    exp: now + 120,
    iat: now,
    iss: process.env.JWT_ISSUER || "ec10-crm-oracle",
    sub: profile.rows[0].auth_user_id,
    role: "authenticated",
  });
  const authorized = await fetch(`${origin}/rest/v1/profiles?select=id&limit=1`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  assert.equal(authorized.status, 200, "Authorized PostgREST request");
  assert.ok((await authorized.json()).length > 0, "Superadmin must see a profile");

  const rejected = await fetch(`${origin}/rest/v1/profiles?select=id&limit=1`, {
    headers: { authorization: `Bearer ${jwt.slice(0, -3)}bad` },
  });
  assert.equal(rejected.status, 401, "Tampered JWT must be rejected");

  const password = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "integration-check@example.invalid", password: "wrong" }),
  });
  assert.equal(password.status, 400, "Wrong credentials must be rejected");

  const signup = await fetch(`${origin}/auth/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "integration-check@example.invalid", password: "wrong" }),
  });
  assert.equal(signup.status, 403, "Public signup must remain disabled");

  const database = await pool.query(
    "select current_setting('server_version_num')::int as version, pg_database_size(current_database())::bigint as bytes",
  );
  console.log(JSON.stringify({
    ok: true,
    checks: 6,
    databaseVersion: database.rows[0].version,
    databaseBytes: Number(database.rows[0].bytes),
  }));
} finally {
  await pool.end();
}
