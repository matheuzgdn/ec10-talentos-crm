import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const startAt = process.argv[2] || "2026-06-26T20:12:00.000Z";
const endAt = process.argv[3] || new Date().toISOString();

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

function publicPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}...${digits.slice(-4)}`;
}

function bool(value) {
  return Boolean(Number(value ?? 0));
}

try {
  const { rows } = await pool.query(
    `
      with event_flags as (
        select
          client_id,
          count(*) filter (where event_type = 'QualifiedLead')::int as qualified_lead_events,
          count(*) filter (where event_type = 'whatsapp_inbound')::int as whatsapp_inbound_events,
          count(*) filter (where event_type = 'bot_meeting_scheduled')::int as meeting_events,
          count(*) filter (where event_type = 'Schedule')::int as schedule_events
        from public.traffic_events
        where created_at >= $1::timestamptz - interval '5 minutes'
          and created_at <= $2::timestamptz + interval '5 minutes'
        group by client_id
      ),
      message_flags as (
        select
          client_id,
          count(*)::int as message_total,
          count(*) filter (where direction = 'outbound')::int as outbound_messages,
          count(*) filter (where direction = 'inbound')::int as inbound_messages,
          max(created_at) as last_message_at
        from public.messages
        where created_at >= $1::timestamptz - interval '30 minutes'
          and created_at <= $2::timestamptz + interval '30 minutes'
        group by client_id
      ),
      outbound_flags as (
        select
          client_id,
          count(*)::int as outbound_total,
          count(*) filter (where status = 'sent')::int as outbound_sent,
          count(*) filter (where status = 'queued')::int as outbound_queued,
          count(*) filter (where status = 'failed')::int as outbound_failed,
          count(*) filter (where status = 'cancelled')::int as outbound_cancelled,
          min(coalesce(scheduled_at, created_at)) as first_outbound_at,
          max(sent_at) as last_sent_at,
          string_agg(distinct coalesce(error_message, ''), ' | ') filter (where status = 'failed') as failed_errors
        from public.outbound_messages
        where created_at >= $1::timestamptz - interval '30 minutes'
          and created_at <= $2::timestamptz + interval '2 hours'
        group by client_id
      ),
      gap_clients as (
        select
          c.id,
          c.name,
          c.phone,
          c.source,
          c.traffic_source,
          c.service_interest,
          c.status,
          c.tags,
          c.created_at,
          c.updated_at,
          c.last_message_at,
          b.stage as bot_stage,
          b.completed_at as bot_completed_at,
          la.client_id is not null as has_attribution,
          coalesce(ef.qualified_lead_events, 0) as qualified_lead_events,
          coalesce(ef.whatsapp_inbound_events, 0) as whatsapp_inbound_events,
          coalesce(ef.meeting_events, 0) as meeting_events,
          coalesce(ef.schedule_events, 0) as schedule_events,
          coalesce(mf.message_total, 0) as message_total,
          coalesce(mf.outbound_messages, 0) as outbound_messages,
          coalesce(mf.inbound_messages, 0) as inbound_messages,
          mf.last_message_at as message_last_at,
          coalesce(of.outbound_total, 0) as outbound_total,
          coalesce(of.outbound_sent, 0) as outbound_sent,
          coalesce(of.outbound_queued, 0) as outbound_queued,
          coalesce(of.outbound_failed, 0) as outbound_failed,
          coalesce(of.outbound_cancelled, 0) as outbound_cancelled,
          of.first_outbound_at,
          of.last_sent_at,
          of.failed_errors
        from public.clients c
        left join public.bot_conversation_states b on b.client_id = c.id
        left join public.lead_attribution la on la.client_id = c.id
        left join event_flags ef on ef.client_id = c.id
        left join message_flags mf on mf.client_id = c.id
        left join outbound_flags of on of.client_id = c.id
        where c.created_at >= $1::timestamptz
          and c.created_at <= $2::timestamptz
          and (
            c.source = 'site'
            or c.traffic_source = 'meta_ads'
            or la.client_id is not null
            or coalesce(ef.qualified_lead_events, 0) > 0
          )
      )
      select *
      from gap_clients
      order by created_at asc
    `,
    [startAt, endAt]
  );

  const missingWhatsapp = rows.filter((row) =>
    !bool(row.outbound_sent) &&
    !bool(row.outbound_queued) &&
    !bool(row.inbound_messages) &&
    !bool(row.outbound_messages)
  );
  const blocked = rows.filter((row) =>
    Number(row.outbound_failed) > 0 ||
    (Number(row.outbound_queued) > 0 && Number(row.outbound_sent) === 0)
  );

  console.log(JSON.stringify({
    window: { startAt, endAt },
    totals: {
      trafficLeads: rows.length,
      missingWhatsappRegistration: missingWhatsapp.length,
      blockedOrPendingOutbound: blocked.length,
      withOutboundSent: rows.filter((row) => Number(row.outbound_sent) > 0).length,
      withInbound: rows.filter((row) => Number(row.inbound_messages) > 0).length,
      withAttribution: rows.filter((row) => row.has_attribution).length
    },
    leads: rows.map((row) => ({
      clientId: row.id,
      name: compact(row.name, 80),
      phone: publicPhone(row.phone),
      source: row.source,
      trafficSource: row.traffic_source,
      serviceInterest: row.service_interest,
      createdAt: row.created_at,
      botStage: row.bot_stage,
      tags: row.tags,
      hasAttribution: row.has_attribution,
      outbound: {
        total: Number(row.outbound_total),
        sent: Number(row.outbound_sent),
        queued: Number(row.outbound_queued),
        failed: Number(row.outbound_failed),
        cancelled: Number(row.outbound_cancelled),
        firstAt: row.first_outbound_at,
        lastSentAt: row.last_sent_at,
        failedErrors: compact(row.failed_errors)
      },
      messages: {
        total: Number(row.message_total),
        inbound: Number(row.inbound_messages),
        outbound: Number(row.outbound_messages),
        lastAt: row.message_last_at
      },
      events: {
        qualifiedLead: Number(row.qualified_lead_events),
        whatsappInbound: Number(row.whatsapp_inbound_events),
        meeting: Number(row.meeting_events),
        schedule: Number(row.schedule_events)
      }
    })),
    missingWhatsapp: missingWhatsapp.map((row) => ({
      clientId: row.id,
      name: compact(row.name, 80),
      phone: publicPhone(row.phone),
      createdAt: row.created_at,
      source: row.source,
      trafficSource: row.traffic_source
    })),
    blockedOrPendingOutbound: blocked.map((row) => ({
      clientId: row.id,
      name: compact(row.name, 80),
      phone: publicPhone(row.phone),
      createdAt: row.created_at,
      outboundSent: Number(row.outbound_sent),
      outboundQueued: Number(row.outbound_queued),
      outboundFailed: Number(row.outbound_failed),
      failedErrors: compact(row.failed_errors)
    }))
  }, null, 2));
} finally {
  await pool.end();
}
