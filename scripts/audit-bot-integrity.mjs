import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const since = readArg("--since") ?? process.env.BOT_INTEGRITY_SINCE ?? "24 hours";
const sinceSql = /^\d{4}-\d{2}-\d{2}T/.test(since)
  ? "$1::timestamptz"
  : `now() - $1::interval`;
const meetingReminderLeadMinutes = Number.isFinite(Number(process.env.MEETING_REMINDER_LEAD_MINUTES))
  && Number(process.env.MEETING_REMINDER_LEAD_MINUTES) > 0
  ? Number(process.env.MEETING_REMINDER_LEAD_MINUTES)
  : 10;

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL nao configurado.");
}

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
});

try {
  const report = await buildReport();
  if (apply) {
    report.repairs = await applyRepairs();
  }

  await fs.mkdir(path.resolve("runtime"), { recursive: true });
  await fs.writeFile(
    path.resolve("runtime", "bot-integrity-audit-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

  console.log(JSON.stringify(report, null, 2));
  if (report.summary.severeContacts > 0 || report.summary.duplicateInboundEvents > 0) {
    process.exitCode = apply ? 0 : 2;
  }
} finally {
  await pool.end();
}

async function buildReport() {
  const [
    duplicateInbound,
    repeatedOutbound,
    repeatedAudio,
    unsafeFollowups,
    highVolume,
    futureMeetingReminderConflicts
  ] = await Promise.all([
    queryDuplicateInbound(),
    queryRepeatedOutbound(),
    queryRepeatedAudio(),
    queryUnsafeFollowups(),
    queryHighVolume(),
    queryFutureMeetingReminderConflicts()
  ]);

  const severePhones = new Set([
    ...repeatedOutbound.filter((row) => row.sends >= 3).map((row) => row.phone),
    ...repeatedAudio.map((row) => row.phone),
    ...highVolume.map((row) => row.phone),
    ...futureMeetingReminderConflicts.map((row) => row.phone)
  ].filter(Boolean));

  return {
    checkedAt: new Date().toISOString(),
    since,
    apply,
    summary: {
      duplicateInboundEvents: duplicateInbound.reduce((sum, row) => sum + row.extra_copies, 0),
      repeatedOutboundGroups: repeatedOutbound.length,
      repeatedAudioGroups: repeatedAudio.length,
      unsafeFollowups: unsafeFollowups.length,
      highVolumeContacts: highVolume.length,
      futureMeetingReminderConflicts: futureMeetingReminderConflicts.length,
      severeContacts: severePhones.size
    },
    severePhones: [...severePhones],
    duplicateInbound,
    repeatedOutbound,
    repeatedAudio,
    unsafeFollowups,
    highVolume,
    futureMeetingReminderConflicts
  };
}

async function queryDuplicateInbound() {
  const { rows } = await pool.query(
    `
      select phone, name,
             count(*)::int as duplicate_message_ids,
             sum(copies - 1)::int as extra_copies,
             max(copies)::int as max_copies,
             max(last_at) as last_at,
             array_agg(body_sample order by last_at desc) filter (where body_sample <> '') as samples
      from (
        select c.phone, c.name, m.whatsapp_message_id, count(*)::int as copies,
               max(m.created_at) as last_at,
               left(coalesce(max(m.body), ''), 160) as body_sample
        from public.messages m
        join public.clients c on c.id = m.client_id
        where m.created_at >= ${sinceSql}
          and m.direction = 'inbound'
          and nullif(m.whatsapp_message_id, '') is not null
        group by c.phone, c.name, m.whatsapp_message_id
        having count(*) > 1
      ) duplicates
      group by phone, name
      order by extra_copies desc, last_at desc
      limit 100
    `,
    [since]
  );
  return rows.map(limitSamples);
}

async function queryRepeatedOutbound() {
  const { rows } = await pool.query(
    `
      with grouped as (
        select c.phone, c.name, m.client_id, m.media_type,
               coalesce(m.media_path, left(coalesce(m.body,''), 500)) as content_key,
               count(*)::int as sends,
               min(m.created_at) as first_at,
               max(m.created_at) as last_at,
               left(coalesce(max(m.body), ''), 180) as body_sample,
               max(m.media_path) as media_path
        from public.messages m
        join public.clients c on c.id = m.client_id
        where m.created_at >= ${sinceSql}
          and m.direction = 'outbound'
          and m.media_type in ('text','audio','poll')
        group by c.phone, c.name, m.client_id, m.media_type, coalesce(m.media_path, left(coalesce(m.body,''), 500))
      )
      select phone, name, media_type, sends, first_at, last_at, body_sample, media_path
      from grouped
      where sends > 1
        and last_at <= first_at + interval '30 minutes'
      order by sends desc, last_at desc
      limit 100
    `,
    [since]
  );
  return rows;
}

async function queryRepeatedAudio() {
  const { rows } = await pool.query(
    `
      select c.phone, c.name, m.media_path, count(*)::int as sends,
             min(m.created_at) as first_at, max(m.created_at) as last_at
      from public.messages m
      join public.clients c on c.id = m.client_id
      where m.created_at >= ${sinceSql}
        and m.direction = 'outbound'
        and m.media_type = 'audio'
        and m.media_path is not null
      group by c.phone, c.name, m.media_path
      having count(*) > 1
      order by sends desc, last_at desc
      limit 100
    `,
    [since]
  );
  return rows;
}

async function queryUnsafeFollowups() {
  const { rows } = await pool.query(
    `
      select c.phone, c.name, c.status, c.tags,
             count(*)::int as followups,
             count(*) filter (where o.status = 'queued')::int as queued,
             count(*) filter (where o.status = 'sent')::int as sent,
             count(*) filter (where o.status = 'failed')::int as failed,
             max(coalesce(o.sent_at, o.scheduled_at, o.created_at)) as last_at
      from public.outbound_messages o
      join public.clients c on c.id = o.client_id
      where o.created_at >= ${sinceSql}
        and o.media_path like 'ec10_followup:%'
        and (
          c.tags && array['ec10_reuniao_agendada','reuniao_recusada','ec10_presenca_confirmada','ec10_nao_podera_participar']::text[]
          or c.status in ('orcamento','fechado','perdido')
          or o.status = 'failed'
        )
      group by c.phone, c.name, c.status, c.tags
      order by queued desc, failed desc, last_at desc
      limit 100
    `,
    [since]
  );
  return rows;
}

async function queryHighVolume() {
  const { rows } = await pool.query(
    `
      select c.phone, c.name,
             count(*) filter (where m.direction='inbound')::int as inbound_count,
             count(*) filter (where m.direction='outbound')::int as outbound_count,
             count(*) filter (where m.direction='outbound' and m.media_type='audio')::int as audio_count,
             count(*) filter (where m.direction='outbound' and m.media_type='poll')::int as poll_count,
             min(m.created_at) as first_at,
             max(m.created_at) as last_at
      from public.messages m
      join public.clients c on c.id = m.client_id
      where m.created_at >= ${sinceSql}
      group by c.phone, c.name
      having count(*) filter (where m.direction='outbound') >= 10
          or count(*) filter (where m.direction='outbound' and m.media_type='audio') > 3
      order by outbound_count desc, last_at desc
      limit 100
    `,
    [since]
  );
  return rows;
}

async function queryFutureMeetingReminderConflicts() {
  const { rows } = await pool.query(
    `
      select c.id as client_id,
             c.phone,
             c.name,
             b.metadata #>> '{meeting,startsAt}' as meeting_starts_at,
             count(*) filter (
               where o.phone = c.phone
                 and o.body like 'Lembrete EC10: sua reuniao%'
             )::int as client_reminders,
             count(*)::int as total_reminders,
             array_agg(jsonb_build_object(
               'id', o.id,
               'phone', o.phone,
               'scheduledAt', o.scheduled_at,
               'body', left(regexp_replace(coalesce(o.body, ''), '\\s+', ' ', 'g'), 180)
             ) order by o.scheduled_at, o.created_at) as reminders
      from public.outbound_messages o
      join public.clients c on c.id = o.client_id
      left join public.bot_conversation_states b on b.client_id = c.id
      where o.status = 'queued'
        and coalesce(o.scheduled_at, o.created_at) > now()
        and o.body like 'Lembrete EC10:%'
      group by c.id, c.phone, c.name, b.metadata
      having count(*) filter (
               where o.phone = c.phone
                 and o.body like 'Lembrete EC10: sua reuniao%'
             ) > 1
          or count(*) > 2
      order by total_reminders desc, max(o.scheduled_at) desc
      limit 100
    `
  );

  return rows.map((row) => ({
    ...row,
    expected_reminder_at: row.meeting_starts_at
      ? new Date(new Date(row.meeting_starts_at).getTime() - meetingReminderLeadMinutes * 60_000).toISOString()
      : null,
    reminders: Array.isArray(row.reminders) ? row.reminders.slice(0, 8) : []
  }));
}

async function applyRepairs() {
  const unsafe = await pool.query(
    `
      update public.outbound_messages o
      set status = 'cancelled',
          error_message = 'Bot integrity audit cancelou follow-up automatico por seguranca.'
      from public.clients c
      where o.client_id = c.id
        and o.status = 'queued'
        and o.media_path like 'ec10_followup:%'
        and (
          c.tags && array['ec10_reuniao_agendada','reuniao_recusada','ec10_presenca_confirmada','ec10_nao_podera_participar']::text[]
          or c.status in ('orcamento','fechado','perdido')
          or $1::boolean = true
        )
      returning o.id
    `,
    [true]
  );

  const staleMeetingReminders = await pool.query(
    `
      with conflicts as (
        select c.id as client_id,
               (b.metadata #>> '{meeting,startsAt}')::timestamptz as meeting_starts_at
        from public.outbound_messages o
        join public.clients c on c.id = o.client_id
        join public.bot_conversation_states b on b.client_id = c.id
        where o.status = 'queued'
          and coalesce(o.scheduled_at, o.created_at) > now()
          and o.body like 'Lembrete EC10:%'
          and nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
        group by c.id, b.metadata
        having count(*) filter (
                 where o.phone = c.phone
                   and o.body like 'Lembrete EC10: sua reuniao%'
               ) > 1
            or count(*) > 2
      ),
      expected as (
        select client_id,
               meeting_starts_at - make_interval(mins => $1::int) as expected_reminder_at
        from conflicts
      )
      update public.outbound_messages o
      set status = 'cancelled',
          error_message = 'Bot integrity audit cancelou lembrete antigo de reuniao por seguranca.'
      from expected
      where o.client_id = expected.client_id
        and o.status = 'queued'
        and o.body like 'Lembrete EC10:%'
        and o.scheduled_at is not null
        and abs(extract(epoch from (o.scheduled_at - expected.expected_reminder_at))) > 1
      returning o.id
    `,
    [meetingReminderLeadMinutes]
  );

  return {
    queuedFollowupsCancelled: unsafe.rowCount,
    staleMeetingRemindersCancelled: staleMeetingReminders.rowCount
  };
}

function readArg(name) {
  const equalPrefix = `${name}=`;
  const equalArg = process.argv.find((arg) => arg.startsWith(equalPrefix));
  if (equalArg) return equalArg.slice(equalPrefix.length).trim();

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1].trim();
  }

  return null;
}

function limitSamples(row) {
  return {
    ...row,
    samples: Array.isArray(row.samples) ? row.samples.slice(0, 5) : []
  };
}
