import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

function compact(value, length = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

try {
  const invalidPresence = await pool.query(`
    with invalid as (
      select distinct c.id, c.name, c.phone
      from public.clients c
      join public.bot_conversation_states b on b.client_id = c.id
      join public.traffic_events e on e.client_id = c.id
      where 'ec10_presenca_confirmada' = any(coalesce(c.tags, '{}'))
        and nullif(b.metadata #>> '{meeting,startsAt}', '') is null
        and e.event_type = 'bot_meeting_presence_option_selected'
        and e.metadata #>> '{choice}' = 'confirm'
        and (e.metadata #>> '{meeting}' is null or e.metadata #>> '{meeting}' = 'null')
    )
    update public.clients c
    set tags = array(
          select value
          from unnest(coalesce(c.tags, '{}')) as tags(value)
          where value <> 'ec10_presenca_confirmada'
        ) || array['ec10_followup_bloqueado_erro_corrigido']::text[],
        updated_at = now()
    from invalid
    where c.id = invalid.id
    returning c.id, c.name, c.phone
  `);

  const invalidEvents = await pool.query(`
    update public.traffic_events e
    set event_type = 'bot_meeting_presence_false_positive_corrected',
        lead_status = 'aguardando_humano',
        metadata = e.metadata || jsonb_build_object(
          'correctedAt', now(),
          'correctedReason', 'Resposta Sim sem reuniao salva era enquete de interesse, nao confirmacao de presenca.'
        )
    where e.event_type = 'bot_meeting_presence_option_selected'
      and e.metadata #>> '{choice}' = 'confirm'
      and (e.metadata #>> '{meeting}' is null or e.metadata #>> '{meeting}' = 'null')
    returning e.client_id
  `);

  const stateRepair = await pool.query(`
    update public.bot_conversation_states b
    set stage = 'awaiting_interest',
        completed_at = null,
        metadata = b.metadata
          - 'meetingPresenceConfirmedAt'
          - 'meetingPresenceConfirmedBody'
          - 'meetingPresenceSellerNotifiedAt'
          || jsonb_build_object(
            'falsePresenceCorrectedAt', now(),
            'requiresHumanFollowUp', true
          ),
        updated_at = now()
    from public.clients c
    where b.client_id = c.id
      and 'ec10_followup_bloqueado_erro_corrigido' = any(coalesce(c.tags, '{}'))
      and nullif(b.metadata #>> '{meeting,startsAt}', '') is null
    returning b.client_id
  `);

  const cancelledFollowups = await pool.query(`
    with protected_clients as (
      select c.id
      from public.clients c
      left join public.bot_conversation_states b on b.client_id = c.id
      where coalesce(c.tags, '{}') && array[
        'ec10_reuniao_agendada',
        'ec10_presenca_confirmada',
        'mentoria_prime_reuniao_agendada',
        'ec10_followup_bloqueado_erro_corrigido'
      ]::text[]
        or nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
        or exists (
          select 1
          from public.traffic_events e
          where e.client_id = c.id
            and e.event_type in ('bot_meeting_scheduled', 'Schedule')
        )
    )
    update public.outbound_messages o
    set status = 'cancelled',
        error_message = 'Cancelado: lead ja tem reuniao/presenca ou falso positivo de presenca corrigido.'
    from protected_clients p
    where o.client_id = p.id
      and o.status = 'queued'
      and o.media_path like 'ec10_followup:%'
    returning o.client_id, o.id, o.media_path
  `);

  const affected = await pool.query(`
    select
      c.id,
      c.name,
      c.phone,
      c.tags,
      b.stage,
      b.metadata #>> '{meeting,startsAt}' as meeting_starts_at,
      count(o.*) filter (where o.media_path like 'ec10_followup:%' and o.status = 'queued')::int as queued_followups,
      count(o.*) filter (where o.media_path like 'ec10_followup:%' and o.status = 'sent')::int as sent_followups,
      max(o.sent_at) filter (where o.media_path like 'ec10_followup:%' and o.status = 'sent') as last_followup_sent_at
    from public.clients c
    join public.bot_conversation_states b on b.client_id = c.id
    left join public.outbound_messages o on o.client_id = c.id
    where coalesce(c.tags, '{}') && array[
      'ec10_reuniao_agendada',
      'ec10_presenca_confirmada',
      'mentoria_prime_reuniao_agendada',
      'ec10_followup_bloqueado_erro_corrigido'
    ]::text[]
      or nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
    group by c.id, c.name, c.phone, c.tags, b.stage, meeting_starts_at
    having count(o.*) filter (where o.media_path like 'ec10_followup:%' and o.status in ('queued','sent')) > 0
    order by queued_followups desc, last_followup_sent_at desc nulls last
  `);

  const sellersToNotify = await pool.query(`
    insert into public.outbound_messages
      (client_id, phone, body, media_type, media_path, status, scheduled_at)
    select
      c.id,
      case
        when c.service_interest = 'plano_internacional' then coalesce(nullif(b.metadata #>> '{meetingSellerPhone}', ''), '+55 31 8233-1411')
        else coalesce(nullif(b.metadata #>> '{meetingSellerPhone}', ''), '+55 31 8876-4692')
      end as seller_phone,
      concat(
        'Alerta EC10: follow-up indevido corrigido.', E'\\n',
        'Lead: ', coalesce(c.name, 'Sem nome'), ' (+', regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), ')', E'\\n',
        'Contexto: o bot tinha tratado um Sim sem reuniao como presenca confirmada e/ou disparado follow-up apos confirmacao.', E'\\n',
        'Acao: revisar a conversa e responder manualmente se necessario.'
      ),
      'text',
      concat('seller_alert:false_presence_followup:v1:', c.id),
      'queued',
      now()
    from public.clients c
    join public.bot_conversation_states b on b.client_id = c.id
    where 'ec10_followup_bloqueado_erro_corrigido' = any(coalesce(c.tags, '{}'))
      and not exists (
        select 1
        from public.outbound_messages o
        where o.client_id = c.id
          and o.media_path = concat('seller_alert:false_presence_followup:v1:', c.id)
          and o.status in ('queued', 'sent')
      )
    returning client_id, phone
  `);

  console.log(JSON.stringify({
    invalidPresenceClients: invalidPresence.rows.map((row) => ({
      clientId: row.id,
      name: compact(row.name),
      phone: row.phone
    })),
    correctedPresenceEvents: invalidEvents.rowCount,
    repairedStates: stateRepair.rowCount,
    cancelledQueuedFollowups: cancelledFollowups.rowCount,
    sellerAlertsQueued: sellersToNotify.rowCount,
    remainingProtectedWithFollowups: affected.rows.map((row) => ({
      clientId: row.id,
      name: compact(row.name),
      phone: row.phone,
      stage: row.stage,
      meetingStartsAt: row.meeting_starts_at,
      queuedFollowups: Number(row.queued_followups),
      sentFollowups: Number(row.sent_followups),
      lastFollowupSentAt: row.last_followup_sent_at,
      tags: row.tags
    }))
  }, null, 2));
} finally {
  await pool.end();
}
