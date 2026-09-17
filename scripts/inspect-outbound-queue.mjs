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

function compact(value, length = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

try {
  const { rows } = await pool.query(`
    select
      id,
      client_id,
      phone,
      media_type,
      media_path,
      status,
      body,
      scheduled_at,
      created_at,
      sent_at,
      error_message
    from public.outbound_messages
    where status in ('queued', 'failed')
    order by
      case status when 'queued' then 0 else 1 end,
      coalesce(scheduled_at, created_at) asc,
      created_at asc
    limit 80
  `);

  console.log(JSON.stringify({
    rows: rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      phone: row.phone,
      mediaType: row.media_type,
      mediaPath: row.media_path,
      status: row.status,
      body: compact(row.body),
      scheduledAt: row.scheduled_at,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      error: compact(row.error_message)
    }))
  }, null, 2));
} finally {
  await pool.end();
}
