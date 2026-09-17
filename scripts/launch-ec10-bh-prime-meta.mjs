/**
 * EC10 BH Prime - Plano de Carreira + Plano Internacional
 *
 * Auditoria (somente leitura):
 *   node scripts/launch-ec10-bh-prime-meta.mjs
 *
 * Criacao pausada, autorizacao exata de R$ 700,00:
 *   node scripts/launch-ec10-bh-prime-meta.mjs --apply --budget=70000
 */

import fs from "node:fs/promises";
import path from "node:path";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || process.env.META_GRAPH_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "");
const PAGE_ID = process.env.META_PAGE_ID;
const INSTAGRAM_ID = process.env.META_EC10_INSTAGRAM_ID || process.env.META_INSTAGRAM_BUSINESS_ID;
const PIXEL_ID = process.env.META_PIXEL_ID;
const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const REQUESTED_BUDGET = Number(process.argv.find((item) => item.startsWith("--budget="))?.split("=")[1] || 0);
const RESUME_PC_ID = process.argv.find((item) => item.startsWith("--resume-pc="))?.split("=")[1] || null;
const AUTHORIZED_BUDGET = 70_000;
const OUTPUT_PATH = "C:\\Users\\Admin\\Documents\\CODEX\\2026-09-15\\abr\\outputs\\EC10_Meta_BH_Prime_Creation_2026-09-16.json";

const bhPrimeGeo = {
  location_types: ["home"],
  neighborhoods: [
    { key: "2776740", name: "Belvedere" },
    { key: "2776549", name: "Lourdes" },
    { key: "2776585", name: "Savassi" },
    { key: "2776698", name: "Funcionários" },
    { key: "2781408", name: "Santo Agostinho" },
    { key: "2784814", name: "Anchieta" },
    { key: "2776581", name: "Sion" },
    { key: "2776294", name: "Mangabeiras" },
    { key: "2776576", name: "Cidade Jardim" },
    { key: "2776396", name: "Gutierrez" },
    { key: "2776560", name: "Buritis" },
    { key: "2781305", name: "Estoril" },
    { key: "2778179", name: "São Bento" },
  ],
  custom_locations: [
    {
      name: "Vila da Serra + Vale do Sereno",
      latitude: -19.982,
      longitude: -43.94,
      radius: 1,
      distance_unit: "kilometer",
    },
  ],
};

const bhNovaLimaGeo = {
  location_types: ["home"],
  cities: [
    { key: "244661", name: "Belo Horizonte" },
    { key: "261456", name: "Nova Lima" },
  ],
};

