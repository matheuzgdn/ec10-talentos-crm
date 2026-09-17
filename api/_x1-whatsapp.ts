import crypto from "node:crypto";

import { pool } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";

const TARGET_WHATSAPP = "553197767223";
const CAMPAIGN_SLUG = "libertacademy_x1_2027";
const BOT_INSTANCE_ID = "main";

function clean(value: unknown, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isCrawler(userAgent: string) {
  return /facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|whatsapp|googlebot|bingbot|crawler|spider/i.test(userAgent);
}

function buildTrackingCode(language: "pt" | "es", variant: string) {
  const normalizedVariant = variant.replace(/[^a-z0-9]+/gi, "").slice(0, 5).toUpperCase() || "VID";
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `X1-${language.toUpperCase()}-${normalizedVariant}-${random}`;
}

function whatsappUrl(language: "pt" | "es", trackingCode: string) {
  const message = language === "es"
    ? `Hola. Vi el anuncio de Libertacademy y soy responsable de una escuela o proyecto de f\u00fatbol. Quiero recibir la presentaci\u00f3n de Florian\u00f3polis 2027. C\u00f3digo: ${trackingCode}`
    : `Ol\u00e1. Vi o an\u00fancio da Libertacademy e sou respons\u00e1vel por uma escola ou projeto de futebol. Quero receber a apresenta\u00e7\u00e3o de Florian\u00f3polis 2027. C\u00f3digo: ${trackingCode}`;
  return `https://wa.me/${TARGET_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

function requestSourceUrl(request: any) {
  const protocol = clean(request.headers?.["x-forwarded-proto"], 10) || "https";
  const host = clean(request.headers?.["x-forwarded-host"] || request.headers?.host, 200) || "ec10talentos.com";
  const rawUrl = clean(request.url, 1800) || "/api/x1-whatsapp";
  return `${protocol}://${host}${rawUrl}`;
}

export default async function handler(request: any, response: any) {
  response.setHeader("cache-control", "no-store, max-age=0");
  response.setHeader("x-robots-tag", "noindex, nofollow");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = request.query ?? {};
  const language: "pt" | "es" = clean(query.lang, 5).toLowerCase() === "es" ? "es" : "pt";
  const variant = clean(query.variant || query.utm_content, 100) || `video_${language}`;
  const trackingCode = buildTrackingCode(language, variant);
  const destination = whatsappUrl(language, trackingCode);
  const userAgent = clean(request.headers?.["user-agent"], 500);
  const crawler = isCrawler(userAgent);

  if (clean(query.dry_run, 10) === "1") {
    response.status(200).json({
      ok: true,
      campaign: CAMPAIGN_SLUG,
      language,
      variant,
      targetWhatsapp: TARGET_WHATSAPP,
      destination,
      trackingCode,
      recorded: false,
    });
    return;
  }

  if (request.method === "GET" && !crawler) {
    const campaignId = clean(query.campaign_id, 80);
    const adsetId = clean(query.adset_id, 80);
    const adId = clean(query.ad_id, 80);
    const fbclid = clean(query.fbclid, 240);
    const fbc = fbclid ? `fb.1.${Math.floor(Date.now() / 1000)}.${fbclid}` : null;
    const sourceUrl = requestSourceUrl(request);
    const metadata = {
      trackingCode,
      language,
      variant,
      targetWhatsapp: TARGET_WHATSAPP,
      placement: clean(query.placement, 100) || null,
      siteSourceName: clean(query.site_source_name, 100) || null,
      referrer: clean(request.headers?.referer, 500) || null,
      measurement: "whatsapp_open_intent",
      confirmedConversation: false,
    };

    try {
      await pool.query(
        `
          insert into public.traffic_events (
            bot_instance_id, event_type, channel, platform, service_interest,
            lead_status, quality_score, campaign_id, campaign_name, adset_id, ad_id,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, metadata
          )
          values (
            $1, 'libertacademy_x1_whatsapp_click', 'site', 'meta_ads', 'libertacademy_florianopolis',
            'contato_iniciado', 55, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11, $12::jsonb
          )
        `,
        [
          BOT_INSTANCE_ID,
          campaignId || null,
          CAMPAIGN_SLUG,
          adsetId || null,
          adId || null,
          clean(query.utm_source, 160) || "meta",
          clean(query.utm_medium, 160) || "paid_social",
          clean(query.utm_campaign, 200) || CAMPAIGN_SLUG,
          clean(query.utm_content, 200) || variant,
          clean(query.utm_term, 200) || null,
          fbclid || null,
          JSON.stringify(metadata),
        ],
      );

      await sendMetaQualityEvent({
        clientId: trackingCode,
        eventName: "Contact",
        status: "novo",
        serviceInterest: "libertacademy_florianopolis",
        leadScore: 55,
        country: language === "es" ? null : "br",
        fbclid: fbclid || null,
        fbc,
        eventSourceUrl: sourceUrl,
        actionSource: "website",
        eventId: trackingCode,
        customData: {
          campaign_project: CAMPAIGN_SLUG,
          language,
          creative_variant: variant,
          destination: "whatsapp_external",
          measurement: "whatsapp_open_intent",
        },
      });
    } catch (error) {
      console.error("X1 WhatsApp tracking failed", error);
    }
  }

  response.setHeader("location", destination);
  response.status(302).end();
}
