/**
 * Cria a campanha X1 da Libertacademy sem duplicar objetos.
 *
 * Auditoria: node scripts/launch-libertacademy-x1-meta.mjs
 * Montagem pausada: node scripts/launch-libertacademy-x1-meta.mjs --apply
 * Ativacao: node scripts/launch-libertacademy-x1-meta.mjs --activate
 */

import fs from "node:fs/promises";
import path from "node:path";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "1235838336986319");
const PAGE_ID = process.env.META_PAGE_ID || "100627363090555";
const INSTAGRAM_ID = process.env.META_LIBERTACADEMY_INSTAGRAM_ID || "17841470447370577";
const ASSET_ROOT = "C:\\Users\\Admin\\Downloads\\TRAFEGO";
const CAMPAIGN_NAME = "LIBERTACADEMY X1 | WHATSAPP DIRETO | BR + LATAM | R$400 | 5D";
const BR_ADSET_NAME = "X1 | BRASIL | DONOS-GESTORES ESCOLAS-PROJETOS | FUTEBOL + VIAGEM | 30-58 | R$250";
const ES_ADSET_NAME = "X1 | LATAM CIDADES | DUENOS-GESTORES ESCUELAS-PROYECTOS | FUTBOL + VIAJE | 30-58 | R$150";
const TRACKING_URL = "https://ec10talentos.com/x1";
const EXCLUSION_AUDIENCE_ID = "120248386190540601";
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
    key: "pt",
    locale: "pt",
    adsetName: BR_ADSET_NAME,
    video: "libertaacademy PORTUGUES.mp4",
    cover: "_thumbs/libertaacademy PORTUGUES.jpg",
    adName: "X1 | BR | VIDEO PORTUGUES | V1",
    content: "x1_video_portugues_v1",
    message: "Voce e dono, gestor ou responsavel por uma escola ou projeto de futebol? Leve sua equipe para uma experiencia internacional em Florianopolis. A Libertacademy 2027 recebe as categorias Sub-09, Sub-11, Sub-13 e Sub-15. Fale agora com a organizacao e receba a apresentacao oficial.",
    headline: "Sua escola na Libertacademy 2027",
    description: "Florianopolis | 21 a 24 de janeiro",
  },
  {
    key: "es",
    locale: "es",
    adsetName: ES_ADSET_NAME,
    video: "libertaacademy ESPANHOL.mp4",
    cover: "_thumbs/libertaacademy ESPANHOL.jpg",
    adName: "X1 | LATAM | VIDEO ESPANOL | V1",
    content: "x1_video_espanol_v1",
    message: "Eres dueno, gestor o responsable de una escuela o proyecto de futbol? Lleva tu equipo a una experiencia internacional en Florianopolis. Libertacademy 2027 recibe las categorias Sub-09, Sub-11, Sub-13 y Sub-15. Habla ahora con la organizacion y recibe la presentacion oficial.",
    headline: "Tu escuela en Libertacademy 2027",
    description: "Florianopolis | 21 al 24 de enero",
  },
];

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID) {
  throw new Error("Perfil ec10-manager incompleto para montar a campanha X1.");
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
  const type = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".png" ? "image/png" : "video/mp4";
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

function targeting(geoLocations, positions) {
  return {
    age_min: 30,
    age_max: 58,
    geo_locations: geoLocations,
    excluded_custom_audiences: [{ id: EXCLUSION_AUDIENCE_ID }],
    flexible_spec: [
      { work_positions: positions, behaviors: ownerBehaviors },
      { interests: footballInterest },
      { behaviors: travelBehaviors },
    ],
    publisher_platforms: ["instagram"],
    instagram_positions: ["stream", "story", "explore", "reels"],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
  };
}

function destinationLink(asset) {
  return `${TRACKING_URL}?lang=${asset.locale}&variant=${asset.content}`;
}

function urlTags(asset) {
  return [
    "utm_source=meta",
    "utm_medium=paid_social",
    "utm_campaign=libertacademy_x1_2027",
    `utm_content=${asset.content}`,
    "utm_term={{adset.name}}",
    "campaign_id={{campaign.id}}",
    "adset_id={{adset.id}}",
    "ad_id={{ad.id}}",
    "placement={{placement}}",
    "site_source_name={{site_source_name}}",
  ].join("&");
}

async function findCampaign() {
  const response = await metaGet(`${ACCOUNT_ID}/campaigns`, {
    fields: "id,name,status,effective_status,objective,start_time,stop_time",
    limit: 200,
  });
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

async function ensureAdset(campaignId, config, start, end, existingAdsets) {
  const existing = existingAdsets.find((item) => item.name === config.name);
  const payload = {
    name: config.name,
    lifetime_budget: config.budget,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    destination_type: "WEBSITE",
    targeting: config.targeting,
    status: "PAUSED",
  };
  if (existing) {
    // Meta locks start_time once the scheduled start has passed, even while paused.
    const updatePayload = { ...payload };
    delete updatePayload.start_time;
    await metaPost(existing.id, updatePayload);
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

async function ensureAd(asset, adsetId, existingAds) {
  const existing = existingAds.find((item) => item.name === asset.adName);
  if (existing) return { id: existing.id, creativeId: existing.creative?.id, reused: true };
  const videoPath = path.join(ASSET_ROOT, asset.video);
  const coverPath = path.join(ASSET_ROOT, ...asset.cover.split("/"));
  await Promise.all([fs.access(videoPath), fs.access(coverPath)]);
  const [videoId, imageHash] = await Promise.all([
    uploadVideo(videoPath, `${asset.adName} | VIDEO`),
    uploadImage(coverPath),
  ]);
  const creative = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: `${asset.adName} | CRIATIVO`,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: INSTAGRAM_ID,
      video_data: {
        video_id: videoId,
        image_hash: imageHash,
        message: asset.message,
        title: asset.headline,
        link_description: asset.description,
        call_to_action: { type: "CONTACT_US", value: { link: destinationLink(asset) } },
      },
    },
    url_tags: urlTags(asset),
  });
  const ad = await metaPost(`${ACCOUNT_ID}/ads`, {
    name: asset.adName,
    adset_id: adsetId,
    creative: { creative_id: creative.id },
    status: "PAUSED",
  });
  return { id: ad.id, creativeId: creative.id, videoId, reused: false };
}

async function campaignObjects(campaignId) {
  const [campaign, adsets, ads] = await Promise.all([
    metaGet(campaignId, { fields: "id,name,status,effective_status,objective,start_time,stop_time" }),
    metaGet(`${campaignId}/adsets`, {
      fields: "id,name,status,effective_status,lifetime_budget,start_time,end_time,targeting",
      limit: 50,
    }),
    metaGet(`${campaignId}/ads`, {
      fields: "id,name,status,effective_status,adset_id,creative{id,name,status,object_story_spec}",
      limit: 50,
    }),
  ]);
  return { campaign, adsets: adsets.data || [], ads: ads.data || [] };
}

async function audienceEstimate(targetingSpec) {
  try {
    const result = await metaGet(`${ACCOUNT_ID}/delivery_estimate`, {
      targeting_spec: targetingSpec,
      optimization_goal: "LINK_CLICKS",
    });
    return result.data?.[0] || null;
  } catch (error) {
    return { unavailable: true, reason: String(error.message).slice(0, 300) };
  }
}

async function auditAccount() {
  const [account, instagram] = await Promise.all([
    metaGet(ACCOUNT_ID, {
      fields: "id,name,account_status,disable_reason,currency,balance,amount_spent,spend_cap,funding_source_details",
    }),
    metaGet(INSTAGRAM_ID, { fields: "id,username,name" }),
  ]);
  return { account, instagram, existingCampaign: await findCampaign() };
}

async function apply() {
  const start = new Date(Date.now() + 30 * 60_000);
  const end = new Date(start.getTime() + 5 * 24 * 60 * 60 * 1000);
  const campaignId = await ensureCampaign();
  const brTargeting = targeting({ countries: ["BR"], location_types: ["home"] }, brPositions);
  const esTargeting = targeting({
    cities: [
      city("83693", 50),
      city("84740", 40),
      city("328660", 40),
      city("2549997", 40),
      city("1903658", 40),
    ],
    location_types: ["home"],
  }, esPositions);
  const before = await campaignObjects(campaignId);
  const brAdsetId = await ensureAdset(campaignId, { name: BR_ADSET_NAME, budget: 25_000, targeting: brTargeting }, start, end, before.adsets);
  const esAdsetId = await ensureAdset(campaignId, { name: ES_ADSET_NAME, budget: 15_000, targeting: esTargeting }, start, end, before.adsets);
  const afterAdsets = await campaignObjects(campaignId);
  const adResults = [];
  for (const asset of assets) {
    adResults.push({
      key: asset.key,
      ...(await ensureAd(asset, asset.locale === "pt" ? brAdsetId : esAdsetId, afterAdsets.ads)),
    });
  }
  if (ACTIVATE) {
    const objects = await campaignObjects(campaignId);
    for (const ad of objects.ads) await metaPost(ad.id, { status: "ACTIVE" });
    for (const adset of objects.adsets) await metaPost(adset.id, { status: "ACTIVE" });
    await metaPost(campaignId, { status: "ACTIVE" });
  }
  return {
    campaignId,
    brAdsetId,
    esAdsetId,
    start: start.toISOString(),
    end: end.toISOString(),
    adResults,
    estimates: {
      br: await audienceEstimate(brTargeting),
      es: await audienceEstimate(esTargeting),
    },
    activated: ACTIVATE,
    after: await campaignObjects(campaignId),
  };
}

const accountAudit = await auditAccount();
const result = APPLY ? await apply() : null;
console.log(JSON.stringify({ mode: ACTIVATE ? "activate" : APPLY ? "apply" : "audit", accountAudit, result }, null, 2));
