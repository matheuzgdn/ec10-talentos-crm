import { ensureSeller, handleApiError, HttpError } from "./_auth.js";
import { pool } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";
import {
  buildFallbackRecommendations,
  callBase44TrafficAgent,
  callOllamaTrafficAgent,
  insertTrafficRecommendations,
  loadTrafficContext
} from "./_traffic.js";

const serviceNames: Record<string, string> = {
  plano_carreira: "Plano de Carreira",
  plano_internacional: "Plano Internacional",
  ambos: "Carreira + Internacional",
  nao_definido: "EC10"
};

const allowedDraftStatuses = new Set(["draft", "pending_approval", "approved", "rejected"]);
const publishableDraftStatuses = new Set(["approved", "failed"]);

const draftSelect = `
  id, name, objective, status, platform, service_interest, budget_daily,
  budget_total, age_min, age_max, locations, interests, placements,
  destination_url, whatsapp_message, copy_text, creative_notes,
  ai_rationale, meta_payload, meta_campaign_id, meta_adset_id,
  meta_creative_id, meta_ad_id, publish_error, published_at,
  created_at, updated_at
`;

function asMoney(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAdAccount(input: string) {
  const clean = input.trim();
  if (!clean) return "";
  return clean.startsWith("act_") ? clean : `act_${clean}`;
}

function normalizeMetaError(payload: any) {
  const error = payload?.error;
  const userMessage = error?.error_user_msg ?? error?.error_user_title;
  const message = userMessage ?? error?.message ?? payload?.message;
  if (!message) return "Meta Ads retornou erro sem mensagem.";
  return String(message).slice(0, 500);
}

async function postMeta(graphVersion: string, path: string, accessToken: string, body: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  params.set("access_token", accessToken);

  const metaResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(30000)
  });
  const payload = await metaResponse.json().catch(async () => ({ message: await metaResponse.text() }));

  if (!metaResponse.ok) {
    throw new Error(normalizeMetaError(payload));
  }

  return payload;
}

function actionValue(actions: any[] | undefined, names: string[]) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((item) => names.includes(String(item.action_type ?? "")))
    .reduce((sum, item) => sum + asNumber(item.value), 0);
}

function ageRange(ageGroup: string, serviceInterest: string) {
  if (ageGroup === "8-12") return { ageMin: 28, ageMax: 54, athleteAge: "8 a 12" };
  if (ageGroup === "13-17") return { ageMin: 30, ageMax: 56, athleteAge: "13 a 17" };
  if (ageGroup === "8-13") return { ageMin: 28, ageMax: 54, athleteAge: "8 a 13" };
  if (ageGroup === "14-17") return { ageMin: 30, ageMax: 56, athleteAge: "14 a 17" };
  if (ageGroup === "18-plus") return { ageMin: 18, ageMax: 28, athleteAge: "18+" };
  if (serviceInterest === "plano_internacional") return { ageMin: 18, ageMax: 28, athleteAge: "18+" };
  return { ageMin: 28, ageMax: 56, athleteAge: "8 a 17" };
}

function buildLocations(region: string) {
  const text = region.trim();
  if (!text || text.toLowerCase() === "brasil") return ["Brasil"];
  if (text.toLowerCase().includes("bh") || text.toLowerCase().includes("belo horizonte")) {
    return ["Belo Horizonte + 40 km", "Minas Gerais"];
  }
  return [text];
}

function buildInterests(serviceInterest: string, ageGroup: string) {
  const base = ["futebol", "treinamento esportivo", "alto rendimento", "preparacao fisica"];
  if (serviceInterest === "plano_internacional" || ageGroup === "18-plus") {
    return [...base, "futebol europeu", "intercambio esportivo", "atleta profissional"];
  }

  return [...base, "futebol de base", "escola de futebol", "campeonato de futebol", "pais de atleta"];
}

