/**
 * Monta e audita a campanha Libertacademy sem duplicar objetos.
 *
 * Padrao: somente leitura.
 * Aplicacao: node scripts/launch-libertacademy-meta.mjs --apply
 * Ativacao: node scripts/launch-libertacademy-meta.mjs --activate
 */

import fs from "node:fs/promises";
import path from "node:path";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "1235838336986319");
const PAGE_ID = process.env.META_PAGE_ID;
const INSTAGRAM_ID = process.env.META_INSTAGRAM_BUSINESS_ID;
const PIXEL_ID = process.env.META_PIXEL_ID || "834310425674029";

const CAMPAIGN_ID = "120248386089530601";
const BR_ADSET_ID = "120248386095120601";
const ES_ADSET_ID = "120248386096480601";
const EXCLUSION_AUDIENCE_ID = "120248386190540601";
const TOTAL_BUDGET = 60_000;
const BR_CORE_DAILY_BUDGET = 6_000;
const BR_SOUTH_DAILY_BUDGET = 3_600;
const ES_DAILY_BUDGET = 2_400;
const SOUTH_ADSET_NAME = "LIBERTA | BR SUL | DONOS-GESTORES ESCOLAS-PROJETOS | FUTEBOL + VIAGEM | 30-58 | R$36-DIA";
const LANDING_URL = "https://ec10talentos.com/libertacademy-florianopolis/";
const ASSET_ROOT = "C:\\Users\\Admin\\Downloads\\LIBERTACADEMY_FLORIANOPOLIS_2027_CRIATIVOS_META";
const APPLY = process.argv.includes("--apply") || process.argv.includes("--activate");
const ACTIVATE = process.argv.includes("--activate");

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

const assets = [
  {
    key: "br-real",
    adsetId: BR_ADSET_ID,
    locale: "pt",
    video: "02_ANUNCIOS_CURTOS_9X16/C03_PT_CORTES_REAIS_GESTORES_23S_9X16.mp4",
    cover: "03_CAPAS/C03_PT_CORTES_REAIS_GESTORES_23S_9X16.png",
    name: "LIBERTA | BR | CORTES REAIS | V1",
    content: "cortes_reais_pt_v1",
    message: "Sua escola, escolinha ou projeto de futebol pode viver uma competicao internacional em Florianopolis. A Libertacademy 2027 reune futebol, organizacao e experiencia para equipes Sub-09, Sub-11, Sub-13 e Sub-15. Cadastro exclusivo para proprietarios e gestores.",
    headline: "Leve sua escola para a Libertacademy",
    description: "Florianopolis | 21 a 24 de janeiro de 2027",
  },
  {
    key: "br-social",
    adsetId: BR_ADSET_ID,
    locale: "pt",
    video: "02_ANUNCIOS_CURTOS_9X16/C03_PT_PROVA_SOCIAL_GESTORES_23S_9X16.mp4",
    cover: "03_CAPAS/C03_PT_PROVA_SOCIAL_GESTORES_CAPA.jpg",
    name: "LIBERTA | BR | PROVA SOCIAL | V1",
    content: "prova_social_pt_v1",
    message: "Equipes do Brasil e da America do Sul ja viveram a energia da Libertacademy. Em 2027, Florianopolis recebe uma nova edicao para escolas, escolinhas e projetos de futebol. Se voce decide pela sua equipe, solicite agora a apresentacao oficial.",
    headline: "Sua equipe no palco internacional",
    description: "Cadastro para proprietarios e gestores",
  },
  {
    key: "es-real",
    adsetId: ES_ADSET_ID,
    locale: "es",
    video: "02_ANUNCIOS_CURTOS_9X16/C04_ES_CORTES_REALES_ACADEMIAS_23S_9X16.mp4",
    cover: "03_CAPAS/C04_ES_CORTES_REALES_ACADEMIAS_23S_9X16.png",
    name: "LIBERTA | ES | CORTES REALES | V1",
    content: "cortes_reales_es_v1",
    message: "Tu escuela o proyecto de futbol puede vivir una competencia internacional en Florianopolis. Libertacademy 2027 reune futbol, organizacion y experiencia para equipos Sub-09, Sub-11, Sub-13 y Sub-15. Registro exclusivo para propietarios y gestores.",
    headline: "Lleva tu escuela a Libertacademy",
    description: "Florianopolis | 21 al 24 de enero de 2027",
  },
  {
    key: "es-social",
    adsetId: ES_ADSET_ID,
    locale: "es",
    video: "02_ANUNCIOS_CURTOS_9X16/C04_ES_EXPERIENCIA_INTERNACIONAL_23S_9X16.mp4",
    cover: "03_CAPAS/C04_ES_EXPERIENCIA_INTERNACIONAL_CAPA.jpg",
    name: "LIBERTA | ES | EXPERIENCIA INTERNACIONAL | V1",
    content: "experiencia_internacional_es_v1",
    message: "Equipos de Brasil y Sudamerica ya vivieron la energia de Libertacademy. En 2027, Florianopolis recibe una nueva edicion para escuelas y proyectos de futbol. Si decides por tu equipo, solicita la presentacion oficial.",
    headline: "Tu equipo en un escenario internacional",
    description: "Registro para propietarios y gestores",
  },
];

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID || !PIXEL_ID) {
  throw new Error("Perfil ec10-manager incompleto para operar a campanha.");
}

