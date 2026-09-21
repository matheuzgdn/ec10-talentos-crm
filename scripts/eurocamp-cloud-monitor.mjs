import "dotenv/config";
import pg from "pg";

const TIME_ZONE = "America/Sao_Paulo";
const LEAD_CAMPAIGN_ID = "120248613293460601";
const LEAD_ADSET_ID = "120248613293890601";
const DIRECT_CAMPAIGN_ID = "120248609120900601";
const DIRECT_ADSET_ID = "120248613309460601";
const CAMPAIGN_START_DATE = "2026-08-25";
const HISTORICAL_ADSET_IDS = new Set(["120248602440860601", "120248609122300601"]);
const CREATIVE_KEYS = new Map([
  ["120248613294590601", "sonho_em_movimento"],
  ["120248613294740601", "pedrao_autoridade"],
  ["120248618907690601", "sonho_em_movimento_completo"],
  ["120248613309660601", "sonho_em_movimento"],
  ["120248618909160601", "sonho_em_movimento_completo"]
]);
const GEO_FALLBACK_TIERS = [
  {
    tier: 1,
    name: "Vale do Itajai e Norte de Santa Catarina",
    cities: [
      { key: "255793", name: "Itapema", region: "Santa Catarina", country: "BR", radius: 25, distance_unit: "kilometer" },
      { key: "243550", name: "Balneário Camboriú", region: "Santa Catarina", country: "BR", radius: 25, distance_unit: "kilometer" },
      { key: "256952", name: "Joinville", region: "Santa Catarina", country: "BR", radius: 30, distance_unit: "kilometer" }
    ]
  },
  {
    tier: 2,
    name: "Corredores metropolitanos qualificados",
    cities: [
      { key: "268866", name: "Santos", region: "São Paulo", country: "BR", radius: 30, distance_unit: "kilometer" },
      { key: "261275", name: "Niterói", region: "Rio de Janeiro", country: "BR", radius: 30, distance_unit: "kilometer" },
      { key: "257242", name: "Jundiaí", region: "São Paulo", country: "BR", radius: 30, distance_unit: "kilometer" }
    ]
  },
  {
    tier: 3,
    name: "Polos familiares de alta capacidade",
    cities: [
      { key: "244661", name: "Belo Horizonte", region: "Minas Gerais", country: "BR", radius: 40, distance_unit: "kilometer" },
      { key: "244379", name: "Barueri", region: "São Paulo", country: "BR", radius: 25, distance_unit: "kilometer" },
      { key: "261456", name: "Nova Lima", region: "Minas Gerais", country: "BR", radius: 25, distance_unit: "kilometer" },
      { key: "258404", name: "Londrina", region: "Paraná", country: "BR", radius: 35, distance_unit: "kilometer" },
      { key: "259493", name: "Maringá", region: "Paraná", country: "BR", radius: 35, distance_unit: "kilometer" }
    ]
  }
];
const DRY_RUN = process.argv.includes("--dry-run");
const META_TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = String(process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "");
const META_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const DATABASE_URL = process.env.SUPABASE_DB_URL;