const campaigns = [
  {
    key: "pc",
    name: "EC10 | PC | LEADS SITE | BH PRIME | PILOTO 7D | 2026-09",
    destination: "https://ec10talentos.com/lp/plano-de-carreira/",
    utmCampaign: "pc_lead_bh_prime_v1_20260916",
    adsets: [
      {
        key: "pc_resp",
        name: "PC | RESP 25-54 | ATLETA 8+ | BH PRIME | LEAD | R$40D",
        lifetimeBudget: 28_000,
        ageMin: 25,
        ageMax: 54,
        geo: bhPrimeGeo,
        ads: [
          {
            name: "PC-R1 | Video 22s | Problema e plano",
            video: { type: "existing", id: "2247743782686700" },
            text: "Famílias de Belo Horizonte e Nova Lima: seu filho tem 8 anos ou mais, treina futebol, mas vocês ainda não sabem qual é o próximo passo? O Plano de Carreira EC10 organiza a trajetória com leitura do momento do atleta, orientação à família, preparação, posicionamento e próximos passos compatíveis com a idade. Cadastre-se para uma análise inicial. A EC10 não promete aprovação ou contrato: cada oportunidade depende do perfil e da decisão dos clubes.",
            headline: "Transforme o sonho em um plano de carreira",
            description: "Orientação para atleta e família.",
            content: "pc_resp_video22_plano",
            term: "bh_prime_resp_25_54_atleta_8plus",
          },
          {
            name: "PC-R2 | Video 35s | Decisao com clareza",
            video: { type: "existing", id: "1763647831482098" },
            text: "Para atletas a partir de 8 anos, antes de buscar peneira, viagem ou clube, é preciso entender o momento atual e qual rota faz sentido. A EC10 reúne acompanhamento, mentoria, leitura técnica e posicionamento para construir uma trajetória mais clara com a família. Conte a idade e o objetivo do atleta.",
            headline: "Descubra o próximo passo do atleta",
            description: "Planejamento antes da oportunidade.",
            content: "pc_resp_video35_clareza",
            term: "bh_prime_resp_25_54_atleta_8plus",
          },
        ],
      },
      {
        key: "pc_atleta",
        name: "PC | ATLETA 18-24 | BH + NOVA LIMA | LEAD | R$20D",
        lifetimeBudget: 14_000,
        ageMin: 18,
        ageMax: 24,
        geo: bhNovaLimaGeo,
        ads: [
          {
            name: "PC-A1 | Video seguro | Direcao do atleta",
            video: { type: "existing", id: "2247743782686700" },
            text: "Você treina e quer evoluir, mas sente que falta direção? O Plano de Carreira EC10 ajuda a organizar seu perfil, identificar o que precisa melhorar e planejar os próximos passos no Brasil ou no exterior. Envie seus dados e conte em que momento você está.",
            headline: "Construa seu próximo passo no futebol",
            description: "Análise inicial do momento do atleta.",
            content: "pc_atleta_video_direcao",
            term: "bh_nova_lima_18_24",
          },
        ],
      },
    ],
  },
  {
    key: "pi",
    name: "EC10 | PI 20-25 | LEADS SITE | BH PRIME | PILOTO 7D | 2026-09",
    destination: "https://ec10talentos.com/lp/plano-internacional/",
    utmCampaign: "pi_20_25_lead_bh_prime_v1_20260916",
    adsets: [
      {
        key: "pi_atleta",
        name: "PI | ATLETA 20-25 | BH PRIME | LEAD | R$25D",
        lifetimeBudget: 17_500,
        ageMin: 20,
        ageMax: 25,
        geo: bhPrimeGeo,
        ads: [
          {
            name: "PI-A1 | Case Joao | Analise do atleta",
            video: { type: "remote", url: "https://ec10talentos.com/sales-media/v1/international-cases/joao-shillong.mp4" },
            text: "Atleta de Belo Horizonte ou Nova Lima: você tem entre 20 e 25 anos, histórico competitivo e quer uma avaliação internacional com preparação e logística definidas? O Plano Internacional EC10 analisa idade, posição, vídeos, experiência e disponibilidade para direcionar o atleta a uma oportunidade compatível. Cadastre-se para uma análise inicial. Avaliação, continuidade, contrato e salário dependem exclusivamente do clube.",
            headline: "Seu perfil pode estar pronto para outro mercado",
            description: "Análise individual para atletas de 20 a 25 anos.",
            content: "pi_atleta_joao_analise",
            term: "bh_prime_20_25",
          },
          {
            name: "PI-A2 | Case adaptacao | Momento esportivo",
            video: { type: "remote", url: "https://ec10talentos.com/sales-media/v1/international-cases/adaptacao-clube-europeu.mp4" },
            text: "Jogar fora não começa no aeroporto. Começa com uma leitura honesta do perfil, do material e do momento esportivo. A EC10 organiza a análise, o direcionamento e o acompanhamento para que você entenda o projeto antes de decidir.",
            headline: "Entenda se o Plano Internacional faz sentido",
            description: "Perfil, destino e escopo antes da viagem.",
            content: "pi_atleta_adaptacao_momento",
            term: "bh_prime_20_25",
          },
        ],
      },
      {
        key: "pi_familia",
        name: "PI | FAMILIA 35-54 | BH PRIME | LEAD | R$15D",
        lifetimeBudget: 10_500,
        ageMin: 35,
        ageMax: 54,
        geo: bhPrimeGeo,
        ads: [
          {
            name: "PI-F1 | Case Portugal | Seguranca da familia",
            video: { type: "remote", url: "https://ec10talentos.com/sales-media/v1/international-cases/historia-transformacao-portugal.mp4" },
            text: "Levar um atleta para uma avaliação no exterior exige mais do que comprar uma passagem. A EC10 avalia perfil, momento esportivo, material e destino para organizar um projeto com escopo, logística e acompanhamento claros. Envie os dados do atleta e descubra se este é o momento certo.",
            headline: "Planeje a avaliação internacional com clareza",
            description: "Sem promessa de aprovação ou contrato.",
            content: "pi_familia_portugal_seguranca",
            term: "bh_prime_35_54",
          },
        ],
      },
    ],
  },
];

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID || !PIXEL_ID) {
  throw new Error("Perfil ec10-manager incompleto para a operacao Meta Ads.");
}
if (APPLY && REQUESTED_BUDGET !== AUTHORIZED_BUDGET) {
  throw new Error("Operacao bloqueada: use exatamente --budget=70000 (R$ 700,00 total).");
}
const configuredBudget = campaigns.flatMap((campaign) => campaign.adsets).reduce((sum, adset) => sum + adset.lifetimeBudget, 0);
if (configuredBudget !== AUTHORIZED_BUDGET) throw new Error("A distribuicao de verba nao fecha R$ 700,00.");

