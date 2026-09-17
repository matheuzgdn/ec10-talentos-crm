/**
 * Monta a campanha X1 da Academy Sudamerica sem duplicar objetos.
 *
 * Auditoria: node scripts/launch-sudamerica-x1-meta.mjs
 * Montagem pausada: node scripts/launch-sudamerica-x1-meta.mjs --apply
 * Ativacao explicita: node scripts/launch-sudamerica-x1-meta.mjs --activate --budget=20000
 */

import fs from "node:fs/promises";
import path from "node:path";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "1235838336986319");
const PAGE_ID = process.env.META_PAGE_ID || "100627363090555";
const INSTAGRAM_ID = process.env.META_SUDAMERICA_INSTAGRAM_ID || "17841471445116053";
const LIBERTA_INSTAGRAM_ID = process.env.META_LIBERTACADEMY_INSTAGRAM_ID || "17841470447370577";
const EC10_INSTAGRAM_ID = process.env.META_EC10_INSTAGRAM_ID || "17841444199647209";
const PIXEL_ID = process.env.META_PIXEL_ID;
const ASSET_ROOT = "C:\\Users\\Admin\\Desktop\\videos erick\\trafego sudamericana";
const COVER_ROOT = path.resolve("tmp", "sudamerica-creatives");
const TRACKING_URL = "https://cliente-whatsapp-crm.vercel.app/sudamerica-x1";
const CAMPAIGN_NAME = "ACADEMY SUDAMERICA X1 | WHATSAPP DIRETO | BR + LATAM | R$200 | 4D";
const TOTAL_BUDGET = 20_000;
const CREATIVE_REVISION = "V2";
const APPLY = process.argv.includes("--apply") || process.argv.includes("--activate");
const ACTIVATE = process.argv.includes("--activate");
const REQUESTED_BUDGET = Number(process.argv.find((item) => item.startsWith("--budget="))?.split("=")[1] || 0);

const audienceNames = {
  ec10: "RMK | EC10 Instagram | Engajamento | 365D",
  liberta: "RMK | LIBERTACADEMY Instagram | Engajamento | 365D",
  sudamerica: "RMK | SUDAMERICA Instagram | Engajamento | 365D",
  exclusion: "EXCLUSAO | SUDAMERICA X1 | CONTACT | 180D",
};

const ownerBehaviors = [
  { id: "6002714898572", name: "Proprietarios de pequenas empresas" },
  { id: "6020530156983", name: "Administradores de Pagina sobre Esportes" },
];
const footballInterest = [{ id: "6003107902433", name: "Futebol (futebol)" }];
const travelBehaviors = [
  { id: "6002714895372", name: "Frequent Travelers" },
  { id: "6022788483583", name: "Frequent international travelers" },
];
const brPositions = [
  ["106065199425555", "Sports Director"],
  ["110722838955052", "Proprietario"],
  ["117677474946712", "Owner/Manager/CEO"],
  ["132572250109703", "Manager (association football)"],
  ["138434539530345", "Owner/Managing Director"],
  ["141020069296055", "Fundador/Proprietario"],
  ["144066855611031", "Socio Proprietario"],
  ["145883162179925", "Chief Executive Officer (CEO) & Founder"],
  ["149598488387016", "Owner and CEO"],
  ["151785081542575", "Proprietario(a)"],
].map(([id, name]) => ({ id, name }));
const esPositions = [
  ["106065199425555", "Sports Director"],
  ["115729578478693", "Propietario"],
  ["116885444988542", "Director general"],
  ["117677474946712", "Owner/Manager/CEO"],
  ["131462966897408", "Gerente Propietario"],
  ["132572250109703", "Manager (association football)"],
  ["138434539530345", "Owner/Managing Director"],
  ["145855138773838", "Dueno"],
  ["210836798933397", "Gerente general"],
].map(([id, name]) => ({ id, name }));

