import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const accessLookaheadMinutes = Number(process.env.GOOGLE_MEET_OPEN_ACCESS_LOOKAHEAD_MINUTES || 10);
const accessLookbackDays = Number(process.env.GOOGLE_MEET_OPEN_ACCESS_LOOKBACK_DAYS || 365);

function parseMeetingCode(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  const match = text.match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/i);
  return match ? match[0].toLowerCase() : null;
}

async function rows(pool, text, params = []) {
  return (await pool.query(text, params)).rows;
}

async function getAccessToken() {
  if (process.env.GOOGLE_MEET_OAUTH_ACCESS_TOKEN) {
    return {
      ok: true,
      token: process.env.GOOGLE_MEET_OAUTH_ACCESS_TOKEN,
      source: "GOOGLE_MEET_OAUTH_ACCESS_TOKEN"
    };
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const missing = [
    ["GOOGLE_OAUTH_CLIENT_ID", clientId],
    ["GOOGLE_OAUTH_CLIENT_SECRET", clientSecret],
    ["GOOGLE_OAUTH_REFRESH_TOKEN", refreshToken]
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) {
    return { ok: false, missing };
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(async () => ({ error: await response.text() }));
  if (!response.ok || !payload.access_token) {
    return {
      ok: false,
      error: payload.error_description || payload.error || `Google OAuth HTTP ${response.status}`
    };
  }
  return { ok: true, token: payload.access_token, source: "GOOGLE_OAUTH_REFRESH_TOKEN" };
}

async function meetRequest(token, method, path, body = null, query = null) {
  const url = new URL(`https://meet.googleapis.com/v2/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(async () => ({ error: await response.text() }));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error_description || payload?.error || `Google Meet HTTP ${response.status}`;
    throw new Error(String(message).slice(0, 500));
  }
  return payload;
}

async function openMeetAccess(token, meetUrl) {
  const code = parseMeetingCode(meetUrl);
  if (!code) return { ok: false, meetUrl, error: "Codigo do Meet nao encontrado no link." };

  const space = await meetRequest(token, "GET", `spaces/${code}`);
  const body = {
    name: space.name,
    config: {
      ...(space.config || {}),
      accessType: "OPEN",
      entryPointAccess: "ALL",
      moderation: "OFF"
    }
  };

  const updated = await meetRequest(token, "PATCH", space.name, body, {
    updateMask: "config.access_type,config.entry_point_access,config.moderation"
  });

  return {
    ok: true,
    meetUrl,
    meetingCode: code,
    spaceName: updated.name || space.name,
    accessType: updated.config?.accessType || body.config.accessType,
    entryPointAccess: updated.config?.entryPointAccess || body.config.entryPointAccess,
    moderation: updated.config?.moderation || body.config.moderation
  };
}

async function markState(pool, row, status) {
  const patch = status.ok
    ? {
        meetingMeetAccessOpenedAt: new Date().toISOString(),
        meetingMeetAccessOpenStatus: "opened",
        meetingMeetAccessType: status.accessType,
        meetingMeetEntryPointAccess: status.entryPointAccess,
        meetingMeetSpaceName: status.spaceName
      }
    : {
        meetingMeetAccessOpenStatus: "failed",
        meetingMeetAccessOpenError: status.error,
        meetingMeetAccessOpenCheckedAt: new Date().toISOString()
      };

  await pool.query(
    `
      update public.bot_conversation_states
      set metadata = metadata || $2::jsonb,
          updated_at = now()
      where id = $1
    `,
    [row.state_id, JSON.stringify(patch)]
  );
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

try {
  const meetings = await rows(pool, `
    select
      b.id as state_id,
      b.client_id,
      c.name as client_name,
      coalesce(s.name, b.metadata #>> '{meetingSellerName}', 'Sem vendedor') as seller_name,
      b.metadata #>> '{meeting,startsAt}' as starts_at,
      coalesce(b.metadata #>> '{meetingMeetUrl}', b.metadata #>> '{meeting,meetUrl}') as meet_url,
      b.metadata #>> '{meetingMeetAccessOpenedAt}' as access_opened_at
    from public.bot_conversation_states b
    join public.clients c on c.id = b.client_id
    left join public.sellers s on s.id = c.assigned_seller_id
    where nullif(coalesce(b.metadata #>> '{meetingMeetUrl}', b.metadata #>> '{meeting,meetUrl}'), '') is not null
      and nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
      and (b.metadata #>> '{meeting,startsAt}') ~ '^\\d{4}-\\d{2}-\\d{2}'
      and (b.metadata #>> '{meeting,startsAt}')::timestamptz >= now() - ($2::int * interval '1 day')
      and (b.metadata #>> '{meeting,startsAt}')::timestamptz <= now() + ($1::int * interval '1 minute')
      and nullif(b.metadata #>> '{meetingMeetAccessOpenedAt}', '') is null
    order by (b.metadata #>> '{meeting,startsAt}')::timestamptz asc
  `, [accessLookaheadMinutes, accessLookbackDays]);

  const tokenResult = await getAccessToken();
  if (!tokenResult.ok) {
    console.log(JSON.stringify({
      ok: false,
      action: "google_meet_open_access",
      eligibleMeetings: meetings.length,
      opened: 0,
      failed: 0,
      missingCredentials: tokenResult.missing || [],
      error: tokenResult.error || null
    }, null, 2));
    process.exitCode = 0;
  } else {
    const byUrl = new Map();
    for (const meeting of meetings) {
      if (!byUrl.has(meeting.meet_url)) byUrl.set(meeting.meet_url, []);
      byUrl.get(meeting.meet_url).push(meeting);
    }

    const opened = [];
    const failed = [];
    for (const [meetUrl, linkedMeetings] of byUrl.entries()) {
      let result;
      try {
        result = await openMeetAccess(tokenResult.token, meetUrl);
        opened.push(result);
      } catch (error) {
        result = { ok: false, meetUrl, error: error instanceof Error ? error.message : String(error) };
        failed.push(result);
      }
      for (const meeting of linkedMeetings) {
        await markState(pool, meeting, result);
      }
    }

    console.log(JSON.stringify({
      ok: failed.length === 0,
      action: "google_meet_open_access",
      tokenSource: tokenResult.source,
      eligibleMeetings: meetings.length,
      uniqueMeetLinks: byUrl.size,
      opened: opened.length,
      failed: failed.length,
      openedMeetings: opened.map((item) => ({
        meetingCode: item.meetingCode,
        accessType: item.accessType,
        entryPointAccess: item.entryPointAccess
      })),
      failures: failed
    }, null, 2));
  }
} finally {
  await pool.end();
}
