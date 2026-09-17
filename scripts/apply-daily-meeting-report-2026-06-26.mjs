import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";

const apply = process.argv.includes("--apply");
const graphVersion = process.env.META_GRAPH_VERSION || "v23.0";
const workStartMarker = "relatorio-diario-2026-06";

const serviceUrl = {
  plano_carreira: "https://ec10talentos.com/instagram",
  plano_internacional: "https://ec10talentos.com/instagram"
};

function brtIso(date, time) {
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function phoneCandidates(value) {
  const base = normalizePhone(value);
  const candidates = new Set([base, digitsOnly(value)]);

  if (base.startsWith("55") && base.length === 13 && base[4] === "9") {
    candidates.add(`${base.slice(0, 4)}${base.slice(5)}`);
  }

  if (base.startsWith("55") && base.length === 12) {
    candidates.add(`${base.slice(0, 4)}9${base.slice(4)}`);
  }

  return [...candidates].filter(Boolean);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

function compactMetaResponse(data, status) {
  if (!data || typeof data !== "object") return { status };
  return {
    status,
    events_received: data.events_received ?? null,
    messages: data.messages ?? null,
    fbtrace_id: data.fbtrace_id ?? data.error?.fbtrace_id ?? null,
    error_code: data.error?.code ?? null,
    error_message: data.error?.message ?? null
  };
}

function leadAgeGroup(age) {
  if (!Number.isFinite(age)) return null;
  if (age <= 13) return "8-13";
  if (age <= 17) return "14-17";
  return "18-plus";
}

function eventOccurredAt(entry) {
  return entry.meetingOccurredAt || `${entry.reportDate}T12:00:00-03:00`;
}

function mergeTags(existing, incoming) {
  return [...new Set([...(existing || []), ...incoming].filter(Boolean))];
}

const reportEntries = [
  {
    key: "carreira-filho-do-rei-2026-06-25-16",
    reportDate: "2026-06-26",
    sellerName: "Sandro",
    name: "Filho do Rei",
    preferredName: false,
    phone: "+55 11 96540-0756",
    serviceInterest: "plano_carreira",
    status: "aguardando_cliente",
    leadScore: 76,
    outcome: "meeting_attended_waiting_return",
    meetingOccurredAt: brtIso("2026-06-25", "16:00"),
    nextFollowUpAt: brtIso("2026-06-27", "12:00"),
    tags: ["plano_carreira", "reuniao_realizada", "aguardando_retorno", "sandro", workStartMarker],
    note: "Reuniao realizada em 25/06/2026 as 16h. Atleta recebeu as informacoes sobre o Plano de Carreira e segue aguardando posicionamento para continuidade.",
    metaEvents: []
  },
  {
    key: "carreira-joao-manzato-2026-06-26-14",
    reportDate: "2026-06-26",
    sellerName: "Sandro",
    name: "Joao Manzato",
    phone: "+55 67 99989-9167",
    serviceInterest: "plano_carreira",
    status: "perdido",
    leadScore: 24,
    outcome: "meeting_not_realized_no_advance",
    meetingOccurredAt: brtIso("2026-06-26", "14:00"),
    tags: ["plano_carreira", "reuniao_nao_realizada", "sem_avanco", "sandro", workStartMarker],
    note: "Reuniao nao realizada em 26/06/2026 as 14h. Nao foi possivel avancar na apresentacao do projeto.",
    metaEvents: []
  },
  {
    key: "carreira-matheus-cortes-2026-06-26-16",
    reportDate: "2026-06-26",
    sellerName: "Sandro",
    name: "Matheus Cortes",
    phone: "+55 71 98104-8945",
    serviceInterest: "plano_carreira",
    athleteAge: 16,
    status: "perdido",
    leadScore: 22,
    outcome: "no_show_no_response",
    meetingOccurredAt: brtIso("2026-06-26", "16:00"),
    tags: ["plano_carreira", "nao_compareceu", "sem_interacao", "sandro", workStartMarker],
    note: "Atleta de 16 anos nao respondeu as mensagens enviadas e nao compareceu a reuniao agendada em 26/06/2026 as 16h.",
    metaEvents: []
  },
  {
    key: "carreira-jaqueline-camila-caetano-2026-06-29-19",
    reportDate: "2026-06-26",
    sellerName: "Sandro",
    name: "Jaqueline Camila Caetano",
    phone: "+55 11 93944-1875",
    serviceInterest: "plano_carreira",
    athleteAge: 14,
    status: "quente",
    leadScore: 95,
    outcome: "rescheduled_high_interest",
    meetingStartsAt: brtIso("2026-06-29", "19:00"),
    meetingEndsAt: brtIso("2026-06-29", "20:00"),
    nextFollowUpAt: brtIso("2026-06-29", "18:30"),
    tags: ["plano_carreira", "reagendada", "alto_interesse", "sandro", workStartMarker],
    note: "Reuniao reagendada para 29/06/2026 as 19h. Responsavel pelo atleta de 14 anos demonstrou bastante interesse, fez perguntas sobre o funcionamento do programa e mostrou disposicao para continuidade.",
    metaEvents: [
      { eventName: "Schedule", leadStatus: "orcamento", qualityScore: 90 },
      { eventName: "QualifiedLead", leadStatus: "quente", qualityScore: 95 }
    ]
  },
  {
    key: "carreira-diego-neves-meneses-2026-06-26-16",
    reportDate: "2026-06-26",
    sellerName: "Sandro",
    name: "Diego Neves Meneses",
    preferredName: true,
    phone: "+55 11 96540-0756",
    serviceInterest: "plano_carreira",
    athleteAge: 16,
    status: "aguardando_cliente",
    leadScore: 84,
    outcome: "meeting_attended_presentation_completed",
    meetingOccurredAt: brtIso("2026-06-26", "16:00"),
    nextFollowUpAt: brtIso("2026-06-27", "16:00"),
    tags: ["plano_carreira", "reuniao_realizada", "apresentacao_concluida", "interessado", "sandro", workStartMarker],
    note: "Responsavel pelo atleta de 16 anos participou normalmente da apresentacao em 26/06/2026 as 16h, recebeu todas as informacoes do Plano de Carreira e demonstrou interesse em compreender o acompanhamento do atleta.",
    metaEvents: [
      { eventName: "QualifiedLead", leadStatus: "aguardando_cliente", qualityScore: 84 }
    ]
  },
  {
    key: "internacional-vitor-augusto-2026-06-23-18",
    reportDate: "2026-06-23",
    sellerName: "Igor",
    name: "Vitor Augusto de Sousa Santos",
    phone: "+55 17 99679-9870",
    serviceInterest: "plano_internacional",
    athleteAge: 18,
    status: "quente",
    leadScore: 98,
    outcome: "contracting_in_progress",
    meetingOccurredAt: brtIso("2026-06-23", "18:00"),
    nextFollowUpAt: brtIso("2026-06-27", "09:00"),
    tags: ["plano_internacional", "contratacao_em_andamento", "dados_contrato_enviados", "igor", workStartMarker],
    note: "Participou da reuniao de 23/06/2026 as 18h, demonstrou interesse no programa internacional, avancou para contratacao e ja enviou os dados para elaboracao do contrato.",
    metaEvents: [
      { eventName: "QualifiedLead", leadStatus: "quente", qualityScore: 98 }
    ]
  },
  {
    key: "internacional-gabriel-jose-2026-06-23-09",
    reportDate: "2026-06-23",
    sellerName: "Igor",
    name: "Gabriel Jose",
    phone: "+55 75 99956-3722",
    serviceInterest: "plano_internacional",
    status: "aguardando_cliente",
    leadScore: 82,
    outcome: "interested_payment_timeline_30_days",
    meetingOccurredAt: brtIso("2026-06-23", "09:00"),
    nextFollowUpAt: brtIso("2026-07-23", "09:00"),
    tags: ["plano_internacional", "interessado", "prazo_pagamento_30_dias", "igor", workStartMarker],
    note: "Participou da reuniao de 23/06/2026 as 9h, demonstrou interesse no programa internacional e informou que precisa de aproximadamente 30 dias para reunir o investimento.",
    metaEvents: [
      { eventName: "QualifiedLead", leadStatus: "aguardando_cliente", qualityScore: 82 }
    ]
  },
  {
    key: "internacional-maria-marlene-2026-06-23-10",
    reportDate: "2026-06-23",
    sellerName: "Igor",
    name: "Maria Marlene",
    phone: "+55 12 98852-5078",
    serviceInterest: "plano_internacional",
    status: "perdido",
    leadScore: 18,
    outcome: "no_show_no_response",
    meetingOccurredAt: brtIso("2026-06-23", "10:00"),
    tags: ["plano_internacional", "nao_compareceu", "sem_resposta", "igor", workStartMarker],
    note: "Foi aguardada por aproximadamente 20 minutos na reuniao de 23/06/2026 as 10h, nao compareceu e nao respondeu as mensagens no WhatsApp.",
    metaEvents: []
  },
  {
    key: "internacional-luciano-2026-06-23-15",
    reportDate: "2026-06-23",
    sellerName: "Igor",
    name: "Luciano",
    phone: "+55 68 99241-2620",
    serviceInterest: "plano_internacional",
    status: "orcamento",
    leadScore: 66,
    outcome: "reschedule_requested_connection_issue",
    meetingOccurredAt: brtIso("2026-06-23", "15:00"),
    nextFollowUpAt: brtIso("2026-06-27", "10:00"),
    tags: ["plano_internacional", "reagendamento_solicitado", "problema_internet", "igor", workStartMarker],
    note: "Entrou na reuniao de 23/06/2026 as 15h, informou problema de internet, nao abriu a camera e solicitou reagendamento.",
    metaEvents: []
  },
  {
    key: "internacional-raddatz-2026-06-23-18",
    reportDate: "2026-06-23",
    sellerName: "Igor",
    name: "Raddatz",
    phone: "+55 49 99184-9063",
    serviceInterest: "plano_internacional",
    status: "aguardando_cliente",
    leadScore: 45,
    outcome: "no_show_later_brazil_question_no_return",
    meetingOccurredAt: brtIso("2026-06-23", "18:00"),
    nextFollowUpAt: brtIso("2026-06-27", "11:00"),
    tags: ["plano_internacional", "nao_compareceu", "perguntou_brasil", "acompanhar", "igor", workStartMarker],
    note: "Nao entrou na reuniao de 23/06/2026 as 18h. Depois perguntou sobre oportunidades no Brasil; foi orientado sobre mercado europeu pela idade de 23 anos e nao respondeu ao novo convite de video ou ligacao.",
    metaEvents: []
  }
];

if (!process.env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL nao configurada.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: true
});

async function loadSellers(client) {
  const { rows } = await client.query(
    "select id, name, region, role, active from public.sellers where active = true"
  );
  return rows;
}

function findSeller(sellers, name) {
  const normalized = String(name || "").toLowerCase();
  return sellers.find((seller) => String(seller.name || "").toLowerCase().includes(normalized)) || null;
}

async function findClientByPhone(client, phone) {
  const candidates = phoneCandidates(phone);
  const { rows } = await client.query(
    `
      select *
      from public.clients
      where regexp_replace(phone, '\\D', '', 'g') = any($1::text[])
      order by updated_at desc
      limit 1
    `,
    [candidates]
  );

  return rows[0] || null;
}

async function upsertClient(client, entry, seller) {
  const normalizedPhone = normalizePhone(entry.phone);
  const existing = await findClientByPhone(client, entry.phone);
  const noteMarker = `[relatorio-diario:${entry.key}]`;
  const noteBlock = `${noteMarker}\n${entry.note}`;
  const metadataPatch = {
    athleteName: entry.athleteName ?? undefined,
    dailyReport: {
      key: entry.key,
      reportDate: entry.reportDate,
      sellerName: entry.sellerName,
      outcome: entry.outcome,
      serviceInterest: entry.serviceInterest,
      meetingOccurredAt: entry.meetingOccurredAt ?? null,
      meetingStartsAt: entry.meetingStartsAt ?? null
    },
    lastMeetingOutcome: entry.outcome,
    lastMeetingReportAt: new Date().toISOString()
  };

  if (entry.athleteAge) {
    metadataPatch.athleteAge = entry.athleteAge;
  }

  if (entry.meetingStartsAt) {
    metadataPatch.meeting = {
      startsAt: entry.meetingStartsAt,
      endsAt: entry.meetingEndsAt,
      dateLabel: "29/06/2026",
      timeLabel: "19:00",
      timezone: "America/Sao_Paulo"
    };
    metadataPatch.meetingSellerName = entry.sellerName;
  }

  const tags = mergeTags(existing?.tags, entry.tags);

  if (!apply) {
    return {
      client: existing || { id: "(novo)", phone: normalizedPhone, name: entry.name, attribution_metadata: {} },
      created: !existing,
      wouldUpdate: true,
      noteMarker,
      metadataPatch
    };
  }

  if (!existing) {
    const inserted = await client.query(
      `
        insert into public.clients
          (phone, name, status, region, assigned_seller_id, notes, tags, service_interest, source,
           next_follow_up_at, lead_score, attribution_metadata, last_message_at, updated_at)
        values
          ($1, $2, $3::public.lead_status, $4, $5, $6, $7::text[], $8, 'manual',
           $9, $10, $11::jsonb, now(), now())
        returning *
      `,
      [
        normalizedPhone,
        entry.name,
        entry.status,
        seller?.region || "brasil",
        seller?.id || null,
        noteBlock,
        tags,
        entry.serviceInterest,
        entry.nextFollowUpAt || null,
        entry.leadScore,
        JSON.stringify(metadataPatch)
      ]
    );
    return { client: inserted.rows[0], created: true, noteMarker, metadataPatch };
  }

  const updated = await client.query(
    `
      update public.clients
      set
        name = case
          when $12::boolean or nullif(name, '') is null then $2
          else name
        end,
        status = $3::public.lead_status,
        region = coalesce(region, $4),
        assigned_seller_id = coalesce($5::uuid, assigned_seller_id),
        notes = case
          when coalesce(notes, '') like '%' || $6 || '%' then notes
          else trim(both from concat_ws(E'\n\n', nullif(notes, ''), $7::text))
        end,
        tags = (
          select array_agg(distinct tag)
          from unnest(coalesce(tags, '{}'::text[]) || $8::text[]) as tag
        ),
        service_interest = $9,
        next_follow_up_at = coalesce($10::timestamptz, next_follow_up_at),
        lead_score = $11,
        attribution_metadata = coalesce(attribution_metadata, '{}'::jsonb) || $13::jsonb,
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      existing.id,
      entry.name,
      entry.status,
      seller?.region || "brasil",
      seller?.id || null,
      noteMarker,
      noteBlock,
      tags,
      entry.serviceInterest,
      entry.nextFollowUpAt || null,
      entry.leadScore,
      entry.preferredName !== false,
      JSON.stringify(metadataPatch)
    ]
  );

  return { client: updated.rows[0], created: false, noteMarker, metadataPatch };
}

async function upsertBotState(client, entry, savedClient) {
  const metadataPatch = {
    dailyReport: {
      key: entry.key,
      reportDate: entry.reportDate,
      sellerName: entry.sellerName,
      outcome: entry.outcome,
      note: entry.note
    },
    lastMeetingOutcome: entry.outcome,
    lastMeetingReportAt: new Date().toISOString()
  };

  if (entry.meetingStartsAt) {
    metadataPatch.meeting = {
      startsAt: entry.meetingStartsAt,
      endsAt: entry.meetingEndsAt,
      dateLabel: "29/06/2026",
      timeLabel: "19:00",
      timezone: "America/Sao_Paulo"
    };
    metadataPatch.meetingSellerName = entry.sellerName;
  } else if (entry.meetingOccurredAt) {
    metadataPatch.lastMeeting = {
      occurredAt: entry.meetingOccurredAt,
      outcome: entry.outcome,
      sellerName: entry.sellerName
    };
  }

  if (!apply) return false;

  await client.query(
    `
      insert into public.bot_conversation_states
        (client_id, phone, stage, service_interest, athlete_age, age_group, metadata, completed_at, updated_at)
      values
        ($1, $2, 'completed', $3, $4, $5, $6::jsonb, now(), now())
      on conflict (phone) do update
      set
        client_id = excluded.client_id,
        service_interest = coalesce(public.bot_conversation_states.service_interest, excluded.service_interest),
        athlete_age = coalesce(public.bot_conversation_states.athlete_age, excluded.athlete_age),
        age_group = coalesce(public.bot_conversation_states.age_group, excluded.age_group),
        metadata = coalesce(public.bot_conversation_states.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now()
    `,
    [
      savedClient.id,
      savedClient.phone,
      entry.serviceInterest,
      entry.athleteAge || null,
      leadAgeGroup(entry.athleteAge),
      JSON.stringify(metadataPatch)
    ]
  );

  return true;
}

async function findTrafficEvent(client, entry, eventName) {
  const { rows } = await client.query(
    `
      select id, metadata
      from public.traffic_events
      where metadata ->> 'reportKey' = $1
        and coalesce(metadata ->> 'metaEventName', event_type) = $2
      order by created_at desc
      limit 1
    `,
    [entry.key, eventName]
  );
  return rows[0] || null;
}

async function acceptedMetaAlreadyRecorded(client, entry, eventName) {
  const event = await findTrafficEvent(client, entry, eventName);
  return Boolean(event?.metadata?.metaAccepted);
}

async function insertTrafficEvent(client, savedClient, entry, eventType, eventMeta = {}) {
  if (!apply) return false;
  const existing = await findTrafficEvent(client, entry, eventType);
  const metadata = {
    source: "daily_meeting_report",
    reportKey: entry.key,
    reportDate: entry.reportDate,
    sellerName: entry.sellerName,
    outcome: entry.outcome,
    metaEventName: eventMeta.metaEventName || eventType,
    metaSent: Boolean(eventMeta.metaSent),
    metaAccepted: Boolean(eventMeta.metaAccepted),
    metaResponse: eventMeta.metaResponse || null
  };

  if (existing) {
    if (!eventMeta.metaSent) return false;
    await client.query(
      `
        update public.traffic_events
        set
          platform = 'meta_ads',
          lead_status = $2,
          quality_score = $3,
          metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb,
          occurred_at = $5,
          created_at = created_at
        where id = $1
      `,
      [
        existing.id,
        eventMeta.leadStatus || entry.status,
        eventMeta.qualityScore || entry.leadScore,
        JSON.stringify(metadata),
        eventOccurredAt(entry)
      ]
    );
    return true;
  }

  await client.query(
    `
      insert into public.traffic_events
        (client_id, phone, event_type, channel, platform, service_interest, athlete_age, age_group,
         lead_status, quality_score, campaign_id, campaign_name, adset_id, ad_id, utm_source,
         utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, metadata, occurred_at)
      values
        ($1, $2, $3, 'crm', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22)
    `,
    [
      savedClient.id,
      savedClient.phone,
      eventType,
      eventMeta.metaSent ? "meta_ads" : "crm",
      entry.serviceInterest,
      entry.athleteAge || null,
      leadAgeGroup(entry.athleteAge),
      eventMeta.leadStatus || entry.status,
      eventMeta.qualityScore || entry.leadScore,
      savedClient.traffic_campaign_id || null,
      savedClient.traffic_campaign_name || null,
      savedClient.traffic_adset_id || null,
      savedClient.traffic_ad_id || null,
      savedClient.utm_source || null,
      savedClient.utm_medium || null,
      savedClient.utm_campaign || null,
      savedClient.utm_content || null,
      savedClient.utm_term || null,
      savedClient.fbclid || null,
      savedClient.gclid || null,
      JSON.stringify(metadata),
      eventOccurredAt(entry)
    ]
  );
  return true;
}

async function sendMetaEvent(savedClient, entry, metaEvent) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return { skipped: true, ok: false, response: { status: "missing_meta_env" } };
  }

  const metadata = savedClient.attribution_metadata || {};
  const eventTime = Math.floor(new Date(eventOccurredAt(entry)).getTime() / 1000);
  const eventId = `daily-report-${entry.key}-${metaEvent.eventName}-${savedClient.id}`;
  const sourceUrl = metadata.eventSourceUrl || metadata.landingUrl || metadata.landing_url || serviceUrl[entry.serviceInterest];
  const userData = {
    ph: [sha256(savedClient.phone)],
    external_id: [sha256(savedClient.id)]
  };

  if (metadata.fbp) userData.fbp = metadata.fbp;
  if (metadata.fbc) userData.fbc = metadata.fbc;
  if (savedClient.fbclid && !userData.fbc) {
    userData.fbc = `fb.1.${eventTime}.${savedClient.fbclid}`;
  }

  const payload = {
    data: [
      {
        event_name: metaEvent.eventName,
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        event_source_url: sourceUrl,
        user_data: userData,
        custom_data: {
          content_name: entry.serviceInterest === "plano_carreira" ? "Plano de Carreira" : "Plano Internacional",
          content_category: "EC10 Talentos",
          lead_status: metaEvent.leadStatus,
          service_interest: entry.serviceInterest,
          lead_score: metaEvent.qualityScore,
          seller_name: entry.sellerName,
          daily_report_outcome: entry.outcome
        }
      }
    ]
  };

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, access_token: accessToken })
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  const compact = compactMetaResponse(data, response.status);
  return {
    skipped: false,
    ok: response.ok && !data?.error && Number(data?.events_received || 0) > 0,
    response: compact
  };
}

async function main() {
  const client = await pool.connect();
  const summary = {
    mode: apply ? "apply" : "dry-run",
    matched: 0,
    created: 0,
    updated: 0,
    botStates: 0,
    trafficEvents: 0,
    metaPlanned: 0,
    metaAccepted: 0,
    metaSkipped: 0,
    metaFailed: 0,
    rows: []
  };

  try {
    const sellers = await loadSellers(client);
    if (apply) await client.query("begin");

    for (const entry of reportEntries) {
      const seller = findSeller(sellers, entry.sellerName);
      const result = await upsertClient(client, entry, seller);
      const savedClient = result.client;

      if (result.created) summary.created += 1;
      else summary.matched += 1;
      if (!result.created) summary.updated += 1;

      if (await upsertBotState(client, entry, savedClient)) summary.botStates += 1;

      const internalEvent = `daily_report_${entry.outcome}`;
      if (await insertTrafficEvent(client, savedClient, entry, internalEvent)) summary.trafficEvents += 1;

      const row = {
        key: entry.key,
        clientId: savedClient.id,
        phone: savedClient.phone,
        name: entry.name,
        seller: seller?.name || "(vendedor nao encontrado)",
        status: entry.status,
        meta: []
      };

      for (const metaEvent of entry.metaEvents) {
        summary.metaPlanned += 1;
        if (!apply) {
          row.meta.push({ eventName: metaEvent.eventName, planned: true });
          continue;
        }

        if (await acceptedMetaAlreadyRecorded(client, entry, metaEvent.eventName)) {
          summary.metaSkipped += 1;
          row.meta.push({ eventName: metaEvent.eventName, skipped: "already_recorded" });
          continue;
        }

        const metaResult = await sendMetaEvent(savedClient, entry, metaEvent);
        if (metaResult.skipped) summary.metaSkipped += 1;
        else if (metaResult.ok) summary.metaAccepted += 1;
        else summary.metaFailed += 1;

        const inserted = await insertTrafficEvent(client, savedClient, entry, metaEvent.eventName, {
          metaEventName: metaEvent.eventName,
          metaSent: !metaResult.skipped,
          metaAccepted: metaResult.ok,
          metaResponse: metaResult.response,
          leadStatus: metaEvent.leadStatus,
          qualityScore: metaEvent.qualityScore
        });
        if (inserted) summary.trafficEvents += 1;

        row.meta.push({
          eventName: metaEvent.eventName,
          accepted: metaResult.ok,
          response: metaResult.response
        });
      }

      summary.rows.push(row);
    }

    if (apply) await client.query("commit");
  } catch (error) {
    if (apply) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