const assets = {
  pt: {
    locale: "pt",
    video: "sudacademy PORTUGUES.mp4",
    cover: "sudacademy-portugues.jpg",
    message: "Voce e dono, gestor ou responsavel por uma escola ou projeto de futebol? Conecte sua equipe a uma experiencia esportiva internacional com a Academy Sudamerica. Fale agora com a organizacao e receba a apresentacao oficial.",
    headline: "Sua escola na Academy Sudamerica",
    description: "Futebol, intercambio e experiencia internacional",
  },
  es: {
    locale: "es",
    video: "sudacademy espanhol.mp4",
    cover: "sudacademy-espanhol.jpg",
    message: "Eres dueno, gestor o responsable de una escuela o proyecto de futbol? Conecta tu equipo con una experiencia deportiva internacional junto a Academy Sudamerica. Habla ahora con la organizacion y recibe la presentacion oficial.",
    headline: "Tu escuela en Academy Sudamerica",
    description: "Futbol, intercambio y experiencia internacional",
  },
};

const adsetBlueprints = [
  { key: "bh", name: "X1 | BH + 80KM | DONOS-GESTORES | FUTEBOL + VIAGEM | 30-58 | R$70", budget: 7_000, locale: "pt", kind: "cold" },
  { key: "br", name: "X1 | BRASIL EXCETO BH | DONOS-GESTORES | FUTEBOL + VIAGEM | 30-58 | R$45", budget: 4_500, locale: "pt", kind: "cold" },
  { key: "latam", name: "X1 | LATAM CIDADES | DUENOS-GESTORES | FUTBOL + VIAJE | 30-58 | R$34", budget: 3_400, locale: "es", kind: "cold" },
  { key: "warm_br", name: "X1 | RMK EC10-LIBERTA-SUDA | BR | GESTORES | R$30", budget: 3_000, locale: "pt", kind: "warm" },
  { key: "warm_latam", name: "X1 | RMK EC10-LIBERTA-SUDA | LATAM | GESTORES | R$21", budget: 2_100, locale: "es", kind: "warm" },
];

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID || !PIXEL_ID) {
  throw new Error("Perfil ec10-manager incompleto para montar a campanha Sudamerica X1.");
}
if (ACTIVATE && REQUESTED_BUDGET !== TOTAL_BUDGET) {
  throw new Error("Ativacao bloqueada: confirme o valor com --budget=20000 (R$200 total). ");
}
if (adsetBlueprints.reduce((sum, item) => sum + item.budget, 0) !== TOTAL_BUDGET) {
  throw new Error("A distribuicao dos conjuntos nao fecha o orcamento total.");
}

function normalizeAccountId(value) {
  return String(value).startsWith("act_") ? String(value) : `act_${value}`;
}

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [error.message || `Meta HTTP ${status}`, error.error_user_title, error.error_user_msg]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 1400);
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
  if (!APPLY) throw new Error("POST bloqueado no modo de auditoria.");
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
  if (!APPLY) throw new Error("Upload bloqueado no modo de auditoria.");
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  const data = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const type = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "video/mp4";
  form.set(fileField, new Blob([data], { type }), path.basename(filePath));
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

function city(key, radius) {
  return { key, radius, distance_unit: "kilometer" };
}

function latamCities() {
  return [city("83693", 50), city("84740", 40), city("328660", 40), city("2549997", 40), city("1903658", 40)];
}

function detailedTargeting(positions, includeTravel = true) {
  const spec = [
    { work_positions: positions, behaviors: ownerBehaviors },
    { interests: footballInterest },
  ];
  if (includeTravel) spec.push({ behaviors: travelBehaviors });
  return spec;
}

function commonTargeting() {
  return {
    age_min: 30,
    age_max: 58,
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "explore", "reels"],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
  };
}

