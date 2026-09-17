import pg from "pg";

const campaignId = process.env.LIBERTACADEMY_CAMPAIGN_ID || "120248386089530601";
const accountId = String(process.env.META_AD_ACCOUNT_ID || "act_1235838336986319").startsWith("act_")
  ? String(process.env.META_AD_ACCOUNT_ID || "act_1235838336986319")
  : `act_${process.env.META_AD_ACCOUNT_ID}`;
const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const graphVersion = process.env.META_GRAPH_API_VERSION || "v25.0";
const dbUrl = process.env.SUPABASE_DB_URL;

if (!token) throw new Error("META_SYSTEM_USER_ACCESS_TOKEN ausente.");

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Number(number(value).toFixed(2));
}

async function graph(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Meta HTTP ${response.status}`);
  return payload;
}

async function graphRows(path, params = {}) {
  const rows = [];
  let payload = await graph(path, params);
  rows.push(...(payload.data || []));
  while (payload.paging?.next) {
    const response = await fetch(payload.paging.next, { signal: AbortSignal.timeout(30000) });
    payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Meta HTTP ${response.status}`);
    rows.push(...(payload.data || []));
  }
  return rows;
}

function actionsMap(actions = []) {
  return Object.fromEntries(actions.map((item) => [item.action_type, number(item.value)]));
}

function preferredAction(map, names) {
  for (const name of names) if (map[name] !== undefined) return map[name];
  return 0;
}

function summarize(rows) {
  const totals = {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    linkClicks: 0,
    landingPageViews: 0,
    leads: 0,
    contacts: 0,
    videoPlays: 0,
    thruPlays: 0,
    video25: 0,
    video50: 0,
    video100: 0,
  };
  for (const row of rows) {
    const actions = actionsMap(row.actions);
    totals.spend += number(row.spend);
    totals.impressions += number(row.impressions);
    totals.reach += number(row.reach);
    totals.clicks += number(row.clicks);
    totals.linkClicks += preferredAction(actions, ["link_click"]);
    totals.landingPageViews += preferredAction(actions, ["landing_page_view"]);
    totals.leads += preferredAction(actions, ["offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped", "lead"]);
    totals.contacts += preferredAction(actions, ["offsite_conversion.fb_pixel_contact", "contact"]);
    totals.videoPlays += preferredAction(actionsMap(row.video_play_actions), ["video_view"]);
    totals.thruPlays += preferredAction(actionsMap(row.video_thruplay_watched_actions), ["video_view"]);
    totals.video25 += preferredAction(actionsMap(row.video_p25_watched_actions), ["video_view"]);
    totals.video50 += preferredAction(actionsMap(row.video_p50_watched_actions), ["video_view"]);
    totals.video100 += preferredAction(actionsMap(row.video_p100_watched_actions), ["video_view"]);
  }
  return {
    ...totals,
    spend: money(totals.spend),
    ctr: totals.impressions ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0,
    linkCtr: totals.impressions ? Number(((totals.linkClicks / totals.impressions) * 100).toFixed(2)) : 0,
    cpm: totals.impressions ? money((totals.spend / totals.impressions) * 1000) : 0,
    cpc: totals.clicks ? money(totals.spend / totals.clicks) : 0,
    costPerLinkClick: totals.linkClicks ? money(totals.spend / totals.linkClicks) : 0,
    costPerLandingPageView: totals.landingPageViews ? money(totals.spend / totals.landingPageViews) : 0,
    costPerLead: totals.leads ? money(totals.spend / totals.leads) : 0,
    clickToLandingRate: totals.linkClicks ? Number(((totals.landingPageViews / totals.linkClicks) * 100).toFixed(1)) : 0,
    landingToLeadRate: totals.landingPageViews ? Number(((totals.leads / totals.landingPageViews) * 100).toFixed(1)) : 0,
    videoCompletionRate: totals.videoPlays ? Number(((totals.video100 / totals.videoPlays) * 100).toFixed(1)) : 0,
    frequency: totals.reach ? Number((totals.impressions / totals.reach).toFixed(2)) : 0,
  };
}

const insightFields = [
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "actions",
  "video_play_actions", "video_thruplay_watched_actions", "video_p25_watched_actions",
  "video_p50_watched_actions", "video_p100_watched_actions",
  "date_start", "date_stop",
].join(",");

const campaign = await graph(campaignId, {
  fields: "id,name,status,effective_status,configured_status,objective,start_time,stop_time,created_time,updated_time,budget_remaining",
});
const startDate = String(campaign.start_time || campaign.created_time || new Date().toISOString()).slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

