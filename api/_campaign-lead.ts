import { bookingPool } from "./_booking-db.js";
import { saveCampaignRegistration, sendCampaignCapi } from "./_campaign-crm.js";

const DEFAULT_WHATSAPP_NUMBER = "553198526146";
const FUNNEL_KEY = "ec10_campaign_landing_pages";

const productCatalog = {
  carreira: {
    service: "plano_carreira",
    label: "Plano de Carreira",
    campaign: "plano_carreira",
    tier: "entrada",
    audience: "atleta_8_mais_e_responsavel",
    category: "planejamento_de_carreira_no_futebol",
  },
  kids: {
    service: "eurocamp",
    label: "Eurokids",
    campaign: "eurocamp",
    tier: "experiencia_internacional",
    audience: "atleta_8_13_e_responsavel",
    category: "camp_de_futebol_internacional",
  },
  juvenil: {
    service: "eurocamp",
    label: "Eurocamp 14 a 19",
    campaign: "eurocamp",
    tier: "experiencia_internacional",
    audience: "atleta_14_19_e_responsavel",
    category: "camp_de_futebol_internacional",
  },
  temporada: {
    service: "plano_internacional",
    label: "Plano Internacional",
    campaign: "plano_internacional",
    tier: "premium_individual",
    audience: "atleta_20_25_e_familia",
    category: "avaliacao_internacional_direta_em_clubes",
  },
} as const;

type ProductId = keyof typeof productCatalog;

