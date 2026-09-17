import "dotenv/config";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const botStatusUrl = process.env.BOT_PUBLIC_STATUS_URL || "https://cliente-whatsapp-crm.vercel.app/api/bot-status";
const meetUrl = process.env.EC10_GOOGLE_MEET_URL || null;
const campaignId = process.env.EC10_PRIORITY_CAMPAIGN_ID || "120246705254850601";
const accountId = process.env.META_AD_ACCOUNT_ID || "act_1235838336986319";

const helpPattern = [
  "ajuda",
  "atendente",
  "humano",
  "vendedor",
  "nao consegui",
  "não consegui",
  "erro",
  "problema",
  "travou",
  "link",
  "meet",
  "autorizar",
  "esperando",
  "ninguém",
  "ninguem",
  "responde"
];

function n(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function short(value, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function rows(pool, text, params = []) {
  return (await pool.query(text, params)).rows;
}

async function insertRecommendation(pool, item) {
  const exists = await rows(
    pool,
    `
      select id
      from public.traffic_agent_recommendations
      where created_at >= now() - interval '24 hours'
        and lower(title) = lower($1)
      limit 1
    `,
    [item.title]
  );
  if (exists.length) return { inserted: false, title: item.title, id: exists[0].id };

  const inserted = await rows(
    pool,
    `
      insert into public.traffic_agent_recommendations
        (title, summary, recommendation_type, priority, status, confidence,
         impact_area, service_interest, campaign_id, campaign_name,
         reasoning, evidence, suggested_action)
      values
        ($1, $2, 'daily_ops_healthcheck', $3, 'pending_approval', $4,
         $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      returning id, title, priority, created_at
    `,
    [
      item.title,
      item.summary,
      item.priority,
      item.confidence ?? 82,
      item.impactArea ?? "operations",
      item.serviceInterest ?? null,
      item.campaignId ?? campaignId,
      item.campaignName ?? "Plano de Carreira EC10",
      item.reasoning,
      JSON.stringify(item.evidence ?? {}),
      JSON.stringify({
        requiresHumanApproval: true,
        doNotChangeBudgetAutomatically: true,
        ...item.suggestedAction
      })
    ]
  );
  return { inserted: true, ...inserted[0] };
}

async function checkBotStatus() {
  try {
    const response = await fetch(botStatusUrl, { signal: AbortSignal.timeout(10000) });
    const payload = await response.json().catch(async () => ({ text: await response.text() }));
    return {
      ok: response.ok,
      httpStatus: response.status,
      status: payload.status ?? null,
      stale: payload.stale ?? null,
      updatedAt: payload.updatedAt ?? null,
      source: payload.source ?? null
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildMessageIssueRows(messages) {
  return messages.filter((row) => {
    const body = String(row.last_inbound_body ?? "").toLowerCase();
    return helpPattern.some((term) => body.includes(term));
  });
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 12,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 60000
});

const startedAt = new Date().toISOString();
const [
  unanswered,
  inboundHelp,
  outboundFailures,
  overdueOutbound,
  followupFailures,
  leadHealth,
  qualityEvents,
  metaSnapshot,
  meetings
] = await Promise.all([
  rows(pool, `
    with last_messages as (
      select
        c.id,
        c.name,
        c.phone,
        c.status,
        c.service_interest,
        s.name as seller_name,
        max(m.created_at) filter (where m.direction = 'inbound') as last_inbound_at,
        max(m.created_at) filter (where m.direction = 'outbound') as last_outbound_at,
        (array_agg(m.body order by m.created_at desc) filter (where m.direction = 'inbound'))[1] as last_inbound_body
      from public.clients c
      join public.messages m on m.client_id = c.id
      left join public.sellers s on s.id = c.assigned_seller_id
      where m.created_at >= now() - interval '24 hours'
        and coalesce(c.status::text, '') not in ('fechado', 'arquivado')
      group by c.id, c.name, c.phone, c.status, c.service_interest, s.name
    )
    select *
    from last_messages
    where last_inbound_at is not null
      and (last_outbound_at is null or last_inbound_at > last_outbound_at)
      and last_inbound_at <= now() - interval '2 hours'
    order by last_inbound_at asc
    limit 30
  `),
  rows(pool, `
    select
      c.id,
      c.name,
      c.phone,
      c.status,
      c.service_interest,
      s.name as seller_name,
      m.created_at,
      m.body
    from public.messages m
    join public.clients c on c.id = m.client_id
    left join public.sellers s on s.id = c.assigned_seller_id
    where m.direction = 'inbound'
      and m.created_at >= now() - interval '24 hours'
      and (${helpPattern.map((_, index) => `lower(m.body) like $${index + 1}`).join(" or ")})
    order by m.created_at desc
    limit 40
  `, helpPattern.map((term) => `%${term}%`)),
  rows(pool, `
    select o.status, coalesce(o.error_message, 'sem erro') as error_message, count(*)::int total
    from public.outbound_messages o
    left join public.clients c on c.id = o.client_id
    where o.created_at >= now() - interval '24 hours'
      and o.status = 'failed'
      and not ('whatsapp_indisponivel' = any(coalesce(c.tags, '{}')))
      and not exists (
        select 1
        from public.outbound_messages later
        where later.client_id = o.client_id
          and later.status = 'sent'
          and later.created_at > o.created_at
      )
    group by o.status, coalesce(o.error_message, 'sem erro')
    order by total desc
    limit 20
  `),
  rows(pool, `
    select count(*)::int total
    from public.outbound_messages
    where status = 'queued'
      and coalesce(scheduled_at, created_at) <= now() - interval '20 minutes'
  `),
  rows(pool, `
    select coalesce(o.error_message, 'sem erro') as error_message, count(*)::int total
    from public.outbound_messages o
    left join public.clients c on c.id = o.client_id
    where o.media_path like 'ec10_followup:%'
      and o.status = 'failed'
      and o.created_at >= now() - interval '7 days'
      and not ('whatsapp_indisponivel' = any(coalesce(c.tags, '{}')))
      and not exists (
        select 1
        from public.outbound_messages later
        where later.client_id = o.client_id
          and later.status = 'sent'
          and later.created_at > o.created_at
      )
    group by coalesce(o.error_message, 'sem erro')
    order by total desc
    limit 20
  `),
  rows(pool, `
    select
      count(*)::int leads_24h,
      count(*) filter (where service_interest = 'plano_carreira')::int career_24h,
      count(*) filter (where source = 'site')::int site_24h,
      count(*) filter (
        where source = 'site'
          and (
            nullif(utm_source, '') is not null
            or nullif(utm_campaign, '') is not null
            or nullif(fbclid, '') is not null
            or nullif(attribution_metadata ->> 'fbp', '') is not null
            or nullif(attribution_metadata ->> 'fbc', '') is not null
          )
      )::int attributed_site_24h,
      count(*) filter (where assigned_seller_id is null)::int unassigned_24h
    from public.clients
    where created_at >= now() - interval '24 hours'
  `),
  rows(pool, `
    select event_type, count(*)::int total,
           count(*) filter (where metadata ->> 'capiSent' = 'true')::int capi_sent,
           count(*) filter (where metadata ->> 'capiSent' = 'false')::int capi_failed
    from public.traffic_events
    where occurred_at >= now() - interval '24 hours'
      and event_type in ('QualifiedLead', 'Schedule', 'Purchase', 'purchase', 'bot_meeting_scheduled')
    group by event_type
    order by event_type
  `),
  rows(pool, `
    select
      sum(spend)::numeric(12,2) spend,
      sum(impressions)::int impressions,
      sum(clicks)::int clicks,
      sum(leads)::int leads,
      sum(qualified_leads)::int qualified_leads,
      sum(proposals)::int schedules,
      sum(purchases)::int purchases,
      max(created_at) last_synced_at
    from public.traffic_campaign_snapshots
    where account_id = $1
      and campaign_id = $2
      and date_start >= current_date - interval '2 days'
  `, [accountId, campaignId]),
  rows(pool, `
    select
      c.id,
      c.name,
      c.phone,
      coalesce(s.name, b.metadata #>> '{meetingSellerName}', 'Sem vendedor') seller_name,
      b.metadata #>> '{meeting,startsAt}' starts_at,
      coalesce(b.metadata #>> '{meetingMeetUrl}', b.metadata #>> '{meeting,meetUrl}') meet_url,
      b.metadata #>> '{meetingMeetAccessOpenedAt}' meet_access_opened_at,
      b.metadata #>> '{meetingMeetAccessOpenStatus}' meet_access_open_status
    from public.bot_conversation_states b
    join public.clients c on c.id = b.client_id
    left join public.sellers s on s.id = c.assigned_seller_id
    where nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
      and (b.metadata #>> '{meeting,startsAt}') ~ '^\\d{4}-\\d{2}-\\d{2}'
      and (b.metadata #>> '{meeting,startsAt}')::timestamptz >= now() - interval '7 days'
      and (b.metadata #>> '{meeting,startsAt}')::timestamptz <= now() + interval '24 hours'
    order by (b.metadata #>> '{meeting,startsAt}')::timestamptz asc
  `)
]);

const bot = await checkBotStatus();
const helpRows = buildMessageIssueRows(inboundHelp);
const health = leadHealth[0] ?? {};
const meta = metaSnapshot[0] ?? {};
const qualityMap = Object.fromEntries(qualityEvents.map((row) => [row.event_type, row]));
const recommendations = [];

if (!bot.ok || bot.stale || !["ready", "authenticated", "online"].includes(String(bot.status ?? ""))) {
  recommendations.push({
    title: "Bot precisa de verificacao operacional",
    summary: `Status publico ${bot.status ?? "indefinido"}, stale=${bot.stale ?? "n/a"}.`,
    priority: "urgent",
    impactArea: "bot",
    reasoning: "O bot publico nao esta em estado claramente saudavel durante o healthcheck diario.",
    evidence: { bot },
    suggestedAction: { recommendedNextStep: "Abrir status do bot, validar sessao WhatsApp e religar se necessario." }
  });
}

if (unanswered.length) {
  recommendations.push({
    title: "Leads com mensagens sem resposta",
    summary: `${unanswered.length} conversas tiveram inbound sem resposta ha mais de 2h.`,
    priority: "high",
    impactArea: "sales_followup",
    reasoning: "Mensagem inbound mais recente ficou sem outbound posterior, indicando possivel gargalo de atendimento.",
    evidence: {
      sample: unanswered.slice(0, 10).map((row) => ({
        clientId: row.id,
        name: row.name,
        seller: row.seller_name,
        status: row.status,
        lastInboundAt: row.last_inbound_at,
        lastInboundBody: short(row.last_inbound_body)
      }))
    },
    suggestedAction: { recommendedNextStep: "Equipe revisar amostra e responder leads pendentes ainda hoje." }
  });
}

if (helpRows.length) {
  recommendations.push({
    title: "Mensagens de ajuda pedem revisao humana",
    summary: `${helpRows.length} mensagens recentes citam ajuda, erro, link, Meet ou atendimento.`,
    priority: "high",
    impactArea: "conversation_quality",
    reasoning: "Palavras de friccao em mensagens inbound podem indicar cliente travado ou bot/follow-up confuso.",
    evidence: {
      sample: helpRows.slice(0, 12).map((row) => ({
        clientId: row.id,
        name: row.name,
        seller: row.seller_name,
        createdAt: row.created_at,
        body: short(row.body)
      }))
    },
    suggestedAction: { recommendedNextStep: "Vendedor ou suporte revisar manualmente as conversas sinalizadas." }
  });
}

if (outboundFailures.length || n(overdueOutbound[0]?.total) > 0 || followupFailures.length) {
  recommendations.push({
    title: "Fila de mensagens precisa de reparo",
    summary: `${outboundFailures.reduce((total, row) => total + n(row.total), 0)} falhas 24h; ${n(overdueOutbound[0]?.total)} pendentes vencidas.`,
    priority: "high",
    impactArea: "whatsapp_delivery",
    reasoning: "Falhas ou mensagens vencidas podem interromper bot, lembretes, follow-up e atendimento humano.",
    evidence: { outboundFailures, overdueOutbound: overdueOutbound[0], followupFailures },
    suggestedAction: { recommendedNextStep: "Rodar reparo de follow-ups, verificar numeros sem WhatsApp e reprocessar fila vencida." }
  });
}

if (n(health.site_24h) > 0 && n(health.attributed_site_24h) / n(health.site_24h) < 0.85) {
  recommendations.push({
    title: "Atribuicao dos leads do site caiu",
    summary: `${health.attributed_site_24h}/${health.site_24h} leads do site vieram com UTM/fbp/fbc/fbclid.`,
    priority: "medium",
    impactArea: "tracking",
    serviceInterest: "plano_carreira",
    reasoning: "Queda de atribuicao prejudica leitura de Meta e qualidade dos eventos CAPI.",
    evidence: { leadHealth: health },
    suggestedAction: { recommendedNextStep: "Conferir landing, parametros de anuncio e persistencia de fbp/fbc/fbclid." }
  });
}

if (n(health.unassigned_24h) > 0) {
  recommendations.push({
    title: "Leads recentes sem vendedor",
    summary: `${health.unassigned_24h} leads das ultimas 24h estao sem responsavel.`,
    priority: "medium",
    impactArea: "sales_distribution",
    reasoning: "Lead sem vendedor tende a ficar sem retorno e sem acompanhamento de agenda.",
    evidence: { leadHealth: health },
    suggestedAction: { recommendedNextStep: "Distribuir leads sem responsavel entre Sandro, Igor e Pablo conforme servico." }
  });
}

const crmQuality = n(qualityMap.QualifiedLead?.total) + n(qualityMap.Schedule?.total) + n(qualityMap.Purchase?.total) + n(qualityMap.purchase?.total);
const metaQuality = n(meta.qualified_leads) + n(meta.schedules) + n(meta.purchases);
if (crmQuality > 0 && metaQuality === 0) {
  recommendations.push({
    title: "Eventos de qualidade ainda nao aparecem na Meta",
    summary: `${crmQuality} eventos CRM 24h e 0 eventos de qualidade nos snapshots Meta.`,
    priority: "high",
    impactArea: "meta_learning",
    serviceInterest: "plano_carreira",
    reasoning: "O CRM esta gerando sinais de qualidade, mas a campanha ainda nao mostra esses eventos nos insights.",
    evidence: { qualityEvents, metaSnapshot: meta },
    suggestedAction: { recommendedNextStep: "Validar Events Manager, event match e action_type retornado pela Marketing API antes de escalar verba." }
  });
}

const meetingsNeedingMeetOpen = meetings.filter((row) => {
  const hasMeet = row.meet_url || meetUrl;
  const status = String(row.meet_access_open_status || "");
  return hasMeet && !row.meet_access_opened_at && !status.startsWith("opened");
});
if (meetingsNeedingMeetOpen.length && !process.env.GOOGLE_MEET_OAUTH_ACCESS_TOKEN) {
  recommendations.push({
    title: "Google Meet precisa de acesso aberto",
    summary: `${meetingsNeedingMeetOpen.length} reunioes recentes/proximas usam link Meet sem credencial para liberar sala.`,
    priority: "urgent",
    impactArea: "meeting_show_rate",
    reasoning: "O CRM envia link de Meet, mas sem integracao Google Meet/Calendar nao consegue alterar controle de entrada automaticamente.",
    evidence: {
      meetConfigured: true,
      hasGoogleMeetApiToken: false,
      sample: meetingsNeedingMeetOpen.slice(0, 12).map((row) => ({
        clientId: row.id,
        name: row.name,
        seller: row.seller_name,
        startsAt: row.starts_at,
        hasMeetUrl: Boolean(row.meet_url || meetUrl)
      }))
    },
    suggestedAction: {
      recommendedNextStep: "Configurar reunioes com Acesso rapido/aberto ou fornecer OAuth Google Meet para liberar automaticamente.",
      requiresGoogleWorkspaceAccess: true
    }
  });
}

const inserted = [];
for (const item of recommendations) {
  inserted.push(await insertRecommendation(pool, item));
}

await pool.end();

console.log(JSON.stringify({
  startedAt,
  finishedAt: new Date().toISOString(),
  bot,
  counts: {
    unanswered: unanswered.length,
    helpMessages: helpRows.length,
    outboundFailureGroups: outboundFailures.length,
    overdueOutbound: n(overdueOutbound[0]?.total),
    meetingsWindow: meetings.length,
    recommendations: recommendations.length,
    inserted: inserted.filter((item) => item.inserted).length
  },
  leadHealth: health,
  qualityEvents,
  metaSnapshot: meta,
  recommendations: inserted
}, null, 2));
