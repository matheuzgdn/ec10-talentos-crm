import { pool } from "./_db.js";

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type TrafficContext = {
  periodDays: number;
  metrics: {
    totalLeads: number;
    whatsappLeads: number;
    careerLeads: number;
    internationalLeads: number;
    hotLeads: number;
    proposals: number;
    closed: number;
    lost: number;
    averageScore: number;
    conversionRate: number;
    hotRate: number;
  };
  eventCounts: Array<{ eventType: string; total: number }>;
  ageGroups: Array<{ ageGroup: string; total: number }>;
  recentEvents: any[];
  recommendations: any[];
  drafts: any[];
  snapshots: any[];
};

export type TrafficRecommendationInput = {
  title: string;
  summary: string;
  recommendationType?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  confidence?: number;
  impactArea?: string;
  serviceInterest?: string | null;
  ageGroup?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  reasoning?: string | null;
  evidence?: Record<string, unknown>;
  suggestedAction?: Record<string, unknown>;
};

function asNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function clampConfidence(value: unknown) {
  const numberValue = Math.round(asNumber(value));
  return Math.max(0, Math.min(100, numberValue || 60));
}

async function safeRows(queryable: Queryable, sql: string, params: unknown[] = []) {
  try {
    return (await queryable.query(sql, params)).rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not exist")) return [];
    throw error;
  }
}

export async function loadTrafficContext(periodDaysInput = 30): Promise<TrafficContext> {
  const periodDays = Math.max(1, Math.min(180, Math.round(periodDaysInput || 30)));

  const metricsRows = (await pool.query(
    `
      select
        count(*)::int as total_leads,
        count(*) filter (where source = 'whatsapp')::int as whatsapp_leads,
        count(*) filter (where service_interest = 'plano_carreira')::int as career_leads,
        count(*) filter (where service_interest = 'plano_internacional')::int as international_leads,
        count(*) filter (where status = 'quente')::int as hot_leads,
        count(*) filter (where status = 'orcamento')::int as proposals,
        count(*) filter (where status = 'fechado')::int as closed,
        count(*) filter (where status = 'perdido')::int as lost,
        coalesce(avg(lead_score), 0)::numeric(10,2) as average_score
      from public.clients
      where created_at >= now() - ($1::int * interval '1 day')
    `,
    [periodDays]
  )).rows;

  const eventCounts = await safeRows(
    pool,
    `
      select event_type, count(*)::int as total
      from public.traffic_events
      where occurred_at >= now() - ($1::int * interval '1 day')
      group by event_type
      order by total desc, event_type asc
    `,
    [periodDays]
  );

  const ageGroups = await safeRows(
    pool,
    `
      select coalesce(age_group, 'sem_faixa') as age_group, count(*)::int as total
      from public.traffic_events
      where occurred_at >= now() - ($1::int * interval '1 day')
        and event_type in ('bot_age_captured', 'bot_link_sent', 'qualified_lead', 'purchase')
      group by coalesce(age_group, 'sem_faixa')
      order by total desc
    `,
    [periodDays]
  );

  const recentEvents = await safeRows(
    pool,
    `
      select id, client_id, phone, event_type, channel, platform, service_interest,
             athlete_age, age_group, lead_status, quality_score, campaign_name,
             metadata, occurred_at
      from public.traffic_events
      order by occurred_at desc
      limit 40
    `
  );

  const recommendations = await safeRows(
    pool,
    `
      select id, title, summary, recommendation_type, priority, status, confidence,
             impact_area, service_interest, age_group, campaign_id, campaign_name,
             reasoning, evidence, suggested_action, created_at
      from public.traffic_agent_recommendations
      order by created_at desc
      limit 20
    `
  );

  const drafts = await safeRows(
    pool,
    `
      select id, name, objective, status, platform, service_interest, budget_daily,
             budget_total, age_min, age_max, locations, interests, placements,
             destination_url, whatsapp_message, copy_text, creative_notes,
             ai_rationale, meta_payload, created_at, updated_at
      from public.traffic_campaign_drafts
      order by created_at desc
      limit 20
    `
  );

  const snapshots = await safeRows(
    pool,
    `
      select campaign_id, campaign_name, status,
             sum(spend)::numeric(12,2) as spend,
             sum(impressions)::int as impressions,
             sum(clicks)::int as clicks,
             sum(leads)::int as leads,
             sum(qualified_leads)::int as qualified_leads,
             sum(proposals)::int as proposals,
             sum(purchases)::int as purchases,
             max(created_at) as last_synced_at
      from public.traffic_campaign_snapshots
      where date_start >= current_date - ($1::int * interval '1 day')
      group by campaign_id, campaign_name, status
      order by spend desc nulls last
      limit 12
    `,
    [periodDays]
  );

  const rawMetrics = metricsRows[0] ?? {};
  const totalLeads = asNumber(rawMetrics.total_leads);
  const hotLeads = asNumber(rawMetrics.hot_leads);
  const closed = asNumber(rawMetrics.closed);

  return {
    periodDays,
    metrics: {
      totalLeads,
      whatsappLeads: asNumber(rawMetrics.whatsapp_leads),
      careerLeads: asNumber(rawMetrics.career_leads),
      internationalLeads: asNumber(rawMetrics.international_leads),
      hotLeads,
      proposals: asNumber(rawMetrics.proposals),
      closed,
      lost: asNumber(rawMetrics.lost),
      averageScore: asNumber(rawMetrics.average_score),
      conversionRate: totalLeads ? Number(((closed / totalLeads) * 100).toFixed(1)) : 0,
      hotRate: totalLeads ? Number(((hotLeads / totalLeads) * 100).toFixed(1)) : 0
    },
    eventCounts: eventCounts.map((row) => ({
      eventType: row.event_type,
      total: asNumber(row.total)
    })),
    ageGroups: ageGroups.map((row) => ({
      ageGroup: row.age_group,
      total: asNumber(row.total)
    })),
    recentEvents,
    recommendations,
    drafts,
    snapshots
  };
}

