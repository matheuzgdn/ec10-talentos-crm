import crypto from "node:crypto";
import pg from "pg";

const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
const pixelId = process.env.META_PIXEL_ID;
const capiToken = process.env.META_CAPI_ACCESS_TOKEN;
const dbUrl = process.env.SUPABASE_DB_URL;

function cleanText(input, maxLength = 500) {
  const text = String(input ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits || null;
}

function eventTimestamp(input) {
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function buildFbc(fbclid, timestamp) {
  const clean = cleanText(fbclid, 240);
  return clean ? `fb.1.${timestamp}.${clean}` : null;
}

function normalizeUrl(input) {
  const text = cleanText(input, 800);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function sendSchedule(row) {
  if (!pixelId || !capiToken) return false;
  const eventTime = eventTimestamp(row.occurred_at);
  const metadata = row.client_attribution_metadata && typeof row.client_attribution_metadata === "object"
    ? row.client_attribution_metadata
    : {};
  const fbc = cleanText(metadata.fbc, 300) ?? buildFbc(row.client_fbclid, eventTime);
  const fbp = cleanText(metadata.fbp, 300);
  const phone = normalizePhone(row.phone);
  const eventSourceUrl = normalizeUrl(metadata.eventSourceUrl);
  const payload = {
    data: [
      {
        event_name: "Schedule",
        event_time: eventTime,
        event_id: row.event_id,
        action_source: eventSourceUrl ? "website" : "business_messaging",
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: {
          ...(phone ? { ph: [sha256(phone)] } : {}),
          external_id: [sha256(row.client_id)],
          ...(fbc ? { fbc } : {}),
          ...(fbp ? { fbp } : {})
        },
        custom_data: {
          lead_status: "orcamento",
          service_interest: row.service_interest ?? "nao_definido",
          lead_score: Math.max(90, Number(row.quality_score ?? 0)),
          source: "traffic_backfill",
          content_name: "EC10 Talentos",
          currency: "BRL"
        }
      }
    ]
  };

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(capiToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000)
    }
  );
  return response.ok;
}

if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

const { rows } = await pool.query(
  `
    select
      e.id,
      e.client_id,
      e.phone,
      e.service_interest,
      e.athlete_age,
      e.age_group,
      e.quality_score,
      e.metadata,
      e.occurred_at,
      c.fbclid as client_fbclid,
      c.attribution_metadata as client_attribution_metadata,
      format('crm-%s-schedule-%s', e.client_id, coalesce(e.metadata #>> '{schedule,startsAt}', e.occurred_at::text)) as event_id
    from public.traffic_events e
    join public.clients c on c.id = e.client_id
    where e.event_type = 'bot_meeting_scheduled'
      and e.occurred_at >= now() - interval '30 days'
      and not exists (
        select 1
        from public.traffic_events s
        where s.client_id = e.client_id
          and s.event_type = 'Schedule'
          and s.metadata ->> 'sourceEventId' = e.id::text
      )
    order by e.occurred_at asc
  `
);

let inserted = 0;
let capiSent = 0;
let capiSkippedOld = 0;
let capiFailed = 0;

for (const row of rows) {
  const occurredAt = new Date(row.occurred_at);
  const isRecentForMeta = Number.isFinite(occurredAt.getTime())
    && Date.now() - occurredAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
  let sent = false;

  if (isRecentForMeta) {
    try {
      sent = await sendSchedule(row);
      if (sent) capiSent += 1;
      else capiFailed += 1;
    } catch {
      capiFailed += 1;
    }
  } else {
    capiSkippedOld += 1;
  }

  await pool.query(
    `
      insert into public.traffic_events
        (client_id, phone, event_type, channel, platform, service_interest,
         athlete_age, age_group, lead_status, quality_score, metadata, occurred_at)
      values
        ($1, $2, 'Schedule', 'whatsapp', 'meta_ads', $3, $4, $5, 'orcamento', $6, $7::jsonb, $8)
    `,
    [
      row.client_id,
      row.phone,
      row.service_interest,
      row.athlete_age,
      row.age_group,
      Math.max(90, Number(row.quality_score ?? 0)),
      JSON.stringify({
        source: "bot_meeting_scheduled_backfill",
        sourceEventId: row.id,
        eventId: row.event_id,
        capiSent: sent,
        capiSkippedOld: !isRecentForMeta,
        schedule: row.metadata?.schedule ?? null,
        sellerName: row.metadata?.sellerName ?? null,
        sellerRoute: row.metadata?.sellerRoute ?? null
      }),
      row.occurred_at
    ]
  );
  inserted += 1;
}

await pool.end();
console.log(JSON.stringify({ found: rows.length, inserted, capiSent, capiSkippedOld, capiFailed }));
