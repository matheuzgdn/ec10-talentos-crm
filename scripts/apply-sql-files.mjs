import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const files = process.argv.slice(2);

if (!process.env.DB_URL || !process.env.PGPASSWORD || !files.length) {
  throw new Error("DB_URL, PGPASSWORD and at least one SQL file are required.");
}

const pool = new Pool({
  connectionString: process.env.DB_URL,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

try {
  for (const file of files) {
    const sql = await fs.readFile(file, "utf8");
    const connection = await pool.connect();
    try {
      await connection.query("begin");
      await connection.query(sql);
      await connection.query("commit");
      console.log(`applied ${path.basename(file)}`);
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  const verification = await pool.query(`
    select
      to_regclass('whatsapp_bot.clients') as clients,
      to_regclass('whatsapp_bot.messages') as messages,
      to_regclass('public.whatsapp_connections') as connections
  `);
  console.log(JSON.stringify(verification.rows[0]));
} finally {
  await pool.end();
}