function targetingFor(blueprint, audienceIds) {
  const common = commonTargeting();
  const bh = city("244661", 80);
  const positions = blueprint.locale === "es" ? esPositions : brPositions;
  const warmAudiences = [audienceIds.ec10, audienceIds.liberta, audienceIds.sudamerica].map((id) => ({ id }));
  const excludedWarm = [...warmAudiences, { id: audienceIds.exclusion }];

  if (blueprint.key === "bh") {
    return { ...common, geo_locations: { cities: [bh], location_types: ["home"] }, excluded_custom_audiences: excludedWarm, flexible_spec: detailedTargeting(positions) };
  }
  if (blueprint.key === "br") {
    return {
      ...common,
      geo_locations: { countries: ["BR"], location_types: ["home"] },
      excluded_geo_locations: { cities: [bh] },
      excluded_custom_audiences: excludedWarm,
      flexible_spec: detailedTargeting(positions),
    };
  }
  if (blueprint.key === "latam") {
    return { ...common, geo_locations: { cities: latamCities(), location_types: ["home"] }, excluded_custom_audiences: excludedWarm, flexible_spec: detailedTargeting(positions) };
  }
  if (blueprint.key === "warm_br") {
    return { ...common, geo_locations: { countries: ["BR"], location_types: ["home"] }, custom_audiences: warmAudiences, excluded_custom_audiences: [{ id: audienceIds.exclusion }], flexible_spec: detailedTargeting(positions, false) };
  }
  return { ...common, geo_locations: { cities: latamCities(), location_types: ["home"] }, custom_audiences: warmAudiences, excluded_custom_audiences: [{ id: audienceIds.exclusion }], flexible_spec: detailedTargeting(positions, false) };
}

function instagramRule(instagramId) {
  return {
    inclusions: {
      operator: "or",
      rules: [{
        event_sources: [{ id: instagramId, type: "ig_business" }],
        retention_seconds: 31_536_000,
        filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "ig_business_profile_all" }] },
      }],
    },
  };
}

function exclusionRule() {
  return {
    inclusions: {
      operator: "or",
      rules: [{
        event_sources: [{ id: PIXEL_ID, type: "pixel" }],
        retention_seconds: 15_552_000,
        filter: {
          operator: "and",
          filters: [
            { field: "event", operator: "eq", value: "Contact" },
            { field: "url", operator: "i_contains", value: "cliente-whatsapp-crm.vercel.app/sudamerica-x1" },
          ],
        },
      }],
    },
  };
}

async function customAudiences() {
  const response = await metaGet(`${ACCOUNT_ID}/customaudiences`, { fields: "id,name,subtype,delivery_status,approximate_count_lower_bound,approximate_count_upper_bound", limit: 500 });
  return response.data || [];
}

async function ensureAudience(name, rule, description, existing) {
  const found = existing.find((item) => item.name === name);
  if (found) return found.id;
  const created = await metaPost(`${ACCOUNT_ID}/customaudiences`, {
    name,
    description,
    rule,
    prefill: 1,
  });
  return created.id;
}

async function ensureAudiences() {
  const existing = await customAudiences();
  if (!APPLY) {
    return Object.fromEntries(Object.entries(audienceNames).map(([key, name]) => [key, existing.find((item) => item.name === name)?.id || null]));
  }
  const ec10 = await ensureAudience(audienceNames.ec10, instagramRule(EC10_INSTAGRAM_ID), "Pessoas que interagiram com o Instagram EC10 nos ultimos 365 dias.", existing);
  const liberta = await ensureAudience(audienceNames.liberta, instagramRule(LIBERTA_INSTAGRAM_ID), "Pessoas que interagiram com o Instagram Libertacademy nos ultimos 365 dias.", existing);
  const sudamerica = await ensureAudience(audienceNames.sudamerica, instagramRule(INSTAGRAM_ID), "Pessoas que interagiram com o Instagram Academy Sudamerica nos ultimos 365 dias.", existing);
  const exclusion = await ensureAudience(audienceNames.exclusion, exclusionRule(), "Exclui quem ja abriu o WhatsApp pela campanha Sudamerica X1 nos ultimos 180 dias.", existing);
  return { ec10, liberta, sudamerica, exclusion };
}

async function findCampaign() {
  const response = await metaGet(`${ACCOUNT_ID}/campaigns`, { fields: "id,name,status,effective_status,objective,start_time,stop_time", limit: 300 });
  return (response.data || []).find((item) => item.name === CAMPAIGN_NAME) || null;
}