export function buildFallbackRecommendations(context: TrafficContext): TrafficRecommendationInput[] {
  const events = Object.fromEntries(context.eventCounts.map((item) => [item.eventType, item.total]));
  const topAgeGroup = context.ageGroups[0]?.ageGroup ?? "8-17";
  const hasSnapshots = context.snapshots.length > 0;
  const linkSent = asNumber(events.bot_link_sent);
  const qualified = asNumber(events.qualified_lead);
  const inbound = asNumber(events.whatsapp_inbound);
  const botAge = asNumber(events.bot_age_captured);

  const recommendations: TrafficRecommendationInput[] = [];

  if (!hasSnapshots) {
    recommendations.push({
      title: "Comecar trafego em modo aprendizado controlado",
      summary: "Criar uma campanha de WhatsApp/lead page pausada para validar publico, criativo e qualidade antes de escalar.",
      recommendationType: "campaign_draft",
      priority: "high",
      confidence: 78,
      impactArea: "cold_traffic",
      serviceInterest: "plano_carreira",
      ageGroup: topAgeGroup === "18-plus" ? "18-plus" : "8-17",
      reasoning: "Ainda nao ha snapshots de campanhas no CRM. A primeira fase deve priorizar aprendizado, coleta de eventos e controle de orcamento.",
      evidence: { snapshots: context.snapshots.length, totalLeads: context.metrics.totalLeads, topAgeGroup },
      suggestedAction: {
        action: "create_draft_campaign",
        status: "paused_until_approval",
        objective: "OUTCOME_LEADS",
        serviceInterest: "plano_carreira"
      }
    });
  }

  if (inbound > botAge + 3) {
    recommendations.push({
      title: "Recuperar leads que iniciaram e nao informaram idade",
      summary: "Abrir fila de remarketing e follow-up para quem chamou no WhatsApp mas parou antes da idade do atleta.",
      recommendationType: "remarketing",
      priority: "high",
      confidence: 82,
      impactArea: "top_funnel",
      reasoning: "O volume de entradas no WhatsApp esta acima dos registros de idade capturada pelo bot.",
      evidence: { whatsappInbound: inbound, agesCaptured: botAge },
      suggestedAction: {
        action: "segment_and_follow_up",
        segment: "whatsapp_started_no_age",
        message: "retomar_triagem_idade"
      }
    });
  }

  if (linkSent > qualified + 2) {
    recommendations.push({
      title: "Ativar sequencia para quem recebeu valores",
      summary: "Criar rotina comercial para leads que receberam a pagina certa, mas ainda nao viraram quente ou orcamento.",
      recommendationType: "crm_automation",
      priority: "medium",
      confidence: 74,
      impactArea: "middle_funnel",
      serviceInterest: "plano_carreira",
      ageGroup: topAgeGroup,
      reasoning: "A diferenca entre links enviados e qualificados indica oportunidade de follow-up e prova social.",
      evidence: { linksSent: linkSent, qualifiedLeads: qualified },
      suggestedAction: {
        action: "seller_follow_up_queue",
        segment: "link_sent_not_qualified",
        slaHours: 4
      }
    });
  }

  if (context.metrics.hotLeads > 0 || qualified > 0) {
    recommendations.push({
      title: "Criar publico de qualidade para retroalimentar o Meta",
      summary: "Usar leads quentes, orcamentos e fechamentos como sinal principal de cliente ideal.",
      recommendationType: "quality_signal",
      priority: "high",
      confidence: 80,
      impactArea: "meta_learning",
      reasoning: "A Meta deve aprender com qualidade e fechamento, nao apenas com clique ou conversa iniciada.",
      evidence: {
        hotLeads: context.metrics.hotLeads,
        proposals: context.metrics.proposals,
        closed: context.metrics.closed,
        qualifiedEvents: qualified
      },
      suggestedAction: {
        action: "send_quality_events",
        events: ["QualifiedLead", "Schedule", "Purchase"],
        approvalRequired: true
      }
    });
  }

  return recommendations.slice(0, 4);
}