const RULES = {
  minimumAgeMinutes: Number(process.env.EUROCAMP_MONITOR_MIN_AGE_MINUTES || 240),
  leadAdMaxSpendWithoutResult: Number(process.env.EUROCAMP_LEAD_AD_MAX_SPEND_NO_RESULT || 18),
  leadAdMinImpressions: Number(process.env.EUROCAMP_LEAD_AD_MIN_IMPRESSIONS || 500),
  directAdMaxSpendWithoutResult: Number(process.env.EUROCAMP_DIRECT_AD_MAX_SPEND_NO_RESULT || 12),
  directAdMinImpressions: Number(process.env.EUROCAMP_DIRECT_AD_MIN_IMPRESSIONS || 700),
  campaignMaxSpendWithoutLead: Number(process.env.EUROCAMP_CAMPAIGN_MAX_SPEND_NO_LEAD || 35),
  campaignMinimumHours: Number(process.env.EUROCAMP_CAMPAIGN_MIN_HOURS || 6),
  optimizationCooldownHours: Number(process.env.EUROCAMP_OPTIMIZATION_COOLDOWN_HOURS || 6),
  leadMinimumActiveAds: Number(process.env.EUROCAMP_LEAD_MIN_ACTIVE_ADS || 2),
  directMinimumActiveAds: Number(process.env.EUROCAMP_DIRECT_MIN_ACTIVE_ADS || 1),
  winnerMinimumResults: Number(process.env.EUROCAMP_WINNER_MIN_RESULTS || 2),
  loserCostRatio: Number(process.env.EUROCAMP_LOSER_COST_RATIO || 2.5),
  leadLoserMinimumSpend: Number(process.env.EUROCAMP_LEAD_LOSER_MIN_SPEND || 15),
  directLoserMinimumSpend: Number(process.env.EUROCAMP_DIRECT_LOSER_MIN_SPEND || 10),
  audienceRefineMinimumHour: Number(process.env.EUROCAMP_AUDIENCE_REFINE_MIN_HOUR || 10),
  leadAudienceRefineMinimumSpend: Number(process.env.EUROCAMP_LEAD_AUDIENCE_REFINE_MIN_SPEND || 35),
  directAudienceRefineMinimumSpend: Number(process.env.EUROCAMP_DIRECT_AUDIENCE_REFINE_MIN_SPEND || 18),
  audienceRefineMinimumImpressions: Number(process.env.EUROCAMP_AUDIENCE_REFINE_MIN_IMPRESSIONS || 600),
  audienceRefineAgeMin: Number(process.env.EUROCAMP_AUDIENCE_REFINE_AGE_MIN || 35),
  audienceRefineAgeMax: Number(process.env.EUROCAMP_AUDIENCE_REFINE_AGE_MAX || 54),
  audienceGraceHours: Number(process.env.EUROCAMP_AUDIENCE_GRACE_HOURS || 6),
  audienceGraceAdditionalSpend: Number(process.env.EUROCAMP_AUDIENCE_GRACE_ADDITIONAL_SPEND || 20),
  leadGeoExpansionMinimumSpend: Number(process.env.EUROCAMP_LEAD_GEO_EXPANSION_MIN_SPEND || 20),
  directGeoExpansionMinimumSpend: Number(process.env.EUROCAMP_DIRECT_GEO_EXPANSION_MIN_SPEND || 12),
  leadGeoExpansionSpendStep: Number(process.env.EUROCAMP_LEAD_GEO_EXPANSION_SPEND_STEP || 7.5),
  directGeoExpansionSpendStep: Number(process.env.EUROCAMP_DIRECT_GEO_EXPANSION_SPEND_STEP || 6),
  geoExpansionImpressionStep: Number(process.env.EUROCAMP_GEO_EXPANSION_IMPRESSION_STEP || 200),
  lowCtrMinimumImpressions: Number(process.env.EUROCAMP_LOW_CTR_MIN_IMPRESSIONS || 800),
  lowCtrThreshold: Number(process.env.EUROCAMP_LOW_CTR_THRESHOLD || 1.2),
  maximumHealthyFrequency: Number(process.env.EUROCAMP_MAX_HEALTHY_FREQUENCY || 2.5),
  funnelMinimumLinkClicks: Number(process.env.EUROCAMP_FUNNEL_MIN_LINK_CLICKS || 8),
  minimumLandingViewRate: Number(process.env.EUROCAMP_MIN_LANDING_VIEW_RATE || 0.55),
  minimumLandingConversionRate: Number(process.env.EUROCAMP_MIN_LANDING_CONVERSION_RATE || 0.12),
  underdeliveryCheckHour: Number(process.env.EUROCAMP_UNDERDELIVERY_CHECK_HOUR || 12),
  underdeliveryMaximumSpend: Number(process.env.EUROCAMP_UNDERDELIVERY_MAX_SPEND || 8)
};

if (!META_TOKEN) throw new Error("META_SYSTEM_USER_ACCESS_TOKEN nao configurado.");
if (!META_AD_ACCOUNT_ID) throw new Error("META_AD_ACCOUNT_ID nao configurado.");
if (!DATABASE_URL) throw new Error("SUPABASE_DB_URL nao configurada.");

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).format(date));
}