function normalizeAccountId(value) {
  if (!value) return "";
  return String(value).startsWith("act_") ? String(value) : `act_${value}`;
}

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [error.message || `Meta HTTP ${status}`, error.error_user_title, error.error_user_msg]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 1800);
}

async function metaGet(resource, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  url.searchParams.set("access_token", TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function metaPost(resource, body) {
  if (!APPLY) throw new Error("POST bloqueado no modo auditoria.");
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
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function uploadRemoteVideo(url, name) {
  if (!APPLY) throw new Error("Upload bloqueado no modo auditoria.");
  const source = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!source.ok) throw new Error(`Falha ao obter criativo ${name}: HTTP ${source.status}`);
  const data = await source.arrayBuffer();
  const form = new FormData();
  form.set("name", name);
  form.set("source", new Blob([data], { type: source.headers.get("content-type") || "video/mp4" }), `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp4`);
  form.set("access_token", TOKEN);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${ACCOUNT_ID}/advideos`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(12 * 60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  if (!payload.id) throw new Error(`Meta nao retornou video_id para ${name}.`);
  return payload.id;
}

async function waitForVideo(videoId) {
  for (let attempt = 0; attempt < 42; attempt += 1) {
    const video = await metaGet(videoId, { fields: "id,status,thumbnails" });
    const status = String(video.status?.video_status || video.status || "").toLowerCase();
    if (["ready", "complete", "completed"].includes(status)) return video;
    if (["error", "failed"].includes(status)) throw new Error(`Processamento do video ${videoId} falhou: ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`Video ${videoId} nao ficou pronto na janela de processamento.`);
}

function videoThumbnail(video) {
  const thumbnails = video?.thumbnails?.data || [];
  return thumbnails.find((item) => item.is_preferred)?.uri || thumbnails[0]?.uri || null;
}

function nextSchedule() {
  const now = new Date();
  const saoPaulo = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  const base = new Date(`${saoPaulo.year}-${saoPaulo.month}-${saoPaulo.day}T12:00:00-03:00`);
  base.setUTCDate(base.getUTCDate() + 1);
  const end = new Date(base);
  end.setUTCDate(end.getUTCDate() + 7);
  const isoDate = (date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return {
    start: `${isoDate(base)}T09:00:00-03:00`,
    end: `${isoDate(end)}T09:00:00-03:00`,
  };
}

function targeting(adset) {
  const cleanGeo = {
    ...adset.geo,
    neighborhoods: adset.geo.neighborhoods?.map(({ key }) => ({ key })),
    cities: adset.geo.cities?.map(({ key }) => ({ key })),
  };
  if (!cleanGeo.neighborhoods) delete cleanGeo.neighborhoods;
  if (!cleanGeo.cities) delete cleanGeo.cities;
  return {
    age_min: adset.ageMin,
    age_max: adset.ageMax,
    geo_locations: cleanGeo,
    targeting_automation: { advantage_audience: 0 },
  };
}

function urlTags(campaign, ad) {
  return [
    "utm_source=meta",
    "utm_medium=paid_social",
    `utm_campaign=${campaign.utmCampaign}`,
    `utm_content=${ad.content}`,
    `utm_term=${ad.term}`,
    "campaign_id={{campaign.id}}",
    "adset_id={{adset.id}}",
    "ad_id={{ad.id}}",
    "placement={{placement}}",
    "site_source_name={{site_source_name}}",
  ].join("&");
}

async function checkWeb(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45_000) });
  return { url, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") };
}

async function allCampaigns() {
  const response = await metaGet(`${ACCOUNT_ID}/campaigns`, {
    fields: "id,name,status,effective_status,objective",
    limit: "500",
  });
  return response.data || [];
}

function remainingCap(account) {
  const spendCap = Number(account.spend_cap || 0);
  if (spendCap <= 0) return null;
  return Math.max(0, spendCap - Number(account.amount_spent || 0));
}

