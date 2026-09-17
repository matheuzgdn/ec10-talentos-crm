import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pollMediaPath = "meeting_presence:poll:v1";
const confirmedMediaPath = "meeting_presence:confirmed:v1";
const cannotAudioPath = "media/audio/bot-principal/meeting_presence_cannot_attend_eric_cena_opus.ogg";
const cannotTag = "ec10_nao_podera_participar";
const confirmedTag = "ec10_presenca_confirmada";
const pollQueuedTag = "ec10_presenca_enquete_enviada";

const pollBody = [
  "Voce confirma sua presenca na reuniao EC10?",
  "1. CONFIRMO MINHA PRESENÇA",
  "2. QUERO REAGENDAR",
  "3. NÃO PODEREI PARTICIPAR"
].join("\n");

function normalize(input) {
  return String(input ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyReply(input) {
  const text = normalize(input);
  if (!text) return null;
  if (
    /\b(nao poderei participar|nao vou participar|nao posso participar|nao consigo participar)\b/.test(text)
    || /\bnao (poderei|posso|vou conseguir|consigo) (ir|comparecer|entrar|estar|participar)(?:\b| .*reuniao| .*meet| .*chamada)/.test(text)
    || /\b(vou faltar|preciso cancelar|cancelar a reuniao|cancela a reuniao|cancelar o meet|cancela o meet|nao poderei ir|nao poderei comparecer)\b/.test(text)
  ) {
    return "cannot_attend";
  }
  if (/\b(confirmo|confirmado|confirmada|presenca confirmada|vou participar|estarei presente|ok|okay|sim|show|beleza|certo|combinado)\b/.test(text)) {
    return "confirm";
  }
  return null;
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function serviceLabel(value) {
  if (value === "plano_internacional") return "Plano internacional";
  if (value === "plano_carreira") return "Plano de carreira";
  return "EC10";
}

function sellerConfirmationBody(row) {
  return [
    "Confirmacao de presenca EC10.",
    `Lead: +${digits(row.client_phone)}`,
    `Servico: ${serviceLabel(row.service_interest)}`,
    `Reuniao: ${row.meeting_local || "horario registrado no CRM"}`,
    `Vendedor responsavel: ${row.seller_name}`,
    row.meet_url ? `Google Meet: ${row.meet_url}` : null,
    "",
    "Status: lead confirmou presenca pelo WhatsApp."
  ].filter(Boolean).join("\n");
}

async function insertQueued(pool, input) {
  const result = await pool.query(
    `
      insert into public.outbound_messages
        (client_id, phone, body, media_type, media_path, status, scheduled_at)
      select $1, $2, $3, $4, $5, 'queued', now()
      where not exists (
        select 1
        from public.outbound_messages
        where client_id = $1
          and phone = $2
          and media_path = $5
          and status in ('queued', 'sent', 'delivered')
      )
      returning id
    `,
    [input.clientId, input.phone, input.body ?? null, input.mediaType, input.mediaPath]
  );
  return result.rowCount || 0;
}

async function appendTag(pool, clientId, tag) {
  await pool.query(
    `
      update public.clients
      set tags = (
            select array(
              select distinct value
              from unnest(coalesce(public.clients.tags, '{}') || $2::text[]) as tags(value)
              where value is not null and value <> ''
            )
          ),
          updated_at = now()
      where id = $1
    `,
    [clientId, [tag]]
  );
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

const { rows } = await pool.query(`
  with notices as (
    select distinct on (o.client_id)
      o.client_id,
      o.phone as notice_phone,
      o.created_at as notice_at
    from public.outbound_messages o
    where o.status in ('sent', 'delivered')
      and o.body like 'EC10: sua reuniao esta confirmada%'
      and o.body like '%Para evitar espera%'
      and o.body like '%Google Meet%'
    order by o.client_id, o.created_at desc
  ),
  inbound_after_notice as (
    select
      n.client_id,
      string_agg(m.body, E'\n' order by m.created_at desc) as inbound_text,
      max(m.created_at) as last_inbound_at
    from notices n
    join public.messages m on m.client_id = n.client_id
    where m.direction = 'inbound'
      and m.created_at > n.notice_at
    group by n.client_id
  )
  select
    c.id as client_id,
    c.name as client_name,
    c.phone as client_phone,
    c.service_interest,
    coalesce(s.name, b.metadata #>> '{meetingSellerName}', 'Sem vendedor') as seller_name,
    coalesce(b.metadata #>> '{meetingSellerPhone}', '') as seller_phone,
    coalesce(b.metadata #>> '{meetingMeetUrl}', b.metadata #>> '{meeting,meetUrl}') as meet_url,
    to_char((b.metadata #>> '{meeting,startsAt}')::timestamptz at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as meeting_local,
    n.notice_at,
    i.inbound_text,
    i.last_inbound_at
  from notices n
  join public.clients c on c.id = n.client_id
  join public.bot_conversation_states b on b.client_id = c.id
  left join public.sellers s on s.id = c.assigned_seller_id
  left join inbound_after_notice i on i.client_id = n.client_id
  where nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
    and (b.metadata #>> '{meeting,startsAt}') ~ '^\\d{4}-\\d{2}-\\d{2}'
    and (b.metadata #>> '{meeting,startsAt}')::timestamptz > now()
  order by (b.metadata #>> '{meeting,startsAt}')::timestamptz asc
`);

let pollQueued = 0;
let audioQueued = 0;
let sellerConfirmQueued = 0;
const skippedConfirmed = [];
const cannotAttend = [];

for (const row of rows) {
  const replyClass = classifyReply(row.inbound_text);

  if (replyClass === "confirm") {
    sellerConfirmQueued += await insertQueued(pool, {
      clientId: row.client_id,
      phone: row.seller_phone,
      body: sellerConfirmationBody(row),
      mediaType: "text",
      mediaPath: `${confirmedMediaPath}:${row.client_id}`
    });
    await appendTag(pool, row.client_id, confirmedTag);
    skippedConfirmed.push({ clientId: row.client_id, name: row.client_name, seller: row.seller_name });
    continue;
  }

  if (replyClass === "cannot_attend") {
    audioQueued += await insertQueued(pool, {
      clientId: row.client_id,
      phone: row.client_phone,
      body: null,
      mediaType: "audio",
      mediaPath: cannotAudioPath
    });
    await appendTag(pool, row.client_id, cannotTag);
    cannotAttend.push({ clientId: row.client_id, name: row.client_name, seller: row.seller_name });
    continue;
  }

  pollQueued += await insertQueued(pool, {
    clientId: row.client_id,
    phone: row.client_phone,
    body: pollBody,
    mediaType: "poll",
    mediaPath: `${pollMediaPath}:${row.client_id}`
  });
  await appendTag(pool, row.client_id, pollQueuedTag);
}

await pool.end();

console.log(JSON.stringify({
  candidates: rows.length,
  pollQueued,
  audioQueued,
  sellerConfirmQueued,
  skippedConfirmed,
  cannotAttend
}, null, 2));