function actionValue(row, type) {
  const match = Array.isArray(row?.actions)
    ? row.actions.find((item) => item.action_type === type)
    : null;
  return Number(match?.value || 0);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function graph(path, params = {}, method = "GET") {
  const url = new URL(`https://graph.facebook.com/${META_VERSION}/${path}`);
  const body = new URLSearchParams({ access_token: META_TOKEN });
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (method === "GET") url.searchParams.set(key, String(value));
    else body.set(key, String(value));
  }
  if (method === "GET") url.searchParams.set("access_token", META_TOKEN);
  const response = await fetch(url, method === "GET" ? undefined : { method, body });
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || `Meta HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function adsetAds(adsetId) {
  const payload = await graph(`${adsetId}/ads`, {
    fields: "id,name,adset_id,status,effective_status,created_time,issues_info",
    limit: 100
  });
  return payload.data || [];
}

async function adsetDetails(adsetId) {
  return graph(adsetId, {
    fields: "id,name,status,effective_status,targeting,daily_budget,lifetime_budget,budget_remaining,optimization_goal,bid_strategy"
  });
}

async function adAccountStatus() {
  const payload = await graph(`act_${META_AD_ACCOUNT_ID}`, {
    fields: "account_status,disable_reason,balance,amount_spent,spend_cap,currency,timezone_name"
  });
  const lifetimeSpend = number(payload.amount_spent) / 100;
  const spendCap = number(payload.spend_cap) / 100;
  return {
    status: number(payload.account_status),
    disableReason: number(payload.disable_reason),
    balance: number(payload.balance) / 100,
    lifetimeSpend,
    spendCap,
    headroom: Math.max(0, spendCap - lifetimeSpend),
    currency: payload.currency,
    timezone: payload.timezone_name
  };
}

async function adInsights(campaignId, since, until = since) {
  const payload = await graph(`${campaignId}/insights`, {
    fields: "campaign_id,adset_id,ad_id,ad_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,actions",
    time_range: JSON.stringify({ since, until }),
    level: "ad",
    limit: 200
  });
  return payload.data || [];
}

async function ageInsights(campaignId, adsetId, since, resultAction) {
  const payload = await graph(`${campaignId}/insights`, {
    fields: "adset_id,spend,impressions,actions",
    time_range: JSON.stringify({ since, until: localDate() }),
    level: "adset",
    breakdowns: "age",
    limit: 100
  });
  const rows = (payload.data || []).filter((row) => row.adset_id === adsetId);
  const byAge = rows.map((row) => ({
    age: row.age,
    spend: number(row.spend),
    impressions: number(row.impressions),
    results: actionValue(row, resultAction)
  }));
  const provenAges = new Set(["35-44", "45-54"]);
  return {
    byAge,
    provenResults: byAge.filter((row) => provenAges.has(row.age)).reduce((sum, row) => sum + row.results, 0),
    outsideResults: byAge.filter((row) => !provenAges.has(row.age)).reduce((sum, row) => sum + row.results, 0)
  };
}

function summarize(rows, resultAction) {
  return rows.map((row) => ({
    campaignId: row.campaign_id,
    adsetId: row.adset_id,
    adId: row.ad_id,
    adName: row.ad_name,
    spend: number(row.spend),
    impressions: number(row.impressions),
    reach: number(row.reach),
    frequency: number(row.frequency),
    clicks: number(row.clicks),
    linkClicks: number(row.inline_link_clicks),
    ctr: number(row.ctr),
    results: actionValue(row, resultAction),
    landingPageViews: actionValue(row, "landing_page_view")
  }));
}

function minutesSince(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? (Date.now() - timestamp) / 60_000 : Number.POSITIVE_INFINITY;
}

function hoursSince(value) {
  return minutesSince(value) / 60;
}

function costPerResult(stat) {
  return stat?.results > 0 ? stat.spend / stat.results : Number.POSITIVE_INFINITY;
}

function rankCreatives(active, statsById, crm, qualitySignals = {}) {
  return active
    .map((ad) => {
      const creativeKey = CREATIVE_KEYS.get(ad.id);
      const formQuality = crm?.creativeQuality?.[creativeKey] || { total: 0, financiallyQualified: 0, priority: 0 };
      const manualQuality = qualitySignals[creativeKey] || { qualified: 0, averageScore: 0 };
      return {
        ad,
        stat: statsById.get(ad.id),
        crmQuality: {
          total: formQuality.total,
          financiallyQualified: formQuality.financiallyQualified + manualQuality.qualified,
          priority: formQuality.priority + manualQuality.qualified,
          manualQualified: manualQuality.qualified,
          manualAverageScore: manualQuality.averageScore
        }
      };
    })
    .filter((item) => item.stat)
    .sort((a, b) => {
      if (b.crmQuality.financiallyQualified !== a.crmQuality.financiallyQualified) {
        return b.crmQuality.financiallyQualified - a.crmQuality.financiallyQualified;
      }
      if (b.crmQuality.priority !== a.crmQuality.priority) return b.crmQuality.priority - a.crmQuality.priority;
      if (b.stat.results !== a.stat.results) return b.stat.results - a.stat.results;
      const costDifference = costPerResult(a.stat) - costPerResult(b.stat);
      if (Number.isFinite(costDifference) && costDifference !== 0) return costDifference;
      if (b.stat.ctr !== a.stat.ctr) return b.stat.ctr - a.stat.ctr;
      return b.stat.landingPageViews - a.stat.landingPageViews;
    });
}

function winnerSummary(ranked) {
  const winner = ranked[0];
  if (!winner) return null;
  return {
    adId: winner.ad.id,
    adName: winner.ad.name,
    results: winner.stat.results,
    spend: winner.stat.spend,
    costPerResult: Number.isFinite(costPerResult(winner.stat)) ? costPerResult(winner.stat) : null,
    ctr: winner.stat.ctr,
    crmFinanciallyQualified: winner.crmQuality.financiallyQualified,
    crmPriority: winner.crmQuality.priority
  };
}

async function optimizationHistory() {
  const { rows } = await pool.query(
    `
      select created_at, metadata
      from whatsapp_bot.traffic_events
      where event_type in ('eurocamp_cloud_optimizer_action', 'eurocamp_cloud_guardrail_pause')
        and created_at >= now() - interval '96 hours'
      order by created_at desc
    `
  );
  return rows.flatMap((row) => {
    const actions = Array.isArray(row.metadata?.actions) ? row.metadata.actions : [];
    return actions.map((action) => ({ ...action, recordedAt: row.created_at }));
  });
}

function recentMutation(history, hours = RULES.optimizationCooldownHours) {
  return history.find((action) => !String(action.type || "").startsWith("would_") && hoursSince(action.recordedAt) < hours) || null;
}

function lastAudienceRefinement(history, scope) {
  return history.find((action) => action.type === "refined_audience" && action.scope === scope) || null;
}

function lastPlacementExpansion(history, scope) {
  return history.find((action) => action.type === "expanded_instagram_placements" && action.scope === scope) || null;
}

async function crmLeadSummary(since) {
  const { rows } = await pool.query(
    `
      select
        te.id,
        te.client_id,
        te.quality_score as lead_score,
        te.service_interest,
        coalesce(te.metadata->>'utmContent', c.utm_content) as utm_content,
        coalesce(te.metadata->>'utmCampaign', c.utm_campaign) as utm_campaign,
        coalesce(te.metadata, c.attribution_metadata, '{}'::jsonb) as attribution_metadata
      from whatsapp_bot.traffic_events te
      left join whatsapp_bot.clients c on c.id = te.client_id
      where te.created_at >= (($1::date)::timestamp at time zone $2)
        and te.event_type in (
          'eurocamp_waitlist_submitted',
          'eurocamp_waitlist_decision_pending',
          'eurocamp_waitlist_followup_pending',
          'eurocamp_lead_reoriented_career_plan'
        )
    `,
    [since, TIME_ZONE]
  );
  const tiers = {};
  const creatives = {};
  const creativeQuality = {};
  for (const row of rows) {
    const metadata = row.attribution_metadata && typeof row.attribution_metadata === "object"
      ? row.attribution_metadata
      : {};
    const tier = String(metadata.qualification_tier || metadata.qualificationTier || "sem_classificacao");
    const creative = String(row.utm_content || "sem_criativo");
    const financiallyQualified = tier.startsWith("eurocamp_");
    const priority = tier === "eurocamp_prioritario";
    tiers[tier] = (tiers[tier] || 0) + 1;
    creatives[creative] = (creatives[creative] || 0) + 1;
    creativeQuality[creative] ||= { total: 0, financiallyQualified: 0, priority: 0 };
    creativeQuality[creative].total += 1;
    if (financiallyQualified) creativeQuality[creative].financiallyQualified += 1;
    if (priority) creativeQuality[creative].priority += 1;
  }
  return {
    total: rows.length,
    uniqueClients: new Set(rows.map((row) => row.client_id).filter(Boolean)).size,
    campaignAttributed: rows.filter((row) => row.utm_campaign === "eurocamp_2027_ig_leads_qualificada").length,
    financiallyQualified: rows.filter((row) => {
      const metadata = row.attribution_metadata && typeof row.attribution_metadata === "object"
        ? row.attribution_metadata
        : {};
      const tier = String(metadata.qualification_tier || metadata.qualificationTier || "");
      return tier.startsWith("eurocamp_");
    }).length,
    tiers,
    creatives,
    creativeQuality
  };
}

async function crmQualitySignals(since) {
  const { rows } = await pool.query(
    `
      select
        coalesce(metadata->>'sourceCreative', metadata->>'source_creative', 'sem_criativo') as creative,
        count(*)::int as qualified,
        avg(coalesce(quality_score, 0))::numeric as average_score
      from whatsapp_bot.traffic_events
      where created_at >= (($1::date)::timestamp at time zone $2)
        and event_type = 'QualifiedLead'
        and platform = 'meta_ads'
      group by 1
    `,
    [since, TIME_ZONE]
  );
  return Object.fromEntries(rows.map((row) => [row.creative, {
    qualified: number(row.qualified),
    averageScore: number(row.average_score)
  }]));
}

async function pauseAd(ad, reason, actions, scope) {
  if (DRY_RUN) {
    actions.push({ type: "would_pause_ad", scope, adId: ad.id, adName: ad.name, reason });
    return;
  }
  await graph(ad.id, { status: "PAUSED" }, "POST");
  actions.push({ type: "paused_ad", scope, adId: ad.id, adName: ad.name, reason });
}

async function pauseAdset(adsetId, reason, actions, scope) {
  if (DRY_RUN) {
    actions.push({ type: "would_pause_adset", scope, adsetId, reason });
    return;
  }
  await graph(adsetId, { status: "PAUSED" }, "POST");
  actions.push({ type: "paused_adset", scope, adsetId, reason });
}

async function refineAudience(adset, scope, spendAtAction, date, evidence, actions) {
  const currentTargeting = adset?.targeting && typeof adset.targeting === "object" ? adset.targeting : null;
  if (!currentTargeting) return false;
  if (
    number(currentTargeting.age_min) === RULES.audienceRefineAgeMin
    && number(currentTargeting.age_max) === RULES.audienceRefineAgeMax
  ) return false;

  const targeting = JSON.parse(JSON.stringify(currentTargeting));
  targeting.age_min = RULES.audienceRefineAgeMin;
  targeting.age_max = RULES.audienceRefineAgeMax;
  const action = {
    type: DRY_RUN ? "would_refine_audience" : "refined_audience",
    scope,
    adsetId: adset.id,
    previousAgeMin: currentTargeting.age_min,
    previousAgeMax: currentTargeting.age_max,
    ageMin: targeting.age_min,
    ageMax: targeting.age_max,
    spendAtAction,
    localDate: date,
    evidence,
    reason: "Resultados comprovados concentrados em pais de 35 a 54 anos; remove apenas faixas sem conversao."
  };
  if (!DRY_RUN) await graph(adset.id, { targeting: JSON.stringify(targeting) }, "POST");
  actions.push(action);
  return true;
}

function nextGeoFallbackTier(adset) {
  const currentCities = Array.isArray(adset?.targeting?.geo_locations?.cities)
    ? adset.targeting.geo_locations.cities
    : [];
  const existingKeys = new Set(currentCities.map((city) => String(city.key)));
  for (const tier of GEO_FALLBACK_TIERS) {
    const additions = tier.cities.filter((city) => !existingKeys.has(city.key));
    if (additions.length) return { ...tier, additions };
  }
  return null;
}

function geoFallbackThreshold(scope, tier) {
  const tierOffset = Math.max(0, number(tier) - 1);
  const minimumSpend = scope === "lead"
    ? RULES.leadGeoExpansionMinimumSpend + tierOffset * RULES.leadGeoExpansionSpendStep
    : RULES.directGeoExpansionMinimumSpend + tierOffset * RULES.directGeoExpansionSpendStep;
  return {
    minimumSpend,
    minimumImpressions: RULES.audienceRefineMinimumImpressions
      + tierOffset * RULES.geoExpansionImpressionStep
  };
}

async function expandQualifiedGeo(adset, scope, fallbackTier, spendAtAction, date, actions) {
  const currentTargeting = adset?.targeting && typeof adset.targeting === "object" ? adset.targeting : null;
  if (!currentTargeting || !fallbackTier) return false;
  const targeting = JSON.parse(JSON.stringify(currentTargeting));
  targeting.geo_locations ||= {};
  const currentCities = Array.isArray(targeting.geo_locations.cities) ? targeting.geo_locations.cities : [];
  const existingKeys = new Set(currentCities.map((city) => String(city.key)));
  const additions = fallbackTier.cities.filter((city) => !existingKeys.has(city.key));
  if (!additions.length) return false;
  targeting.geo_locations.cities = [...currentCities, ...additions];
  const action = {
    type: DRY_RUN ? "would_expand_qualified_geo" : "expanded_qualified_geo",
    scope,
    adsetId: adset.id,
    geoTier: fallbackTier.tier,
    tierName: fallbackTier.name,
    addedCities: additions.map((city) => city.name),
    spendAtAction,
    localDate: date,
    reason: `Etapa geografica ${fallbackTier.tier}: amplia somente apos falta de resultado e mantem pais e responsaveis como filtro.`
  };
  if (!DRY_RUN) await graph(adset.id, { targeting: JSON.stringify(targeting) }, "POST");
  actions.push(action);
  return true;
}

async function expandInstagramPlacements(adset, scope, spendAtAction, date, actions) {
  const currentTargeting = adset?.targeting && typeof adset.targeting === "object" ? adset.targeting : null;
  if (!currentTargeting) return false;
  const targeting = JSON.parse(JSON.stringify(currentTargeting));
  const positions = new Set(Array.isArray(targeting.instagram_positions) ? targeting.instagram_positions : []);
  if (positions.has("explore_home")) return false;
  positions.add("explore_home");
  targeting.instagram_positions = [...positions];
  const action = {
    type: DRY_RUN ? "would_expand_instagram_placements" : "expanded_instagram_placements",
    scope,
    adsetId: adset.id,
    addedPlacement: "explore_home",
    spendAtAction,
    localDate: date,
    reason: "Baixa entrega ate o meio do dia; amplia inventario Instagram sem abrir Facebook ou Audience Network."
  };
  if (!DRY_RUN) await graph(adset.id, { targeting: JSON.stringify(targeting) }, "POST");
  actions.push(action);
  return true;
}

function activeAds(ads) {
  return ads.filter((ad) => ad.status === "ACTIVE" && !HISTORICAL_ADSET_IDS.has(ad.adset_id));
}

async function recordRun(summary) {
  if (DRY_RUN) return;
  const eventType = summary.actions.length
    ? "eurocamp_cloud_optimizer_action"
    : "eurocamp_cloud_monitor_run";
  await pool.query(
    `
      insert into whatsapp_bot.traffic_events
        (event_type, channel, platform, service_interest, quality_score, value,
         campaign_id, campaign_name, adset_id, metadata)
      values
        ($1, 'cloud_monitor', 'meta_ads', 'eurocamp', $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      eventType,
      summary.actions.length ? 55 : summary.alerts?.length ? 75 : 100,
      summary.leadCampaign.spend,
      LEAD_CAMPAIGN_ID,
      "EUROCAMP 2027 | IG | LEADS QUALIFICADOS | R$40D | FINAL",
      LEAD_ADSET_ID,
      JSON.stringify(summary)
    ]
  );
}