function normalizeRecommendation(item: any): TrafficRecommendationInput | null {
  if (!item || typeof item !== "object") return null;
  const title = String(item.title ?? item.titulo ?? "").trim();
  const summary = String(item.summary ?? item.resumo ?? item.description ?? "").trim();
  if (!title || !summary) return null;

  const priority = String(item.priority ?? item.prioridade ?? "medium").toLowerCase();
  const validPriority = ["low", "medium", "high", "urgent"].includes(priority)
    ? (priority as TrafficRecommendationInput["priority"])
    : "medium";

  return {
    title,
    summary,
    recommendationType: String(item.recommendationType ?? item.recommendation_type ?? item.tipo ?? "analysis"),
    priority: validPriority,
    confidence: clampConfidence(item.confidence ?? item.confianca ?? 60),
    impactArea: String(item.impactArea ?? item.impact_area ?? item.area ?? "traffic"),
    serviceInterest: item.serviceInterest ?? item.service_interest ?? null,
    ageGroup: item.ageGroup ?? item.age_group ?? null,
    campaignId: item.campaignId ?? item.campaign_id ?? null,
    campaignName: item.campaignName ?? item.campaign_name ?? null,
    reasoning: item.reasoning ?? item.racional ?? item.justificativa ?? null,
    evidence: typeof item.evidence === "object" && item.evidence ? item.evidence : {},
    suggestedAction: typeof item.suggestedAction === "object" && item.suggestedAction
      ? item.suggestedAction
      : typeof item.suggested_action === "object" && item.suggested_action
        ? item.suggested_action
        : {}
  };
}

