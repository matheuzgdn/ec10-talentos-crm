import { config } from "dotenv";
import pg from "pg";

const envFile = process.env.EC10_AUDIT_ENV_FILE || ".env";
config({ path: envFile, quiet: true });

const connectionString = process.env.EC10_BOOKING_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Database URL ausente.");

const database = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await database.connect();
try {
  const { rows } = await database.query(`select
    current_database() as database_name,
    to_regclass('whatsapp_bot.clients') is not null as clients,
    to_regclass('whatsapp_bot.meta_webhook_events') is not null as events,
    to_regclass('whatsapp_bot.gustavo_v2_inbox') is not null as inbox,
    to_regclass('whatsapp_bot.gustavo_v2_contacts') is not null as contacts,
    to_regclass('whatsapp_bot.gustavo_v2_turns') is not null as turns,
    to_regclass('whatsapp_bot.gustavo_v2_outbox') is not null as outbox`);
  console.log(JSON.stringify(rows[0]));
} finally {
  await database.end();
}
