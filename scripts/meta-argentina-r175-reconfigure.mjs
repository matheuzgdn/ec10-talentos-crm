/**
 * Reconfiguracao idempotente da campanha Argentina (R$ 175 vitalicios).
 *
 * O modo padrao e SOMENTE LEITURA. Ele consulta a Graph API e imprime uma
 * auditoria sanitizada mais o plano de mudancas. Nenhum POST e executado.
 *
 * A aplicacao futura exige, ao mesmo tempo:
 *   --apply
 *   --confirm=APLICAR-ARGENTINA-R175
 *   --group-story-image-hash=<hash 9:16 Meta>
 *   --group-feed-image-hash=<hash 4:5 Meta>
 *   --payment-story-image-hash=<hash 9:16 Meta>
 *   --payment-feed-image-hash=<hash 4:5 Meta>
 *
 * Carregue o perfil sem expor segredos:
 *   . C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1 -Profile ec10-manager
 *   node scripts/meta-argentina-r175-reconfigure.mjs
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "");
const PAGE_ID = process.env.META_PAGE_ID;
const INSTAGRAM_ID = process.env.META_INSTAGRAM_BUSINESS_ID;
const PIXEL_ID = process.env.META_PIXEL_ID;

const END_TIME = "2026-07-17T10:00:00-03:00";
const BUENOS_AIRES_CITY_KEY = "83693";
const CONFIRMATION = "APLICAR-ARGENTINA-R175";

const NAMES = Object.freeze({
  audienceInstagram90: "RMK | EC10 Instagram | Engajamento | 90D",
  audienceInstagram365: "RMK | EC10 Instagram | Engajamento | 365D",
  audienceVisitors30: "RMK | Revela Argentina | Visitou LP | 30D",
  audienceLeads180: "RMK | Revela Argentina | Lead | 180D",
  groupCampaign: "TRAFFIC | RT ARG | GRUPO LEADS | WARM BA | LT R$25 | 13-17 JUL",
  paymentCampaign: "LEADS | RT ARG | PAGAMENTO + GRUPO | WARM BA | LT R$150 | 13-17 JUL",
  groupAdset: "GRUPO | LEADS 180D | BA 40KM | LT R$25",
  paymentAdset: "PAGAMENTO | IG EC10 + VISITANTES 30D - LEADS | BA 40KM | LT R$150",
  groupCreative: "RT ARG | GRUPO LEADS | ES-AR | V2",
  paymentCreative: "RT ARG | PAGAMENTO | ES-AR | V2",
  groupAd: "RT ARG | GRUPO LEADS | ES-AR | V2",
  paymentAd: "RT ARG | PAGAMENTO | ES-AR | V2"
});

// IDs confirmados em 13/07/2026. Sao identificadores de objetos, nao segredos.
// O script tambem procura pelos nomes, portanto continua idempotente se um ID
// deixar de existir.
const CURRENT_IDS = Object.freeze({
  groupCampaign: "120247606270090601",
  paymentCampaign: "120247606271030601"
});

const LEGACY_NAMES = Object.freeze({
  groupCampaign: "TRAFFIC | RT ARG | GRUPO DIRETO | WARM BA | LT R$70 | 13-17 JUL",
  paymentCampaign: "LEADS | RT ARG | PAGAMENTO + GRUPO | WARM BA | LT R$105 | 13-17 JUL"
});

const LINKS = Object.freeze({
  group:
    "https://www.revelatalentos.com/api/argentina-grupo?utm_source=meta&utm_medium=paid_social&utm_campaign=rt_arg_grupo_leads_r25&utm_content={{ad.name}}&utm_term={{adset.name}}",
  payment:
    "https://www.revelatalentos.com/argentina?utm_source=meta&utm_medium=paid_social&utm_campaign=rt_arg_pagamento_r150&utm_content={{ad.name}}&utm_term={{adset.name}}"
});

const COPY = Object.freeze({
  group: {
    message:
      "¿Ya completaste tu inscripción? Sumate al grupo oficial de WhatsApp de la convocatoria en Buenos Aires. Ahí vas a recibir horarios, ubicación y avisos para el 17 y 18 de julio. Entrá ahora para no perder ninguna novedad de EC10 Talentos.",
    headline: "Ingresá al grupo oficial",
    description: "Buenos Aires · 17 y 18 de julio",
    cta: "LEARN_MORE"
  },
  payment: {
    message:
      "\u00bfSegu\u00eds a EC10 Talentos o ya viste la convocatoria? Buenos Aires recibe la convocatoria internacional el 17 y 18 de julio. La inscripci\u00f3n cuesta USD 50, en un pago \u00fanico. Complet\u00e1 tus datos, abon\u00e1 la inscripci\u00f3n y sub\u00ed el comprobante para validar tu cupo. Despu\u00e9s, sumate al grupo oficial de WhatsApp.",
    headline: "Inscripci\u00f3n: USD 50",
    description: "Pago \u00fanico, comprobante y grupo oficial",
    cta: "SIGN_UP"
  }
});

const cli = parseArgs(process.argv.slice(2));
const APPLY = cli.apply === true;
const GROUP_STORY_IMAGE_HASH =
  cli["group-story-image-hash"] || cli["group-image-hash"] || "{{GROUP_STORY_9X16_IMAGE_HASH}}";
const GROUP_FEED_IMAGE_HASH = cli["group-feed-image-hash"] || "{{GROUP_FEED_4X5_IMAGE_HASH}}";
const PAYMENT_STORY_IMAGE_HASH =
  cli["payment-story-image-hash"] || cli["payment-image-hash"] || "{{PAYMENT_STORY_9X16_IMAGE_HASH}}";
const PAYMENT_FEED_IMAGE_HASH = cli["payment-feed-image-hash"] || "{{PAYMENT_FEED_4X5_IMAGE_HASH}}";

if (!TOKEN || !ACCOUNT_ID) {
  throw new Error("Carregue o perfil ec10-manager: token/conta Meta ausente.");
}

if (APPLY) {
  if (cli.confirm !== CONFIRMATION) {
    throw new Error(`Aplicacao bloqueada. Use --confirm=${CONFIRMATION}.`);
  }
  if (!PAGE_ID || !INSTAGRAM_ID || !PIXEL_ID) {
    throw new Error("META_PAGE_ID, META_INSTAGRAM_BUSINESS_ID e META_PIXEL_ID sao obrigatorios.");
  }
  const imageHashes = [
    GROUP_STORY_IMAGE_HASH,
    GROUP_FEED_IMAGE_HASH,
    PAYMENT_STORY_IMAGE_HASH,
    PAYMENT_FEED_IMAGE_HASH
  ];
  if (imageHashes.some((hash) => hash.includes("{{"))) {
    throw new Error("Informe os quatro image_hash reais (9:16 e 4:5 de cada anuncio).");
  }
  if (new Set(imageHashes).size !== imageHashes.length) {
    throw new Error("Os quatro assets devem usar image_hash distintos.");
  }
}

function normalizeAccountId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("act_") ? text : `act_${text}`;
}

function parseArgs(argv) {
  const result = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    result[key] = rest.length ? rest.join("=") : true;
  }
  return result;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function creativeNameForHashes(baseName, storyHash, feedHash) {
  const story = String(storyHash || "");
  const feed = String(feedHash || "");
  return story.includes("{{") || feed.includes("{{")
    ? baseName
    : `${baseName} | S${story.slice(0, 6)}-F${feed.slice(0, 6)}`;
}

function moneyFromCents(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number((number / 100).toFixed(2)) : 0;
}

function sanitizeError(payload, status) {
  const message = payload?.error?.message || payload?.message || `Meta HTTP ${status}`;
  const code = payload?.error?.code;
  const subcode = payload?.error?.error_subcode;
  const title = payload?.error?.error_user_title;
  const detail = payload?.error?.error_user_msg;
  return [
    `${message}${code ? ` (code ${code}${subcode ? `/${subcode}` : ""})` : ""}`,
    title,
    detail
  ]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 1200);
}

async function metaGet(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  url.searchParams.set("access_token", TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function metaAll(path, params = {}) {
  const first = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    first.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  first.searchParams.set("access_token", TOKEN);
  let next = first.toString();
  const rows = [];
  while (next) {
    const response = await fetch(next, { signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(sanitizeError(payload, response.status));
    rows.push(...(payload.data || []));
    next = payload.paging?.next || null;
  }
  return rows;
}

async function metaPost(path, body) {
  if (!APPLY) throw new Error("POST bloqueado no modo somente leitura.");
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  form.set("access_token", TOKEN);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

function findByName(rows, ...names) {
  const normalized = new Set(names.filter(Boolean).map(normalizeText));
  return rows.find((item) => normalized.has(normalizeText(item.name))) || null;
}

function findCampaign(rows, id, currentName, legacyName) {
  return rows.find((item) => item.id === id) || findByName(rows, currentName, legacyName);
}

function audienceRuleInstagram90() {
  return {
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ id: INSTAGRAM_ID, type: "ig_business" }],
          retention_seconds: 90 * 24 * 60 * 60,
          filter: {
            operator: "and",
            filters: [{ field: "event", operator: "eq", value: "ig_business_profile_all" }]
          }
        }
      ]
    }
  };
}

function baseTargeting() {
  return {
    age_min: 18,
    age_max: 55,
    geo_locations: {
      location_types: ["home"],
      cities: [
        {
          key: BUENOS_AIRES_CITY_KEY,
          radius: 40,
          distance_unit: "kilometer"
        }
      ]
    },
    publisher_platforms: ["facebook", "instagram"],
    // Feed permanece disponivel para ampliar entrega; Stories/Reels recebem a
    // arte 9:16 e os inventarios de Feed recebem a futura arte 4:5.
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "explore", "story", "reels"],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 }
  };
}

function compactTargeting(targeting) {
  return {
    ageMin: targeting?.age_min ?? null,
    ageMax: targeting?.age_max ?? null,
    locationTypes: targeting?.geo_locations?.location_types || [],
    cities: (targeting?.geo_locations?.cities || []).map((city) => ({
      key: city.key,
      radius: city.radius,
      unit: city.distance_unit
    })),
    includedAudiences: (targeting?.custom_audiences || []).map((item) => item.id),
    excludedAudiences: (targeting?.excluded_custom_audiences || []).map((item) => item.id),
    platforms: targeting?.publisher_platforms || [],
    facebookPositions: targeting?.facebook_positions || [],
    instagramPositions: targeting?.instagram_positions || [],
    advantageAudience: targeting?.targeting_automation?.advantage_audience ?? null
  };
}

async function loadState() {
  const account = await metaGet(ACCOUNT_ID, {
    fields: "id,name,account_status,currency,timezone_name,amount_spent,spend_cap"
  });
  const [campaigns, audiences] = await Promise.all([
    metaAll(`${ACCOUNT_ID}/campaigns`, {
      fields:
        "id,name,status,effective_status,configured_status,objective,lifetime_budget,daily_budget,start_time,stop_time,issues_info",
      limit: "500"
    }),
    metaAll(`${ACCOUNT_ID}/customaudiences`, {
      fields:
        "id,name,subtype,delivery_status,operation_status,approximate_count_lower_bound,approximate_count_upper_bound,rule",
      limit: "500"
    })
  ]);

  const groupCampaign = findCampaign(
    campaigns,
    CURRENT_IDS.groupCampaign,
    NAMES.groupCampaign,
    LEGACY_NAMES.groupCampaign
  );
  const paymentCampaign = findCampaign(
    campaigns,
    CURRENT_IDS.paymentCampaign,
    NAMES.paymentCampaign,
    LEGACY_NAMES.paymentCampaign
  );

  const loadChildren = async (campaign) => {
    if (!campaign) return { adsets: [], ads: [] };
    const [adsets, ads] = await Promise.all([
      metaAll(`${campaign.id}/adsets`, {
        fields:
          "id,name,status,effective_status,configured_status,lifetime_budget,budget_remaining,start_time,end_time,optimization_goal,billing_event,bid_strategy,destination_type,is_dynamic_creative,promoted_object,targeting,issues_info",
        limit: "200"
      }),
      metaAll(`${campaign.id}/ads`, {
        fields:
          "id,name,status,effective_status,configured_status,adset_id,creative{id,name,object_story_spec},issues_info",
        limit: "200"
      })
    ]);
    return { adsets, ads };
  };

  const [groupChildren, paymentChildren] = await Promise.all([
    loadChildren(groupCampaign),
    loadChildren(paymentCampaign)
  ]);

  const campaignIds = [groupCampaign?.id, paymentCampaign?.id].filter(Boolean);
  const insights = campaignIds.length
    ? await metaAll(`${ACCOUNT_ID}/insights`, {
        level: "adset",
        fields: "campaign_id,adset_id,spend,impressions,reach,clicks,actions,date_start,date_stop",
        time_range: { since: "2026-07-13", until: "2026-07-17" },
        filtering: [{ field: "campaign.id", operator: "IN", value: campaignIds }],
        limit: "500"
      })
    : [];

  return {
    account,
    campaigns,
    audiences,
    groupCampaign,
    paymentCampaign,
    groupChildren,
    paymentChildren,
    insights
  };
}

function audienceSummary(item) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    subtype: item.subtype,
    deliveryStatus: item.delivery_status,
    operationStatus: item.operation_status,
    approximateLower: item.approximate_count_lower_bound ?? null,
    approximateUpper: item.approximate_count_upper_bound ?? null,
    retentionSeconds:
      item.rule?.inclusions?.rules?.[0]?.retention_seconds ||
      item.rule?.inclusions?.rules?.[0]?.retention_seconds ||
      null,
    eventSourceType: item.rule?.inclusions?.rules?.[0]?.event_sources?.[0]?.type || null,
    eventSourceId: item.rule?.inclusions?.rules?.[0]?.event_sources?.[0]?.id || null
  };
}

function campaignSummary(campaign, children, insights) {
  if (!campaign) return null;
  const campaignInsights = insights.filter((row) => row.campaign_id === campaign.id);
  const spend = campaignInsights.reduce((sum, row) => sum + Number(row.spend || 0), 0);
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    status: campaign.status,
    effectiveStatus: campaign.effective_status,
    issues: campaign.issues_info || [],
    spend: Number(spend.toFixed(2)),
    adsets: children.adsets.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      effectiveStatus: item.effective_status,
      lifetimeBudget: moneyFromCents(item.lifetime_budget),
      budgetRemaining: moneyFromCents(item.budget_remaining),
      startTime: item.start_time,
      endTime: item.end_time,
      optimizationGoal: item.optimization_goal,
      destinationType: item.destination_type,
      isDynamicCreative: item.is_dynamic_creative ?? null,
      promotedObject: item.promoted_object,
      targeting: compactTargeting(item.targeting),
      issues: item.issues_info || []
    })),
    ads: children.ads.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      effectiveStatus: item.effective_status,
      adsetId: item.adset_id,
      creativeId: item.creative?.id || null,
      creativeName: item.creative?.name || null,
      creativeCopy: item.creative?.object_story_spec?.link_data
        ? {
            message: item.creative.object_story_spec.link_data.message || null,
            headline: item.creative.object_story_spec.link_data.name || null,
            description: item.creative.object_story_spec.link_data.description || null,
            link: item.creative.object_story_spec.link_data.link || null,
            cta: item.creative.object_story_spec.link_data.call_to_action?.type || null
          }
        : null,
      issues: item.issues_info || []
    }))
  };
}

function buildPlannedTargeting(audiences) {
  const instagram90 = findByName(audiences, NAMES.audienceInstagram90);
  const instagram365 = findByName(audiences, NAMES.audienceInstagram365);
  const instagramEngagement = instagram90 || instagram365;
  const visitors30 = findByName(audiences, NAMES.audienceVisitors30);
  const leads180 = findByName(audiences, NAMES.audienceLeads180);
  const group = {
    ...baseTargeting(),
    custom_audiences: leads180 ? [{ id: leads180.id }] : [],
    excluded_custom_audiences: []
  };
  const payment = {
    ...baseTargeting(),
    custom_audiences: [instagramEngagement, visitors30].filter(Boolean).map((item) => ({ id: item.id })),
    excluded_custom_audiences: leads180 ? [{ id: leads180.id }] : []
  };
  return { instagram90, instagram365, instagramEngagement, visitors30, leads180, group, payment };
}

async function ensureAudienceInstagram90(state) {
  const existing = findByName(state.audiences, NAMES.audienceInstagram90);
  if (existing) return existing;
  const permittedFallback = findByName(state.audiences, NAMES.audienceInstagram365);
  if (permittedFallback) return permittedFallback;
  if (!APPLY) return null;
  try {
    const created = await metaPost(`${ACCOUNT_ID}/customaudiences`, {
      name: NAMES.audienceInstagram90,
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      description: "Pessoas que interagiram com o Instagram da EC10 nos ultimos 90 dias.",
      rule: audienceRuleInstagram90(),
      prefill: 1
    });
    return { id: created.id, name: NAMES.audienceInstagram90 };
  } catch (error) {
    const isAudiencePermissionError = /Permissions error|code 200\/1870090/i.test(String(error?.message || error));
    if (permittedFallback && isAudiencePermissionError) return permittedFallback;
    throw error;
  }
}

async function ensureCampaign(existing, spec) {
  if (existing) {
    await metaPost(existing.id, { name: spec.name });
    return { ...existing, name: spec.name };
  }
  const created = await metaPost(`${ACCOUNT_ID}/campaigns`, {
    name: spec.name,
    objective: spec.objective,
    buying_type: "AUCTION",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
    status: "PAUSED"
  });
  return { id: created.id, name: spec.name, objective: spec.objective };
}

async function ensureAdset(campaign, existingRows, spec) {
  const existing = findByName(existingRows, spec.name) || existingRows[0] || null;
  const payload = {
    name: spec.name,
    lifetime_budget: spec.lifetimeBudget,
    billing_event: "IMPRESSIONS",
    optimization_goal: spec.optimizationGoal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    end_time: END_TIME,
    targeting: spec.targeting,
    destination_type: "WEBSITE",
    ...(spec.promotedObject ? { promoted_object: spec.promotedObject } : {})
  };
  if (existing) {
    await metaPost(existing.id, payload);
    return { ...existing, name: spec.name };
  }
  const startTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const created = await metaPost(`${ACCOUNT_ID}/adsets`, {
    ...payload,
    campaign_id: campaign.id,
    start_time: startTime,
    status: "PAUSED"
  });
  return { id: created.id, name: spec.name };
}

async function ensureCreative(existingCreatives, spec) {
  const existing = findByName(existingCreatives, spec.name);
  if (existing) return existing;
  const created = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: spec.name,
    // Placement Asset Customization, nao Dynamic Creative: cada proporcao fica
    // presa a um grupo de posicionamentos deterministico.
    object_story_spec: { page_id: PAGE_ID, instagram_user_id: INSTAGRAM_ID },
    asset_feed_spec: {
      ad_formats: ["SINGLE_IMAGE"],
      optimization_type: "PLACEMENT",
      images: [
        {
          hash: spec.feedImageHash,
          adlabels: [{ name: "IMG_FEED_4X5" }]
        },
        {
          hash: spec.storyImageHash,
          adlabels: [{ name: "IMG_STORY_REELS_9X16" }]
        }
      ],
      bodies: [
        {
          text: spec.copy.message,
          adlabels: [{ name: "BODY_FEED" }, { name: "BODY_STORY_REELS" }]
        }
      ],
      titles: [
        {
          text: spec.copy.headline,
          adlabels: [{ name: "TITLE_FEED" }, { name: "TITLE_STORY_REELS" }]
        }
      ],
      descriptions: [{ text: spec.copy.description }],
      link_urls: [
        {
          website_url: spec.link,
          adlabels: [{ name: "LINK_FEED" }, { name: "LINK_STORY_REELS" }]
        }
      ],
      call_to_action_types: [spec.copy.cta],
      asset_customization_rules: [
        {
          customization_spec: {
            age_min: 18,
            age_max: 55,
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["story", "facebook_reels"],
            instagram_positions: ["story", "reels"]
          },
          image_label: { name: "IMG_STORY_REELS_9X16" },
          body_label: { name: "BODY_STORY_REELS" },
          title_label: { name: "TITLE_STORY_REELS" },
          link_url_label: { name: "LINK_STORY_REELS" },
          priority: 1
        },
        {
          customization_spec: {
            age_min: 18,
            age_max: 55
          },
          image_label: { name: "IMG_FEED_4X5" },
          body_label: { name: "BODY_FEED" },
          title_label: { name: "TITLE_FEED" },
          link_url_label: { name: "LINK_FEED" },
          priority: 2
        }
      ]
    }
  });
  return { id: created.id, name: spec.name };
}

async function ensureAd(existingRows, spec) {
  const existing = findByName(existingRows, spec.name) || existingRows[0] || null;
  const payload = {
    name: spec.name,
    adset_id: spec.adsetId,
    creative: { creative_id: spec.creativeId }
  };
  if (existing) {
    await metaPost(existing.id, payload);
    return { ...existing, name: spec.name };
  }
  const created = await metaPost(`${ACCOUNT_ID}/ads`, { ...payload, status: "PAUSED" });
  return { id: created.id, name: spec.name };
}

async function applyPlan(state) {
  const currentSpend = state.insights.reduce((totals, row) => {
    totals[row.campaign_id] = (totals[row.campaign_id] || 0) + Number(row.spend || 0);
    return totals;
  }, {});
  if ((currentSpend[state.groupCampaign?.id] || 0) > 25) {
    throw new Error("A campanha de grupo ja gastou mais de R$25; nao e seguro reduzir o vitalicio.");
  }
  if ((currentSpend[state.paymentCampaign?.id] || 0) > 150) {
    throw new Error("A campanha de pagamento ja gastou mais de R$150; nao e seguro aplicar.");
  }
  if (Date.now() >= Date.parse(END_TIME)) {
    throw new Error("A data final da seletiva ja passou; aplicacao bloqueada.");
  }

  const [page, instagram, pixel] = await Promise.all([
    metaGet(PAGE_ID, { fields: "id,name" }),
    metaGet(INSTAGRAM_ID, { fields: "id,name,username" }),
    metaGet(PIXEL_ID, { fields: "id,name" })
  ]);
  if (page.id !== PAGE_ID || instagram.id !== INSTAGRAM_ID || pixel.id !== PIXEL_ID) {
    throw new Error("Pagina, Instagram ou pixel nao correspondem aos IDs esperados.");
  }
  if (instagram.username !== "ec10_talentos_agencia") {
    throw new Error(`Instagram inesperado: @${instagram.username || "sem_username"}.`);
  }

  const instagramEngagement = await ensureAudienceInstagram90(state);
  const visitors30 = findByName(state.audiences, NAMES.audienceVisitors30);
  const leads180 = findByName(state.audiences, NAMES.audienceLeads180);
  if (!instagramEngagement || !visitors30 || !leads180) {
    throw new Error("Publicos obrigatorios ausentes: engajamento IG EC10, visitantes 30D ou Leads 180D.");
  }

  const groupTargeting = {
    ...baseTargeting(),
    custom_audiences: [{ id: leads180.id }],
    excluded_custom_audiences: []
  };
  const paymentTargeting = {
    ...baseTargeting(),
    custom_audiences: [{ id: instagramEngagement.id }, { id: visitors30.id }],
    excluded_custom_audiences: [{ id: leads180.id }]
  };

  // Valida e cria os novos criativos antes de pausar qualquer objeto que ja
  // esteja entregando. Assim, um erro de schema/asset nao interrompe a campanha.
  const existingCreatives = await metaAll(`${ACCOUNT_ID}/adcreatives`, {
    fields: "id,name,status",
    limit: "100"
  });
  const groupCreative = await ensureCreative(existingCreatives, {
    name: creativeNameForHashes(NAMES.groupCreative, GROUP_STORY_IMAGE_HASH, GROUP_FEED_IMAGE_HASH),
    storyImageHash: GROUP_STORY_IMAGE_HASH,
    feedImageHash: GROUP_FEED_IMAGE_HASH,
    link: LINKS.group,
    copy: COPY.group
  });
  const paymentCreative = await ensureCreative(existingCreatives, {
    name: creativeNameForHashes(
      NAMES.paymentCreative,
      PAYMENT_STORY_IMAGE_HASH,
      PAYMENT_FEED_IMAGE_HASH
    ),
    storyImageHash: PAYMENT_STORY_IMAGE_HASH,
    feedImageHash: PAYMENT_FEED_IMAGE_HASH,
    link: LINKS.payment,
    copy: COPY.payment
  });

  const groupCampaign = await ensureCampaign(state.groupCampaign, {
    name: NAMES.groupCampaign,
    objective: "OUTCOME_TRAFFIC"
  });
  const paymentCampaign = await ensureCampaign(state.paymentCampaign, {
    name: NAMES.paymentCampaign,
    objective: "OUTCOME_LEADS"
  });

  const groupAdset = await ensureAdset(groupCampaign, state.groupChildren.adsets, {
    name: NAMES.groupAdset,
    lifetimeBudget: 2500,
    optimizationGoal: "LINK_CLICKS",
    targeting: groupTargeting
  });
  const paymentAdset = await ensureAdset(paymentCampaign, state.paymentChildren.adsets, {
    name: NAMES.paymentAdset,
    lifetimeBudget: 15000,
    optimizationGoal: "OFFSITE_CONVERSIONS",
    promotedObject: { pixel_id: PIXEL_ID, custom_event_type: "LEAD" },
    targeting: paymentTargeting
  });

  const groupAd = await ensureAd(state.groupChildren.ads, {
    name: NAMES.groupAd,
    adsetId: groupAdset.id,
    creativeId: groupCreative.id
  });
  const paymentAd = await ensureAd(state.paymentChildren.ads, {
    name: NAMES.paymentAd,
    adsetId: paymentAdset.id,
    creativeId: paymentCreative.id
  });

  // Ativa somente depois de toda a estrutura estar pronta.
  for (const object of [groupAd, paymentAd, groupAdset, paymentAdset, groupCampaign, paymentCampaign]) {
    await metaPost(object.id, { status: "ACTIVE" });
  }

  return {
    applied: true,
    totalLifetimeBudgetBrl: 175,
    ids: {
      groupCampaign: groupCampaign.id,
      paymentCampaign: paymentCampaign.id,
      groupAdset: groupAdset.id,
      paymentAdset: paymentAdset.id,
      groupAd: groupAd.id,
      paymentAd: paymentAd.id,
      instagramEngagement: instagramEngagement.id,
      instagramEngagementName: instagramEngagement.name,
      visitors30: visitors30.id,
      leads180: leads180.id
    }
  };
}

const state = await loadState();
const planned = buildPlannedTargeting(state.audiences);
const report = {
  checkedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "read-only",
  graphVersion: GRAPH_VERSION,
  account: {
    id: state.account.id,
    name: state.account.name,
    status: state.account.account_status,
    currency: state.account.currency,
    timezone: state.account.timezone_name,
    amountSpent: moneyFromCents(state.account.amount_spent),
    spendCap: moneyFromCents(state.account.spend_cap),
    spendCapRemaining: Number(
      (moneyFromCents(state.account.spend_cap) - moneyFromCents(state.account.amount_spent)).toFixed(2)
    )
  },
  audiences: {
    instagram90: audienceSummary(planned.instagram90),
    instagram365: audienceSummary(findByName(state.audiences, NAMES.audienceInstagram365)),
    visitors30: audienceSummary(planned.visitors30),
    leads180: audienceSummary(planned.leads180)
  },
  current: {
    group: campaignSummary(state.groupCampaign, state.groupChildren, state.insights),
    payment: campaignSummary(state.paymentCampaign, state.paymentChildren, state.insights)
  },
  planned: {
    exactTotalLifetimeBudgetBrl: 175,
    endTime: END_TIME,
    geo: "Moradores de Buenos Aires, raio de 40 km",
    age: "18-55",
    platforms: ["facebook", "instagram"],
    advantageAudience: false,
    creativePlacementStrategy: "PLACEMENT: 9:16 em Stories/Reels e 4:5 em Feed/Explore",
    group: {
      budgetBrl: 25,
      audience: "somente Leads 180D",
      targeting: compactTargeting(planned.group),
      destination: LINKS.group,
      creativeName: NAMES.groupCreative,
      imageHashes: {
        storyReels9x16: GROUP_STORY_IMAGE_HASH,
        feedExplore4x5: GROUP_FEED_IMAGE_HASH
      },
      copy: COPY.group,
      statusAfterApply: "ACTIVE"
    },
    payment: {
      budgetBrl: 150,
      audience: `${planned.instagram90 ? "IG EC10 90D" : "IG EC10 365D"} OU visitantes LP 30D, excluindo Leads 180D`,
      targeting: compactTargeting(planned.payment),
      destination: LINKS.payment,
      creativeName: NAMES.paymentCreative,
      imageHashes: {
        storyReels9x16: PAYMENT_STORY_IMAGE_HASH,
        feedExplore4x5: PAYMENT_FEED_IMAGE_HASH
      },
      copy: COPY.payment,
      statusAfterApply: "ACTIVE"
    }
  },
  safety: {
    noPostInReadOnlyMode: !APPLY,
    requiresExplicitConfirmation: true,
    requiresFourDistinctImageHashes: true,
    placementAssetsAreDeterministic: true,
    blocksAfterEndTime: true,
    blocksUnsafeBudgetReductionAfterSpend: true,
    usesExistingInstagram365IfAccountCannotCreateInstagram90: true
  }
};

if (APPLY) report.result = await applyPlan(state);
console.log(JSON.stringify(report, null, 2));
