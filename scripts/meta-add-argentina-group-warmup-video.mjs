/** Publica a variacao sem preco, com destino ao cadastro + grupo oficial. */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "");
const PAGE_ID = process.env.META_PAGE_ID;
const INSTAGRAM_ID = process.env.META_INSTAGRAM_BUSINESS_ID;
const ADSET_ID = "120247606274320601";
const CAMPAIGN_ID = "120247606271030601";
const cli = parseArgs(process.argv.slice(2));
const CLIENT_ORIGINAL = cli.variant === "client-original";
const CREATIVE_NAME = CLIENT_ORIGINAL
  ? "RT ARG | GRUPO VIDEO CLIENTE 38S | ORIGINAL | V1"
  : "RT ARG | GRUPO WARMUP VIDEO 15S | ES-AR | V1";
const AD_NAME = CREATIVE_NAME;
const CONFIRMATION = "PUBLICAR-GRUPO-WARMUP-ARGENTINA";
const LINK =
  "https://www.revelatalentos.com.br/argentina-grupo?utm_source=meta&utm_medium=paid_social&utm_campaign=rt_arg_grupo_warmup_r175&utm_content={{ad.name}}&utm_term={{adset.name}}";

const COPY = Object.freeze({
  message:
    "\u00bfViv\u00eds en Buenos Aires y segu\u00eds a EC10 Talentos? La convocatoria internacional llega el 17 y 18 de julio de 2026. Complet\u00e1 un registro breve y sumate al grupo oficial de WhatsApp para recibir horarios, ubicaci\u00f3n y novedades. El ingreso al grupo no confirma por s\u00ed solo un cupo en la convocatoria.",
  headline: "Entr\u00e1 al grupo oficial",
  description: "Registrate y abr\u00ed WhatsApp"
});

const VIDEO_ID = String(cli["video-id"] || "").trim();
const IMAGE_HASH = String(cli["image-hash"] || "").trim();
const APPLY = cli.apply === true;

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID) {
  throw new Error("Carregue o perfil ec10-manager.");
}
if (!VIDEO_ID || !IMAGE_HASH) throw new Error("Informe --video-id e --image-hash.");
if (APPLY && cli.confirm !== CONFIRMATION) {
  throw new Error(`Aplicacao bloqueada. Use --confirm=${CONFIRMATION}.`);
}

