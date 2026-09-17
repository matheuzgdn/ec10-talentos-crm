import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const defaultInternationalSellerName = process.env.EC10_INTERNATIONAL_SELLER_NAME || process.env.EC10_SELLER_NAME || "EC10 Comercial";
const defaultInternationalSellerPhone = process.env.EC10_INTERNATIONAL_SELLER_PHONE || process.env.EC10_SELLER_PHONE || "+55 31 9852-6146";
const defaultCareerSellerName = process.env.EC10_CAREER_SELLER_NAME || "EC10 Comercial";
const defaultCareerSellerPhone = process.env.EC10_CAREER_SELLER_PHONE || "+55 31 9852-6146";
const meetUrl = process.env.EC10_GOOGLE_MEET_URL || null;
const reminderLeadMinutes = Number(process.env.MEETING_REMINDER_LEAD_MINUTES || 10);

function meetingReminderAt(startsAt, now = new Date()) {
  const start = new Date(startsAt);
  if (!Number.isFinite(start.getTime()) || start.getTime() <= now.getTime()) return null;
  const lead = new Date(start.getTime() - reminderLeadMinutes * 60 * 1000);
  const soonest = new Date(now.getTime() + 2 * 60 * 1000);
  const reminder = lead.getTime() > soonest.getTime() ? lead : soonest;
  return reminder.getTime() < start.getTime() ? reminder.toISOString() : null;
}

function formatDate(startsAt) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(startsAt));
}

function formatTimeRange(startsAt, endsAt) {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  });
  const start = formatter.format(new Date(startsAt));
  const end = endsAt ? formatter.format(new Date(endsAt)) : null;
  return end ? `${start} as ${end}` : start;
}

function clientBody(row) {
  const rowMeetUrl = row.meet_url || meetUrl;
  return [
    `Lembrete EC10: sua reuniao esta marcada para ${formatDate(row.starts_at)}, das ${formatTimeRange(row.starts_at, row.ends_at)}.`,
    `O atendimento sera com ${row.seller_name}.`,
    "Entre na sala no maximo 10 minutos antes do seu horario para evitar espera.",
    rowMeetUrl ? `Google Meet: ${rowMeetUrl}` : "Se o link do Meet ainda nao aparecer, responda por aqui que o time confirma."
  ].join("\n");
}

function sellerBody(row) {
  const rowMeetUrl = row.meet_url || meetUrl;
  return [
    "Lembrete EC10: reuniao chegando.",
    row.client_name ? `Lead: ${row.client_name} (+${row.client_phone})` : `Lead: +${row.client_phone}`,
    `Horario: ${formatDate(row.starts_at)}, das ${formatTimeRange(row.starts_at, row.ends_at)}`,
    rowMeetUrl ? `Google Meet: ${rowMeetUrl}` : "Google Meet: link pendente de configuracao no CRM"
  ].join("\n");
}

async function insertReminder(pool, input) {
  const updated = await pool.query(
    `
      update public.outbound_messages
      set body = $3,
          scheduled_at = $4::timestamptz,
          error_message = null
      where client_id = $1
        and phone = $2
        and status = 'queued'
        and coalesce(scheduled_at, created_at) >= now()
        and (
          body like 'Lembrete EC10:%'
          or body like 'Google Meet:%'
          or body like '%Google Meet:%'
        )
    `,
    [input.clientId, input.phone, input.body, input.scheduledAt]
  );
  if ((updated.rowCount || 0) > 0) {
    await pool.query(
      `
        delete from public.outbound_messages duplicate
        using public.outbound_messages keep
        where duplicate.client_id = $1
          and duplicate.phone = $2
          and duplicate.body = $3
          and duplicate.scheduled_at = $4::timestamptz
          and duplicate.status = 'queued'
          and keep.client_id = duplicate.client_id
          and keep.phone = duplicate.phone
          and keep.body = duplicate.body
          and keep.scheduled_at = duplicate.scheduled_at
          and keep.status = duplicate.status
          and keep.id < duplicate.id
      `,
      [input.clientId, input.phone, input.body, input.scheduledAt]
    );
    return 0;
  }

  const result = await pool.query(
    `
      insert into public.outbound_messages
        (client_id, phone, body, media_type, status, scheduled_at)
      select $1, $2, $3, 'text', 'queued', $4::timestamptz
      where not exists (
        select 1
        from public.outbound_messages
        where client_id = $1
          and phone = $2
          and body = $3
          and scheduled_at = $4::timestamptz
          and status in ('queued', 'sent')
      )
      returning id
    `,
    [input.clientId, input.phone, input.body, input.scheduledAt]
  );
  return result.rowCount || 0;
}

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
      c.id as client_id,
      c.name as client_name,
      c.phone as client_phone,
      coalesce(
        s.name,
        b.metadata #>> '{meetingSellerName}',
        case when c.service_interest = 'plano_carreira' then $1 else $3 end
      ) as seller_name,
      coalesce(
        b.metadata #>> '{meetingSellerPhone}',
        case when c.service_interest = 'plano_carreira' then $2 else $4 end
      ) as seller_phone,
      b.metadata #>> '{meeting,startsAt}' as starts_at,
      b.metadata #>> '{meeting,endsAt}' as ends_at,
      coalesce(b.metadata #>> '{meetingMeetUrl}', b.metadata #>> '{meeting,meetUrl}') as meet_url
    from public.bot_conversation_states b
    join public.clients c on c.id = b.client_id
    left join public.sellers s on s.id = c.assigned_seller_id
    where nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
      and (b.metadata #>> '{meeting,startsAt}') ~ '^\\d{4}-\\d{2}-\\d{2}'
      and (b.metadata #>> '{meeting,startsAt}')::timestamptz > now()
      and (b.metadata #>> '{meeting,startsAt}')::timestamptz <= now() + interval '60 days'
    order by (b.metadata #>> '{meeting,startsAt}')::timestamptz asc
  `,
  [defaultCareerSellerName, defaultCareerSellerPhone, defaultInternationalSellerName, defaultInternationalSellerPhone]
);

let clientInserted = 0;
let sellerInserted = 0;
let skippedTooSoon = 0;

for (const row of rows) {
  const scheduledAt = meetingReminderAt(row.starts_at);
  if (!scheduledAt) {
    skippedTooSoon += 1;
    continue;
  }

  clientInserted += await insertReminder(pool, {
    clientId: row.client_id,
    phone: row.client_phone,
    body: clientBody(row),
    scheduledAt
  });
  sellerInserted += await insertReminder(pool, {
    clientId: row.client_id,
    phone: row.seller_phone,
    body: sellerBody(row),
    scheduledAt
  });
}

await pool.end();
console.log(JSON.stringify({ futureMeetings: rows.length, clientInserted, sellerInserted, skippedTooSoon }));
