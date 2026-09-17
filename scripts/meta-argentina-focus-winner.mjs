/**
 * Concentra a campanha Argentina no criativo vencedor e cria uma expansão
 * controlada com o lookalike 1% dos engajados da EC10.
 *
 * Modo padrão: somente leitura.
 * Aplicação: --apply --confirm=FOCAR-VENCEDOR-ARGENTINA
 */

const GRAPH_VERSION = "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "");

const IDS = Object.freeze({
  campaign: "120247606271030601",
  warmAdset: "120247606274320601",
  winnerAd: "120247634325330601",
  paymentStaticAd: "120247606282860601",
  paymentVideoAd: "120247611422200601",
  lookalike: "120247605989930601",
  leads180: "120247605984170601",
  pixel: "834310425674029",
});

const NAMES = Object.freeze({
  campaign: "LEADS | RT ARG | GRUPO VIDEO ORIGINAL | WARM + LAL | LT R$175 | 13-17 JUL",
  warmAdset: "GRUPO VIDEO ORIGINAL | WARM EC10 - LEADS | BA 40KM | LT R$125",
  expansionAdset: "EXPANSAO CONTROLADA | LAL AR 1% EC10 | IG | BA 40KM | 18-44 | LT R$50",
  expansionAd: "RT ARG | GRUPO VIDEO ORIGINAL | LAL 1% | IG | V1",
});

const END_TIME = "2026-07-17T10:00:00-03:00";
const CONFIRMATION = "FOCAR-VENCEDOR-ARGENTINA";
const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true;

if (!TOKEN || !ACCOUNT_ID) throw new Error("Carregue o perfil ec10-manager.");
if (APPLY && args.confirm !== CONFIRMATION) {
  throw new Error(`Aplicação bloqueada. Use --confirm=${CONFIRMATION}.`);
}

