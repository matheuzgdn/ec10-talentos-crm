/**
 * Eurocamp 2027 LATAM
 *
 * Auditoria: node scripts/launch-eurocamp-latam-meta.mjs
 * Montagem pausada: node scripts/launch-eurocamp-latam-meta.mjs --apply --budget=29100
 * Ativacao: node scripts/launch-eurocamp-latam-meta.mjs --activate --budget=29100
 */

import fs from "node:fs/promises";
import path from "node:path";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "1235838336986319");
const PAGE_ID = process.env.META_PAGE_ID || "100627363090555";
const INSTAGRAM_ID = process.env.META_EC10_INSTAGRAM_ID || process.env.META_INSTAGRAM_BUSINESS_ID || "17841444199647209";
const PIXEL_ID = process.env.META_PIXEL_ID || "834310425674029";
const CAMPAIGN_NAME = "EUROCAMP 2027 | AR + CL + PY | ADVANTAGE+ | LEADS ES | R$291 | 3D";
const TOTAL_BUDGET = 29_100;
const REQUESTED_BUDGET = Number(process.argv.find((item) => item.startsWith("--budget="))?.split("=")[1] || 0);
const APPLY = process.argv.includes("--apply") || process.argv.includes("--activate");
const ACTIVATE = process.argv.includes("--activate");
const LANDING_URL = "https://ec10talentos.com/eurocamp/?lang=es";
const CREATIVE_PATH = "C:\\Users\\Admin\\Desktop\\EC10-MANAGER\\ec10-manager\\public\\videos\\eurocamp-eric-espanhol-prova-social.mp4";
const COVER_PATH = "C:\\Users\\Admin\\Desktop\\EC10-MANAGER\\ec10-manager\\public\\videos\\eurocamp-eric-espanhol-prova-social-poster.jpg";
const OUTPUT_PATH = path.resolve("reports", "eurocamp-latam-launch-state.json");

const dailyPhases = [
  { day: 1, share: 40, budget: 11_640 },
  { day: 2, share: 30, budget: 8_730 },
  { day: 3, share: 30, budget: 8_730 },
];
const parentStatuses = [
  { id: "6023005681983", name: "Parents with teenagers (13-17 years)" },
  { id: "6023080302983", name: "Parents with preteens (09-12 years)" },
];
const spanishLatamCountries = ["AR", "CL", "PY"];

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID || !PIXEL_ID) {
  throw new Error("Perfil ec10-manager incompleto para a campanha Eurocamp LATAM.");
}
if (APPLY && REQUESTED_BUDGET !== TOTAL_BUDGET) {
  throw new Error("Operacao bloqueada: confirme exatamente --budget=29100 (R$291,00 total).");
}
if (dailyPhases.reduce((sum, phase) => sum + phase.budget, 0) !== TOTAL_BUDGET) {
  throw new Error("Distribuicao 40/30/30 nao fecha R$291,00.");
}

function normalizeAccountId(value) {
  return String(value).startsWith("act_") ? String(value) : `act_${value}`;
}

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [error.message || `Meta HTTP ${status}`, error.error_user_title, error.error_user_msg]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 1600);
}

