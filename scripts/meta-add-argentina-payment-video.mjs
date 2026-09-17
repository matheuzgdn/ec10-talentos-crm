/**
 * Adiciona, de forma idempotente, o video es-AR ao conjunto de pagamento
 * existente da campanha Argentina. O conjunto e o orcamento nao sao alterados.
 *
 * Modo padrao: somente leitura.
 * Aplicacao:
 *   node scripts/meta-add-argentina-payment-video.mjs --video-id=<id> \
 *     --apply --confirm=PUBLICAR-VIDEO-ARGENTINA-R175
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "");
const PAGE_ID = process.env.META_PAGE_ID;
const INSTAGRAM_ID = process.env.META_INSTAGRAM_BUSINESS_ID;

const ADSET_ID = "120247606274320601";
const CAMPAIGN_ID = "120247606271030601";
const VIDEO_THUMBNAIL_HASH = "ad4b40a7aaf5cd300e34f8b44d5c1ff3";
const CREATIVE_NAME = "RT ARG | PAGAMENTO VIDEO 15S | ES-AR | V1";
const AD_NAME = "RT ARG | PAGAMENTO VIDEO 15S | ES-AR | V1";
const CONFIRMATION = "PUBLICAR-VIDEO-ARGENTINA-R175";
const LINK =
  "https://www.revelatalentos.com/argentina?utm_source=meta&utm_medium=paid_social&utm_campaign=rt_arg_pagamento_video_r150&utm_content={{ad.name}}&utm_term={{adset.name}}";

const COPY = Object.freeze({
  message:
    "\u00bfSegu\u00eds a EC10 Talentos o ya viste la convocatoria? Buenos Aires recibe la convocatoria internacional el 17 y 18 de julio de 2026. La inscripci\u00f3n cuesta USD 50, en un pago \u00fanico. Complet\u00e1 tus datos, abon\u00e1 la inscripci\u00f3n y sub\u00ed el comprobante para validar tu cupo. Despu\u00e9s, sumate al grupo oficial de WhatsApp.",
  headline: "Inscripci\u00f3n: USD 50",
  description: "Pago \u00fanico, comprobante y grupo oficial"
});

const cli = parseArgs(process.argv.slice(2));
const VIDEO_ID = String(cli["video-id"] || "").trim();
const APPLY = cli.apply === true;

if (!TOKEN || !ACCOUNT_ID || !PAGE_ID || !INSTAGRAM_ID) {
  throw new Error("Carregue o perfil ec10-manager antes de executar.");
}
if (!VIDEO_ID) throw new Error("Informe --video-id=<id>.");
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

function creativeVideoId(creative) {
  return String(creative?.object_story_spec?.video_data?.video_id || "");
}

async function readState() {
  const [video, adset, campaign, ads, creatives] = await Promise.all([
    metaGet(VIDEO_ID, { fields: "id,status" }),
    metaGet(ADSET_ID, {
      fields:
        "id,name,status,effective_status,lifetime_budget,end_time,optimization_goal,promoted_object,campaign_id,targeting"
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
    existingAd: ads.find((row) => row.name === AD_NAME) || null,
    existingCreative:
      creatives.find(
        (row) => row.name === CREATIVE_NAME && creativeVideoId(row) === VIDEO_ID
      ) || null
  };
}

function validateBase(state) {
  if (state.video?.status?.video_status !== "ready") {
    throw new Error(`Video ainda nao esta pronto: ${state.video?.status?.video_status || "desconhecido"}.`);
  }
  if (state.adset.id !== ADSET_ID || state.adset.campaign_id !== CAMPAIGN_ID) {
    throw new Error("O conjunto de pagamento nao pertence a campanha esperada.");
  }
  if (state.adset.lifetime_budget !== "15000") {
    throw new Error(`Orcamento inesperado no conjunto de pagamento: ${state.adset.lifetime_budget}.`);
  }
  if (state.adset.status !== "ACTIVE" || state.campaign.status !== "ACTIVE") {
    throw new Error("A campanha ou o conjunto de pagamento nao esta configurado como ativo.");
  }
  if (Date.now() >= Date.parse(state.adset.end_time)) {
    throw new Error("O horario final da campanha ja passou.");
  }
  if (state.existingAd && creativeVideoId(state.existingAd.creative) !== VIDEO_ID) {
    throw new Error("Ja existe um anuncio com o mesmo nome apontando para outro video.");
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
        image_hash: VIDEO_THUMBNAIL_HASH,
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
  const videoData = ad?.creative?.object_story_spec?.video_data;
  if (ad.adset_id !== ADSET_ID) throw new Error("Anuncio criado no conjunto incorreto.");
  if (String(videoData?.video_id || "") !== VIDEO_ID) {
    throw new Error("O criativo do anuncio nao aponta para o video esperado.");
  }
  if (videoData?.call_to_action?.value?.link !== LINK) {
    throw new Error("O link do anuncio nao corresponde a landing page rastreada.");
  }
  if (!String(videoData?.message || "").includes("USD 50")) {
    throw new Error("A copia do anuncio nao informa USD 50.");
  }
}

async function main() {
  const state = await readState();
  validateBase(state);

  if (!APPLY) {
    console.log(
      JSON.stringify({
        mode: "read_only",
        ready: true,
        video_id: VIDEO_ID,
        adset_id: state.adset.id,
        adset_budget_brl: Number(state.adset.lifetime_budget) / 100,
        adset_status: state.adset.effective_status,
        campaign_status: state.campaign.effective_status,
        existing_ad_id: state.existingAd?.id || null,
        action: state.existingAd ? "validate_and_activate" : "create_paused_validate_activate"
      })
    );
    return;
  }

  const creative = await ensureCreative(state);
  const ad = await ensureAd(state, creative);
  validateAd(ad);

  if (ad.status !== "ACTIVE") await metaPost(ad.id, { status: "ACTIVE" });

  const [finalAd, finalAdset] = await Promise.all([
    metaGet(ad.id, {
      fields: "id,name,status,effective_status,issues_info,adset_id,creative{id,name,object_story_spec}"
    }),
    metaGet(ADSET_ID, {
      fields: "id,status,effective_status,lifetime_budget,end_time,optimization_goal,promoted_object"
    })
  ]);
  validateAd(finalAd);
  console.log(
    JSON.stringify({
      mode: "applied",
      video_id: VIDEO_ID,
      creative_id: finalAd.creative.id,
      ad_id: finalAd.id,
      ad_status: finalAd.status,
      ad_effective_status: finalAd.effective_status,
      issues: finalAd.issues_info || [],
      adset_id: finalAdset.id,
      adset_status: finalAdset.effective_status,
      adset_budget_brl: Number(finalAdset.lifetime_budget) / 100,
      optimization_goal: finalAdset.optimization_goal,
      pixel_id: finalAdset.promoted_object?.pixel_id || null,
      landing_link_ok: true,
      price_copy_ok: true
    })
  );
}

await main();