async function preflight() {
  const destinations = campaigns.map((campaign) => checkWeb(campaign.destination));
  const remoteVideos = campaigns.flatMap((campaign) => campaign.adsets).flatMap((adset) => adset.ads)
    .filter((ad) => ad.video.type === "remote")
    .map((ad) => checkWeb(ad.video.url, { method: "HEAD" }));
  const [account, page, instagram, pixel, configResponse, existingCampaigns, ...webChecks] = await Promise.all([
    metaGet(ACCOUNT_ID, { fields: "id,name,account_status,currency,timezone_name,amount_spent,spend_cap,balance,funding_source_details" }),
    metaGet(PAGE_ID, { fields: "id,name" }),
    metaGet(INSTAGRAM_ID, { fields: "id,username" }),
    metaGet(PIXEL_ID, { fields: "id,name,last_fired_time,is_unavailable" }),
    fetch("https://ec10talentos.com/api/meta-config", { signal: AbortSignal.timeout(45_000) }),
    allCampaigns(),
    ...destinations,
    ...remoteVideos,
  ]);
  const config = await configResponse.json().catch(() => ({}));
  const duplicateNames = existingCampaigns.filter((item) => campaigns.some((campaign) => campaign.name === item.name));
  const unexpectedDuplicates = duplicateNames.filter((item) => item.id !== RESUME_PC_ID);
  const remaining = remainingCap(account);
  const webOk = webChecks.every((item) => item.ok);
  const ready = Number(account.account_status) === 1
    && account.currency === "BRL"
    && account.timezone_name === "America/Sao_Paulo"
    && (remaining === null || remaining >= AUTHORIZED_BUDGET)
    && config.pixelId === PIXEL_ID
    && configResponse.ok
    && webOk
    && unexpectedDuplicates.length === 0;
  return {
    ready,
    account: {
      id: account.id,
      name: account.name,
      status: account.account_status,
      currency: account.currency,
      timezone: account.timezone_name,
      remainingSpendCapCents: remaining,
    },
    page,
    instagram,
    pixel,
    sitePixelMatches: config.pixelId === PIXEL_ID,
    duplicateCampaigns: duplicateNames,
    unexpectedDuplicateCampaigns: unexpectedDuplicates,
    webChecks,
  };
}

async function createCampaign(spec) {
  if (spec.key === "pc" && RESUME_PC_ID) {
    const [existing, children] = await Promise.all([
      metaGet(RESUME_PC_ID, { fields: "id,name,status,effective_status,objective" }),
      metaGet(`${RESUME_PC_ID}/adsets`, { fields: "id,name,status,effective_status", limit: "10" }),
    ]);
    if (existing.name !== spec.name || existing.status !== "PAUSED" || existing.objective !== "OUTCOME_LEADS") {
      throw new Error("A campanha indicada para retomada nao corresponde ao objeto pausado criado nesta operacao.");
    }
    if ((children.data || []).length > 0) {
      throw new Error("Retomada bloqueada: a campanha parcial ja possui conjuntos de anuncios.");
    }
    return existing.id;
  }
  const result = await metaPost(`${ACCOUNT_ID}/campaigns`, {
    name: spec.name,
    objective: "OUTCOME_LEADS",
    buying_type: "AUCTION",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
    status: "PAUSED",
  });
  return result.id;
}

async function createAdset(campaignId, spec, schedule) {
  const result = await metaPost(`${ACCOUNT_ID}/adsets`, {
    name: spec.name,
    campaign_id: campaignId,
    lifetime_budget: spec.lifetimeBudget,
    start_time: schedule.start,
    end_time: schedule.end,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }],
    promoted_object: { pixel_id: PIXEL_ID, custom_event_type: "LEAD" },
    targeting: targeting(spec),
    status: "PAUSED",
  });
  return result.id;
}

async function resolveVideo(ad) {
  if (ad.video.type === "existing") {
    const video = await metaGet(ad.video.id, { fields: "id,status,thumbnails" });
    return { id: ad.video.id, thumbnail: videoThumbnail(video), uploaded: false };
  }
  const id = await uploadRemoteVideo(ad.video.url, `EC10 BH PRIME | ${ad.name}`);
  const video = await waitForVideo(id);
  return { id, thumbnail: videoThumbnail(video), uploaded: true };
}

async function createCreative(campaign, ad, video) {
  const videoData = {
    video_id: video.id,
    message: ad.text,
    title: ad.headline,
    link_description: ad.description,
    call_to_action: { type: "LEARN_MORE", value: { link: campaign.destination } },
  };
  if (video.thumbnail) videoData.image_url = video.thumbnail;
  const result = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: `${ad.name} | CRIATIVO`,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: INSTAGRAM_ID,
      video_data: videoData,
    },
    url_tags: urlTags(campaign, ad),
  });
  return result.id;
}

