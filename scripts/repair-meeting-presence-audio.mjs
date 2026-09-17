import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const audioPath = "media/audio/bot-principal/meeting_presence_cannot_attend_eric_cena_opus.ogg";

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

try {
  const { rows } = await pool.query(
    `
      with cannot_attend as (
        select distinct on (e.client_id)
          e.client_id,
          c.name,
          c.phone,
          e.created_at as selected_at
        from public.traffic_events e
        join public.clients c on c.id = e.client_id
        where e.event_type = 'bot_meeting_presence_option_selected'
          and e.metadata #>> '{choice}' = 'cannot_attend'
        order by e.client_id, e.created_at desc
      )
      insert into public.outbound_messages
        (client_id, phone, body, media_type, media_path, status, scheduled_at)
      select
        ca.client_id,
        ca.phone,
        null,
        'audio',
        $1,
        'queued',
        now()
      from cannot_attend ca
      where not exists (
        select 1
        from public.outbound_messages o
        where o.client_id = ca.client_id
          and o.phone = ca.phone
          and o.media_path = $1
          and o.status in ('queued', 'sent')
      )
      returning client_id, phone, created_at
    `,
    [audioPath]
  );

  console.log(JSON.stringify({
    audioPath,
    queued: rows.length,
    rows: rows.map((row) => ({
      clientId: row.client_id,
      phone: digits(row.phone),
      createdAt: row.created_at
    }))
  }, null, 2));
} finally {
  await pool.end();
}