function extractJsonPayload(raw: any) {
  if (typeof raw === "object" && raw) return raw;
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveBase44AgentUrls(endpoint: string) {
  const base = endpoint.trim().replace(/\/$/, "");
  const urls = [base];

  if (!/\/conversation(s)?$/i.test(base)) {
    urls.push(`${base}/conversation`);
    urls.push(`${base}/conversations`);
  }

  if (/\/conversations$/i.test(base)) {
    urls.push(base.replace(/\/conversations$/i, "/conversation"));
  }

  return uniqueValues(urls);
}

function resolveBase44SuperagentBase(endpoint: string) {
  return endpoint
    .trim()
    .replace(/\/$/, "")
    .replace(/\/conversations\/[^/]+\/messages$/i, "")
    .replace(/\/conversations$/i, "")
    .replace(/\/conversation$/i, "");
}

function extractBase44Content(payload: any) {
  if (!payload || typeof payload !== "object") return payload;

  const lastAssistantMessage = Array.isArray(payload.messages)
    ? [...payload.messages].reverse().find((message) => message?.role === "assistant")
    : null;

  return payload.content
    ?? payload.answer
    ?? payload.response
    ?? payload.output
    ?? payload.output_text
    ?? payload.result
    ?? payload.data?.content
    ?? payload.message?.content
    ?? lastAssistantMessage?.content
    ?? payload;
}

async function readBase44Payload(response: Response) {
  return response.json().catch(async () => ({ content: await response.text() }));
}

function extractRecommendations(payload: any) {
  const content = extractBase44Content(payload);
  const parsed = extractJsonPayload(content);
  const list = Array.isArray(parsed?.recommendations)
    ? parsed.recommendations
    : Array.isArray(parsed)
      ? parsed
      : [];

  return list.map(normalizeRecommendation).filter(Boolean) as TrafficRecommendationInput[];
}

export async function callBase44TrafficAgent(context: TrafficContext) {
  const endpoint = process.env.BASE44_TRAFFIC_AGENT_URL;
  const apiKey = process.env.BASE44_TRAFFIC_AGENT_API_KEY;
  if (!endpoint || !apiKey) return null;

  const prompt = [
    "Voce e a IA gestora de trafego da EC10 Talentos.",
    "Analise o CRM, WhatsApp, funil e sinais de qualidade para indicar campanhas, remarketing e prioridades comerciais.",
    "Nunca recomende publicar ou gastar sem aprovacao humana no CRM.",
    "Responda somente JSON valido no formato:",
    "{\"recommendations\":[{\"title\":\"...\",\"summary\":\"...\",\"recommendationType\":\"campaign_draft|remarketing|quality_signal|crm_automation|budget_shift\",\"priority\":\"low|medium|high|urgent\",\"confidence\":0,\"impactArea\":\"...\",\"serviceInterest\":\"plano_carreira|plano_internacional|ambos\",\"ageGroup\":\"8-12|13-17|8-13|14-17|18-plus|8-17\",\"reasoning\":\"...\",\"evidence\":{},\"suggestedAction\":{}}]}",
    `Contexto: ${JSON.stringify(context)}`
  ].join("\n");

  const bodies = [
    { role: "user", content: prompt },
    { messages: [{ role: "user", content: prompt }] },
    { prompt }
  ];

  let lastStatus = 0;
  let lastError = "";

  const superagentBase = resolveBase44SuperagentBase(endpoint);
  try {
    const conversationResponse = await fetch(`${superagentBase}/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        api_key: apiKey,
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        metadata: {
          source: "cliente-whatsapp-crm",
          periodDays: context.periodDays
        }
      }),
      signal: AbortSignal.timeout(25000)
    });

    lastStatus = conversationResponse.status;
    if (conversationResponse.ok) {
      const conversation = await readBase44Payload(conversationResponse);
      const conversationId = conversation?.id;
      if (conversationId) {
        const messageResponse = await fetch(`${superagentBase}/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            api_key: apiKey,
            "x-api-key": apiKey
          },
          body: JSON.stringify({ role: "user", content: prompt }),
          signal: AbortSignal.timeout(45000)
        });

        lastStatus = messageResponse.status;
        if (messageResponse.ok) {
          const messagePayload = await readBase44Payload(messageResponse);
          const recommendations = extractRecommendations(messagePayload);
          if (recommendations.length) return recommendations;
        } else {
          lastError = await messageResponse.text().catch(() => "");
        }
      }
    } else {
      lastError = await conversationResponse.text().catch(() => "");
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  for (const url of resolveBase44AgentUrls(endpoint)) {
    for (const body of bodies) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          api_key: apiKey,
          "x-api-key": apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000)
      });

      lastStatus = response.status;
      if (!response.ok) {
        lastError = await response.text().catch(() => "");
        if ([400, 404, 405, 415, 422].includes(response.status)) continue;
        throw new Error("A IA de trafego nao respondeu corretamente.");
      }

      const payload = await readBase44Payload(response);
      const recommendations = extractRecommendations(payload);
      if (recommendations.length) return recommendations;
    }
  }

  throw new Error(`A IA de trafego nao respondeu corretamente. Status: ${lastStatus || "sem resposta"}. ${lastError ? "Formato nao aceito." : ""}`);
}

export async function insertTrafficRecommendations(
  queryable: Queryable,
  sellerId: string,
  recommendations: TrafficRecommendationInput[]
) {
  const inserted: any[] = [];

  for (const item of recommendations) {
    const { rows } = await queryable.query(
      `
        insert into public.traffic_agent_recommendations
          (title, summary, recommendation_type, priority, status, confidence,
           impact_area, service_interest, age_group, campaign_id, campaign_name,
           reasoning, evidence, suggested_action, created_by)
        values
          ($1, $2, $3, $4, 'pending_approval', $5,
           $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)
        returning id, title, summary, recommendation_type, priority, status, confidence,
                  impact_area, service_interest, age_group, campaign_id, campaign_name,
                  reasoning, evidence, suggested_action, created_at
      `,
      [
        item.title,
        item.summary,
        item.recommendationType ?? "analysis",
        item.priority ?? "medium",
        clampConfidence(item.confidence),
        item.impactArea ?? "traffic",
        item.serviceInterest ?? null,
        item.ageGroup ?? null,
        item.campaignId ?? null,
        item.campaignName ?? null,
        item.reasoning ?? null,
        JSON.stringify(item.evidence ?? {}),
        JSON.stringify(item.suggestedAction ?? {}),
        sellerId
      ]
    );
    inserted.push(rows[0]);
  }

  return inserted;
}