function cleanText(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function allowedOrigin(origin: string) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "ec10talentos.com"
      || url.hostname === "www.ec10talentos.com"
      || url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function setCors(request: any, response: any) {
  const origin = String(request.headers?.origin ?? "");
  if (origin && allowedOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");
}

function normalizePhone(raw: unknown, dialCode: string) {
  const digits = cleanText(raw, 40).replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith(dialCode) || digits.length > 11 ? digits : `${dialCode}${digits}`;
}

function validPhone(phone: string, dialCode: string) {
  if (!phone.startsWith(dialCode) || phone.length > 15) return false;
  const national = phone.slice(dialCode.length);
  if (dialCode === "55") return /^[1-9][0-9][0-9]{8,9}$/.test(national) && !/^(\d)\1+$/.test(national.slice(2));
  return national.length >= 7;
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sourceUrl(origin: string, path: string) {
  try {
    return new URL(path || "/", origin || "https://ec10talentos.com").toString();
  } catch {
    return "https://ec10talentos.com/";
  }
}

function whatsappUrl(name: string, product: string) {
  const number = cleanText(process.env.EC10_PUBLIC_WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER, 24).replace(/\D/g, "");
  const message = `Olá, EC10 Talentos! Sou ${name} e enviei meu interesse em ${product} pela página da campanha.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export default async function handler(request: any, response: any) {
  setCors(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });

  const origin = String(request.headers?.origin ?? "");
  if (!allowedOrigin(origin)) return response.status(403).json({ error: "Origin not allowed" });

  try {
    const body = request.body ?? {};
    if (cleanText(body.website, 120)) return response.status(200).json({ ok: true });

    const role = body.role === "atleta" ? "atleta" : body.role === "responsavel" ? "responsavel" : "";
    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 180).toLowerCase();
    const dialCode = cleanText(body.countryDialCode, 5).replace(/\D/g, "") || "55";
    const countryCode = cleanText(body.countryCode, 2).toUpperCase() || "BR";
    const phone = normalizePhone(body.phone, dialCode);
    const productId = cleanText(body.productId, 40) as ProductId;
    const product = productCatalog[productId];
    const eventId = cleanText(body.eventId, 160).replace(/[^a-zA-Z0-9._:-]/g, "");
    const startedAt = Number(body.startedAt);
    const dryRun = body.dryRun === true;

    if (!role) return response.status(400).json({ error: "role is required" });
    if (name.split(/\s+/).filter(Boolean).length < 2) return response.status(400).json({ error: "full name is required" });
    if (!validEmail(email)) return response.status(400).json({ error: "valid email is required" });
    if (!validPhone(phone, dialCode)) return response.status(400).json({ error: "valid phone is required" });
    if (!product) return response.status(400).json({ error: "valid product is required" });
    if (!eventId) return response.status(400).json({ error: "event id is required" });
    if (!dryRun && (!Number.isFinite(startedAt) || Date.now() - startedAt < 700)) {
      return response.status(400).json({ error: "form submitted too quickly" });
    }

    const traffic = {
      utmSource: cleanText(body.utmSource, 160),
      utmMedium: cleanText(body.utmMedium, 160),
      utmCampaign: cleanText(body.utmCampaign, 200),
      utmContent: cleanText(body.utmContent, 200),
      utmTerm: cleanText(body.utmTerm, 200),
      fbclid: cleanText(body.fbclid, 240),
      gclid: cleanText(body.gclid, 240),
      fbc: cleanText(body.fbc, 300),
      fbp: cleanText(body.fbp, 300),
      campaignId: cleanText(body.campaignId, 160),
      adsetId: cleanText(body.adsetId, 160),
      adId: cleanText(body.adId, 160),
      creativeId: cleanText(body.creativeId, 160),
      placement: cleanText(body.placement, 120),
      siteSourceName: cleanText(body.siteSourceName, 80),
      landingVariant: cleanText(body.landingVariant, 120) || `traffic_${productId}_v2`,
      sourcePath: cleanText(body.sourcePath, 200) || `/lp/${productId}/`,
    };
    const eventSourceUrl = sourceUrl(origin, traffic.sourcePath);
    const tags = [
      "funil_lp_campanhas_ec10",
      `campanha_${product.campaign}`,
      productId === "kids" ? "eurokids" : productId === "juvenil" ? "eurocamp" : product.service,
      role === "responsavel" ? "responsavel_atleta" : "atleta",
      "qualificacao_pendente",
    ];
    const notes = [
      `Lead da campanha ${product.label}.`,
      `Contato: ${role === "responsavel" ? "responsável" : "atleta"}.`,
      `E-mail: ${email}`,
      `Funil: Campanhas LP EC10.`,
      `Página: ${traffic.sourcePath}`,
    ].join("\n");
    const attribution = {
      funnelKey: FUNNEL_KEY,
      campaignProject: product.campaign,
      productId,
      productLabel: product.label,
      role,
      email,
      countryCode,
      countryDialCode: dialCode,
      eventId,
      eventSourceUrl,
      landingVariant: traffic.landingVariant,
      sourcePath: traffic.sourcePath,
      campaignId: traffic.campaignId || null,
      adsetId: traffic.adsetId || null,
      adId: traffic.adId || null,
      creativeId: traffic.creativeId || null,
      placement: traffic.placement || null,
      siteSourceName: traffic.siteSourceName || null,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
      capturedAt: new Date().toISOString(),
    };

    if (dryRun) {
      return response.status(200).json({ ok: true, dryRun: true, funnelKey: FUNNEL_KEY, crmDestination: "https://ec10talentos.com/crm", automation: "on_inbound_message", campaign: product.campaign, serviceInterest: product.service, normalizedPhone: phone, eventId });
    }

    const db = await bookingPool.connect();
    let registration;
    try {
      await db.query("begin");
      registration = await saveCampaignRegistration(db, {phone,name,email,role,countryCode,productId,product,traffic,attribution,eventId,tags});
      await db.query("commit");
    } catch (error) {
      await db.query("rollback"); throw error;
    } finally { db.release(); }
    const metaAccepted = registration.capiAccepted || await sendCampaignCapi({
      phone,email,countryCode,eventId,eventSourceUrl,traffic,
      customData: {
        funnel_key: FUNNEL_KEY,
        funnel_stage: "lead",
        business_model: "assessoria_de_carreira_e_mobilidade_esportiva",
        product_id: productId,
        product_name: product.label,
        content_name: product.label,
        content_type: "product",
        product_tier: product.tier,
        content_category: product.category,
        audience_profile: product.audience,
        buyer_role: role,
        beneficiary: "atleta_de_futebol",
        landing_variant: traffic.landingVariant,
        campaign_id: traffic.campaignId || "nao_informado",
        adset_id: traffic.adsetId || "nao_informado",
        ad_id: traffic.adId || "nao_informado",
        creative_id: traffic.creativeId || "nao_informado",
        utm_campaign: traffic.utmCampaign || "nao_informado",
        utm_content: traffic.utmContent || "nao_informado",
        utm_term: traffic.utmTerm || "nao_informado",
        placement: traffic.placement || "nao_informado",
        site_source_name: traffic.siteSourceName || "nao_informado",
      },
    });

    if (metaAccepted) await bookingPool.query("update whatsapp_bot.ec10_campaign_registrations set capi_accepted_at=coalesce(capi_accepted_at,now()) where event_id=$1", [eventId]).catch(() => console.warn("Campaign CAPI receipt persistence deferred; registration remains confirmed"));
    return response.status(200).json({
      ok: true,
      clientId: registration.clientId,
      crmLeadId: registration.crmLeadId,
      crmDestination: "https://ec10talentos.com/crm",
      botActivated: registration.botActivated,
      bookingUrl: registration.bookingUrl,
      eventId,
      funnelKey: FUNNEL_KEY,
      campaign: product.campaign,
      metaAccepted,
      whatsappUrl: whatsappUrl(name, product.label),
    });
  } catch (error) {
    console.error("campaign lead intake failed", error instanceof Error ? error.message : String(error));
    return response.status(500).json({ error: "Unable to create campaign lead" });
  }
}
