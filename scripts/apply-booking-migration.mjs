import fs from "node:fs/promises";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL is not configured");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 12000 });
try {
  await client.connect();
  const migration = await fs.readFile(new URL("../supabase/migrations/20260915190000_ec10_booking.sql", import.meta.url), "utf8");
  await client.query("begin");
  await client.query(migration);
  await client.query("commit");
  const { rows } = await client.query("select name, email, active from whatsapp_bot.sellers order by name");
  console.log(JSON.stringify({ migration: "applied", sellerNames: rows.map(row => row.name), pabloRegistered: rows.some(row => /pablo/i.test(row.name) && row.active) }));
} catch (error) {
  try { await client.query("rollback"); } catch { /* Connection can fail before a transaction starts. */ }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
