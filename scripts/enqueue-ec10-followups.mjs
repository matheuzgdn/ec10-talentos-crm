import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const firstOnly = args.has("--first-only");
const since = process.env.EC10_FOLLOWUP_SINCE || "2026-06-20T00:00:00-03:00";
const markerPrefix = "ec10_followup:meeting";

if (process.env.EC10_FOLLOWUPS_ENABLED !== "true") {
  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "apply",
    skipped: true,
    reason: "EC10_FOLLOWUPS_ENABLED diferente de true"
  }, null, 2));
  process.exit(0);
}

function greeting(name) {
  const firstName = String(name || "").trim().split(/\s+/).find(Boolean);
  return firstName ? `Oi, ${firstName}.` : "Oi, tudo bem?";
}

const steps = [
  {
    step: 1,
    delayMinutes: 0,
    text: (name) => [
      `${greeting(name)} Vi que voce comecou o atendimento da EC10, mas ainda nao escolheu o horario da reuniao.`,
      "",
      "Quando existe objetivo no futebol, seguir no improviso pode custar tempo e oportunidade."
    ].join("\n"),
    pollQuestion: "Quer dar o proximo passo agora?",
    pollOptions: ["Quero agendar", "Tenho uma duvida", "Ver mais tarde"]
  },
  {
    step: 2,
    delayMinutes: 120,
    text: (name) => [
      `${greeting(name)} A reuniao e rapida e serve para entender o momento do atleta, os objetivos da familia e qual plano faz mais sentido.`,
      "",
      "Se fizer sentido, mostramos o caminho. Se nao fizer, tambem falamos com clareza."
    ].join("\n"),
    pollQuestion: "Como prefere seguir?",
    pollOptions: ["Separar um horario", "Entender melhor antes", "Falar com atendente"]
  },
  {
    step: 3,
    delayMinutes: 1440,
    text: (name) => [
      `${greeting(name)} Muitos responsaveis procuram orientacao so quando ja perderam tempo.`,
      "",
      "No futebol, quem tem plano chega mais preparado. Quem vai no achismo depende de sorte."
    ].join("\n"),
    pollQuestion: "Quer escolher um horario hoje?",
    pollOptions: ["Quero ver horarios", "Quero entender valores", "Ainda estou pensando"]
  },
  {
    step: 4,
    delayMinutes: 2880,
    text: (name) => `${greeting(name)} So para eu te direcionar certo: o que esta te travando agora?`,
    pollQuestion: "O que esta te travando agora?",
    pollOptions: [
      "Quero entender os valores",
      "Quero saber se faz sentido para o atleta",
      "Quero entender como funciona",
      "Quero agendar a reuniao"
    ]
  },
  {
    step: 5,
    delayMinutes: 4320,
    text: (name) => [
      `${greeting(name)} Vou deixar seu atendimento em aberto ate hoje.`,
      "",
      "Se o objetivo e levar esse projeto a serio, o primeiro passo e entender o caminho certo."
    ].join("\n"),
    pollQuestion: "Quer que eu te envie os horarios finais?",
    pollOptions: ["Enviar horarios finais", "Falar com consultor", "Encerrar por enquanto"]
  }
];