async function ensureCampaign() {
  const existing = await findCampaign();
  if (existing) return existing.id;
  const created = await metaPost(`${ACCOUNT_ID}/campaigns`, {
    name: CAMPAIGN_NAME,
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: [],
    buying_type: "AUCTION",
    is_adset_budget_sharing_enabled: false,
  });
  return created.id;
}

async function ensureAdset(campaignId, blueprint, targeting, start, end, existingAdsets) {
  const existing = existingAdsets.find((item) => item.name === blueprint.name);
  const payload = {
    name: blueprint.name,
    lifetime_budget: blueprint.budget,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    destination_type: "WEBSITE",
    targeting,
    status: "PAUSED",
  };
  if (existing) {
    if (new Date(existing.start_time).getTime() <= Date.now()) delete payload.start_time;
    await metaPost(existing.id, payload);
    return existing.id;
  }
  const created = await metaPost(`${ACCOUNT_ID}/adsets`, { ...payload, campaign_id: campaignId });
  return created.id;
}

async function uploadImage(filePath) {
  const result = await metaUpload(`${ACCOUNT_ID}/adimages`, {}, "filename", filePath);
  const image = Object.values(result.images || {})[0];
  if (!image?.hash) throw new Error(`Meta nao retornou image_hash para ${path.basename(filePath)}`);
  return image.hash;
}

async function uploadVideo(filePath, name) {
  const result = await metaUpload(`${ACCOUNT_ID}/advideos`, { name }, "source", filePath);
  if (!result.id) throw new Error(`Meta nao retornou video_id para ${path.basename(filePath)}`);
  return result.id;
}

const uploadedAssets = new Map();

async function ensureUploadedAsset(locale, uploadName) {
  if (uploadedAssets.has(locale)) return uploadedAssets.get(locale);
  const asset = assets[locale];
  const videoPath = path.join(ASSET_ROOT, asset.video);
  const coverPath = path.join(COVER_ROOT, asset.cover);
  await Promise.all([fs.access(videoPath), fs.access(coverPath)]);
  const uploaded = await Promise.all([
    uploadVideo(videoPath, `${uploadName} | VIDEO`),
    uploadImage(coverPath),
  ]).then(([videoId, imageHash]) => ({ videoId, imageHash }));
  uploadedAssets.set(locale, uploaded);
  return uploaded;
}

function adName(blueprint) {
  return `X1 | ${blueprint.key.toUpperCase()} | VIDEO ${blueprint.locale === "es" ? "ESPANOL" : "PORTUGUES"} | ${CREATIVE_REVISION}`;
}

function contentName(blueprint) {
  return `sudamerica_x1_${blueprint.key}_${blueprint.locale}_${CREATIVE_REVISION.toLowerCase()}`;
}

function destinationLink(blueprint) {
  return `${TRACKING_URL}?lang=${blueprint.locale}&variant=${contentName(blueprint)}`;
}

function urlTags(blueprint) {
  return [
    "utm_source=meta",
    "utm_medium=paid_social",
    "utm_campaign=academy_sudamerica_x1_2026",
    `utm_content=${contentName(blueprint)}`,
    "utm_term={{adset.name}}",
    "campaign_id={{campaign.id}}",
    "adset_id={{adset.id}}",
    "ad_id={{ad.id}}",
    "placement={{placement}}",
    "site_source_name={{site_source_name}}",
  ].join("&");
}

async function ensureAd(blueprint, adsetId, existingAds) {
  const name = adName(blueprint);
  const existing = existingAds.find((item) => item.name === name);
  if (existing) return { id: existing.id, creativeId: existing.creative?.id, reused: true };
  const asset = assets[blueprint.locale];
  const { videoId, imageHash } = await ensureUploadedAsset(blueprint.locale, name);
  const creative = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: `${name} | CRIATIVO`,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: INSTAGRAM_ID,
      video_data: {
        video_id: videoId,
        image_hash: imageHash,
        message: asset.message,
        title: asset.headline,
        link_description: asset.description,
        call_to_action: { type: "CONTACT_US", value: { link: destinationLink(blueprint) } },
      },
    },
    url_tags: urlTags(blueprint),
  });
  const ad = await metaPost(`${ACCOUNT_ID}/ads`, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creative.id },
    status: "PAUSED",
  });
  return { id: ad.id, creativeId: creative.id, videoId, reused: false };
}

