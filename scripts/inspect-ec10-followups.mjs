import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

try {
  const { rows } = await pool.query(
    `
      select media_path, status, count(*)::int as count
      from public.outbound_messages
      where media_path like 'ec10_followup:%'
      group by media_path, status
      order by media_path, status
    `
  );

  const { rows: dueRows } = await pool.query(
    `
      select media_type, status, count(*)::int as count
      from public.outbound_messages
      where media_path like 'ec10_followup:meeting:1:%'
        and coalesce(scheduled_at, created_at) <= now()
      group by media_type, status
      order by media_type, status
    `
  );

  const { rows: failureRows } = await pool.query(
    `
      select media_path, error_message, count(*)::int as count
      from public.outbound_messages
      where media_path like 'ec10_followup:%'
        and status = 'failed'
      group by media_path, error_message
      order by media_path, count desc
    `
  );

  console.log(JSON.stringify({ byMarker: rows, dueStepOne: dueRows, failures: failureRows }, null, 2));
} finally {
  await pool.end();
}
