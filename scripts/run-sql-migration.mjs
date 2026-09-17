import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const migrationPath = process.argv[2];
const apply = process.argv.includes("--apply");

if (!migrationPath) {
  throw new Error("Informe o caminho da migration.");
}

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.EC10_BOOKING_DB_URL;
if (!connectionString) {
  throw new Error("SUPABASE_DB_URL ou EC10_BOOKING_DB_URL nao configurada.");
}

const sql = await readFile(resolve(migrationPath), "utf8");
const body = sql
  .replace(/^\s*begin\s*;?/i, "")
  .replace(/commit\s*;?\s*$/i, "");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query("begin");
  await client.query(body);
  if (apply) {
    await client.query("commit");
    console.log("Migration aplicada com sucesso.");
  } else {
    await client.query("rollback");
    console.log("Migration validada e revertida (dry-run).");
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