function normalizeAccountId(value) {
  const text = String(value || "").trim();
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

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [
    error.message || `Meta HTTP ${status}`,
    error.code ? `code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""}` : "",
    error.error_user_title,
    error.error_user_msg
  ].filter(Boolean).join(" - ").slice(0, 1200);
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
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

function videoIdFromCreative(creative) {
  return String(creative?.object_story_spec?.video_data?.video_id || "");
}

async function readState() {
  const [video, adset, campaign, ads, creatives] = await Promise.all([
    metaGet(VIDEO_ID, { fields: "id,status" }),
    metaGet(ADSET_ID, {
      fields: "id,name,status,effective_status,lifetime_budget,end_time,optimization_goal,promoted_object,campaign_id,targeting"
    }),
    metaGet(CAMPAIGN_ID, { fields: "id,name,status,effective_status,objective" }),
    metaAll(`${ACCOUNT_ID}/ads`, {
      fields: "id,name,status,effective_status,creative{id,name,object_story_spec}",
      limit: "200"
    }),
    metaAll(`${ACCOUNT_ID}/adcreatives`, {
      fields: "id,name,object_story_spec",
      limit: "200"
    })
  ]);
  return {
    video,
    adset,
    campaign,
    existingAd: ads.find((item) => item.name === AD_NAME) || null,
    existingCreative: creatives.find(
      (item) => item.name === CREATIVE_NAME && videoIdFromCreative(item) === VIDEO_ID
    ) || null
  };
}

function validateBase(state) {
  if (state.video?.status?.video_status !== "ready") throw new Error("Video ainda nao esta pronto.");
  if (state.adset.campaign_id !== CAMPAIGN_ID) throw new Error("Conjunto inesperado.");
  if (!["15000", "17500"].includes(state.adset.lifetime_budget)) {
    throw new Error(`Orcamento inesperado: ${state.adset.lifetime_budget}.`);
  }
  if (state.adset.status !== "ACTIVE" || state.campaign.status !== "ACTIVE") {
    throw new Error("Campanha ou conjunto nao esta ativo.");
  }
  if (state.adset.optimization_goal !== "OFFSITE_CONVERSIONS") {
    throw new Error("O conjunto nao esta otimizando conversao no site.");
  }
  if (!state.adset.promoted_object?.pixel_id) throw new Error("Pixel ausente no conjunto.");
  if (Date.now() >= Date.parse(state.adset.end_time)) throw new Error("Campanha encerrada.");
  if (state.existingAd && videoIdFromCreative(state.existingAd.creative) !== VIDEO_ID) {
    throw new Error("Ja existe anuncio com o mesmo nome e outro video.");
  }
}

async function ensureCreative(state) {
  if (state.existingAd?.creative) return state.existingAd.creative;
  if (state.existingCreative) return state.existingCreative;
  const created = await metaPost(`${ACCOUNT_ID}/adcreatives`, {
    name: CREATIVE_NAME,
    object_story_spec: {
      page_id: PAGE_ID,
      instagram_user_id: INSTAGRAM_ID,
      video_data: {
        video_id: VIDEO_ID,
        image_hash: IMAGE_HASH,
        message: COPY.message,
        title: COPY.headline,
        link_description: COPY.description,
        call_to_action: { type: "SIGN_UP", value: { link: LINK } }
      }
    }
  });
  return metaGet(created.id, { fields: "id,name,object_story_spec" });
}

async function ensureAd(state, creative) {
  if (state.existingAd) return state.existingAd;
  const created = await metaPost(`${ACCOUNT_ID}/ads`, {
    name: AD_NAME,
    adset_id: ADSET_ID,
    creative: { creative_id: creative.id },
    status: "PAUSED"
  });
  return metaGet(created.id, {
    fields: "id,name,status,effective_status,issues_info,adset_id,creative{id,name,object_story_spec}"
  });
}

function validateAd(ad) {
  const data = ad?.creative?.object_story_spec?.video_data;
  if (ad.adset_id !== ADSET_ID) throw new Error("Anuncio no conjunto incorreto.");
  if (String(data?.video_id || "") !== VIDEO_ID) throw new Error("Video incorreto no criativo.");
  if (data?.call_to_action?.value?.link !== LINK) throw new Error("Link incorreto no criativo.");
  const combined = `${data?.message || ""} ${data?.title || ""} ${data?.link_description || ""}`;
  if (/USD|Mercado Pago|comprobante|pago/i.test(combined)) {
    throw new Error("O criativo sem preco contem linguagem de pagamento.");
  }
}

async function main() {
  const state = await readState();
  validateBase(state);
  if (!APPLY) {
    console.log(JSON.stringify({
      mode: "read_only",
      ready: true,
      video_id: VIDEO_ID,
      adset_id: state.adset.id,
      budget_brl: Number(state.adset.lifetime_budget) / 100,
      pixel_id: state.adset.promoted_object.pixel_id,
      existing_ad_id: state.existingAd?.id || null
    }));
    return;
  }
  const creative = await ensureCreative(state);
  const ad = await ensureAd(state, creative);
  validateAd(ad);
  if (ad.status !== "ACTIVE") await metaPost(ad.id, { status: "ACTIVE" });
  const finalAd = await metaGet(ad.id, {
    fields: "id,name,status,effective_status,issues_info,adset_id,creative{id,name,object_story_spec}"
  });
  validateAd(finalAd);
  console.log(JSON.stringify({
    mode: "applied",
    video_id: VIDEO_ID,
    creative_id: finalAd.creative.id,
    ad_id: finalAd.id,
    status: finalAd.status,
    effective_status: finalAd.effective_status,
    issues: finalAd.issues_info || [],
    landing_ok: true,
    no_payment_copy: true
  }));
}

await main();
