import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { SUPABASE_CA } from "./supabase-ca.mjs";

const rawUrl = process.env.SUPABASE_DB_URL || process.env.EC10_BOOKING_DB_URL;
const sqlFile = path.resolve(String(process.env.EC10_SQL_FILE || ""));
if (!rawUrl) throw new Error("SUPABASE_DB_URL ausente.");
if (!/^\d{14}_[a-z0-9_]+\.sql$/i.test(path.basename(sqlFile))) {
  throw new Error("EC10_SQL_FILE deve apontar para uma migration versionada.");
}

const databaseUrl = new URL(rawUrl);
for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) databaseUrl.searchParams.delete(key);

const client = new pg.Client({
  connectionString: databaseUrl.toString(),
  ssl: { ca: SUPABASE_CA, rejectUnauthorized: true },
});

await client.connect();
try {
  await client.query(await readFile(sqlFile, "utf8"));
  console.log(`Migration aplicada: ${path.basename(sqlFile)}`);
} finally {
  await client.end();
}
