import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

const envPath = process.env.EC10_MIGRATION_ENV_FILE || ".env.gustavo-migration";
const loaded = config({ path: envPath, quiet: true });

const raw = process.env.EC10_BOOKING_DB_URL || process.env.SUPABASE_DB_URL
  || loaded.parsed?.EC10_BOOKING_DB_URL || loaded.parsed?.SUPABASE_DB_URL;
if (!raw) {
  const available = Object.keys(loaded.parsed || {}).filter((key) => /DB_URL$/.test(key));
  throw new Error(`URL do banco da EC10 ausente. Arquivo=${envPath}; chaves=${available.join(",") || "nenhuma"}`);
}

const url = new URL(raw);
for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);

const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const sql = await readFile("supabase/migrations/20260918110000_gustavo_v2_cloud_api.sql", "utf8");
  await client.query(sql);
  const result = await client.query(`select
    to_regclass('whatsapp_bot.meta_webhook_events') is not null as events,
    to_regclass('whatsapp_bot.gustavo_v2_outbox') is not null as outbox`);
  console.log(JSON.stringify(result.rows[0]));
} finally {
  await client.end();
}