async function campaignObjects(campaignId) {
  const [campaign, adsets, ads] = await Promise.all([
    metaGet(campaignId, { fields: "id,name,status,effective_status,objective,start_time,stop_time" }),
    metaGet(`${campaignId}/adsets`, { fields: "id,name,status,effective_status,lifetime_budget,start_time,end_time,targeting", limit: 100 }),
    metaGet(`${campaignId}/ads`, { fields: "id,name,status,effective_status,adset_id,creative{id,name,status,object_story_spec,url_tags}", limit: 100 }),
  ]);
  return { campaign, adsets: adsets.data || [], ads: ads.data || [] };
}

async function audienceEstimate(targetingSpec) {
  try {
    const result = await metaGet(`${ACCOUNT_ID}/delivery_estimate`, { targeting_spec: targetingSpec, optimization_goal: "LINK_CLICKS" });
    return result.data?.[0] || null;
  } catch (error) {
    return { unavailable: true, reason: String(error.message).slice(0, 300) };
  }
}

async function auditAccount() {
  const [account, instagram, audiences, campaign] = await Promise.all([
    metaGet(ACCOUNT_ID, { fields: "id,name,account_status,disable_reason,currency,balance,amount_spent,spend_cap,funding_source_details" }),
    metaGet(INSTAGRAM_ID, { fields: "id,username,name" }),
    customAudiences(),
    findCampaign(),
  ]);
  return {
    account,
    instagram,
    audiences: Object.values(audienceNames).map((name) => audiences.find((item) => item.name === name) || { name, missing: true }),
    existingCampaign: campaign,
  };
}

async function apply() {
  const start = new Date(Date.now() + 60 * 60_000);
  const end = new Date(start.getTime() + 4 * 24 * 60 * 60 * 1000);
  const audienceIds = await ensureAudiences();
  if (Object.values(audienceIds).some((id) => !id)) throw new Error("Nao foi possivel resolver todos os publicos personalizados.");
  const campaignId = await ensureCampaign();
  const before = await campaignObjects(campaignId);
  const targetingByKey = Object.fromEntries(adsetBlueprints.map((item) => [item.key, targetingFor(item, audienceIds)]));
  const adsetIds = {};
  for (const blueprint of adsetBlueprints) {
    adsetIds[blueprint.key] = await ensureAdset(campaignId, blueprint, targetingByKey[blueprint.key], start, end, before.adsets);
  }
  const withAdsets = await campaignObjects(campaignId);
  const adResults = [];
  for (const blueprint of adsetBlueprints) {
    adResults.push({ key: blueprint.key, ...(await ensureAd(blueprint, adsetIds[blueprint.key], withAdsets.ads)) });
  }
  if (ACTIVATE) {
    const currentObjects = await campaignObjects(campaignId);
    const selectedAdIds = new Set(adResults.map((ad) => ad.id));
    for (const ad of currentObjects.ads) {
      if (!selectedAdIds.has(ad.id) && ad.status !== "PAUSED") {
        await metaPost(ad.id, { status: "PAUSED" });
      }
    }
    for (const ad of adResults) await metaPost(ad.id, { status: "ACTIVE" });
    for (const adsetId of Object.values(adsetIds)) await metaPost(adsetId, { status: "ACTIVE" });
    await metaPost(campaignId, { status: "ACTIVE" });
  }
  const estimates = {};
  for (const blueprint of adsetBlueprints) estimates[blueprint.key] = await audienceEstimate(targetingByKey[blueprint.key]);
  return { campaignId, start: start.toISOString(), end: end.toISOString(), totalBudget: TOTAL_BUDGET, audienceIds, adsetIds, adResults, estimates, activated: ACTIVATE, after: await campaignObjects(campaignId) };
}

const accountAudit = await auditAccount();
const result = APPLY ? await apply() : null;
console.log(JSON.stringify({ mode: ACTIVATE ? "activate" : APPLY ? "apply" : "audit", accountAudit, result }, null, 2));
