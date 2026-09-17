import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const audioPaths = [
  "media/audio/bot-principal/meeting_presence_cannot_attend_eric_cena.ogg",
  "media/audio/bot-principal/meeting_presence_cannot_attend_eric_cena_opus.ogg"
];

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

function compact(value, length = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

async function query(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

try {
  const statusRows = await query(`
    select
      coalesce(media_type, 'unknown') as media_type,
      coalesce(status, 'unknown') as status,
      count(*)::int as count
    from public.outbound_messages
    where media_path like 'meeting_presence:%'
       or media_path = any($1::text[])
    group by media_type, status
    order by media_type, status
  `, [audioPaths]);

  const messageRows = await query(`
    select
      coalesce(media_type, 'unknown') as media_type,
      coalesce(media_path, '') as media_path,
      count(*)::int as count,
      max(created_at) as last_created_at
    from public.messages
    where media_path like 'meeting_presence:%'
       or media_path = any($1::text[])
       or body like 'Voce confirma sua presenca na reuniao EC10%'
       or body like 'Voc%c confirma sua presen%a na reuniao EC10%'
    group by media_type, media_path
    order by media_type, media_path
  `, [audioPaths]);

  const choiceRows = await query(`
    select
      metadata #>> '{choice}' as choice,
      count(*)::int as count,
      max(created_at) as last_created_at
    from public.traffic_events
    where event_type = 'bot_meeting_presence_option_selected'
    group by metadata #>> '{choice}'
    order by choice nulls last
  `);

  const recentChoices = await query(`
    select
      c.id as client_id,
      c.name,
      c.phone,
      e.metadata #>> '{choice}' as choice,
      e.metadata #>> '{selectedOption}' as selected_option,
      e.created_at
    from public.traffic_events e
    join public.clients c on c.id = e.client_id
    where e.event_type = 'bot_meeting_presence_option_selected'
    order by e.created_at desc
    limit 30
  `);

  const recentPollVotes = await query(`
    select
      c.id as client_id,
      c.name,
      c.phone,
      e.metadata::text as metadata,
      e.created_at
    from public.traffic_events e
    join public.clients c on c.id = e.client_id
    where e.event_type = 'bot_poll_vote_received'
    order by e.created_at desc
    limit 30
  `);

  const failures = await query(`
    select
      id,
      phone,
      media_type,
      media_path,
      status,
      error_message,
      created_at,
      sent_at
    from public.outbound_messages
    where status = 'failed'
      and (
        media_path like 'meeting_presence:%'
        or media_path = any($1::text[])
      )
    order by created_at desc
    limit 50
  `, [audioPaths]);

  console.log(JSON.stringify({
    outboundStatus: statusRows,
    messageRecords: messageRows,
    choices: choiceRows,
    recentChoices: recentChoices.map((row) => ({
      clientId: row.client_id,
      name: row.name,
      phone: digits(row.phone),
      choice: row.choice,
      selectedOption: compact(row.selected_option, 120),
      createdAt: row.created_at
    })),
    recentPollVotes: recentPollVotes.map((row) => ({
      clientId: row.client_id,
      name: row.name,
      phone: digits(row.phone),
      metadata: compact(row.metadata, 300),
      createdAt: row.created_at
    })),
    failures: failures.map((row) => ({
      id: row.id,
      phone: digits(row.phone),
      mediaType: row.media_type,
      mediaPath: row.media_path,
      status: row.status,
      error: compact(row.error_message, 220),
      createdAt: row.created_at,
      sentAt: row.sent_at
    }))
  }, null, 2));
} finally {
  await pool.end();
}
