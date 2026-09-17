import fs from "node:fs";
import pg from "pg";
import dotenv from "dotenv";

const sourceEnv = dotenv.parse(fs.readFileSync("C:/Users/Admin/.codex/shared-access/secrets/cliente-whatsapp-crm-supabase.env"));
const targetEnv = dotenv.parse(fs.readFileSync("C:/Users/Admin/.codex/shared-access/secrets/ec10-saas-supabase.env"));
const options = (connectionString) => ({ connectionString, ssl: { rejectUnauthorized: false } });
const source = new pg.Client(options(sourceEnv.SUPABASE_DB_URL));
const target = new pg.Client(options(targetEnv.SUPABASE_DB_URL));
await source.connect();
await target.connect();

try {
  const sellers = await source.query(`select id, name, email, region, timezone, active, created_at, role, approved_at, last_login_at from public.sellers`);
  const users = await source.query(`select id, seller_id, email, password_hash, created_at, updated_at, last_login_at from public.crm_auth_users`);
  await target.query("begin");
  for (const row of sellers.rows) {
    await target.query(`
      insert into whatsapp_bot.sellers
        (id, auth_user_id, name, email, region, timezone, active, created_at, role, approved_at, approved_by, last_login_at)
      values ($1,null,$2,$3,$4,$5,$6,$7,$8,$9,null,$10)
      on conflict (id) do update set name=excluded.name, email=excluded.email, region=excluded.region,
        timezone=excluded.timezone, active=excluded.active, role=excluded.role,
        approved_at=excluded.approved_at, last_login_at=excluded.last_login_at
    `, [row.id, row.name, row.email, row.region, row.timezone, row.active, row.created_at, row.role, row.approved_at, row.last_login_at]);
  }
  for (const row of users.rows) {
    await target.query(`
      insert into whatsapp_bot.crm_auth_users (id, seller_id, email, password_hash, created_at, updated_at, last_login_at)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (id) do update set seller_id=excluded.seller_id, email=excluded.email,
        password_hash=excluded.password_hash, updated_at=excluded.updated_at, last_login_at=excluded.last_login_at
    `, [row.id, row.seller_id, row.email, row.password_hash, row.created_at, row.updated_at, row.last_login_at]);
  }
  await target.query("commit");
  const loginNames = await target.query(`select s.name from whatsapp_bot.crm_auth_users u join whatsapp_bot.sellers s on s.id=u.seller_id order by s.name`);
  console.log(JSON.stringify({ sellers: sellers.rowCount, users: users.rowCount, loginNames: loginNames.rows.map(row => row.name), pabloReady: sellers.rows.some(row => /pablo/i.test(row.name) && row.active) }));
} catch (error) {
  await target.query("rollback");
  throw error;
} finally {
  await Promise.all([source.end(), target.end()]);
}
