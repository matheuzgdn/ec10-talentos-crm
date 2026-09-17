import crypto from "node:crypto";
import "dotenv/config";
import pg from "pg";

const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
const pixelId = process.env.META_PIXEL_ID;
const capiToken = process.env.META_CAPI_ACCESS_TOKEN;
const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

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

function metadataObject(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

async function sendCapiEvent(row) {
  if (!pixelId || !capiToken) return { ok: false, reason: "missing_capi_config" };

  const metadata = metadataObject(row.metadata);
  const attribution = metadataObject(row.attribution_metadata);
  const eventTime = eventTimestamp(row.occurred_at);
  const eventId = cleanText(metadata.eventId, 160);
  if (!eventId) return { ok: false, reason: "missing_event_id" };

  const fbc = cleanText(attribution.fbc, 300) ?? buildFbc(row.fbclid, eventTime);
  const fbp = cleanText(attribution.fbp, 300);
  const phone = normalizePhone(row.phone);
  const eventSourceUrl = normalizeUrl(attribution.eventSourceUrl || row.lead_page_url);
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(capiToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: row.event_type,
            event_time: eventTime,
            event_id: eventId,
            action_source: eventSourceUrl ? "website" : "business_messaging",
            ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
            user_data: {
              ...(phone ? { ph: [sha256(phone)] } : {}),
              external_id: [sha256(row.client_id)],
              ...(fbc ? { fbc } : {}),
              ...(fbp ? { fbp } : {})
            },
            custom_data: {
              lead_status: row.lead_status || (row.event_type === "Schedule" ? "orcamento" : "quente"),
              service_interest: row.service_interest || "nao_definido",
              lead_score: Number(row.quality_score ?? row.lead_score ?? 0),
              source: "traffic_retry_failed_capi",
              content_name: "EC10 Talentos",
              currency: "BRL"
            }
          }
        ]
      }),
      signal: AbortSignal.timeout(12000)
    }
  );

  if (response.ok) return { ok: true };
  return { ok: false, reason: `meta_http_${response.status}` };
}

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
      select
        e.id,
        e.client_id,
        e.phone,
        e.event_type,
        e.service_interest,
        e.lead_status,
        e.quality_score,
        e.metadata,
        e.occurred_at,
        c.fbclid,
        c.lead_score,
        b.lead_page_url,
        c.attribution_metadata
      from public.traffic_events e
      join public.clients c on c.id = e.client_id
      left join public.bot_conversation_states b on b.client_id = c.id
      where e.event_type in ('QualifiedLead', 'Schedule')
        and e.occurred_at >= now() - interval '7 days'
        and coalesce((e.metadata ->> 'capiSent')::boolean, false) = false
        and e.metadata ? 'eventId'
      order by e.occurred_at asc
      limit 100
    `
  );

  let retried = 0;
  let sent = 0;
  let failed = 0;
  const failures = [];

  for (const row of rows) {
    retried += 1;
    const result = await sendCapiEvent(row);
    const metadata = {
      ...metadataObject(row.metadata),
      capiRetriedAt: new Date().toISOString(),
      capiRetryReason: "previous_capiSent_false",
      ...(result.ok ? { capiSent: true } : { capiRetryError: result.reason })
    };

    await pool.query(
      `
        update public.traffic_events
        set metadata = $2::jsonb
        where id = $1
      `,
      [row.id, JSON.stringify(metadata)]
    );

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      failures.push({ id: row.id, eventType: row.event_type, reason: result.reason });
    }
  }

  console.log(JSON.stringify({ found: rows.length, retried, sent, failed, failures: failures.slice(0, 10) }, null, 2));
} finally {
  await pool.end();
}
