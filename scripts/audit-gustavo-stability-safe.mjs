import crypto from "node:crypto";
import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const hours = Math.max(1, Math.min(168, Number(process.argv[2] || 24)));
const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000,
});

const contactKey = (value) => crypto
  .createHash("sha256")
  .update(String(value))
  .digest("hex")
  .slice(0, 10);

try {
  const eventColumns = await pool.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'whatsapp_bot' and table_name = 'traffic_events'
  `);
  const eventTimestamp = eventColumns.rows.some((row) => row.column_name === "occurred_at")
    ? "occurred_at"
    : "created_at";

  const { rows } = await pool.query(`
    with recent_messages as (
      select
        client_id,
        count(*) filter (where direction = 'inbound')::int as inbound_count,
        count(*) filter (where direction = 'outbound')::int as outbound_count,
        max(created_at) filter (where direction = 'inbound') as last_inbound_at,
        max(created_at) filter (where direction = 'outbound') as last_outbound_at
      from whatsapp_bot.messages
      where created_at >= now() - ($1::text || ' hours')::interval
      group by client_id
    ), recent_queue as (
      select
        client_id,
        count(*) filter (where status = 'queued')::int as queued_count,
        count(*) filter (where status = 'failed')::int as failed_count,
        count(*) filter (where status = 'sent')::int as sent_count
      from whatsapp_bot.outbound_messages
      where created_at >= now() - ($1::text || ' hours')::interval
      group by client_id
    )
    select
      c.id,
      c.bot_instance_id,
      c.bot_paused,
      c.source,
      c.traffic_source,
      c.tags,
      coalesce(m.inbound_count, 0) as inbound_count,
      coalesce(m.outbound_count, 0) as outbound_count,
      m.last_inbound_at,
      m.last_outbound_at,
      coalesce(q.queued_count, 0) as queued_count,
      coalesce(q.failed_count, 0) as failed_count,
      coalesce(q.sent_count, 0) as sent_count,
      s.stage,
      coalesce((s.metadata -> 'gustavo' ->> 'pending')::boolean, false) as gustavo_pending,
      coalesce((s.metadata -> 'gustavo' ->> 'retryCount')::int, 0) as retry_count,
      coalesce((s.metadata -> 'gustavo' ->> 'handoff')::boolean, false) as handoff,
      coalesce((s.metadata -> 'gustavo' ->> 'disqualified')::boolean, false) as disqualified
    from whatsapp_bot.clients c
    join recent_messages m on m.client_id = c.id and m.inbound_count > 0
    left join recent_queue q on q.client_id = c.id
    left join whatsapp_bot.bot_conversation_states s on s.client_id = c.id
    order by m.last_inbound_at desc
  `, [String(hours)]);

  const eventResult = await pool.query(`
    select event_type, count(*)::int as count
    from whatsapp_bot.traffic_events
    where ${eventTimestamp} >= now() - ($1::text || ' hours')::interval
      and event_type in (
        'bot_automation_suppressed',
        'bot_test_isolation_suppressed',
        'bot_outbound_rate_limited',
        'bot_audio_rate_limited',
        'gustavo_sdr_turn',
        'gustavo_sdr_handoff',
        'whatsapp_outbound_transient_retry',
        'whatsapp_outbound_ack_deferred'
      )
    group by event_type
    order by event_type
  `, [String(hours)]);

  const stuck = rows.filter((row) =>
    row.gustavo_pending ||
    Number(row.retry_count) > 0 ||
    Number(row.failed_count) > 0 ||
    (row.last_inbound_at && (!row.last_outbound_at || row.last_outbound_at < row.last_inbound_at))
  );

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    hours,
    totals: {
      contactsWithInbound: rows.length,
      botPaused: rows.filter((row) => row.bot_paused).length,
      wrongBotInstance: rows.filter((row) => row.bot_instance_id !== "main").length,
      inboundAfterLastOutbound: rows.filter((row) => row.last_inbound_at && (!row.last_outbound_at || row.last_outbound_at < row.last_inbound_at)).length,
      gustavoPending: rows.filter((row) => row.gustavo_pending).length,
      withRetry: rows.filter((row) => Number(row.retry_count) > 0).length,
      queueFailed: rows.reduce((sum, row) => sum + Number(row.failed_count), 0),
      queueQueued: rows.reduce((sum, row) => sum + Number(row.queued_count), 0),
      handoff: rows.filter((row) => row.handoff).length,
      disqualified: rows.filter((row) => row.disqualified).length,
    },
    events: Object.fromEntries(eventResult.rows.map((row) => [row.event_type, Number(row.count)])),
    stuck: stuck.slice(0, 30).map((row) => ({
      contactKey: contactKey(row.id),
      botPaused: row.bot_paused,
      botInstance: row.bot_instance_id,
      source: row.source,
      trafficSource: row.traffic_source,
      stage: row.stage,
      inboundCount: Number(row.inbound_count),
      outboundCount: Number(row.outbound_count),
      lastInboundAt: row.last_inbound_at,
      lastOutboundAt: row.last_outbound_at,
      gustavoPending: row.gustavo_pending,
      retryCount: Number(row.retry_count),
      queueFailed: Number(row.failed_count),
      queueQueued: Number(row.queued_count),
      handoff: row.handoff,
      disqualified: row.disqualified,
    })),
  }, null, 2));
} finally {
  await pool.end();
}