async function createAd(campaignId, adsetId, creativeId, ad) {
  const result = await metaPost(`${ACCOUNT_ID}/ads`, {
    name: ad.name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
    tracking_specs: [{ "action.type": ["offsite_conversion"], fb_pixel: [PIXEL_ID] }],
  });
  return result.id;
}

async function verifyObject(id, fields) {
  return metaGet(id, { fields });
}

async function previewAd(id) {
  const preview = await metaGet(`${id}/previews`, { ad_format: "MOBILE_FEED_STANDARD" });
  return Boolean(preview.data?.[0]?.body);
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function refreshCompletedReport() {
  const saved = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  const verification = {
    campaigns: await Promise.all(saved.created.campaigns.map((item) => verifyObject(item.id, "id,name,status,effective_status,objective"))),
    adsets: await Promise.all(saved.created.adsets.map((item) => verifyObject(item.id, "id,name,status,effective_status,lifetime_budget,start_time,end_time,optimization_goal,billing_event,bid_strategy,attribution_spec,targeting,promoted_object"))),
    ads: await Promise.all(saved.created.ads.map((item) => verifyObject(item.id, "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,object_story_spec,url_tags}"))),
  };
  verification.preview = await Promise.all(saved.created.ads.map(async (item) => ({ id: item.id, ok: await previewAd(item.id) })));
  verification.totalLifetimeBudgetCents = verification.adsets.reduce((sum, item) => sum + Number(item.lifetime_budget || 0), 0);
  verification.allCommandedPaused = [...verification.campaigns, ...verification.adsets, ...verification.ads]
    .every((item) => item.status === "PAUSED");
  verification.parentDeliveryBlocked = [...verification.campaigns, ...verification.adsets]
    .every((item) => item.status === "PAUSED" && item.effective_status === "PAUSED");
  verification.allPreviewsReady = verification.preview.every((item) => item.ok);
  verification.processingAds = verification.ads
    .filter((item) => item.effective_status !== "PAUSED")
    .map((item) => ({ id: item.id, effective_status: item.effective_status }));
  const account = await metaGet(ACCOUNT_ID, { fields: "id,name,account_status,amount_spent,spend_cap,balance" });
  verification.account = {
    id: account.id,
    status: account.account_status,
    remainingSpendCapCents: remainingCap(account),
  };
  const complete = saved.created.campaigns.length === 2
    && saved.created.adsets.length === 4
    && saved.created.ads.length === 6
    && verification.totalLifetimeBudgetCents === AUTHORIZED_BUDGET
    && verification.allCommandedPaused
    && verification.parentDeliveryBlocked
    && verification.allPreviewsReady;
  saved.verification = verification;
  saved.result = complete ? "CREATED_PAUSED" : "VERIFICATION_FAILED";
  saved.error = complete ? null : saved.error;
  saved.rollback = "Objetos novos podem ser arquivados/excluidos pelos IDs registrados; nenhuma campanha preexistente foi alterada.";
  saved.verifiedAt = new Date().toISOString();
  await writeReport(saved);
  console.log(JSON.stringify({
    result: saved.result,
    counts: {
      campaigns: saved.created.campaigns.length,
      adsets: saved.created.adsets.length,
      creatives: saved.created.creatives.length,
      ads: saved.created.ads.length,
      videos: saved.created.videos.length,
    },
    verification: {
      allCommandedPaused: verification.allCommandedPaused,
      parentDeliveryBlocked: verification.parentDeliveryBlocked,
      allPreviewsReady: verification.allPreviewsReady,
      processingAds: verification.processingAds,
      totalLifetimeBudgetCents: verification.totalLifetimeBudgetCents,
      remainingSpendCapCents: verification.account.remainingSpendCapCents,
    },
    output: OUTPUT_PATH,
  }, null, 2));
  if (!complete) process.exitCode = 1;
}

if (VERIFY) {
  await refreshCompletedReport();
  process.exit(process.exitCode || 0);
}

const report = {
  operation: "EC10 BH Prime - criacao Meta Ads pausada",
  mode: APPLY ? "apply" : "audit",
  requestedBudgetCents: REQUESTED_BUDGET,
  authorizedBudgetCents: AUTHORIZED_BUDGET,
  startedAt: new Date().toISOString(),
  noExistingCampaignMutation: true,
  created: { campaigns: [], adsets: [], creatives: [], ads: [], videos: [] },
};

try {
  report.preflight = await preflight();
  if (!report.preflight.ready) {
    throw new Error(`Preflight bloqueou a operacao: ${JSON.stringify({
      account: report.preflight.account,
      sitePixelMatches: report.preflight.sitePixelMatches,
      duplicateCampaigns: report.preflight.duplicateCampaigns,
      webChecks: report.preflight.webChecks,
    })}`);
  }

  if (!APPLY) {
    report.result = "AUDIT_OK";
    report.finishedAt = new Date().toISOString();
    await writeReport(report);
    console.log(JSON.stringify({ result: report.result, preflight: report.preflight, output: OUTPUT_PATH }, null, 2));
    process.exit(0);
  }

  const schedule = nextSchedule();
  report.schedule = schedule;

  for (const campaignSpec of campaigns) {
    const campaignId = await createCampaign(campaignSpec);
    report.created.campaigns.push({ id: campaignId, name: campaignSpec.name, resumed: campaignSpec.key === "pc" && campaignId === RESUME_PC_ID });

    for (const adsetSpec of campaignSpec.adsets) {
      const adsetId = await createAdset(campaignId, adsetSpec, schedule);
      report.created.adsets.push({
        id: adsetId,
        campaignId,
        name: adsetSpec.name,
        lifetimeBudget: adsetSpec.lifetimeBudget,
      });

      for (const adSpec of adsetSpec.ads) {
        const video = await resolveVideo(adSpec);
        if (video.uploaded) report.created.videos.push({ id: video.id, name: adSpec.name });
        const creativeId = await createCreative(campaignSpec, adSpec, video);
        report.created.creatives.push({ id: creativeId, name: `${adSpec.name} | CRIATIVO`, videoId: video.id });
        const adId = await createAd(campaignId, adsetId, creativeId, adSpec);
        report.created.ads.push({ id: adId, campaignId, adsetId, creativeId, name: adSpec.name });
      }
    }
  }

  report.verification = {
    campaigns: await Promise.all(report.created.campaigns.map((item) => verifyObject(item.id, "id,name,status,effective_status,objective"))),
    adsets: await Promise.all(report.created.adsets.map((item) => verifyObject(item.id, "id,name,status,effective_status,lifetime_budget,start_time,end_time,optimization_goal,billing_event,bid_strategy,attribution_spec,targeting,promoted_object"))),
    ads: await Promise.all(report.created.ads.map((item) => verifyObject(item.id, "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,object_story_spec,url_tags}"))),
  };
  report.verification.preview = await Promise.all(report.created.ads.map(async (item) => ({ id: item.id, ok: await previewAd(item.id) })));
  report.verification.totalLifetimeBudgetCents = report.verification.adsets.reduce((sum, item) => sum + Number(item.lifetime_budget || 0), 0);
  report.verification.allPaused = [
    ...report.verification.campaigns,
    ...report.verification.adsets,
    ...report.verification.ads,
  ].every((item) => item.status === "PAUSED" && item.effective_status === "PAUSED");
  report.verification.allPreviewsReady = report.verification.preview.every((item) => item.ok);

  if (report.verification.totalLifetimeBudgetCents !== AUTHORIZED_BUDGET) throw new Error("Verificacao falhou: verba total diferente de R$ 700,00.");
  if (!report.verification.allPaused) throw new Error("Verificacao falhou: existe objeto fora de PAUSED.");

  report.result = "CREATED_PAUSED";
  report.rollback = "Objetos novos podem ser arquivados/excluidos pelos IDs registrados; nenhuma campanha preexistente foi alterada.";
  report.finishedAt = new Date().toISOString();
  await writeReport(report);
  console.log(JSON.stringify({
    result: report.result,
    schedule: report.schedule,
    createdCounts: Object.fromEntries(Object.entries(report.created).map(([key, value]) => [key, value.length])),
    verification: {
      allPaused: report.verification.allPaused,
      allPreviewsReady: report.verification.allPreviewsReady,
      totalLifetimeBudgetCents: report.verification.totalLifetimeBudgetCents,
    },
    ids: report.created,
    output: OUTPUT_PATH,
  }, null, 2));
} catch (error) {
  report.result = "BLOCKED_OR_PARTIAL";
  report.error = String(error?.message || error);
  report.finishedAt = new Date().toISOString();
  await writeReport(report).catch(() => {});
  console.error(JSON.stringify({ result: report.result, error: report.error, created: report.created, output: OUTPUT_PATH }, null, 2));
  process.exitCode = 1;
}
