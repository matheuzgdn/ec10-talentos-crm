import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const origin = process.env.GATEWAY_PUBLIC_ORIGIN;
const databaseUrl = process.env.DATABASE_URL;
if (!origin || !databaseUrl) throw new Error("Gateway environment is incomplete");

const id = randomUUID();
const email = `ec10-gateway-test-${id}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 2 });
let created = false;
let checks = 0;

try {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, $3, now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       '{"full_name":"EC10 Gateway Test"}'::jsonb, now(), now())`,
    [id, email, hash],
  );
  created = true;

  const profile = await pool.query(
    "select id from public.profiles where auth_user_id = $1 and email = $2 and is_active is true",
    [id, email],
  );
  assert.equal(profile.rowCount, 1, "Auth trigger must create active profile");
  checks += 1;

  const login = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, `Password login: ${login.status}`);
  const session = await login.json();
  assert.equal(session.user.id, id);
  checks += 1;

  const user = await fetch(`${origin}/auth/v1/user`, {
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  assert.equal(user.status, 200, "Authenticated user lookup");
  assert.equal((await user.json()).id, id);
  checks += 1;

  const rest = await fetch(`${origin}/rest/v1/profiles?select=id&auth_user_id=eq.${id}`, {
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  assert.equal(rest.status, 200, "Authenticated PostgREST request");
  assert.equal((await rest.json()).length, 1, "Test user must see own profile");
  checks += 1;

  const refresh = await fetch(`${origin}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  assert.equal(refresh.status, 200, "Refresh token rotation");
  const refreshed = await refresh.json();
  assert.notEqual(refreshed.refresh_token, session.refresh_token);
  checks += 1;

  const replay = await fetch(`${origin}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  assert.equal(replay.status, 400, "Old refresh token must not be reusable");
  checks += 1;

  const logout = await fetch(`${origin}/auth/v1/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${refreshed.access_token}` },
  });
  assert.equal(logout.status, 204, "Logout");
  checks += 1;

  console.log(JSON.stringify({ ok: true, checks }));
} finally {
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
      assert.equal(Number(remaining.rows[0].count), 0, "Temporary test identity must be removed");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.end();
}