async function main() {
  const checkedAt = new Date().toISOString();
  const since = localDate();
  const currentHour = localHour();
  const [
    leadObjects,
    directObjects,
    leadAdset,
    directAdset,
    leadRows,
    directRows,
    rollingLeadRows,
    rollingDirectRows,
    crm,
    rollingCrm,
    qualitySignals,
    account,
    history
  ] = await Promise.all([
    adsetAds(LEAD_ADSET_ID),
    adsetAds(DIRECT_ADSET_ID),
    adsetDetails(LEAD_ADSET_ID),
    adsetDetails(DIRECT_ADSET_ID),
    adInsights(LEAD_CAMPAIGN_ID, since),
    adInsights(DIRECT_CAMPAIGN_ID, since),
    adInsights(LEAD_CAMPAIGN_ID, CAMPAIGN_START_DATE, since),
    adInsights(DIRECT_CAMPAIGN_ID, CAMPAIGN_START_DATE, since),
    crmLeadSummary(since),
    crmLeadSummary(CAMPAIGN_START_DATE),
    crmQualitySignals(CAMPAIGN_START_DATE),
    adAccountStatus(),
    optimizationHistory()
  ]);

  const leadStats = summarize(leadRows.filter((row) => row.adset_id === LEAD_ADSET_ID), "lead");
  const directStats = summarize(
    directRows.filter((row) => row.adset_id === DIRECT_ADSET_ID),
    "onsite_conversion.messaging_conversation_started_7d"
  );
  const rollingLeadStats = summarize(
    rollingLeadRows.filter((row) => row.adset_id === LEAD_ADSET_ID),
    "lead"
  );
  const rollingDirectStats = summarize(
    rollingDirectRows.filter((row) => row.adset_id === DIRECT_ADSET_ID),
    "onsite_conversion.messaging_conversation_started_7d"
  );
  const rollingLeadById = new Map(rollingLeadStats.map((row) => [row.adId, row]));
  const rollingDirectById = new Map(rollingDirectStats.map((row) => [row.adId, row]));
  const actions = [];
  const alerts = [];
  const cooldownAction = recentMutation(history);

  for (const ad of [...leadObjects, ...directObjects]) {
    if (["DISAPPROVED", "WITH_ISSUES", "ERROR"].includes(ad.effective_status)) {
      alerts.push({
        type: "ad_delivery_problem",
        adId: ad.id,
        adName: ad.name,
        effectiveStatus: ad.effective_status,
        issues: ad.issues_info || []
      });
    }
  }
  if (account.status !== 1 || account.disableReason !== 0) {
    alerts.push({ type: "ad_account_problem", status: account.status, disableReason: account.disableReason });
  }
  if (account.spendCap > 0 && account.headroom < 40) {
    alerts.push({
      type: "account_spend_cap_low",
      message: `Restam R$${account.headroom.toFixed(2)} ate o teto de gastos da conta.`
    });
  }

  const leadActive = activeAds(leadObjects);
  const directActive = activeAds(directObjects);
  const leadRanked = rankCreatives(leadActive, rollingLeadById, rollingCrm, qualitySignals);
  const directRanked = rankCreatives(directActive, rollingDirectById, rollingCrm, qualitySignals);
  const leadWinner = winnerSummary(leadRanked);
  const directWinner = winnerSummary(directRanked);
  const canMutate = () => !cooldownAction && actions.length === 0;

  // Uma unica alteracao por janela de cooldown. A Meta continua distribuindo
  // verba dentro do conjunto; o otimizador apenas retira perdedores comprovados.
  if (canMutate()) {
    const absoluteLosers = leadRanked
      .slice(1)
      .filter(({ ad, stat }) => minutesSince(ad.created_time) >= RULES.minimumAgeMinutes
        && stat.results === 0
        && (
          (stat.spend >= RULES.leadAdMaxSpendWithoutResult && stat.impressions >= RULES.leadAdMinImpressions)
          || (stat.impressions >= RULES.lowCtrMinimumImpressions && stat.ctr < RULES.lowCtrThreshold)
          || (stat.frequency >= RULES.maximumHealthyFrequency && stat.ctr < RULES.lowCtrThreshold)
        ))
      .sort((a, b) => b.stat.spend - a.stat.spend);
    if (absoluteLosers.length && leadActive.length > RULES.leadMinimumActiveAds) {
      const { ad, stat } = absoluteLosers[0];
      await pauseAd(
        ad,
        `Criativo sem lead: R$${stat.spend.toFixed(2)} e ${stat.impressions} impressoes; vencedor protegido.`,
        actions,
        "lead"
      );
    }
  }

  if (canMutate() && leadRanked[0]?.stat.results >= RULES.winnerMinimumResults) {
    const winnerCost = costPerResult(leadRanked[0].stat);
    const relativeLoser = leadRanked.slice(1).find(({ stat, crmQuality }) => stat.results > 0
      && crmQuality.financiallyQualified <= leadRanked[0].crmQuality.financiallyQualified
      && stat.spend >= RULES.leadLoserMinimumSpend
      && costPerResult(stat) >= winnerCost * RULES.loserCostRatio);
    if (relativeLoser && leadActive.length > RULES.leadMinimumActiveAds) {
      await pauseAd(
        relativeLoser.ad,
        `CPL R$${costPerResult(relativeLoser.stat).toFixed(2)} contra R$${winnerCost.toFixed(2)} do vencedor (${RULES.loserCostRatio}x ou pior).`,
        actions,
        "lead"
      );
    }
  }

  if (canMutate()) {
    const absoluteLosers = directRanked
      .slice(1)
      .filter(({ ad, stat }) => minutesSince(ad.created_time) >= RULES.minimumAgeMinutes
        && stat.results === 0
        && (
          (stat.spend >= RULES.directAdMaxSpendWithoutResult && stat.impressions >= RULES.directAdMinImpressions)
          || (stat.impressions >= RULES.lowCtrMinimumImpressions && stat.ctr < RULES.lowCtrThreshold)
          || (stat.frequency >= RULES.maximumHealthyFrequency && stat.ctr < RULES.lowCtrThreshold)
        ))
      .sort((a, b) => b.stat.spend - a.stat.spend);
    if (absoluteLosers.length && directActive.length > RULES.directMinimumActiveAds) {
      const { ad, stat } = absoluteLosers[0];
      await pauseAd(
        ad,
        `Criativo sem conversa: R$${stat.spend.toFixed(2)} e ${stat.impressions} impressoes; vencedor protegido.`,
        actions,
        "direct"
      );
    }
  }

  if (canMutate() && directRanked[0]?.stat.results >= RULES.winnerMinimumResults) {
    const winnerCost = costPerResult(directRanked[0].stat);
    const relativeLoser = directRanked.slice(1).find(({ stat }) => stat.results > 0
      && stat.spend >= RULES.directLoserMinimumSpend
      && costPerResult(stat) >= winnerCost * RULES.loserCostRatio);
    if (relativeLoser && directActive.length > RULES.directMinimumActiveAds) {
      await pauseAd(
        relativeLoser.ad,
        `Custo por conversa R$${costPerResult(relativeLoser.stat).toFixed(2)} contra R$${winnerCost.toFixed(2)} do vencedor.`,
        actions,
        "direct"
      );
    }
  }

  const leadCampaign = {
    spend: leadStats.reduce((sum, row) => sum + row.spend, 0),
    impressions: leadStats.reduce((sum, row) => sum + row.impressions, 0),
    linkClicks: leadStats.reduce((sum, row) => sum + row.linkClicks, 0),
    landingPageViews: leadStats.reduce((sum, row) => sum + row.landingPageViews, 0),
    metaLeads: leadStats.reduce((sum, row) => sum + row.results, 0)
  };
  const directCampaign = {
    spend: directStats.reduce((sum, row) => sum + row.spend, 0),
    impressions: directStats.reduce((sum, row) => sum + row.impressions, 0),
    conversations: directStats.reduce((sum, row) => sum + row.results, 0)
  };

  const landingViewRate = leadCampaign.linkClicks > 0
    ? leadCampaign.landingPageViews / leadCampaign.linkClicks
    : null;
  const landingConversionRate = leadCampaign.landingPageViews > 0
    ? Math.max(leadCampaign.metaLeads, crm.campaignAttributed) / leadCampaign.landingPageViews
    : null;
  const funnelDiagnosis = {
    landingViewRate,
    landingConversionRate,
    status: leadCampaign.linkClicks < RULES.funnelMinimumLinkClicks
      ? "insufficient_click_sample"
      : landingViewRate < RULES.minimumLandingViewRate
        ? "landing_or_connection_friction"
        : landingConversionRate < RULES.minimumLandingConversionRate
          ? "audience_or_offer_mismatch"
          : "healthy"
  };
  if (funnelDiagnosis.status === "landing_or_connection_friction") {
    alerts.push({
      type: "landing_friction",
      message: `${leadCampaign.linkClicks} cliques e ${leadCampaign.landingPageViews} visitas carregadas; revisar velocidade antes de culpar o publico.`
    });
  }

  let leadAgeEvidence = null;
  let directAgeEvidence = null;
  const previousLeadRefinement = lastAudienceRefinement(history, "lead");
  const previousDirectRefinement = lastAudienceRefinement(history, "direct");
  const previousLeadPlacementExpansion = lastPlacementExpansion(history, "lead");
  const previousDirectPlacementExpansion = lastPlacementExpansion(history, "direct");
  const leadGeoFallback = nextGeoFallbackTier(leadAdset);
  const directGeoFallback = nextGeoFallbackTier(directAdset);
  const leadGeoThreshold = leadGeoFallback
    ? geoFallbackThreshold("lead", leadGeoFallback.tier)
    : null;
  const directGeoThreshold = directGeoFallback
    ? geoFallbackThreshold("direct", directGeoFallback.tier)
    : null;

  if (
    canMutate()
    && !previousLeadPlacementExpansion
    && currentHour >= RULES.underdeliveryCheckHour
    && leadCampaign.metaLeads === 0
    && leadCampaign.spend < RULES.underdeliveryMaximumSpend
    && leadCampaign.impressions < RULES.audienceRefineMinimumImpressions
  ) {
    await expandInstagramPlacements(leadAdset, "lead", leadCampaign.spend, since, actions);
  }

  if (
    canMutate()
    && !previousDirectPlacementExpansion
    && currentHour >= RULES.underdeliveryCheckHour
    && directCampaign.conversations === 0
    && directCampaign.spend < RULES.underdeliveryMaximumSpend
    && directCampaign.impressions < RULES.audienceRefineMinimumImpressions
  ) {
    await expandInstagramPlacements(directAdset, "direct", directCampaign.spend, since, actions);
  }

  if (
    canMutate()
    && leadGeoFallback
    && currentHour >= RULES.audienceRefineMinimumHour
    && leadCampaign.metaLeads === 0
    && crm.total === 0
    && leadCampaign.spend >= leadGeoThreshold.minimumSpend
    && leadCampaign.impressions >= leadGeoThreshold.minimumImpressions
  ) {
    await expandQualifiedGeo(leadAdset, "lead", leadGeoFallback, leadCampaign.spend, since, actions);
  }

  if (
    canMutate()
    && directGeoFallback
    && currentHour >= RULES.audienceRefineMinimumHour
    && directCampaign.conversations === 0
    && directCampaign.spend >= directGeoThreshold.minimumSpend
    && directCampaign.impressions >= directGeoThreshold.minimumImpressions
  ) {
    await expandQualifiedGeo(directAdset, "direct", directGeoFallback, directCampaign.spend, since, actions);
  }

  if (
    canMutate()
    && !previousLeadRefinement
    && !leadGeoFallback
    && currentHour >= RULES.audienceRefineMinimumHour
    && leadCampaign.metaLeads === 0
    && crm.total === 0
    && leadCampaign.spend >= RULES.leadAudienceRefineMinimumSpend
    && leadCampaign.impressions >= RULES.audienceRefineMinimumImpressions
  ) {
    leadAgeEvidence = await ageInsights(LEAD_CAMPAIGN_ID, LEAD_ADSET_ID, CAMPAIGN_START_DATE, "lead");
    if (leadAgeEvidence.provenResults >= 2 && leadAgeEvidence.outsideResults === 0) {
      await refineAudience(leadAdset, "lead", leadCampaign.spend, since, leadAgeEvidence, actions);
    }
  }

  if (
    canMutate()
    && !previousDirectRefinement
    && !directGeoFallback
    && currentHour >= RULES.audienceRefineMinimumHour
    && directCampaign.conversations === 0
    && directCampaign.spend >= RULES.directAudienceRefineMinimumSpend
    && directCampaign.impressions >= RULES.audienceRefineMinimumImpressions
  ) {
    directAgeEvidence = await ageInsights(
      DIRECT_CAMPAIGN_ID,
      DIRECT_ADSET_ID,
      CAMPAIGN_START_DATE,
      "onsite_conversion.messaging_conversation_started_7d"
    );
    if (directAgeEvidence.provenResults >= 2 && directAgeEvidence.outsideResults === 0) {
      await refineAudience(directAdset, "direct", directCampaign.spend, since, directAgeEvidence, actions);
    }
  }

  if (leadCampaign.metaLeads > crm.campaignAttributed) {
    alerts.push({
      type: "meta_crm_gap",
      message: `Meta registra ${leadCampaign.metaLeads} lead(s), CRM registra ${crm.campaignAttributed} envio(s) com UTM da campanha hoje; pode haver atribuicao por visualizacao ou perda de UTM.`
    });
  } else if (crm.campaignAttributed > leadCampaign.metaLeads) {
    alerts.push({
      type: "crm_meta_gap",
      message: `CRM registra ${crm.campaignAttributed} envio(s) com UTM, Meta registra ${leadCampaign.metaLeads} lead(s) atribuido(s) hoje.`
    });
  }

  const leadRefinement = previousLeadRefinement || actions.find((action) => action.type === "refined_audience" && action.scope === "lead");
  const refinementReadyToJudge = leadRefinement
    && hoursSince(leadRefinement.recordedAt || checkedAt) >= RULES.audienceGraceHours
    && (
      leadRefinement.localDate === since
        ? leadCampaign.spend >= number(leadRefinement.spendAtAction) + RULES.audienceGraceAdditionalSpend
        : leadCampaign.spend >= RULES.audienceGraceAdditionalSpend
    );
  const stabilizationInProgress = Boolean(cooldownAction || actions.length || (leadRefinement && !refinementReadyToJudge));

  if (
    currentHour >= RULES.campaignMinimumHours
    && leadCampaign.spend >= RULES.campaignMaxSpendWithoutLead
    && leadCampaign.metaLeads === 0
    && crm.total === 0
    && !stabilizationInProgress
    && (previousLeadRefinement ? refinementReadyToJudge : currentHour >= 12)
  ) {
    await pauseAdset(
      LEAD_ADSET_ID,
      `Protecao diaria: R$${leadCampaign.spend.toFixed(2)} sem lead Meta ou CRM`,
      actions,
      "lead"
    );
  }

  const optimizer = {
    mode: "adaptive",
    evaluationIntervalMinutes: 15,
    mutationCooldownHours: RULES.optimizationCooldownHours,
    cooldownActive: Boolean(cooldownAction),
    lastMutation: cooldownAction
      ? { type: cooldownAction.type, scope: cooldownAction.scope, recordedAt: cooldownAction.recordedAt }
      : null,
    leadWinner,
    directWinner,
    leadAgeEvidence,
    directAgeEvidence,
    funnelDiagnosis,
    policy: {
      maximumMutationsPerRun: 1,
      protectsWinner: true,
      keepsLeadAdsActive: RULES.leadMinimumActiveAds,
      keepsDirectAdsActive: RULES.directMinimumActiveAds,
      audienceChangesRequireHistoricalConversions: true,
      prioritizesCrmFinancialQuality: true,
      usesManualIdealCustomerSignals: true,
      canExpandQualifiedLocations: true,
      geoFallbackTiers: GEO_FALLBACK_TIERS.map(({ tier, name, cities }) => ({
        tier,
        name,
        cities: cities.map((city) => city.name),
        leadThreshold: geoFallbackThreshold("lead", tier),
        directThreshold: geoFallbackThreshold("direct", tier)
      })),
      nextLeadGeoFallback: leadGeoFallback
        ? { tier: leadGeoFallback.tier, name: leadGeoFallback.name, threshold: leadGeoThreshold }
        : null,
      nextDirectGeoFallback: directGeoFallback
        ? { tier: directGeoFallback.tier, name: directGeoFallback.name, threshold: directGeoThreshold }
        : null,
      canExpandInstagramInventory: true,
      canRefineAgeRange: true,
      neverRaisesBudgetAutomatically: true
    }
  };

  const summary = {
    ok: true,
    dryRun: DRY_RUN,
    checkedAt,
    localDate: since,
    rules: RULES,
    account,
    leadCampaign,
    directCampaign,
    crm,
    rollingCrm,
    qualitySignals,
    leadAds: leadStats,
    directAds: directStats,
    rollingLeadAds: rollingLeadStats,
    rollingDirectAds: rollingDirectStats,
    optimizer,
    alerts,
    actions
  };
  await recordRun(summary);
  console.log(JSON.stringify(summary));
}

main()
  .catch(async (error) => {
    const failure = { ok: false, checkedAt: new Date().toISOString(), error: error.message };
    console.error(JSON.stringify(failure));
    if (!DRY_RUN) {
      await pool.query(
        `insert into whatsapp_bot.traffic_events
          (event_type, channel, platform, service_interest, quality_score, metadata)
         values ('eurocamp_cloud_optimizer_error', 'cloud_monitor', 'meta_ads', 'eurocamp', 20, $1::jsonb)`,
        [JSON.stringify(failure)]
      ).catch(() => undefined);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