async function metaGet(resource, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  url.searchParams.set("access_token", TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function metaPost(resource, body) {
  if (!APPLY) throw new Error("POST bloqueado em auditoria.");
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  form.set("access_token", TOKEN);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${resource}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function metaUpload(resource, fields, fileField, filePath) {
  if (!APPLY) throw new Error("Upload bloqueado em auditoria.");
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  const data = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const contentType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "video/mp4";
  form.set(fileField, new Blob([data], { type: contentType }), path.basename(filePath));
  form.set("access_token", TOKEN);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${resource}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(12 * 60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

function phaseSchedule(index) {
  const now = new Date();
  const start = new Date(now);
  if (index === 0) start.setMinutes(start.getMinutes() + 20, 0, 0);
  else start.setDate(start.getDate() + index);
  if (index > 0) start.setHours(0, 5, 0, 0);

  const end = new Date(now);
  end.setDate(end.getDate() + index + 1);
  end.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function targeting() {
  return {
    age_min: 18,
    age_max: 65,
    geo_locations: {
      countries: spanishLatamCountries,
      location_types: ["home"],
    },
    flexible_spec: [{ family_statuses: parentStatuses }],
    targeting_automation: { advantage_audience: 1 },
  };
}

function urlTags() {
  return "utm_source=meta&utm_medium=paid_social&utm_campaign=eurocamp_2027_latam_3d&utm_content=eric_madrid_es&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}";
}

async function accountState() {
  return metaGet(ACCOUNT_ID, {
    fields: "id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance,funding_source_details",
  });
}

function remainingCap(account) {
  return Math.max(0, Number(account.spend_cap || 0) - Number(account.amount_spent || 0));
}

async function verifyLanding() {
  const [page, config, video] = await Promise.all([
    fetch(LANDING_URL, { signal: AbortSignal.timeout(20_000) }),
    fetch("https://ec10talentos.com/api/meta-config", { signal: AbortSignal.timeout(20_000) }),
    fetch("https://ec10talentos.com/videos/eurocamp-eric-espanhol-prova-social.mp4", { method: "HEAD", signal: AbortSignal.timeout(20_000) }),
  ]);
  const pixelConfig = await config.json().catch(() => ({}));
  if (!page.ok || !video.ok || pixelConfig.pixelId !== PIXEL_ID) {
    throw new Error("LP, criativo web ou Pixel nao passaram na verificacao previa.");
  }
  return { page: page.status, video: video.status, pixelId: pixelConfig.pixelId };
}

async function findCampaign() {
  const response = await metaGet(`${ACCOUNT_ID}/campaigns`, {
    fields: "id,name,status,effective_status,objective,start_time,stop_time",
    limit: "500",
  });
  return (response.data || []).find((item) => item.name === CAMPAIGN_NAME) || null;
}

async function ensureCampaign() {
  const existing = await findCampaign();
  if (existing) return { ...existing, reused: true };
  const created = await metaPost(`${ACCOUNT_ID}/campaigns`, {
    name: CAMPAIGN_NAME,
    objective: "OUTCOME_LEADS",
    buying_type: "AUCTION",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
    status: "PAUSED",
  });
  return { id: created.id, name: CAMPAIGN_NAME, reused: false };
}

async function campaignAdsets(campaignId) {
  const response = await metaGet(`${campaignId}/adsets`, {
    fields: "id,name,status,effective_status,lifetime_budget,budget_remaining,start_time,end_time,optimization_goal,targeting,promoted_object",
    limit: "100",
  });
  return response.data || [];
}

async function ensureAdsets(campaignId) {
  const existing = await campaignAdsets(campaignId);
  const results = [];
  for (const [index, phase] of dailyPhases.entries()) {
    const schedule = phaseSchedule(index);
    const name = `EUROCAMP LATAM | DIA ${phase.day} | ${phase.share}% | PAIS 30-55 | ES`;
    const found = existing.find((item) => item.name === name);
    if (found) {
      results.push({ ...found, reused: true });
      continue;
    }
    const created = await metaPost(`${ACCOUNT_ID}/adsets`, {
      name,
      campaign_id: campaignId,
      lifetime_budget: phase.budget,
      start_time: schedule.start,
      end_time: schedule.end,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      promoted_object: { pixel_id: PIXEL_ID, custom_event_type: "LEAD" },
      targeting: targeting(),
      status: "PAUSED",
    });
    results.push({ id: created.id, name, lifetime_budget: String(phase.budget), start_time: schedule.start, end_time: schedule.end, reused: false });
  }
  return results;
}

async function uploadImage() {
  const result = await metaUpload(`${ACCOUNT_ID}/adimages`, {}, "filename", COVER_PATH);
  const image = Object.values(result.images || {})[0];
  if (!image?.hash) throw new Error("Meta nao retornou image_hash.");
  return image.hash;
}

async function uploadVideo() {
  const result = await metaUpload(`${ACCOUNT_ID}/advideos`, { name: "EUROCAMP LATAM | ERIC MADRID | ES | 40S" }, "source", CREATIVE_PATH);
  if (!result.id) throw new Error("Meta nao retornou video_id.");
  return result.id;
}

async function waitForVideo(videoId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const video = await metaGet(videoId, { fields: "id,status" });
    const status = String(video.status?.video_status || video.status || "").toLowerCase();
    if (["ready", "complete", "completed"].includes(status)) return video;
    if (["error", "failed"].includes(status)) throw new Error(`Processamento de video falhou: ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Video nao ficou pronto dentro da janela de processamento.");
}

async function campaignAds(campaignId) {
  const response = await metaGet(`${campaignId}/ads`, {
    fields: "id,name,status,effective_status,adset_id,creative{id,name,status}",
    limit: "100",
  });
  return response.data || [];
}

async function ensureCreative(campaignId) {
  const ads = await campaignAds(campaignId);
  const reusable = ads.find((item) => item.name.startsWith("EUROCAMP LATAM | ERIC MADRID | ES"));
  if (reusable?.creative?.id) return { id: reusable.creative.id, reused: true };
  const [videoId, imageHash] = await Promise.all([uploadVideo(), uploadImage()]);
  await waitForVideo(videoId);
  const created = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: "EUROCAMP LATAM | ERIC MADRID | ES | CRIATIVO",
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: INSTAGRAM_ID,
      video_data: {
        video_id: videoId,
        image_hash: imageHash,
        message: "Tu hijo sueña con vivir el fútbol europeo desde dentro? Eurocamp 2027 reúne partidos de evaluación, acompañamiento EC10 y una experiencia internacional en España y Portugal. Eric te muestra Madrid en este relato real. Completa el registro para recibir la información y entrar al grupo oficial.",
        title: "Eurocamp 2027: fútbol europeo desde dentro",
        link_description: "Registro para familias y atletas de Latinoamérica",
        call_to_action: { type: "SIGN_UP", value: { link: LANDING_URL } },
      },
    },
    url_tags: urlTags(),
  });
  return { id: created.id, videoId, imageHash, reused: false };
}

async function ensureAds(campaignId, adsets, creativeId) {
  const existing = await campaignAds(campaignId);
  const results = [];
  for (const adset of adsets) {
    const name = `EUROCAMP LATAM | ERIC MADRID | ES | ${adset.name.match(/DIA \d/)?.[0] || adset.id}`;
    const found = existing.find((item) => item.name === name);
    if (found) {
      results.push({ ...found, reused: true });
      continue;
    }
    const created = await metaPost(`${ACCOUNT_ID}/ads`, {
      name,
      adset_id: adset.id,
      creative: { creative_id: creativeId },
      tracking_specs: [{ "action.type": ["offsite_conversion"], fb_pixel: [PIXEL_ID] }],
      status: "PAUSED",
    });
    results.push({ id: created.id, name, adset_id: adset.id, reused: false });
  }
  return results;
}

async function activate(campaignId, adsets, ads) {
  for (const ad of ads) await metaPost(ad.id, { status: "ACTIVE" });
  for (const adset of adsets) await metaPost(adset.id, { status: "ACTIVE" });
  await metaPost(campaignId, { status: "ACTIVE" });
}

async function finalState(campaignId) {
  const [campaign, adsets, ads] = await Promise.all([
    metaGet(campaignId, { fields: "id,name,status,effective_status,objective,start_time,stop_time" }),
    campaignAdsets(campaignId),
    campaignAds(campaignId),
  ]);
  return { campaign, adsets, ads };
}

const account = await accountState();
const capRemaining = remainingCap(account);
const landing = await verifyLanding();
if (APPLY) {
  await Promise.all([fs.access(CREATIVE_PATH), fs.access(COVER_PATH)]);
  if (capRemaining < TOTAL_BUDGET) throw new Error(`Teto insuficiente: ${capRemaining} centavos restantes.`);
}

let campaign = await findCampaign();
let result;
if (!APPLY) {
  result = {
    mode: "audit",
    authorizedBudget: TOTAL_BUDGET,
    account: { id: account.id, name: account.name, status: account.account_status, currency: account.currency, capRemaining },
    landing,
    campaign,
    phases: dailyPhases.map((phase, index) => ({ ...phase, ...phaseSchedule(index) })),
    activationReady: capRemaining >= TOTAL_BUDGET && !campaign,
  };
} else {
  campaign = await ensureCampaign();
  const adsets = await ensureAdsets(campaign.id);
  const creative = await ensureCreative(campaign.id);
  const ads = await ensureAds(campaign.id, adsets, creative.id);
  if (ACTIVATE) await activate(campaign.id, adsets, ads);
  result = {
    mode: ACTIVATE ? "activated" : "assembled_paused",
    authorizedBudget: TOTAL_BUDGET,
    account: { id: account.id, name: account.name, status: account.account_status, currency: account.currency, capRemaining },
    landing,
    campaign,
    adsets,
    creative,
    ads,
    verification: await finalState(campaign.id),
  };
}

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2));
console.log(JSON.stringify(result, null, 2));