function normalizeAccountId(value) {
  return String(value).startsWith("act_") ? String(value) : `act_${value}`;
}

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [error.message || `Meta HTTP ${status}`, error.error_user_title, error.error_user_msg]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 1200);
}

async function metaGet(resource, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  url.searchParams.set("access_token", TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
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
    signal: AbortSignal.timeout(60_000),
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
  const type = path.extname(filePath).toLowerCase() === ".png" ? "image/png" : path.extname(filePath).toLowerCase() === ".jpg" ? "image/jpeg" : "video/mp4";
  form.set(fileField, new Blob([data], { type }), path.basename(filePath));
  form.set("access_token", TOKEN);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${resource}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

function city(key, radius) {
  return { key, radius, distance_unit: "kilometer" };
}

function targeting(cities, positions) {
  return {
    age_min: 30,
    age_max: 58,
    geo_locations: { cities, location_types: ["home"] },
    excluded_custom_audiences: [{ id: EXCLUSION_AUDIENCE_ID }],
    flexible_spec: [
      { work_positions: positions, behaviors: ownerBehaviors },
      { interests: footballInterest },
      { behaviors: travelBehaviors },
    ],
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "facebook_reels"],
    instagram_positions: ["stream", "story", "explore", "reels"],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
  };
}

function campaignLink(asset) {
  const campaign = asset.locale === "pt" ? "libertacademy_2027_br" : "libertacademy_2027_es";
  return `${LANDING_URL}?lang=${asset.locale}&utm_source=meta&utm_medium=paid_social&utm_campaign=${campaign}&utm_content=${asset.content}&utm_term={{adset.name}}`;
}

async function uploadImage(filePath) {
  const result = await metaUpload(`${ACCOUNT_ID}/adimages`, {}, "filename", filePath);
  const row = Object.values(result.images || {})[0];
  if (!row?.hash) throw new Error(`Meta nao retornou image_hash para ${path.basename(filePath)}`);
  return row.hash;
}

async function uploadVideo(filePath, name) {
  const result = await metaUpload(`${ACCOUNT_ID}/advideos`, { name }, "source", filePath);
  if (!result.id) throw new Error(`Meta nao retornou video_id para ${path.basename(filePath)}`);
  return result.id;
}

async function findAds() {
  const response = await metaGet(`${CAMPAIGN_ID}/ads`, {
    fields: "id,name,status,effective_status,adset_id,creative{id,name,status}",
    limit: 100,
  });
  return response.data || [];
}

async function ensureAd(asset, existingAds) {
  const existing = existingAds.find((ad) => ad.name === asset.name);
  if (existing) return { id: existing.id, creativeId: existing.creative?.id, reused: true };

  const videoPath = path.join(ASSET_ROOT, ...asset.video.split("/"));
  const coverPath = path.join(ASSET_ROOT, ...asset.cover.split("/"));
  await Promise.all([fs.access(videoPath), fs.access(coverPath)]);
  const [videoId, imageHash] = await Promise.all([
    uploadVideo(videoPath, `${asset.name} | VIDEO`),
    uploadImage(coverPath),
  ]);
  const link = campaignLink(asset);
  const creative = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: `${asset.name} | CRIATIVO`,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: INSTAGRAM_ID,
      video_data: {
        video_id: videoId,
        image_hash: imageHash,
        message: asset.message,
        title: asset.headline,
        link_description: asset.description,
        call_to_action: { type: "SIGN_UP", value: { link } },
      },
    },
    url_tags: `utm_source=meta&utm_medium=paid_social&utm_campaign=${asset.locale === "pt" ? "libertacademy_2027_br" : "libertacademy_2027_es"}&utm_content=${asset.content}&utm_term={{adset.name}}`,
  });
  const ad = await metaPost(`${ACCOUNT_ID}/ads`, {
    name: asset.name,
    adset_id: asset.adsetId,
    creative: { creative_id: creative.id },
    status: "PAUSED",
  });
  return { id: ad.id, creativeId: creative.id, videoId, reused: false };
}