function pollBody(step) {
  return [
    step.pollQuestion,
    ...step.pollOptions.map((option, index) => `${index + 1}. ${option}`)
  ].join("\n");
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

async function insertOutbound(pool, input) {
  const result = await pool.query(
    `
      insert into public.outbound_messages
        (client_id, phone, body, media_type, media_path, status, scheduled_at)
      select $1, $2, $3, $4, $5, 'queued', $6::timestamptz
      where not exists (
        select 1
          from public.outbound_messages
          where client_id = $1
            and phone = $2
            and media_path = $5
            and status in ('queued', 'sent', 'failed', 'cancelled')
      )
      returning id
    `,
    [input.clientId, input.phone, input.body, input.mediaType, input.mediaPath, input.scheduledAt]
  );
  return result.rowCount || 0;
}

async function markQueued(pool, row, scheduledSteps) {
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
    [row.client_id, ["ec10_followup_ativo"]]
  );

  await pool.query(
    `
      insert into public.traffic_events
        (client_id, phone, event_type, channel, platform, service_interest, athlete_age, age_group, lead_status, quality_score, metadata)
      values
        ($1, $2, 'bot_followup_sequence_queued', 'whatsapp', 'meta_ads', $3, $4, $5, 'aguardando_cliente', 70, $6::jsonb)
    `,
    [
      row.client_id,
      row.phone,
      row.service_interest,
      row.athlete_age,
      row.age_group,
      JSON.stringify({
        source: "enqueue-ec10-followups",
        steps: scheduledSteps,
        firstOnly,
        since
      })
    ]
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
  const { rows } = await pool.query(
    `
      select
        c.id as client_id,
        c.phone,
        c.name,
        c.status,
        b.stage,
        b.service_interest,
        b.athlete_age,
        b.age_group
      from public.bot_conversation_states b
      join public.clients c on c.id = b.client_id
      where c.created_at >= $1::timestamptz
        and c.bot_paused = false
        and c.status not in ('fechado', 'perdido')
        and not (coalesce(c.tags, '{}') && array[
          'whatsapp_indisponivel',
          'ec10_followup_cancelado',
          'ec10_reuniao_agendada',
          'ec10_presenca_confirmada',
          'mentoria_prime_reuniao_agendada'
        ])
        and b.stage in ('awaiting_interest', 'awaiting_guardian_confirmation', 'awaiting_meeting_date', 'awaiting_meeting_time')
        and nullif(b.metadata #>> '{meeting,startsAt}', '') is null
        and not exists (
          select 1
          from public.traffic_events e
          where e.client_id = c.id
            and e.event_type in ('bot_meeting_scheduled', 'Schedule')
        )
        and not exists (
          select 1
          from public.outbound_messages o
          where o.client_id = c.id
            and o.media_path = 'ec10_followup:meeting:1:poll'
            and o.status in ('queued', 'sent', 'failed', 'cancelled')
        )
      order by c.created_at asc
    `,
    [since]
  );

  const selectedSteps = firstOnly ? steps.slice(0, 1) : steps;
  const now = new Date();
  let textQueued = 0;
  let pollQueued = 0;
  let clientsQueued = 0;

  if (dryRun) {
    console.log(JSON.stringify({
      mode: "dry-run",
      eligibleClients: rows.length,
      steps: selectedSteps.map((step) => ({
        step: step.step,
        delayMinutes: step.delayMinutes,
        pollQuestion: step.pollQuestion,
        pollOptions: step.pollOptions
      }))
    }, null, 2));
    process.exit(0);
  }

  for (const row of rows) {
    const scheduledSteps = [];
    for (const step of selectedSteps) {
      const textAt = addMinutes(now, step.delayMinutes).toISOString();
      const pollAt = addMinutes(now, step.delayMinutes).getTime() + 20_000;
      textQueued += await insertOutbound(pool, {
        clientId: row.client_id,
        phone: row.phone,
        body: step.text(row.name),
        mediaType: "text",
        mediaPath: `${markerPrefix}:${step.step}:text`,
        scheduledAt: textAt
      });
      pollQueued += await insertOutbound(pool, {
        clientId: row.client_id,
        phone: row.phone,
        body: pollBody(step),
        mediaType: "poll",
        mediaPath: `${markerPrefix}:${step.step}:poll`,
        scheduledAt: new Date(pollAt).toISOString()
      });
      scheduledSteps.push({
        step: step.step,
        textAt,
        pollAt: new Date(pollAt).toISOString()
      });
    }
    await markQueued(pool, row, scheduledSteps);
    clientsQueued += 1;
  }

  console.log(JSON.stringify({
    mode: "apply",
    eligibleClients: rows.length,
    clientsProcessed: clientsQueued,
    textQueued,
    pollQueued,
    firstOnly,
    since
  }, null, 2));
} finally {
  await pool.end();
}
