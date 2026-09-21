import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

try {
  await client.connect();
  await client.query("begin");
  await client.query(`
    create schema if not exists ec10_gateway_private;
    revoke all on schema ec10_gateway_private from public, anon, authenticated;

    create table if not exists ec10_gateway_private.auth_sessions (
      token_hash text primary key,
      user_id uuid not null,
      session_id uuid not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      rotated_to_hash text,
      user_agent_hash text,
      created_at timestamptz not null default now()
    );

    create index if not exists ec10_gateway_auth_sessions_user_idx
      on ec10_gateway_private.auth_sessions (user_id, created_at desc);
    create index if not exists ec10_gateway_auth_sessions_expiry_idx
      on ec10_gateway_private.auth_sessions (expires_at)
      where revoked_at is null;

    revoke all on all tables in schema ec10_gateway_private from public, anon, authenticated;
  `);
  await client.query(
    "delete from ec10_gateway_private.auth_sessions where expires_at < now() - interval '7 days'",
  );
  await client.query("commit");
  console.log(JSON.stringify({ ok: true, migration: "ec10_gateway_private.auth_sessions" }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