const [account, adsets, ads, lifetimeRows, todayRows] = await Promise.all([
  graph(accountId, { fields: "id,name,account_status,disable_reason,currency,timezone_name,amount_spent,balance,funding_source_details" }),
  graphRows(`${campaignId}/adsets`, {
    fields: "id,name,status,effective_status,configured_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,optimization_goal,billing_event,updated_time",
    limit: "100",
  }),
  graphRows(`${campaignId}/ads`, {
    fields: "id,name,status,effective_status,configured_status,adset_id,updated_time,issues_info",
    limit: "100",
  }),
  graphRows(`${campaignId}/insights`, {
    level: "ad",
    fields: insightFields,
    time_range: { since: startDate, until: today },
    time_increment: "1",
    limit: "500",
  }),
  graphRows(`${campaignId}/insights`, {
    level: "ad",
    fields: insightFields,
    time_range: { since: today, until: today },
    limit: "500",
  }),
]);

const byAdset = adsets.map((adset) => {
  const rows = lifetimeRows.filter((row) => row.adset_id === adset.id);
  return {
    id: adset.id,
    name: adset.name,
    status: adset.status,
    effectiveStatus: adset.effective_status,
    dailyBudget: money(number(adset.daily_budget) / 100),
    endTime: adset.end_time || null,
    ...summarize(rows),
  };
});

const byAd = ads.map((ad) => {
  const rows = lifetimeRows.filter((row) => row.ad_id === ad.id);
  return {
    id: ad.id,
    name: ad.name,
    adsetId: ad.adset_id,
    status: ad.status,
    effectiveStatus: ad.effective_status,
    issues: ad.issues_info || [],
    ...summarize(rows),
  };
});

let crm = { configured: false };
if (dbUrl) {
  const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    const result = await pool.query(`
      select
        count(*)::int as total,
        count(*) filter (where created_at::date = current_date)::int as today,
        count(*) filter (where coalesce(attribution_metadata ->> 'metaLeadAccepted', 'false') = 'true')::int as meta_accepted,
        count(*) filter (where nullif(fbclid, '') is not null or nullif(attribution_metadata ->> 'fbc', '') is not null)::int as meta_attributed,
        count(*) filter (where attribution_metadata ->> 'routedWhatsapp' = '553197767223')::int as routed_br,
        count(*) filter (where attribution_metadata ->> 'routedWhatsapp' = '5493512602033')::int as routed_ar,
        count(*) filter (where lower(coalesce(utm_source, '')) = 'meta')::int as utm_meta,
        min(created_at) as first_at,
        max(created_at) as last_at
      from public.clients
      where coalesce(tags, '{}') @> array['libertacademy_florianopolis_2027']::text[]
    `);
    const events = await pool.query(`
      select count(*)::int as total
      from public.traffic_events
      where event_type = 'libertacademy_lead_submitted'
    `);
    crm = { configured: true, ...result.rows[0], intakeEvents: events.rows[0]?.total || 0 };
  } finally {
    await pool.end();
  }
}

const landingStarted = performance.now();
const landingResponse = await fetch("https://ec10talentos.com/libertacademy-florianopolis/?health=traffic-audit", {
  headers: { "cache-control": "no-cache" },
  signal: AbortSignal.timeout(30000),
});
const landingHtml = await landingResponse.text();

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  account: {
    id: account.id,
    name: account.name,
    active: number(account.account_status) === 1 && number(account.disable_reason) === 0,
    currency: account.currency,
    timezone: account.timezone_name,
    balance: money(number(account.balance) / 100),
  },
  campaign: {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    effectiveStatus: campaign.effective_status,
    objective: campaign.objective,
    startTime: campaign.start_time || null,
    stopTime: campaign.stop_time || null,
    updatedTime: campaign.updated_time || null,
  },
  lifetime: summarize(lifetimeRows),
  today: summarize(todayRows),
  byAdset,
  byAd,
  delivery: {
    adsetsActive: adsets.filter((item) => item.effective_status === "ACTIVE").length,
    adsetsTotal: adsets.length,
    adsActive: ads.filter((item) => item.effective_status === "ACTIVE").length,
    adsInReview: ads.filter((item) => ["PENDING_REVIEW", "PREAPPROVED"].includes(item.effective_status)).length,
    adsWithIssues: ads.filter((item) => Array.isArray(item.issues_info) && item.issues_info.length).length,
    adsTotal: ads.length,
  },
  crm,
  landing: {
    status: landingResponse.status,
    responseMs: Math.round(performance.now() - landingStarted),
    hasForm: landingHtml.includes("liberta-lead-form"),
    hasPixel: landingHtml.includes("834310425674029") || landingHtml.includes("fbevents"),
    bytes: Buffer.byteLength(landingHtml),
  },
}, null, 2));