function buildDestination(serviceInterest: string, ageGroup: string, name: string) {
  const baseUrl = ageGroup === "18-plus" || serviceInterest === "plano_internacional"
    ? "https://ec10talentos.com/"
    : "https://ec10talentos.com/instagram";
  const url = new URL(baseUrl);
  url.searchParams.set("utm_source", "meta");
  url.searchParams.set("utm_medium", "paid_social");
  url.searchParams.set("utm_campaign", name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  url.searchParams.set("utm_content", "{{ad.name}}");
  url.searchParams.set("utm_term", "{{adset.name}}");
  url.searchParams.set("origem", "meta_ads");
  if (ageGroup && ageGroup !== "8-17") url.searchParams.set("faixa", ageGroup);
  url.hash = ageGroup === "18-plus" || serviceInterest === "plano_internacional" ? "plans" : "planos";
  return url.toString().replace(/%7B%7B/g, "{{").replace(/%7D%7D/g, "}}");
}

function buildCampaignDraft(input: {
  serviceInterest: string;
  ageGroup: string;
  region: string;
  budgetDaily: number | null;
  budgetTotal: number | null;
  goal: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const serviceLabel = serviceNames[input.serviceInterest] ?? serviceNames.plano_carreira;
  const range = ageRange(input.ageGroup, input.serviceInterest);
  const locations = buildLocations(input.region);
  const interests = buildInterests(input.serviceInterest, input.ageGroup);
  const name = `EC10 | ${serviceLabel} | ${range.athleteAge} | ${locations[0]} | ${today}`;
  const destinationUrl = buildDestination(input.serviceInterest, input.ageGroup, name);
  const isInternational = input.serviceInterest === "plano_internacional" || input.ageGroup === "18-plus";
  const pixelId = process.env.META_PIXEL_ID || "{{META_PIXEL_ID}}";
  const copyText = isInternational
    ? "Atleta com sonho internacional precisa de rota, avaliacao e plano real. Fale com a EC10."
    : "Seu filho joga futebol? A EC10 monta o plano de carreira para orientar evolucao, visibilidade e oportunidades.";
  const whatsappMessage = isInternational
    ? "Ola, quero entender o plano internacional da EC10."
    : "Ola, quero entender o Plano de Carreira da EC10 para meu filho.";

  return {
    name,
    objective: "OUTCOME_LEADS",
    status: "draft",
    platform: "meta_ads",
    serviceInterest: input.serviceInterest,
    ageMin: range.ageMin,
    ageMax: range.ageMax,
    locations,
    interests,
    placements: ["facebook_feed", "instagram_feed", "instagram_reels", "instagram_stories"],
    destinationUrl,
    whatsappMessage,
    copyText,
    creativeNotes: isInternational
      ? "Criativo com atleta em contexto profissional, foco em oportunidade internacional e preparacao."
      : "Criativo para pais/responsaveis, foco em direcao de carreira e seguranca na escolha.",
    aiRationale: [
      `Objetivo: ${input.goal || "gerar conversas qualificadas"}.`,
      `Faixa trabalhada: atleta ${range.athleteAge}, decisor Meta ${range.ageMin}-${range.ageMax}.`,
      "Status mantido como rascunho para aprovacao antes de qualquer publicacao ou gasto."
    ].join(" "),
    metaPayload: {
      campaign: {
        name,
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        buying_type: "AUCTION",
        special_ad_categories: [],
        is_adset_budget_sharing_enabled: false
      },
      adset: {
        name: `${name} | Publico principal`,
        optimization_goal: "OFFSITE_CONVERSIONS",
        billing_event: "IMPRESSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        daily_budget_cents: input.budgetDaily ? Math.round(input.budgetDaily * 100) : null,
        lifetime_budget_cents: input.budgetTotal ? Math.round(input.budgetTotal * 100) : null,
        promoted_object: {
          pixel_id: pixelId,
          custom_event_type: "LEAD"
        },
        targeting: {
          geo_locations: { countries: ["BR"] },
          age_min: range.ageMin,
          age_max: range.ageMax,
          publisher_platforms: ["facebook", "instagram"],
          targeting_automation: { advantage_audience: 1 }
        }
      },
      ad: {
        name: `${name} | Anuncio principal`,
        destination_url: destinationUrl,
        message: whatsappMessage,
        body: copyText
      },
      safety: {
        publish_requires_manual_approval: true,
        created_as: "crm_draft_only",
        qualified_signal_required: ["Lead", "QualifiedLead", "Schedule", "Purchase"],
        do_not_use_legacy_saved_audiences: true
      }
    }
  };
}

async function listDrafts(response: any) {
  const { rows } = await pool.query(
    `
      select ${draftSelect}
      from whatsapp_bot.traffic_campaign_drafts
      order by created_at desc
      limit 30
    `
  );
  response.setHeader("cache-control", "no-store");
  response.status(200).json({ drafts: rows });
}

async function listRecommendations(response: any) {
  const { rows } = await pool.query(
    `
      select id, title, summary, recommendation_type, priority, status, confidence,
             impact_area, service_interest, age_group, campaign_id, campaign_name,
             reasoning, evidence, suggested_action, created_at
      from whatsapp_bot.traffic_agent_recommendations
      order by created_at desc
      limit 30
    `
  );
  response.setHeader("cache-control", "no-store");
  response.status(200).json({ recommendations: rows });
}

async function createRecommendations(request: any, response: any) {
  const { seller } = await ensureSeller(request, { requireActive: true, requireAdmin: true });
  const periodDays = Number(request.body?.periodDays ?? 30);
  const provider = String(request.body?.provider ?? process.env.TRAFFIC_AI_PROVIDER ?? "local").toLowerCase();
  const context = await loadTrafficContext(periodDays);

  let usedAgent = false;
  let usedProvider = "local";
  let recommendations = null;

  if (provider === "ollama") {
    try {
      recommendations = await callOllamaTrafficAgent(context);
      usedAgent = Boolean(recommendations?.length);
      if (usedAgent) usedProvider = "ollama";
    } catch {
      recommendations = null;
    }
  } else if (provider === "base44") {
    try {
      recommendations = await callBase44TrafficAgent(context);
      usedAgent = Boolean(recommendations?.length);
      if (usedAgent) usedProvider = "base44";
    } catch {
      recommendations = null;
    }
  }

  const finalRecommendations = recommendations?.length
    ? recommendations
    : buildFallbackRecommendations(context);

  if (!finalRecommendations.length) {
    response.status(200).json({ recommendations: [], usedAgent });
    return;
  }

  const inserted = await insertTrafficRecommendations(pool, seller.id, finalRecommendations);
  response.status(200).json({ recommendations: inserted, usedAgent, provider: usedProvider });
}

async function createDraft(request: any, response: any) {
  const { seller } = await ensureSeller(request, { requireActive: true, requireAdmin: true });
  const serviceInterest = String(request.body?.serviceInterest ?? "plano_carreira");
  const ageGroup = String(request.body?.ageGroup ?? (serviceInterest === "plano_internacional" ? "18-plus" : "8-17"));
  const region = String(request.body?.region ?? "Brasil");
  const budgetDaily = asMoney(request.body?.budgetDaily);
  const budgetTotal = asMoney(request.body?.budgetTotal);
  const goal = String(request.body?.goal ?? "gerar conversas qualificadas");

  if (!budgetDaily && !budgetTotal) {
    response.status(400).json({ error: "Informe um orcamento diario ou total para montar o rascunho." });
    return;
  }

  const draft = buildCampaignDraft({ serviceInterest, ageGroup, region, budgetDaily, budgetTotal, goal });
  const { rows } = await pool.query(
    `
      insert into whatsapp_bot.traffic_campaign_drafts
        (name, objective, status, platform, service_interest, budget_daily, budget_total,
         age_min, age_max, locations, interests, placements, destination_url,
         whatsapp_message, copy_text, creative_notes, ai_rationale, meta_payload, created_by)
      values
        ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9::text[], $10::text[],
         $11::text[], $12, $13, $14, $15, $16, $17::jsonb, $18)
      returning ${draftSelect}
    `,
    [
      draft.name,
      draft.objective,
      draft.platform,
      draft.serviceInterest,
      budgetDaily,
      budgetTotal,
      draft.ageMin,
      draft.ageMax,
      draft.locations,
      draft.interests,
      draft.placements,
      draft.destinationUrl,
      draft.whatsappMessage,
      draft.copyText,
      draft.creativeNotes,
      draft.aiRationale,
      JSON.stringify(draft.metaPayload),
      seller.id
    ]
  );

  response.status(200).json({ draft: rows[0] });
}

async function updateDraftStatus(request: any, response: any) {
  const { seller } = await ensureSeller(request, { requireActive: true, requireAdmin: true });
  const { id, status } = request.body ?? {};
  if (!id || !allowedDraftStatuses.has(String(status))) {
    response.status(400).json({ error: "id and valid status are required" });
    return;
  }

  const { rows } = await pool.query(
    `
      update whatsapp_bot.traffic_campaign_drafts
      set status = $2,
          approved_by = case when $2 = 'approved' then $3 else approved_by end,
          updated_at = now()
      where id = $1
      returning ${draftSelect}
    `,
    [id, status, seller.id]
  );

  if (!rows.length) {
    response.status(404).json({ error: "Draft not found" });
    return;
  }

  response.status(200).json({ draft: rows[0] });
}

function cents(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function buildTargeting(draft: any) {
  const storedTargeting = draft?.meta_payload?.adset?.targeting;
  if (storedTargeting && typeof storedTargeting === "object" && !Array.isArray(storedTargeting)) {
    return storedTargeting;
  }

  return {
    geo_locations: { countries: ["BR"] },
    age_min: Number(draft.age_min ?? 28),
    age_max: Number(draft.age_max ?? 56),
    publisher_platforms: ["facebook", "instagram"],
    targeting_automation: { advantage_audience: 1 }
  };
}

function buildCreativeSpec(draft: any, pageId: string) {
  const link = String(draft.destination_url ?? "https://ec10talentos.com/instagram#planos");
  return {
    page_id: pageId,
    link_data: {
      link,
      message: String(draft.copy_text ?? "Conheca a EC10 Talentos."),
      call_to_action: {
        type: "LEARN_MORE",
        value: { link }
      }
    }
  };
}

async function publishDraft(request: any, response: any) {
  const { seller } = await ensureSeller(request, { requireActive: true, requireAdmin: true });
  const id = String(request.body?.id ?? "");
  if (!id) {
    response.status(400).json({ error: "Informe o rascunho para publicar." });
    return;
  }

  const accessToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
  const adAccount = normalizeAdAccount(process.env.META_AD_ACCOUNT_ID ?? "");
  const pageId = process.env.META_PAGE_ID ?? "";
  const pixelId = process.env.META_PIXEL_ID ?? "";
  const graphVersion = process.env.META_GRAPH_VERSION ?? "v25.0";
  if (!accessToken || !adAccount || !pageId) {
    response.status(400).json({ error: "Configure META_SYSTEM_USER_ACCESS_TOKEN, META_AD_ACCOUNT_ID e META_PAGE_ID." });
    return;
  }
  if (!pixelId) {
    response.status(400).json({ error: "Configure META_PIXEL_ID antes de publicar rascunhos de trafego qualificado." });
    return;
  }

  const { rows } = await pool.query(
    `
      select ${draftSelect}
      from whatsapp_bot.traffic_campaign_drafts
      where id = $1
      limit 1
    `,
    [id]
  );
  const draft = rows[0];
  if (!draft) {
    response.status(404).json({ error: "Rascunho nao encontrado." });
    return;
  }
  if (!publishableDraftStatuses.has(String(draft.status))) {
    response.status(409).json({ error: "A campanha precisa estar aprovada antes da publicacao." });
    return;
  }

  const dailyBudget = cents(draft.budget_daily);
  if (!dailyBudget) {
    response.status(400).json({ error: "Para publicar no Meta, informe um orcamento diario no rascunho." });
    return;
  }

  const creativeSpec = buildCreativeSpec(draft, pageId);
  const publishAudit: Record<string, unknown> = { requestedAt: new Date().toISOString(), mode: "paused_safe_publish" };
  let campaignId: string | null = null;
  let adsetId: string | null = null;
  let creativeId: string | null = null;
  let adId: string | null = null;

  try {
    await postMeta(graphVersion, `${adAccount}/adcreatives`, accessToken, {
      name: `${draft.name} | Validacao`,
      object_story_spec: creativeSpec,
      execution_options: ["validate_only"]
    });

    await postMeta(graphVersion, `${adAccount}/campaigns`, accessToken, {
      name: draft.name,
      objective: draft.objective ?? "OUTCOME_LEADS",
      buying_type: "AUCTION",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: "PAUSED",
      execution_options: ["validate_only"]
    });

    const campaign = await postMeta(graphVersion, `${adAccount}/campaigns`, accessToken, {
      name: draft.name,
      objective: draft.objective ?? "OUTCOME_LEADS",
      buying_type: "AUCTION",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: "PAUSED"
    });
    campaignId = campaign.id ?? null;

    const adsetBody: Record<string, unknown> = {
      name: `${draft.name} | Publico principal`,
      campaign_id: campaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      promoted_object: {
        pixel_id: pixelId,
        custom_event_type: "LEAD"
      },
      targeting: buildTargeting(draft),
      status: "PAUSED"
    };
    if (dailyBudget) adsetBody.daily_budget = dailyBudget;

    const adset = await postMeta(graphVersion, `${adAccount}/adsets`, accessToken, adsetBody);
    adsetId = adset.id ?? null;

    const creative = await postMeta(graphVersion, `${adAccount}/adcreatives`, accessToken, {
      name: `${draft.name} | Criativo principal`,
      object_story_spec: creativeSpec
    });
    creativeId = creative.id ?? null;

    const ad = await postMeta(graphVersion, `${adAccount}/ads`, accessToken, {
      name: `${draft.name} | Anuncio principal`,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: "PAUSED"
    });
    adId = ad.id ?? null;

    const updated = await pool.query(
      `
        update whatsapp_bot.traffic_campaign_drafts
        set status = 'published',
            meta_campaign_id = $2,
            meta_adset_id = $3,
            meta_creative_id = $4,
            meta_ad_id = $5,
            publish_error = null,
            published_by = $6,
            published_at = now(),
            updated_at = now(),
            meta_payload = meta_payload || $7::jsonb
        where id = $1
        returning ${draftSelect}
      `,
      [
        id,
        campaignId,
        adsetId,
        creativeId,
        adId,
        seller.id,
        JSON.stringify({ metaPublication: { ...publishAudit, campaignId, adsetId, creativeId, adId } })
      ]
    );

    response.status(200).json({ draft: updated.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao publicar no Meta.";
    const updated = await pool.query(
      `
        update whatsapp_bot.traffic_campaign_drafts
        set status = 'failed',
            meta_campaign_id = coalesce($2, meta_campaign_id),
            meta_adset_id = coalesce($3, meta_adset_id),
            meta_creative_id = coalesce($4, meta_creative_id),
            meta_ad_id = coalesce($5, meta_ad_id),
            publish_error = $6,
            updated_at = now(),
            meta_payload = meta_payload || $7::jsonb
        where id = $1
        returning ${draftSelect}
      `,
      [
        id,
        campaignId,
        adsetId,
        creativeId,
        adId,
        message,
        JSON.stringify({ metaPublication: { ...publishAudit, campaignId, adsetId, creativeId, adId, error: message } })
      ]
    );

    response.status(424).json({ error: message, draft: updated.rows[0] });
  }
}

async function fetchMetaInsights(accountId: string, accessToken: string, graphVersion: string, since: string, until: string) {
  const fields = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "spend",
    "impressions",
    "reach",
    "clicks",
    "ctr",
    "cpc",
    "actions",
    "date_start",
    "date_stop"
  ].join(",");

  const params = new URLSearchParams({
    access_token: accessToken,
    level: "ad",
    fields,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    limit: "200"
  });

  let nextUrl: string | null = `https://graph.facebook.com/${graphVersion}/${accountId}/insights?${params.toString()}`;
  const rows: any[] = [];

  while (nextUrl) {
    const metaResponse = await fetch(nextUrl, { signal: AbortSignal.timeout(30000) });
    if (!metaResponse.ok) {
      throw new Error("Meta Ads nao respondeu aos insights.");
    }

    const payload = await metaResponse.json();
    rows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return rows;
}

async function fetchMetaCampaignStatuses(accountId: string, accessToken: string, graphVersion: string) {
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "configured_status",
    "objective",
    "daily_budget",
    "lifetime_budget",
    "start_time",
    "stop_time",
    "updated_time"
  ].join(",");

  let nextUrl: string | null = `https://graph.facebook.com/${graphVersion}/${accountId}/campaigns?${new URLSearchParams({
    access_token: accessToken,
    fields,
    limit: "200"
  }).toString()}`;
  const campaigns = new Map<string, any>();

  while (nextUrl) {
    const metaResponse = await fetch(nextUrl, { signal: AbortSignal.timeout(30000) });
    const payload = await metaResponse.json().catch(async () => ({ message: await metaResponse.text() }));

    if (!metaResponse.ok) {
      throw new Error(normalizeMetaError(payload));
    }

    for (const item of payload.data ?? []) {
      if (item?.id) campaigns.set(String(item.id), item);
    }

    nextUrl = payload.paging?.next ?? null;
  }

  return campaigns;
}

function metaErrorMessage(payload: any) {
  const message = String(payload?.error?.message ?? payload?.message ?? "");
  if (!message) return null;
  if (message.includes("ads_management") || message.includes("ads_read")) {
    return "A conta de anuncios ainda nao concedeu ads_read ou ads_management para este token.";
  }
  return message.slice(0, 240);
}

async function checkMetaEndpoint(name: string, url: string, accessToken: string) {
  try {
    const separator = url.includes("?") ? "&" : "?";
    const metaResponse = await fetch(`${url}${separator}access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(20000)
    });
    const payload = await metaResponse.json().catch(async () => ({ message: await metaResponse.text() }));

    return {
      name,
      ok: metaResponse.ok,
      status: metaResponse.status,
      code: payload?.error?.code ?? null,
      type: payload?.error?.type ?? null,
      message: metaResponse.ok ? null : metaErrorMessage(payload)
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      code: null,
      type: null,
      message: error instanceof Error ? error.message : "Falha ao conectar na Meta."
    };
  }
}

function landingScriptUrls(html: string, landingUrl: string) {
  const matches = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi));
  const urls: string[] = [];

  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;

    try {
      const url = new URL(raw, landingUrl);
      if (url.origin === new URL(landingUrl).origin) urls.push(url.toString());
    } catch {
      continue;
    }
  }

  return Array.from(new Set(urls)).slice(0, 5);
}

async function checkLandingPixel(pixelId: string) {
  const landingUrl = process.env.EC10_TRAFFIC_LANDING_URL ?? "https://ec10talentos.com/instagram";

  try {
    const siteResponse = await fetch(landingUrl, { signal: AbortSignal.timeout(20000) });
    const html = await siteResponse.text().catch(() => "");
    let hasPixel = Boolean(pixelId && html.includes(pixelId));
    let hasFbq = /fbq\s*\(/i.test(html);

    if ((!hasPixel || !hasFbq) && siteResponse.ok) {
      for (const scriptUrl of landingScriptUrls(html, landingUrl)) {
        const scriptResponse = await fetch(scriptUrl, { signal: AbortSignal.timeout(20000) });
        if (!scriptResponse.ok) continue;
        const script = await scriptResponse.text().catch(() => "");
        hasPixel = hasPixel || Boolean(pixelId && script.includes(pixelId));
        hasFbq = hasFbq || /fbq\s*\(/i.test(script);
        if (hasPixel && hasFbq) break;
      }
    }

    return {
      name: "landing_pixel",
      ok: siteResponse.ok && hasPixel && hasFbq,
      status: siteResponse.status,
      code: null,
      type: null,
      message: siteResponse.ok && hasPixel && hasFbq
        ? null
        : "A landing /instagram nao retornou o Pixel Meta esperado no HTML."
    };
  } catch (error) {
    return {
      name: "landing_pixel",
      ok: false,
      status: 0,
      code: null,
      type: null,
      message: error instanceof Error ? error.message : "Falha ao verificar pixel na landing."
    };
  }
}

async function buildMetaStatusPayload() {
  const accessToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
  const adAccount = normalizeAdAccount(process.env.META_AD_ACCOUNT_ID ?? "");
  const graphVersion = process.env.META_GRAPH_VERSION ?? "v25.0";
  const pixelId = process.env.META_PIXEL_ID ?? "";
  const capiToken = process.env.META_CAPI_ACCESS_TOKEN ?? "";

  const checks: any[] = [];
  const requiredActions: string[] = [];

  if (!accessToken) {
    requiredActions.push("Configure META_SYSTEM_USER_ACCESS_TOKEN no ambiente de producao.");
  }
  if (!adAccount) {
    requiredActions.push("Configure META_AD_ACCOUNT_ID no ambiente de producao.");
  }
  if (!pixelId || !capiToken) {
    requiredActions.push("Configure META_PIXEL_ID e META_CAPI_ACCESS_TOKEN para eventos de qualidade.");
  }

  if (accessToken) {
    checks.push(await checkMetaEndpoint(
      "token",
      `https://graph.facebook.com/${graphVersion}/me?fields=id,name`,
      accessToken
    ));
  }

  if (accessToken && adAccount) {
    checks.push(await checkMetaEndpoint(
      "ad_account",
      `https://graph.facebook.com/${graphVersion}/${adAccount}?fields=id,name,account_status,currency,timezone_name`,
      accessToken
    ));
    checks.push(await checkMetaEndpoint(
      "insights",
      `https://graph.facebook.com/${graphVersion}/${adAccount}/insights?fields=campaign_id,spend,impressions&date_preset=last_7d&limit=1`,
      accessToken
    ));
  }

  if (accessToken && pixelId) {
    checks.push(await checkMetaEndpoint(
      "pixel",
      `https://graph.facebook.com/${graphVersion}/${pixelId}?fields=id,name`,
      accessToken
    ));
    checks.push(await checkLandingPixel(pixelId));
  }

  checks.push({
    name: "crm_capi",
    ok: Boolean(pixelId && capiToken),
    status: pixelId && capiToken ? 200 : 0,
    code: null,
    type: null,
    message: pixelId && capiToken ? null : "Conversions API sem META_PIXEL_ID ou META_CAPI_ACCESS_TOKEN."
  });

  const adAccountCheck = checks.find((item) => item.name === "ad_account");
  const insightsCheck = checks.find((item) => item.name === "insights");
  const pixelCheck = checks.find((item) => item.name === "pixel");
  const landingPixelCheck = checks.find((item) => item.name === "landing_pixel");
  const capiCheck = checks.find((item) => item.name === "crm_capi");

  if (adAccountCheck && !adAccountCheck.ok) {
    requiredActions.push("No Meta Business, conceda ao usuario do sistema acesso a conta de anuncios com ads_read e ads_management.");
  }
  if (insightsCheck && !insightsCheck.ok) {
    requiredActions.push("Depois da permissao da conta de anuncios, rode novamente a sincronizacao de metricas.");
  }
  if (landingPixelCheck && !landingPixelCheck.ok) {
    requiredActions.push("Conferir o Pixel Meta publicado na landing /instagram.");
  }
  if (capiCheck && !capiCheck.ok) {
    requiredActions.push("Configurar a Conversions API para enviar Lead, QualifiedLead, Schedule e Purchase pelo CRM.");
  }

  return {
    graphVersion,
    configured: {
      adAccount: Boolean(adAccount),
      systemUserToken: Boolean(accessToken),
      pixel: Boolean(pixelId),
      capi: Boolean(capiToken)
    },
    readyForInsights: Boolean(adAccountCheck?.ok && insightsCheck?.ok),
    readyForQualityEvents: Boolean(pixelId && capiToken && (pixelCheck?.ok ?? true) && (landingPixelCheck?.ok ?? true)),
    checks,
    requiredActions: Array.from(new Set(requiredActions))
  };
}

async function metaStatus(request: any, response: any) {
  await ensureSeller(request, { requireActive: true, requireAdmin: true });
  response.status(200).json(await buildMetaStatusPayload());
}

async function syncMetaData(daysInput = 30) {
  const accessToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
  const adAccount = normalizeAdAccount(process.env.META_AD_ACCOUNT_ID ?? "");
  const graphVersion = process.env.META_GRAPH_VERSION ?? "v25.0";
  if (!accessToken || !adAccount) {
    throw new HttpError(400, "Configure META_AD_ACCOUNT_ID e META_SYSTEM_USER_ACCESS_TOKEN para sincronizar o Meta.");
  }

  const until = new Date().toISOString().slice(0, 10);
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - Number(daysInput ?? 30));
  const since = sinceDate.toISOString().slice(0, 10);

  const [insights, campaignStatuses] = await Promise.all([
    fetchMetaInsights(adAccount, accessToken, graphVersion, since, until),
    fetchMetaCampaignStatuses(adAccount, accessToken, graphVersion)
  ]);
  const insightCampaignIds = new Set(insights.map((item) => String(item.campaign_id ?? "")).filter(Boolean));
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        delete from whatsapp_bot.traffic_campaign_snapshots
        where account_id = $1
          and date_start >= $2::date
          and date_end <= $3::date
      `,
      [adAccount, since, until]
    );

    for (const item of insights) {
      const campaignStatus = campaignStatuses.get(String(item.campaign_id ?? ""));
      const actions = item.actions ?? [];
      const conversations = actionValue(actions, [
        "onsite_conversion.messaging_conversation_started_7d",
        "onsite_conversion.messaging_first_reply"
      ]);
      const leads = actionValue(actions, [
        "lead",
        "onsite_conversion.lead_grouped",
        "offsite_conversion.fb_pixel_lead"
      ]);
      const qualifiedLeads = actionValue(actions, [
        "qualified_lead",
        "onsite_conversion.qualified_lead",
        "offsite_conversion.fb_pixel_qualified_lead"
      ]);
      const proposals = actionValue(actions, [
        "schedule",
        "onsite_conversion.schedule",
        "offsite_conversion.fb_pixel_schedule"
      ]);
      const purchases = actionValue(actions, [
        "purchase",
        "offsite_conversion.fb_pixel_purchase"
      ]);

      await client.query(
        `
          insert into whatsapp_bot.traffic_campaign_snapshots
            (platform, account_id, campaign_id, campaign_name, adset_id, adset_name,
             ad_id, ad_name, status, date_start, date_end, spend, impressions, reach,
             clicks, conversations, leads, qualified_leads, proposals, purchases,
             ctr, cpc, cpl, cpql, raw_payload)
          values
            ('meta_ads', $1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date,
             $11::numeric, $12::integer, $13::integer, $14::integer, $15::integer,
             $16::integer, $17::integer, $18::integer, $19::integer,
             $20::numeric, $21::numeric,
             case when $16::integer > 0 then $11::numeric / $16::numeric else 0 end,
             case when $17::integer > 0 then $11::numeric / $17::numeric else 0 end,
             $22::jsonb)
        `,
        [
          adAccount,
          item.campaign_id ?? null,
          item.campaign_name ?? null,
          item.adset_id ?? null,
          item.adset_name ?? null,
          item.ad_id ?? null,
          item.ad_name ?? null,
          campaignStatus?.effective_status ?? campaignStatus?.status ?? null,
          item.date_start,
          item.date_stop,
          asNumber(item.spend),
          Math.round(asNumber(item.impressions)),
          Math.round(asNumber(item.reach)),
          Math.round(asNumber(item.clicks)),
          Math.round(conversations),
          Math.round(leads),
          Math.round(qualifiedLeads),
          Math.round(proposals),
          Math.round(purchases),
          asNumber(item.ctr),
          asNumber(item.cpc),
          JSON.stringify(item)
        ]
      );
    }

    for (const [campaignId, campaign] of campaignStatuses.entries()) {
      const status = String(campaign.effective_status ?? campaign.status ?? "");
      if (insightCampaignIds.has(campaignId) || status !== "ACTIVE") continue;

      await client.query(
        `
          insert into whatsapp_bot.traffic_campaign_snapshots
            (platform, account_id, campaign_id, campaign_name, status, date_start, date_end,
             spend, impressions, reach, clicks, conversations, leads, qualified_leads,
             proposals, purchases, ctr, cpc, cpl, cpql, raw_payload)
          values
            ('meta_ads', $1, $2, $3, $4, $5::date, $5::date,
             0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, $6::jsonb)
        `,
        [
          adAccount,
          campaignId,
          campaign.name ?? null,
          status,
          until,
          JSON.stringify({ metaCampaignStatus: campaign, noInsightsInRange: true })
        ]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return { synced: true, rows: insights.length, since, until };
}

async function syncMeta(request: any, response: any) {
  await ensureSeller(request, { requireActive: true, requireAdmin: true });
  response.status(200).json(await syncMetaData(Number(request.body?.days ?? 30)));
}

function requestHeader(request: any, name: string) {
  return String(request.headers?.[name.toLowerCase()] ?? request.headers?.[name] ?? "");
}

function isTrafficCronAuthorized(request: any) {
  const secret = process.env.TRAFFIC_CRON_SECRET || process.env.CRON_SECRET || "";
  const authorization = requestHeader(request, "authorization");
  if (secret) return authorization === `Bearer ${secret}`;

  const userAgent = requestHeader(request, "user-agent").toLowerCase();
  const schedule = requestHeader(request, "x-vercel-cron-schedule");
  return userAgent.includes("vercel-cron/1.0") && Boolean(schedule);
}

async function findAutomationSellerId() {
  const { rows } = await pool.query(
    `
      select id
      from whatsapp_bot.sellers
      where active = true and role = 'admin'
      order by approved_at desc nulls last, created_at asc
      limit 1
    `
  );
  return rows[0]?.id ?? null;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scheduleSignalEventSourceUrl(row: any) {
  const metadata = safeMetadata(row.attribution_metadata);
  const direct = typeof metadata.eventSourceUrl === "string" ? metadata.eventSourceUrl : null;
  const sourcePath = typeof metadata.sourcePath === "string" ? metadata.sourcePath : null;
  try {
    return new URL(direct || sourcePath || "/instagram", "https://ec10talentos.com").toString();
  } catch {
    return "https://ec10talentos.com/instagram";
  }
}

function isMetaEventRecent(input: unknown) {
  const occurredAt = new Date(String(input ?? ""));
  return Number.isFinite(occurredAt.getTime())
    && Date.now() - occurredAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

async function backfillSchedulingIntentSignals() {
  const { rows } = await pool.query(
    `
      with requested as (
        select distinct on (e.client_id)
          e.id::text as source_event_id,
          e.client_id,
          e.phone,
          coalesce(e.service_interest, c.service_interest) as service_interest,
          e.athlete_age,
          e.age_group,
          e.quality_score,
          e.occurred_at,
          c.lead_score,
          c.fbclid,
          c.attribution_metadata,
          format('crm-%s-meeting-intent', e.client_id) as event_id,
          'bot_meeting_requested_auto_audit' as source
        from whatsapp_bot.traffic_events e
        join whatsapp_bot.clients c on c.id = e.client_id
        where e.event_type = 'bot_meeting_requested'
          and e.occurred_at >= now() - interval '30 days'
        order by e.client_id, e.occurred_at asc
      ), active_states as (
        select distinct on (c.id)
          null::text as source_event_id,
          c.id as client_id,
          c.phone,
          c.service_interest,
          b.athlete_age,
          b.age_group,
          null::numeric as quality_score,
          coalesce(b.updated_at, c.updated_at, c.created_at) as occurred_at,
          c.lead_score,
          c.fbclid,
          c.attribution_metadata,
          format('crm-%s-meeting-intent', c.id) as event_id,
          'active_scheduling_state_auto_audit' as source
        from whatsapp_bot.bot_conversation_states b
        join whatsapp_bot.clients c on c.phone = b.phone
        where b.stage in ('awaiting_meeting_date', 'awaiting_meeting_time')
          and coalesce(b.updated_at, c.updated_at, c.created_at) >= now() - interval '30 days'
        order by c.id, coalesce(b.updated_at, c.updated_at, c.created_at) desc
      ), candidates as (
        select * from requested
        union all
        select * from active_states
      )
      select distinct on (client_id) *
      from candidates candidate
      where not exists (
        select 1
        from whatsapp_bot.traffic_events q
        where q.client_id = candidate.client_id
          and q.event_type = 'QualifiedLead'
          and q.metadata ->> 'eventId' = candidate.event_id
      )
      order by client_id, occurred_at asc
    `
  );

  let inserted = 0;
  let capiSent = 0;
  let capiSkippedOld = 0;
  let capiFailed = 0;

  for (const row of rows) {
    const recent = isMetaEventRecent(row.occurred_at);
    let sent = false;
    if (recent) {
      sent = await sendMetaQualityEvent({
        clientId: row.client_id,
        phone: row.phone,
        eventName: "QualifiedLead",
        status: "quente",
        serviceInterest: row.service_interest,
        leadScore: Math.max(85, Number(row.lead_score ?? row.quality_score ?? 0)),
        fbclid: row.fbclid ?? null,
        fbc: typeof safeMetadata(row.attribution_metadata).fbc === "string" ? String(safeMetadata(row.attribution_metadata).fbc) : null,
        fbp: typeof safeMetadata(row.attribution_metadata).fbp === "string" ? String(safeMetadata(row.attribution_metadata).fbp) : null,
        eventSourceUrl: scheduleSignalEventSourceUrl(row),
        eventTime: row.occurred_at,
        eventId: row.event_id
      });
      if (sent) capiSent += 1;
      else capiFailed += 1;
    } else {
      capiSkippedOld += 1;
    }

    await pool.query(
      `
        insert into whatsapp_bot.traffic_events
          (client_id, phone, event_type, channel, platform, service_interest,
           athlete_age, age_group, lead_status, quality_score, metadata, occurred_at)
        values
          ($1, $2, 'QualifiedLead', 'whatsapp', 'meta_ads', $3, $4, $5, 'quente', $6, $7::jsonb, $8)
      `,
      [
        row.client_id,
        row.phone,
        row.service_interest,
        row.athlete_age,
        row.age_group,
        Math.max(85, Number(row.lead_score ?? row.quality_score ?? 0)),
        JSON.stringify({
          source: row.source,
          sourceEventId: row.source_event_id,
          eventId: row.event_id,
          capiSent: sent,
          capiSkippedOld: !recent
        }),
        row.occurred_at
      ]
    );
    inserted += 1;
  }

  return { found: rows.length, inserted, capiSent, capiSkippedOld, capiFailed };
}

async function backfillScheduledMeetingSignals() {
  const { rows } = await pool.query(
    `
      select
        e.id,
        e.client_id,
        e.phone,
        coalesce(e.service_interest, c.service_interest) as service_interest,
        e.athlete_age,
        e.age_group,
        e.quality_score,
        e.metadata,
        e.occurred_at,
        c.lead_score,
        c.fbclid,
        c.attribution_metadata,
        format('crm-%s-schedule-%s', e.client_id, coalesce(e.metadata #>> '{schedule,startsAt}', e.occurred_at::text)) as event_id
      from whatsapp_bot.traffic_events e
      join whatsapp_bot.clients c on c.id = e.client_id
      where e.event_type = 'bot_meeting_scheduled'
        and e.occurred_at >= now() - interval '30 days'
        and not exists (
          select 1
          from whatsapp_bot.traffic_events s
          where s.client_id = e.client_id
            and s.event_type = 'Schedule'
            and s.metadata ->> 'sourceEventId' = e.id::text
        )
      order by e.occurred_at asc
    `
  );

  let inserted = 0;
  let capiSent = 0;
  let capiSkippedOld = 0;
  let capiFailed = 0;

  for (const row of rows) {
    const recent = isMetaEventRecent(row.occurred_at);
    let sent = false;
    if (recent) {
      sent = await sendMetaQualityEvent({
        clientId: row.client_id,
        phone: row.phone,
        eventName: "Schedule",
        status: "orcamento",
        serviceInterest: row.service_interest,
        leadScore: Math.max(90, Number(row.lead_score ?? row.quality_score ?? 0)),
        fbclid: row.fbclid ?? null,
        fbc: typeof safeMetadata(row.attribution_metadata).fbc === "string" ? String(safeMetadata(row.attribution_metadata).fbc) : null,
        fbp: typeof safeMetadata(row.attribution_metadata).fbp === "string" ? String(safeMetadata(row.attribution_metadata).fbp) : null,
        eventSourceUrl: scheduleSignalEventSourceUrl(row),
        eventTime: row.occurred_at,
        eventId: row.event_id
      });
      if (sent) capiSent += 1;
      else capiFailed += 1;
    } else {
      capiSkippedOld += 1;
    }

    await pool.query(
      `
        insert into whatsapp_bot.traffic_events
          (client_id, phone, event_type, channel, platform, service_interest,
           athlete_age, age_group, lead_status, quality_score, metadata, occurred_at)
        values
          ($1, $2, 'Schedule', 'whatsapp', 'meta_ads', $3, $4, $5, 'orcamento', $6, $7::jsonb, $8)
      `,
      [
        row.client_id,
        row.phone,
        row.service_interest,
        row.athlete_age,
        row.age_group,
        Math.max(90, Number(row.lead_score ?? row.quality_score ?? 0)),
        JSON.stringify({
          source: "bot_meeting_scheduled_auto_audit",
          sourceEventId: row.id,
          eventId: row.event_id,
          capiSent: sent,
          capiSkippedOld: !recent,
          schedule: row.metadata?.schedule ?? null,
          sellerName: row.metadata?.sellerName ?? null,
          sellerRoute: row.metadata?.sellerRoute ?? null
        }),
        row.occurred_at
      ]
    );
    inserted += 1;
  }

  return { found: rows.length, inserted, capiSent, capiSkippedOld, capiFailed };
}

async function runTrafficAutoAudit(input: { force?: boolean; periodDays?: number }) {
  const force = Boolean(input.force);
  const periodDays = Math.max(1, Math.min(60, Math.round(Number(input.periodDays ?? 30))));
  const checkedAt = new Date().toISOString();

  if (!force) {
    const recent = await pool.query(
      `
        select occurred_at
        from whatsapp_bot.traffic_events
        where event_type = 'traffic_auto_audit_run'
          and occurred_at >= now() - interval '5 hours'
        order by occurred_at desc
        limit 1
      `
    );
    const lastRunAt = recent.rows[0]?.occurred_at ? new Date(recent.rows[0].occurred_at).toISOString() : null;
    if (lastRunAt) {
      return {
        ok: true,
        ran: false,
        reason: "Auditoria ja executada nas ultimas 5 horas.",
        checkedAt,
        lastRunAt,
        nextRunAt: new Date(new Date(lastRunAt).getTime() + 5 * 60 * 60 * 1000).toISOString()
      };
    }
  }

  const meta = await buildMetaStatusPayload();
  let sync: null | { synced: boolean; rows: number; since: string; until: string } = null;
  let syncError: string | null = null;

  if (meta.readyForInsights) {
    try {
      sync = await syncMetaData(Math.min(14, periodDays));
    } catch (error) {
      syncError = error instanceof Error ? error.message : "Falha ao sincronizar Meta Ads.";
    }
  }

  const schedulingIntentBackfill = await backfillSchedulingIntentSignals();
  const scheduledMeetingBackfill = await backfillScheduledMeetingSignals();
  const context = await loadTrafficContext(periodDays);
  let recommendations = buildFallbackRecommendations(context);
  let provider = "local";

  const trafficAiProvider = String(process.env.TRAFFIC_AI_PROVIDER ?? "").toLowerCase();
  if (trafficAiProvider === "ollama") {
    try {
      const agentRecommendations = await callOllamaTrafficAgent(context);
      if (agentRecommendations.length) {
        recommendations = agentRecommendations;
        provider = "ollama";
      }
    } catch {
      provider = "local";
    }
  } else if (trafficAiProvider === "base44") {
    try {
      const agentRecommendations = await callBase44TrafficAgent(context);
      if (agentRecommendations.length) {
        recommendations = agentRecommendations;
        provider = "base44";
      }
    } catch {
      provider = "local";
    }
  }

  const existing = await pool.query(
    `
      select lower(title) as title
      from whatsapp_bot.traffic_agent_recommendations
      where created_at >= now() - interval '24 hours'
        and status in ('draft', 'pending_approval', 'approved')
    `
  );
  const existingTitles = new Set(existing.rows.map((row) => String(row.title ?? "")));
  const freshRecommendations = recommendations.filter((item) => !existingTitles.has(item.title.trim().toLowerCase()));
  const sellerId = await findAutomationSellerId();
  const inserted = freshRecommendations.length
    ? await insertTrafficRecommendations(pool, sellerId, freshRecommendations)
    : [];

  const blockers = meta.requiredActions.length + (syncError ? 1 : 0);
  const qualityScore = Math.max(0, Math.min(100, 100 - blockers * 15));
  await pool.query(
    `
      insert into whatsapp_bot.traffic_events
        (event_type, channel, platform, quality_score, metadata)
      values
        ('traffic_auto_audit_run', 'crm', 'meta_ads', $1, $2::jsonb)
    `,
    [
      qualityScore,
      JSON.stringify({
        checkedAt,
        periodDays,
        provider,
        readyForInsights: meta.readyForInsights,
        readyForQualityEvents: meta.readyForQualityEvents,
        metaRequiredActions: meta.requiredActions,
        sync,
        syncError,
        schedulingIntentBackfill,
        scheduledMeetingBackfill,
        recommendationsCreated: inserted.length,
        attributionHealth: context.attributionHealth,
        metrics: context.metrics
      })
    ]
  );

  return {
    ok: blockers === 0,
    ran: true,
    checkedAt,
    periodDays,
    provider,
    meta: {
      readyForInsights: meta.readyForInsights,
      readyForQualityEvents: meta.readyForQualityEvents,
      requiredActions: meta.requiredActions,
      checks: meta.checks.map((item) => ({
        name: item.name,
        ok: item.ok,
        status: item.status,
        message: item.message
      }))
    },
    sync,
    syncError,
    schedulingIntentBackfill,
    scheduledMeetingBackfill,
    recommendationsCreated: inserted.length,
    recommendationsSkippedAsDuplicate: recommendations.length - freshRecommendations.length,
    nextRunAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
  };
}

async function autoAudit(request: any, response: any) {
  let admin = false;
  try {
    await ensureSeller(request, { requireActive: true, requireAdmin: true });
    admin = true;
  } catch (error) {
    if (!isTrafficCronAuthorized(request)) throw error;
  }

  const force = admin && (request.query?.force === "1" || request.body?.force === true);
  const periodDays = Number(request.query?.days ?? request.body?.days ?? 30);
  response.setHeader("cache-control", "no-store");
  response.status(200).json(await runTrafficAutoAudit({ force, periodDays }));
}

async function exportTrafficData(request: any, response: any) {
  await ensureSeller(request, { requireActive: true, requireAdmin: true });
  const periodDays = Number(request.query?.days ?? 180);
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - periodDays);
  const since = sinceDate.toISOString();
  const context = await loadTrafficContext(periodDays);

  const clients = await pool.query(
    `
      select id, phone, name, status, region, service_interest, source, bot_paused,
             notes, tags, next_follow_up_at, lead_score, traffic_source,
             traffic_campaign_id, traffic_campaign_name, traffic_adset_id, traffic_ad_id,
             utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             fbclid, gclid, attribution_metadata, last_message_at, created_at
      from whatsapp_bot.clients
      where created_at >= $1::timestamptz
      order by created_at desc
      limit 5000
    `,
    [since]
  );

  const events = await pool.query(
    `
      select *
      from whatsapp_bot.traffic_events
      where occurred_at >= $1::timestamptz
      order by occurred_at desc
      limit 10000
    `,
    [since]
  );

  const recommendations = await pool.query(
    `
      select *
      from whatsapp_bot.traffic_agent_recommendations
      order by created_at desc
      limit 1000
    `
  );

  const drafts = await pool.query(
    `
      select *
      from whatsapp_bot.traffic_campaign_drafts
      order by created_at desc
      limit 1000
    `
  );

  const snapshots = await pool.query(
    `
      select *
      from whatsapp_bot.traffic_campaign_snapshots
      where created_at >= $1::timestamptz or date_start >= $2::date
      order by date_start desc, created_at desc
      limit 20000
    `,
    [since, since.slice(0, 10)]
  );

  response.setHeader("cache-control", "no-store");
  response.setHeader("content-disposition", `attachment; filename="ec10-traffic-export-${new Date().toISOString().slice(0, 10)}.json"`);
  response.status(200).json({
    exportedAt: new Date().toISOString(),
    system: "cliente-whatsapp-crm",
    portability: {
      base44Required: false,
      crmDatabaseIsSourceOfTruth: true,
      metaRequiresExternalApi: true
    },
    periodDays,
    context,
    rows: {
      clients: clients.rows,
      trafficEvents: events.rows,
      recommendations: recommendations.rows,
      campaignDrafts: drafts.rows,
      campaignSnapshots: snapshots.rows
    }
  });
}

export default async function handler(request: any, response: any) {
  const action = String(request.query?.action ?? "overview");

  try {
    if (request.method === "GET" && action === "bh-prime") {
      await ensureSeller(request, { requireActive: true, requireAdmin: true });
      const { loadBhPrimeManager } = await import("./_bh-prime.js");
      response.setHeader("cache-control", "no-store");
      response.status(200).json(await loadBhPrimeManager());
      return;
    }
    if (request.method === "GET" && action === "overview") {
      await ensureSeller(request, { requireActive: true });
      const context = await loadTrafficContext(Number(request.query?.days ?? 30));
      response.setHeader("cache-control", "no-store");
      response.status(200).json(context);
      return;
    }

    if (request.method === "GET" && action === "drafts") {
      await ensureSeller(request, { requireActive: true });
      await listDrafts(response);
      return;
    }

    if (request.method === "GET" && action === "recommendations") {
      await ensureSeller(request, { requireActive: true });
      await listRecommendations(response);
      return;
    }

    if (request.method === "GET" && action === "meta-status") {
      await metaStatus(request, response);
      return;
    }

    if ((request.method === "GET" || request.method === "POST") && action === "auto-audit") {
      await autoAudit(request, response);
      return;
    }

    if (request.method === "GET" && action === "export") {
      await exportTrafficData(request, response);
      return;
    }

    if (request.method === "POST" && action === "recommendations") {
      await createRecommendations(request, response);
      return;
    }

    if (request.method === "POST" && action === "draft") {
      await createDraft(request, response);
      return;
    }

    if (request.method === "PATCH" && action === "draft") {
      await updateDraftStatus(request, response);
      return;
    }

    if (request.method === "POST" && action === "publish-draft") {
      await publishDraft(request, response);
      return;
    }

    if (request.method === "POST" && action === "meta-sync") {
      await syncMeta(request, response);
      return;
    }

    response.status(404).json({ error: "Traffic action not found" });
  } catch (error) {
    handleApiError(response, error);
  }
}