function normalizeAccountId(value) {
  const text = String(value || "").trim();
  return text.startsWith("act_") ? text : `act_${text}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    parsed[key] = rest.length ? rest.join("=") : true;
  }
  return parsed;
}

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [
    error.message || `Meta HTTP ${status}`,
    error.code ? `code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""}` : "",
    error.error_user_title,
    error.error_user_msg,
  ].filter(Boolean).join(" - ").slice(0, 1600);
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
  const rows = [];
  let next = first.toString();
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
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

function expansionTargeting() {
  return {
    age_min: 18,
    age_max: 44,
    geo_locations: {
      cities: [{ key: "83693", radius: 40, distance_unit: "kilometer" }],
      location_types: ["home"],
    },
    custom_audiences: [{ id: IDS.lookalike }],
    excluded_custom_audiences: [{ id: IDS.leads180 }],
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "explore", "reels"],
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
    targeting_automation: { advantage_audience: 0 },
  };
}

async function readState() {
  const [campaign, warmAdset, winnerAd, paymentStaticAd, paymentVideoAd, lookalike, adsets, ads] =
    await Promise.all([
      metaGet(IDS.campaign, { fields: "id,name,status,effective_status,objective,issues_info" }),
      metaGet(IDS.warmAdset, {
        fields: "id,name,status,effective_status,lifetime_budget,budget_remaining,end_time,optimization_goal,promoted_object,targeting,issues_info",
      }),
      metaGet(IDS.winnerAd, {
        fields: "id,name,status,effective_status,adset_id,creative{id,name,object_story_spec},issues_info",
      }),
      metaGet(IDS.paymentStaticAd, { fields: "id,name,status,effective_status,issues_info" }),
      metaGet(IDS.paymentVideoAd, { fields: "id,name,status,effective_status,issues_info" }),
      metaGet(IDS.lookalike, {
        fields: "id,name,subtype,delivery_status,operation_status,lookalike_spec,approximate_count_lower_bound,approximate_count_upper_bound",
      }),
      metaAll(`${IDS.campaign}/adsets`, {
        fields: "id,name,status,effective_status,lifetime_budget,budget_remaining,targeting,promoted_object,issues_info",
        limit: "100",
      }),
      metaAll(`${IDS.campaign}/ads`, {
        fields: "id,name,status,effective_status,adset_id,creative{id,name,object_story_spec},issues_info",
        limit: "100",
      }),
    ]);

  return {
    campaign,
    warmAdset,
    winnerAd,
    paymentStaticAd,
    paymentVideoAd,
    lookalike,
    expansionAdset: adsets.find((item) => item.name === NAMES.expansionAdset) || null,
    expansionAd: ads.find((item) => item.name === NAMES.expansionAd) || null,
  };
}

function validateBase(state) {
  if (state.campaign.status !== "ACTIVE") throw new Error("Campanha principal não está ativa.");
  if (state.warmAdset.status !== "ACTIVE") throw new Error("Conjunto quente não está ativo.");
  if (state.warmAdset.optimization_goal !== "OFFSITE_CONVERSIONS") {
    throw new Error("Conjunto quente não está otimizado para conversão no site.");
  }
  if (state.warmAdset.promoted_object?.pixel_id !== IDS.pixel) throw new Error("Pixel inesperado.");
  if (!state.winnerAd.creative?.id) throw new Error("Criativo vencedor não encontrado.");
  if (state.lookalike.subtype !== "LOOKALIKE") throw new Error("Público de expansão não é lookalike.");
  if (state.lookalike.delivery_status?.code !== 200 || state.lookalike.operation_status?.code !== 200) {
    throw new Error("Lookalike ainda não está pronto para uso.");
  }
  if (state.lookalike.lookalike_spec?.country !== "AR" || Number(state.lookalike.lookalike_spec?.ratio) !== 0.01) {
    throw new Error("Lookalike não corresponde a Argentina 1%.");
  }
  const spentCents = Number(state.warmAdset.lifetime_budget) - Number(state.warmAdset.budget_remaining);
  if (spentCents >= 12500) throw new Error("Gasto do conjunto quente já impede redução segura para R$125.");
  if (Date.now() >= Date.parse(END_TIME)) throw new Error("Campanha encerrada.");
}

async function applyPlan(state) {
  for (const ad of [state.paymentStaticAd, state.paymentVideoAd]) {
    if (ad.status !== "PAUSED") await metaPost(ad.id, { status: "PAUSED" });
  }

  await metaPost(IDS.campaign, { name: NAMES.campaign });
  await metaPost(IDS.warmAdset, { name: NAMES.warmAdset, lifetime_budget: "12500" });

  let expansionAdset = state.expansionAdset;
  const adsetPayload = {
    name: NAMES.expansionAdset,
    lifetime_budget: "5000",
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    end_time: END_TIME,
    targeting: expansionTargeting(),
    destination_type: "WEBSITE",
    promoted_object: { pixel_id: IDS.pixel, custom_event_type: "LEAD" },
  };

  if (expansionAdset) {
    await metaPost(expansionAdset.id, adsetPayload);
  } else {
    const created = await metaPost(`${ACCOUNT_ID}/adsets`, {
      ...adsetPayload,
      campaign_id: IDS.campaign,
      start_time: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      status: "PAUSED",
    });
    expansionAdset = { id: created.id };
  }

  let expansionAd = state.expansionAd;
  if (!expansionAd) {
    const created = await metaPost(`${ACCOUNT_ID}/ads`, {
      name: NAMES.expansionAd,
      adset_id: expansionAdset.id,
      creative: { creative_id: state.winnerAd.creative.id },
      status: "PAUSED",
    });
    expansionAd = { id: created.id };
  }

  await metaPost(expansionAdset.id, { status: "ACTIVE" });
  await metaPost(expansionAd.id, { status: "ACTIVE" });

  return { expansionAdsetId: expansionAdset.id, expansionAdId: expansionAd.id };
}

function summary(state) {
  return {
    campaign: {
      id: state.campaign.id,
      name: state.campaign.name,
      status: state.campaign.status,
      effectiveStatus: state.campaign.effective_status,
      issues: state.campaign.issues_info || [],
    },
    warmAdset: {
      id: state.warmAdset.id,
      name: state.warmAdset.name,
      status: state.warmAdset.status,
      effectiveStatus: state.warmAdset.effective_status,
      lifetimeBudgetBrl: Number(state.warmAdset.lifetime_budget) / 100,
      budgetRemainingBrl: Number(state.warmAdset.budget_remaining) / 100,
      issues: state.warmAdset.issues_info || [],
    },
    winnerAd: {
      id: state.winnerAd.id,
      status: state.winnerAd.status,
      effectiveStatus: state.winnerAd.effective_status,
      creativeId: state.winnerAd.creative?.id || null,
      issues: state.winnerAd.issues_info || [],
    },
    paymentAds: [state.paymentStaticAd, state.paymentVideoAd].map((ad) => ({
      id: ad.id,
      status: ad.status,
      effectiveStatus: ad.effective_status,
      issues: ad.issues_info || [],
    })),
    lookalike: {
      id: state.lookalike.id,
      name: state.lookalike.name,
      deliveryCode: state.lookalike.delivery_status?.code,
      operationCode: state.lookalike.operation_status?.code,
      country: state.lookalike.lookalike_spec?.country,
      ratio: state.lookalike.lookalike_spec?.ratio,
      approximateLower: state.lookalike.approximate_count_lower_bound,
      approximateUpper: state.lookalike.approximate_count_upper_bound,
    },
    expansionAdset: state.expansionAdset
      ? {
          id: state.expansionAdset.id,
          name: state.expansionAdset.name,
          status: state.expansionAdset.status,
          effectiveStatus: state.expansionAdset.effective_status,
          lifetimeBudgetBrl: Number(state.expansionAdset.lifetime_budget) / 100,
          issues: state.expansionAdset.issues_info || [],
        }
      : null,
    expansionAd: state.expansionAd
      ? {
          id: state.expansionAd.id,
          status: state.expansionAd.status,
          effectiveStatus: state.expansionAd.effective_status,
          issues: state.expansionAd.issues_info || [],
        }
      : null,
  };
}

const before = await readState();
validateBase(before);

if (!APPLY) {
  console.log(JSON.stringify({
    mode: "read_only",
    checkedAt: new Date().toISOString(),
    ready: true,
    exactTotalLifetimeBudgetBrl: 175,
    planned: {
      warmBrl: 125,
      controlledExpansionBrl: 50,
      expansionGeo: "moradores de Buenos Aires em 40 km",
      expansionAge: "18-44",
      expansionPlatforms: ["instagram"],
      expansionAudience: "LAL AR 1% dos engajados EC10, excluindo Leads 180D",
    },
    current: summary(before),
  }, null, 2));
} else {
  const applied = await applyPlan(before);
  const after = await readState();
  const totalBudget =
    Number(after.warmAdset.lifetime_budget || 0) + Number(after.expansionAdset?.lifetime_budget || 0);
  if (totalBudget !== 17500) throw new Error(`Orçamento total incorreto após aplicação: ${totalBudget}.`);
  if (after.paymentStaticAd.status !== "PAUSED" || after.paymentVideoAd.status !== "PAUSED") {
    throw new Error("Anúncios de pagamento não ficaram pausados.");
  }
  if (after.winnerAd.status !== "ACTIVE" || after.expansionAd?.status !== "ACTIVE") {
    throw new Error("Criativos vencedores não ficaram configurados como ativos.");
  }
  console.log(JSON.stringify({
    mode: "applied",
    checkedAt: new Date().toISOString(),
    exactTotalLifetimeBudgetBrl: totalBudget / 100,
    applied,
    final: summary(after),
  }, null, 2));
}