async function ensureSouthAdset(end, targetingSpec, existingAdsets) {
  const existing = existingAdsets.find((adset) => adset.name === SOUTH_ADSET_NAME);
  const payload = {
    name: SOUTH_ADSET_NAME,
    daily_budget: BR_SOUTH_DAILY_BUDGET,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    end_time: end.toISOString(),
    targeting: targetingSpec,
    destination_type: "WEBSITE",
    promoted_object: { pixel_id: PIXEL_ID, custom_event_type: "LEAD" },
    status: "PAUSED",
  };
  if (existing) {
    await metaPost(existing.id, payload);
    return existing.id;
  }
  const result = await metaPost(`${ACCOUNT_ID}/adsets`, {
    ...payload,
    campaign_id: CAMPAIGN_ID,
    start_time: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  return result.id;
}

async function ensureCloneAd(existingAds, source, adsetId, suffix) {
  const name = `${source.name} | ${suffix}`;
  const existing = existingAds.find((ad) => ad.name === name);
  if (existing) return { id: existing.id, reused: true };
  if (!source.creativeId) throw new Error(`Creative ausente para duplicar ${source.name}`);
  const result = await metaPost(`${ACCOUNT_ID}/ads`, {
    name,
    adset_id: adsetId,
    creative: { creative_id: source.creativeId },
    status: "PAUSED",
  });
  return { id: result.id, reused: false };
}

async function audienceEstimate(targetingSpec) {
  try {
    const result = await metaGet(`${ACCOUNT_ID}/delivery_estimate`, {
      targeting_spec: targetingSpec,
      optimization_goal: "OFFSITE_CONVERSIONS",
    });
    return result.data?.[0]?.estimate_dau || result.data?.[0] || null;
  } catch (error) {
    return { unavailable: true, reason: String(error.message).slice(0, 300) };
  }
}

async function audit() {
  const [account, campaign, adsets, ads] = await Promise.all([
    metaGet(ACCOUNT_ID, { fields: "id,name,account_status,disable_reason,amount_spent,spend_cap,funding_source_details,currency" }),
    metaGet(CAMPAIGN_ID, { fields: "id,name,status,effective_status,objective,start_time,stop_time" }),
    metaGet(`${CAMPAIGN_ID}/adsets`, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,targeting,promoted_object", limit: 20 }),
    findAds(),
  ]);
  return {
    account: {
      id: account.id,
      name: account.name,
      active: Number(account.account_status) === 1 && Number(account.disable_reason) === 0,
      prepaid: account.funding_source_details?.display_string || null,
      amountSpent: Number(account.amount_spent || 0),
      spendCap: Number(account.spend_cap || 0),
      currency: account.currency,
    },
    campaign,
    adsets: adsets.data || [],
    ads,
  };
}

async function apply() {
  const now = new Date();
  const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  await metaPost(CAMPAIGN_ID, {
    name: "LIBERTACADEMY FLORIANOPOLIS 2027 | ESCOLAS E PROJETOS | R$600 | 5D",
    status: "PAUSED",
  });

  const brCoreTargeting = targeting([
    city("269969", 40),
    city("244661", 40),
  ], brPositions);
  const brSouthTargeting = targeting([
    city("253249", 50),
    city("250457", 40),
    city("264859", 40),
  ], brPositions);
  const esTargeting = targeting([
    city("83693", 50),
    city("84740", 40),
    city("328660", 40),
    city("2549997", 40),
    city("1903658", 40),
  ], esPositions);
  await metaPost(BR_ADSET_ID, {
    name: "LIBERTA | SP-BH | DONOS-GESTORES ESCOLAS-PROJETOS | FUTEBOL + VIAGEM | 30-58 | R$60-DIA",
    daily_budget: BR_CORE_DAILY_BUDGET,
    end_time: end.toISOString(),
    targeting: brCoreTargeting,
    status: "PAUSED",
  });
  await metaPost(ES_ADSET_ID, {
    name: "LIBERTA | ES | DUENOS-GESTORES ESCUELAS-PROYECTOS | FUTBOL + VIAJE | 30-58 | R$36-DIA",
    daily_budget: ES_DAILY_BUDGET,
    end_time: end.toISOString(),
    targeting: esTargeting,
    status: "PAUSED",
  });

  const adsetsBefore = (await metaGet(`${CAMPAIGN_ID}/adsets`, {
    fields: "id,name,status,effective_status",
    limit: 50,
  })).data || [];
  const southAdsetId = await ensureSouthAdset(end, brSouthTargeting, adsetsBefore);

  const existingAds = await findAds();
  const adResults = [];
  for (const asset of assets) adResults.push({ key: asset.key, ...(await ensureAd(asset, existingAds)) });
  for (const source of adResults.filter((item) => item.key.startsWith("br-"))) {
    const sourceAsset = assets.find((asset) => asset.key === source.key);
    adResults.push({
      key: `${source.key}-south`,
      ...(await ensureCloneAd(await findAds(), { ...source, name: sourceAsset.name }, southAdsetId, "SUL")),
    });
  }

  const estimates = {
    brCore: await audienceEstimate(brCoreTargeting),
    brSouth: await audienceEstimate(brSouthTargeting),
    es: await audienceEstimate(esTargeting),
  };

  if (ACTIVATE) {
    for (const ad of await findAds()) await metaPost(ad.id, { status: "ACTIVE" });
    await metaPost(BR_ADSET_ID, { status: "ACTIVE" });
    await metaPost(ES_ADSET_ID, { status: "ACTIVE" });
    await metaPost(southAdsetId, { status: "ACTIVE" });
    await metaPost(CAMPAIGN_ID, { status: "ACTIVE" });
  }

  return { endTime: end.toISOString(), adResults, estimates, activated: ACTIVATE };
}

const before = await audit();
const changes = APPLY ? await apply() : null;
const after = APPLY ? await audit() : before;
console.log(JSON.stringify({ mode: ACTIVATE ? "activate" : APPLY ? "apply" : "audit", before, changes, after }, null, 2));
