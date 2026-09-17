import "dotenv/config";
import pg from "pg";

const phone = process.argv[2]?.replace(/\D/g, "");
if (!phone) {
  throw new Error("Uso: node scripts/inspect-meeting-presence-phone.mjs <telefone>");
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

function compact(value, length = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function publicOutboundRow(row) {
  return {
    id: row.id,
    phone: row.phone,
    status: row.status,
    mediaType: row.media_type,
    mediaPath: row.media_path,
    body: compact(row.body),
    error: compact(row.error_message, 180),
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    sentAt: row.sent_at
  };
}

function publicMessageRow(row) {
  return {
    direction: row.direction,
    mediaType: row.media_type,
    mediaPath: row.media_path,
    body: compact(row.body),
    whatsappMessageId: row.whatsapp_message_id,
    createdAt: row.created_at
  };
}

function publicEventRow(row) {
  return {
    eventType: row.event_type,
    platform: row.platform,
    leadStatus: row.lead_status,
    metadata: compact(row.metadata, 500),
    createdAt: row.created_at
  };
}

async function query(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

try {
  const clients = await query(
    `
      select c.id, c.name, c.phone, c.service_interest, c.tags, c.created_at, c.updated_at,
             c.assigned_seller_id, s.name as seller_name,
             b.stage, b.completed_at,
             b.metadata #>> '{meeting,startsAt}' as meeting_starts_at,
             b.metadata #>> '{meetingSellerName}' as meeting_seller_name,
             b.metadata #>> '{meetingSellerPhone}' as meeting_seller_phone,
             b.metadata #>> '{meetingCannotAttendAt}' as cannot_attend_at,
             b.metadata #>> '{meetingCannotAttendBody}' as cannot_attend_body,
             b.metadata #>> '{meetingCannotAttendAudioPath}' as cannot_attend_audio_path
      from public.clients c
      left join public.sellers s on s.id = c.assigned_seller_id
      left join public.bot_conversation_states b on b.client_id = c.id
      where regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') in ($1, right($1, 13), right($1, 11))
         or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like '%' || right($1, 11)
         or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like '%' || right($1, 10)
         or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like '%' || right($1, 9)
         or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like '%' || right($1, 8)
      order by c.updated_at desc
    `,
    [phone]
  );

  const result = [];
  for (const client of clients) {
    const outbound = await query(
      `
        select id, phone, status, media_type, media_path, body, error_message,
               scheduled_at, created_at, sent_at
        from public.outbound_messages
        where client_id = $1
           or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || right($2, 11)
           or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || right($2, 10)
           or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || right($2, 9)
           or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like '%' || right($2, 8)
        order by created_at desc
        limit 80
      `,
      [client.id, phone]
    );

    const messages = await query(
      `
        select direction, media_type, media_path, body, whatsapp_message_id, created_at
        from public.messages
        where client_id = $1
        order by created_at desc
        limit 100
      `,
      [client.id]
    );

    const events = await query(
      `
        select event_type, platform, lead_status, metadata::text as metadata, created_at
        from public.traffic_events
        where client_id = $1
          and event_type in (
            'bot_poll_vote_received',
            'bot_meeting_presence_option_selected',
            'bot_audio_sent',
            'bot_message_received'
          )
        order by created_at desc
        limit 40
      `,
      [client.id]
    );

    result.push({
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        serviceInterest: client.service_interest,
        tags: client.tags,
        sellerName: client.seller_name,
        sellerPhone: client.meeting_seller_phone,
        stage: client.stage,
        completedAt: client.completed_at,
        meetingStartsAt: client.meeting_starts_at,
        meetingSellerName: client.meeting_seller_name,
        meetingSellerPhone: client.meeting_seller_phone,
        cannotAttendAt: client.cannot_attend_at,
        cannotAttendBody: client.cannot_attend_body,
        cannotAttendAudioPath: client.cannot_attend_audio_path,
        createdAt: client.created_at,
        updatedAt: client.updated_at
      },
      outbound: outbound.map(publicOutboundRow),
      messages: messages.map(publicMessageRow),
      events: events.map(publicEventRow)
    });
  }

  console.log(JSON.stringify({ phone, matches: result }, null, 2));
} finally {
  await pool.end();
}
