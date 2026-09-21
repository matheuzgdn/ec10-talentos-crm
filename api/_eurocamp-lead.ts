import { pool } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";
import { syncEurocampLatamLead } from "./_ec10-saas-sync.js";

const MAIN_BOT_INSTANCE_ID = "main";
const FORM_SLUG = "eurocamp_waitlist_2027_v1";
const SIMPLE_FORM_SLUG = "eurocamp_latam_simple_v1";
const EUROCAMP_GROUP_URL = "https://chat.whatsapp.com/LcOtqReBF3u7QVUEkEf8e6?s=cl&p=a&mlu=4";
const ALLOWED_RELATIONSHIPS = new Set(["pai", "mae", "responsavel_legal", "atleta_maior"]);
const ALLOWED_PLANS = new Set(["bronze", "prata", "ouro", "kids", "a_definir"]);
const ALLOWED_INVESTMENT_STAGES = new Set([
  "recurso_reservado",
  "liberacao_15_dias",
  "sem_recurso",
]);
const ALLOWED_DECISION_AUTHORITIES = new Set(["decisor_financeiro", "decisao_conjunta_alinhada", "depende_terceiro"]);
const ALLOWED_TIMELINES = new Set(["48_horas", "7_dias", "sem_disponibilidade"]);

const planLabels: Record<string, string> = {
  bronze: "Bronze - experiencia de 10 dias",
  prata: "Prata - imersao de 30 dias",
  ouro: "Ouro - temporada de 10 meses",
  kids: "Kids - experiencia de 7 dias",
  a_definir: "Ainda precisa de orientacao sobre o plano",
};

const investmentLabels: Record<string, string> = {
  recurso_reservado: "Recurso financeiro ja reservado",
  liberacao_15_dias: "Liberacao financeira confirmada em ate 15 dias",
  sem_recurso: "Ainda nao possui recurso financeiro disponivel",
};

const timelineLabels: Record<string, string> = {
  "48_horas": "Disponivel para conversa de decisao em ate 48 horas",
  "7_dias": "Disponivel para conversa de decisao em ate 7 dias",
  sem_disponibilidade: "Ainda sem disponibilidade para conversa de decisao",
};

const decisionAuthorityLabels: Record<string, string> = {
  decisor_financeiro: "E o responsavel financeiro e pode decidir",
  decisao_conjunta_alinhada: "Decisao conjunta com a outra pessoa ja alinhada",
  depende_terceiro: "Ainda depende da decisao de outra pessoa",
};

function cleanText(value: unknown, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizePhone(value: unknown, dialCode: unknown) {
  const number = cleanText(value, 40).replace(/\D/g, "");
  const countryCode = cleanText(dialCode, 6).replace(/\D/g, "") || "55";
  if (!number) return "";
  let national = number.replace(/^00/, "").replace(/^0+/, "");
  if (countryCode === "54") {
    if (national.startsWith("549")) return national;
    if (national.startsWith("54")) national = national.slice(2);
    if (national.startsWith("9") && national.length === 11) return `54${national}`;
    return `549${national.replace(/^15/, "")}`;
  }
  if (national.startsWith(countryCode) && national.length - countryCode.length >= 7) return national;
  return `${countryCode}${national}`;
}

function isValidPhone(phone: string, countryCode: string | null) {
  const patterns: Record<string, RegExp> = {
    ar: /^549\d{10}$/, br: /^55\d{10,11}$/, cl: /^56\d{9}$/, py: /^595\d{9}$/,
    uy: /^598\d{8}$/, bo: /^591\d{8}$/, co: /^57\d{10}$/, pe: /^51\d{9}$/,
    ec: /^593\d{9}$/, cr: /^506\d{8}$/,
  };
  const structuralMatch = countryCode && patterns[countryCode]
    ? patterns[countryCode].test(phone)
    : /^\d{10,15}$/.test(phone);
  return structuralMatch && !/^(\d)\1+$/.test(phone);
}

function countryFromDialCode(value: unknown) {
  const dialCode = cleanText(value, 6).replace(/\D/g, "");
  return ({
    1: "us", 34: "es", 51: "pe", 52: "mx", 54: "ar", 55: "br", 56: "cl", 57: "co", 58: "ve",
    351: "pt", 502: "gt", 503: "sv", 504: "hn", 505: "ni", 506: "cr", 507: "pa",
    591: "bo", 593: "ec", 595: "py", 598: "uy",
  } as Record<string, string>)[dialCode] ?? null;
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
  const origin = cleanText(request.headers?.origin, 220);
  if (origin && allowedOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");
}

function leadScore(input: {
  athleteAge: number;
  planInterest: string;
  investmentStage: string;
  decisionTimeline: string;
  decisionAuthority: string;
  trainingLevel: string;
  relationship: string;
}) {
  let score = 38;
  if (input.athleteAge >= 9 && input.athleteAge <= 19) score += 7;
  if (input.planInterest !== "a_definir") score += 8;
  if (["competitivo", "federado", "profissional"].includes(input.trainingLevel)) score += 7;
  if (input.relationship !== "atleta_maior") score += 5;
  if (input.investmentStage === "recurso_reservado") score += 25;
  if (input.investmentStage === "liberacao_15_dias") score += 19;
  if (input.decisionAuthority === "decisor_financeiro") score += 12;
  if (input.decisionAuthority === "decisao_conjunta_alinhada") score += 9;
  if (input.decisionTimeline === "48_horas") score += 16;
  if (input.decisionTimeline === "7_dias") score += 12;
  return Math.min(98, score);
}

function ageGroup(age: number) {
  if (age <= 13) return "9_13";
  if (age <= 17) return "14_17";
  return "18_plus";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 180;
}

async function handleSimpleEurocampLead(payload: any, origin: string, response: any) {
  const contactName = cleanText(payload.contactName, 140);
  const email = cleanText(payload.email, 180).toLowerCase();
  const relationshipInput = cleanText(payload.relationship, 30);
  const relationship = new Set(["responsavel", "atleta"]).has(relationshipInput)
    ? relationshipInput
    : "nao_informado";
  const phone = normalizePhone(payload.phone, payload.countryDialCode);
  const countryDialCode = cleanText(payload.countryDialCode, 6).replace(/\D/g, "");
  const countryCode = countryFromDialCode(countryDialCode);
  const consent = payload.consent === true;
  const dryRun = payload.dryRun === true;

  if (contactName.length < 3) {
    response.status(400).json({ error: "Complete name is required" });
    return;
  }
  if (!isValidEmail(email)) {
    response.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (!isValidPhone(phone, countryCode)) {
    response.status(400).json({ error: "Valid WhatsApp is required" });
    return;
  }
  if (!consent) {
    response.status(422).json({ error: "Consent is required", code: "consent_required" });
    return;
  }

  const traffic = {
    utmSource: cleanText(payload.utmSource, 160),
    utmMedium: cleanText(payload.utmMedium, 160),
    utmCampaign: cleanText(payload.utmCampaign, 200),
    utmContent: cleanText(payload.utmContent, 200),
    utmTerm: cleanText(payload.utmTerm, 200),
    campaignId: cleanText(payload.campaignId, 80),
    adsetId: cleanText(payload.adsetId, 80),
    adId: cleanText(payload.adId, 80),
    fbclid: cleanText(payload.fbclid, 240),
    fbc: cleanText(payload.fbc, 300),
    fbp: cleanText(payload.fbp, 300),
    gclid: cleanText(payload.gclid, 240),
    sourcePath: cleanText(payload.sourcePath, 200) || "/eurocamp/?lang=es",
    landingVariant: SIMPLE_FORM_SLUG,
  };
  const serviceInterest = "eurocamp_latam";
  const score = relationship === "responsavel" ? 52 : relationship === "atleta" ? 44 : 48;
  const roleLabel = relationship === "responsavel"
    ? "Pai, mae ou responsavel"
    : relationship === "atleta"
      ? "Atleta"
      : "Nao informado";
  const tags = ["eurocamp", "eurocamp_2027", "eurocamp_latam", "lead_site", "formulario_simplificado", `papel_${relationship}`, "grupo_whatsapp_eurocamp"];
  const notes = [
    "CADASTRO SIMPLES EUROCAMP 2027 LATAM",
    `Contato: ${contactName}`,
    `E-mail: ${email}`,
    `Papel: ${roleLabel}`,
    "Cadastro inicial sem qualificacao financeira ou esportiva.",
    `Destino apos cadastro: grupo oficial Eurocamp (${EUROCAMP_GROUP_URL})`,
  ].join("\n");
  const attributionMetadata = {
    formType: "eurocamp_latam_simple_registration",
    formVariant: SIMPLE_FORM_SLUG,
    contactRole: relationship,
    email,
    groupRedirectUrl: EUROCAMP_GROUP_URL,
    qualificationScore: score,
    qualificationTemperature: "Eurocamp - cadastro inicial",
    qualifiedLead: false,
    utmSource: traffic.utmSource || null,
    utmMedium: traffic.utmMedium || null,
    utmCampaign: traffic.utmCampaign || null,
    utmContent: traffic.utmContent || null,
    utmTerm: traffic.utmTerm || null,
    campaignId: traffic.campaignId || null,
    adsetId: traffic.adsetId || null,
    adId: traffic.adId || null,
    fbclid: traffic.fbclid || null,
    gclid: traffic.gclid || null,
    fbc: traffic.fbc || null,
    fbp: traffic.fbp || null,
    sourcePath: traffic.sourcePath,
    landingVariant: traffic.landingVariant,
    capturedAt: new Date().toISOString(),
    countryCode: countryCode?.toUpperCase() || null,
    countryDialCode: countryDialCode || null,
  };

  if (dryRun) {
    response.status(200).json({ ok: true, dryRun: true, normalizedPhone: phone, leadScore: score, priority: false, qualificationTier: "eurocamp_cadastro_inicial", redirectUrl: EUROCAMP_GROUP_URL });
    return;
  }

  // The EC10 SaaS is the operational CRM. Persist there first so a failure in
  // the legacy WhatsApp database cannot discard a valid public form submission.
  const saasLead = await syncEurocampLatamLead({
    contactName,
    email,
    phone,
    relationship: relationship as "responsavel" | "atleta" | "nao_informado",
    notes,
    attribution: attributionMetadata,
    countryCode: countryCode?.toUpperCase() || "",
    countryDialCode,
  });

  let clientId = saasLead.id;
  let legacySynced = false;
  try {
    const client = await pool.connect();
    try {
    await client.query("begin");
    const result = await client.query(
      `
        with default_seller as (
          select id from whatsapp_bot.sellers
          where active = true
          order by case when role = 'admin' then 0 else 1 end, created_at asc
          limit 1
        )
        insert into whatsapp_bot.clients (
          phone, bot_instance_id, name, region, notes, service_interest, source, status,
          assigned_seller_id, tags, lead_score, traffic_source,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          fbclid, gclid, attribution_metadata, bot_paused, updated_at
        )
        values (
          $1, $16, $2, $3, $4, $17, 'site', 'novo',
          (select id from default_seller), $5::text[], $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15::jsonb, true, now()
        )
        on conflict (phone)
        do update set
          name = coalesce(nullif(excluded.name, ''), whatsapp_bot.clients.name),
          region = coalesce(nullif(excluded.region, ''), whatsapp_bot.clients.region),
          notes = concat_ws(E'\n\n', nullif(whatsapp_bot.clients.notes, ''), excluded.notes),
          service_interest = excluded.service_interest,
          source = 'site',
          assigned_seller_id = coalesce(whatsapp_bot.clients.assigned_seller_id, excluded.assigned_seller_id),
          tags = (select array_agg(distinct tag) from unnest(coalesce(whatsapp_bot.clients.tags, '{}'::text[]) || excluded.tags) tag),
          lead_score = greatest(coalesce(whatsapp_bot.clients.lead_score, 0), excluded.lead_score),
          traffic_source = excluded.traffic_source,
          utm_source = coalesce(nullif(excluded.utm_source, ''), whatsapp_bot.clients.utm_source),
          utm_medium = coalesce(nullif(excluded.utm_medium, ''), whatsapp_bot.clients.utm_medium),
          utm_campaign = coalesce(nullif(excluded.utm_campaign, ''), whatsapp_bot.clients.utm_campaign),
          utm_content = coalesce(nullif(excluded.utm_content, ''), whatsapp_bot.clients.utm_content),
          utm_term = coalesce(nullif(excluded.utm_term, ''), whatsapp_bot.clients.utm_term),
          fbclid = coalesce(nullif(excluded.fbclid, ''), whatsapp_bot.clients.fbclid),
          gclid = coalesce(nullif(excluded.gclid, ''), whatsapp_bot.clients.gclid),
          attribution_metadata = coalesce(whatsapp_bot.clients.attribution_metadata, '{}'::jsonb) || excluded.attribution_metadata,
          bot_paused = true,
          updated_at = now()
        returning id
      `,
      [
        phone, contactName, phone.startsWith("55") ? "brasil" : "internacional", notes, tags, score,
        traffic.utmSource || (traffic.fbclid ? "meta" : "eurocamp_site"),
        traffic.utmSource || null, traffic.utmMedium || null, traffic.utmCampaign || null,
        traffic.utmContent || null, traffic.utmTerm || null, traffic.fbclid || null, traffic.gclid || null,
        JSON.stringify(attributionMetadata), MAIN_BOT_INSTANCE_ID, serviceInterest,
      ],
    );
    clientId = result.rows[0]?.id || clientId;

    await client.query(
      `
        insert into whatsapp_bot.traffic_events (
          client_id, bot_instance_id, phone, event_type, channel, platform, service_interest,
          athlete_age, age_group, lead_status, quality_score, campaign_id, campaign_name,
          adset_id, ad_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
          fbclid, gclid, metadata
        )
        values ($1, $2, $3, 'eurocamp_latam_simple_submitted', 'site', 'meta_ads', $4,
          null, null, 'novo', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
      `,
      [clientId, MAIN_BOT_INSTANCE_ID, phone, serviceInterest, score, traffic.campaignId || null,
        traffic.utmCampaign || null, traffic.adsetId || null, traffic.adId || null,
        traffic.utmSource || null, traffic.utmMedium || null, traffic.utmCampaign || null,
        traffic.utmContent || null, traffic.utmTerm || null, traffic.fbclid || null,
        traffic.gclid || null, JSON.stringify(attributionMetadata)],
    );
    await client.query("commit");
    legacySynced = true;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      console.warn("Eurocamp legacy CRM sync failed", error instanceof Error ? error.message : String(error));
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn("Eurocamp legacy CRM unavailable", error instanceof Error ? error.message : String(error));
  }

  const metaEventId = `eurocamp-${clientId}-lead`;
  const metaDelivered = await sendMetaQualityEvent({
    clientId, phone, email, country: countryCode, status: "novo", eventName: "Lead", serviceInterest, leadScore: score,
    fbclid: traffic.fbclid || null, fbc: traffic.fbc || null, fbp: traffic.fbp || null,
    eventSourceUrl: `${origin || "https://ec10talentos.com"}${traffic.sourcePath}`,
    actionSource: "website", eventId: metaEventId,
    customData: { campaign_project: SIMPLE_FORM_SLUG, contact_role: relationship, commercial_priority: false, qualification_tier: "eurocamp_cadastro_inicial", group_redirect: true },
  }).catch((error) => {
    console.warn("Eurocamp simple Meta Lead event failed", error instanceof Error ? error.message : String(error));
    return false;
  });

  response.status(200).json({
    ok: true, clientId, leadScore: score, priority: false, qualificationTier: "eurocamp_cadastro_inicial",
    redirectUrl: EUROCAMP_GROUP_URL, metaEventName: "Lead", metaEventId, metaDelivery: { lead: metaDelivered },
    saasLead: { synced: true, operation: saasLead.operation },
    legacyCrm: { synced: legacySynced },
  });
}

export default async function eurocampLeadHandler(request: any, response: any) {
  setCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const origin = cleanText(request.headers?.origin, 220);
  if (!allowedOrigin(origin)) {
    response.status(403).json({ error: "Origin not allowed" });
    return;
  }

  try {
    const payload = request.body ?? {};
    if (cleanText(payload.website, 120)) {
      response.status(200).json({ ok: true });
      return;
    }

    const startedAt = Number(payload.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < 800) {
      response.status(400).json({ error: "Form submitted too quickly" });
      return;
    }

    if (cleanText(payload.formVariant, 80) === SIMPLE_FORM_SLUG) {
      await handleSimpleEurocampLead(payload, origin, response);
      return;
    }

    const contactName = cleanText(payload.contactName, 140);
    const relationship = cleanText(payload.relationship, 40);
    const phone = normalizePhone(payload.phone, payload.countryDialCode);
    const fullFormCountryCode = countryFromDialCode(payload.countryDialCode);
    const athleteName = cleanText(payload.athleteName, 140);
    const athleteAge = Number(payload.athleteAge);
    const city = cleanText(payload.city, 140);
    const trainingLevel = cleanText(payload.trainingLevel, 60);
    const objective = cleanText(payload.objective, 120);
    const planInterest = cleanText(payload.planInterest, 40);
    const investmentStage = cleanText(payload.investmentStage, 60);
    const decisionAuthority = cleanText(payload.decisionAuthority, 60);
    const decisionTimeline = cleanText(payload.decisionTimeline, 60);
    const guardianDeclaration = payload.guardianDeclaration === true;
    const investmentAware = payload.investmentAware === true;
    const consent = payload.consent === true;
    const closingReady = payload.closingReady === true;
    const dryRun = payload.dryRun === true;

    if (contactName.split(/\s+/).filter(Boolean).length < 2 || athleteName.length < 2 || city.length < 2) {
      response.status(400).json({ error: "Complete contact and athlete data are required" });
      return;
    }
    if (!ALLOWED_RELATIONSHIPS.has(relationship)) {
      response.status(422).json({ error: "Responsible relationship is required", code: "guardian_required" });
      return;
    }
    if (!Number.isInteger(athleteAge) || athleteAge < 9 || athleteAge > 25) {
      response.status(400).json({ error: "Athlete age must be between 9 and 25" });
      return;
    }
    if (athleteAge < 18 && relationship === "atleta_maior") {
      response.status(422).json({ error: "A minor athlete cannot submit the form", code: "minor_guardian_required" });
      return;
    }
    if (!guardianDeclaration || !investmentAware || !consent || !closingReady) {
      response.status(422).json({ error: "Declarations are required", code: "declarations_required" });
      return;
    }
    if (!isValidPhone(phone, fullFormCountryCode)) {
      response.status(400).json({ error: "Valid WhatsApp is required" });
      return;
    }
    if (!ALLOWED_PLANS.has(planInterest)
      || !ALLOWED_INVESTMENT_STAGES.has(investmentStage)
      || !ALLOWED_DECISION_AUTHORITIES.has(decisionAuthority)
      || !ALLOWED_TIMELINES.has(decisionTimeline)
      || !trainingLevel
      || !objective) {
      response.status(400).json({ error: "Qualification answers are required" });
      return;
    }
    const traffic = {
      utmSource: cleanText(payload.utmSource, 160),
      utmMedium: cleanText(payload.utmMedium, 160),
      utmCampaign: cleanText(payload.utmCampaign, 200),
      utmContent: cleanText(payload.utmContent, 200),
      utmTerm: cleanText(payload.utmTerm, 200),
      fbclid: cleanText(payload.fbclid, 240),
      fbc: cleanText(payload.fbc, 300),
      fbp: cleanText(payload.fbp, 300),
      gclid: cleanText(payload.gclid, 240),
      sourcePath: cleanText(payload.sourcePath, 200) || "/eurocamp/",
      landingVariant: cleanText(payload.landingVariant, 120) || FORM_SLUG,
    };
    const hasFinancialCapacity = investmentStage !== "sem_recurso";
    const decisionAligned = decisionAuthority !== "depende_terceiro";
    const conversationAvailable = decisionTimeline !== "sem_disponibilidade";
    const readyForEurocamp = hasFinancialCapacity;
    const rawScore = leadScore({ athleteAge, planInterest, investmentStage, decisionTimeline, decisionAuthority, trainingLevel, relationship });
    const score = hasFinancialCapacity ? rawScore : Math.min(rawScore, 62);
    const priority = hasFinancialCapacity && decisionAligned && conversationAvailable && score >= 80;
    const alternativeOffer = !hasFinancialCapacity;
    const serviceInterest = alternativeOffer ? "plano_carreira" : "plano_internacional";
    const qualificationTier = alternativeOffer
      ? "plano_carreira_sem_recurso_eurocamp"
      : !decisionAligned
        ? "eurocamp_decisor_pendente"
        : !conversationAvailable
          ? "eurocamp_followup_pendente"
          : priority
            ? "eurocamp_prioritario"
            : "eurocamp_qualificado";
    const temperature = priority
      ? "Eurocamp - lead quente"
      : alternativeOffer
        ? "Plano de Carreira - sem recurso para Eurocamp"
        : !decisionAligned
          ? "Eurocamp - decisor financeiro pendente"
          : !conversationAvailable
            ? "Eurocamp - follow-up pendente"
            : "Eurocamp - bom potencial";
    const commercialAction = alternativeOffer
      ? "Apresentar Plano de Carreira como alternativa de entrada mais acessivel."
      : !decisionAligned
        ? "Manter na Eurocamp e solicitar a participacao do decisor financeiro na proxima conversa."
        : !conversationAvailable
          ? "Manter na Eurocamp e combinar uma data objetiva para o follow-up comercial."
          : priority
            ? "Contato prioritario da equipe Eurocamp."
            : "Realizar triagem comercial da Eurocamp.";
    const trafficEventType = alternativeOffer
      ? "eurocamp_lead_reoriented_career_plan"
      : !decisionAligned
        ? "eurocamp_waitlist_decision_pending"
        : !conversationAvailable
          ? "eurocamp_waitlist_followup_pending"
          : "eurocamp_waitlist_submitted";
    const responseStatus = alternativeOffer
      ? "encaminhado_plano_carreira"
      : !decisionAligned
        ? "lista_de_espera_decisor_pendente"
        : !conversationAvailable
          ? "lista_de_espera_followup_pendente"
          : priority
            ? "lista_de_espera_prioritaria"
            : "lista_de_espera";
    const group = ageGroup(athleteAge);
    const tags = [
      "eurocamp",
      "eurocamp_lista_espera_2027",
      "lead_site",
      "investimento_ciente",
      relationship === "atleta_maior" ? "atleta_maior_18" : "responsavel_atleta",
      `relacao_${relationship}`,
      `plano_${planInterest}`,
      `investimento_${investmentStage}`,
      `autoridade_${decisionAuthority}`,
      `decisao_${decisionTimeline}`,
      `faixa_${group}`,
      qualificationTier,
      hasFinancialCapacity ? "eurocamp_capacidade_financeira_confirmada" : "eurocamp_sem_recurso_disponivel",
      decisionAligned ? "eurocamp_decisao_alinhada" : "eurocamp_incluir_decisor_financeiro",
      conversationAvailable ? "eurocamp_contato_disponivel" : "eurocamp_followup_sem_data",
      alternativeOffer ? "eurocamp_reorientado_plano_carreira" : "eurocamp_apto_financeiro",
    ];
    const notes = [
      "LISTA DE ESPERA EUROCAMP 2027",
      `Contato: ${contactName}`,
      `Relacao com o atleta: ${relationship}`,
      `Atleta: ${athleteName} - ${athleteAge} anos`,
      `Cidade/estado/pais: ${city}`,
      `Nivel atual: ${trainingLevel}`,
      `Objetivo principal: ${objective}`,
      `Plano de interesse: ${planLabels[planInterest]}`,
      `Disponibilidade financeira: ${investmentLabels[investmentStage]}`,
      `Poder de decisao: ${decisionAuthorityLabels[decisionAuthority]}`,
      `Prazo de decisao: ${timelineLabels[decisionTimeline]}`,
      `Classificacao automatica: ${temperature} (${score}/100)`,
      `Classificacao comercial: ${qualificationTier}`,
      `Proxima acao recomendada: ${commercialAction}`,
      "Declarou ser responsavel legal ou atleta maior de 18 anos.",
      "Respondeu ao filtro financeiro e confirmou ciencia de que as vagas sao limitadas.",
    ].join("\n");
    const attributionMetadata = {
      formType: "eurocamp_waitlist_guardian_qualification",
      formVariant: FORM_SLUG,
      contactRole: relationship,
      athleteName,
      athleteAge,
      ageGroup: group,
      city,
      trainingLevel,
      objective,
      planInterest,
      planLabel: planLabels[planInterest],
      investmentStage,
      investmentLabel: investmentLabels[investmentStage],
      decisionAuthority,
      decisionAuthorityLabel: decisionAuthorityLabels[decisionAuthority],
      decisionTimeline,
      decisionTimelineLabel: timelineLabels[decisionTimeline],
      guardianDeclaration,
      investmentAware,
      closingReady,
      qualificationScore: score,
      qualificationTemperature: temperature,
      commercialPriority: priority,
      hasFinancialCapacity,
      decisionAligned,
      conversationAvailable,
      readyForEurocamp,
      alternativeOffer,
      recommendedOffer: alternativeOffer ? "plano_carreira" : "eurocamp",
      waitingList: readyForEurocamp,
      qualificationTier,
      commercialAction,
      sourcePath: traffic.sourcePath,
      landingVariant: traffic.landingVariant,
      utmSource: traffic.utmSource || null,
      utmMedium: traffic.utmMedium || null,
      utmCampaign: traffic.utmCampaign || null,
      utmContent: traffic.utmContent || null,
      utmTerm: traffic.utmTerm || null,
      fbclid: traffic.fbclid || null,
      gclid: traffic.gclid || null,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
      capturedAt: new Date().toISOString(),
    };

    if (dryRun) {
      response.status(200).json({
        ok: true,
        dryRun: true,
        normalizedPhone: phone,
        leadScore: score,
        priority,
        alternativeOffer,
        recommendedOffer: alternativeOffer ? "plano_carreira" : "eurocamp",
        redirectUrl: alternativeOffer ? "https://ec10talentos.com/plano-de-carreira/" : null,
        readyForEurocamp,
        qualificationTier,
        commercialAction,
        status: responseStatus,
        tags,
      });
      return;
    }

    const client = await pool.connect();
    let clientId = "";
    try {
      await client.query("begin");
      const result = await client.query(
        `
          with default_seller as (
            select id from whatsapp_bot.sellers
            where active = true
            order by case when role = 'admin' then 0 else 1 end, created_at asc
            limit 1
          )
          insert into whatsapp_bot.clients (
            phone, bot_instance_id, name, region, notes, service_interest, source, status,
            assigned_seller_id, tags, lead_score, traffic_source,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, gclid, attribution_metadata, bot_paused, updated_at
          )
          values (
            $1, $16, $2, $3, $4, $17, 'site', 'novo',
            (select id from default_seller), $5::text[], $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15::jsonb, true, now()
          )
          on conflict (phone)
          do update set
            name = coalesce(nullif(excluded.name, ''), whatsapp_bot.clients.name),
            region = coalesce(nullif(excluded.region, ''), whatsapp_bot.clients.region),
            notes = concat_ws(E'\n\n', nullif(whatsapp_bot.clients.notes, ''), excluded.notes),
            service_interest = excluded.service_interest,
            source = 'site',
            assigned_seller_id = coalesce(whatsapp_bot.clients.assigned_seller_id, excluded.assigned_seller_id),
            tags = (select array_agg(distinct tag) from unnest(coalesce(whatsapp_bot.clients.tags, '{}'::text[]) || excluded.tags) tag),
            lead_score = greatest(coalesce(whatsapp_bot.clients.lead_score, 0), excluded.lead_score),
            traffic_source = excluded.traffic_source,
            utm_source = coalesce(nullif(excluded.utm_source, ''), whatsapp_bot.clients.utm_source),
            utm_medium = coalesce(nullif(excluded.utm_medium, ''), whatsapp_bot.clients.utm_medium),
            utm_campaign = coalesce(nullif(excluded.utm_campaign, ''), whatsapp_bot.clients.utm_campaign),
            utm_content = coalesce(nullif(excluded.utm_content, ''), whatsapp_bot.clients.utm_content),
            utm_term = coalesce(nullif(excluded.utm_term, ''), whatsapp_bot.clients.utm_term),
            fbclid = coalesce(nullif(excluded.fbclid, ''), whatsapp_bot.clients.fbclid),
            gclid = coalesce(nullif(excluded.gclid, ''), whatsapp_bot.clients.gclid),
            attribution_metadata = coalesce(whatsapp_bot.clients.attribution_metadata, '{}'::jsonb) || excluded.attribution_metadata,
            bot_paused = true,
            updated_at = now()
          returning id
        `,
        [
          phone,
          contactName,
          phone.startsWith("55") ? "brasil" : "internacional",
          notes,
          tags,
          score,
          traffic.utmSource || (traffic.fbclid ? "meta" : "eurocamp_site"),
          traffic.utmSource || null,
          traffic.utmMedium || null,
          traffic.utmCampaign || null,
          traffic.utmContent || null,
          traffic.utmTerm || null,
          traffic.fbclid || null,
          traffic.gclid || null,
          JSON.stringify(attributionMetadata),
          MAIN_BOT_INSTANCE_ID,
          serviceInterest,
        ],
      );
      clientId = result.rows[0]?.id;
      if (!clientId) throw new Error("Eurocamp lead created without id");

      await client.query(
        `
          insert into whatsapp_bot.traffic_events (
            client_id, bot_instance_id, phone, event_type, channel, platform,
            service_interest, athlete_age, age_group, lead_status, quality_score, metadata
          )
          values ($1, $2, $3, $10, 'site', 'whatsapp',
            $9, $4, $5, $6, $7, $8::jsonb)
        `,
        [
          clientId,
          MAIN_BOT_INSTANCE_ID,
          phone,
          athleteAge,
          group,
          priority ? "quente" : "novo",
          score,
          JSON.stringify(attributionMetadata),
          serviceInterest,
          trafficEventType,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const sourceUrl = `${origin || "https://ec10talentos.com"}${traffic.sourcePath}`;
    // O conjunto da Meta otimiza para o evento padrao Lead. Todo cadastro
    // concluido precisa alimentar esse evento; QualifiedLead e um sinal
    // adicional de qualidade, nunca um substituto do Lead.
    const metaEventName = "Lead";
    const metaEventId = `eurocamp-${clientId}-lead`;
    const metaQualifiedEventName = priority ? "QualifiedLead" : null;
    const metaQualifiedEventId = priority ? `eurocamp-${clientId}-qualified` : null;
    const metaLeadDelivered = await sendMetaQualityEvent({
      clientId,
      phone,
      status: "novo",
      eventName: metaEventName,
      serviceInterest,
      leadScore: score,
      fbclid: traffic.fbclid || null,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
      eventSourceUrl: sourceUrl,
      actionSource: "website",
      eventId: metaEventId,
      customData: {
        campaign_project: FORM_SLUG,
        contact_role: relationship,
        athlete_age: athleteAge,
        age_group: group,
        plan_interest: planInterest,
        investment_stage: investmentStage,
        decision_timeline: decisionTimeline,
        decision_authority: decisionAuthority,
        commercial_priority: priority,
        has_financial_capacity: hasFinancialCapacity,
        decision_aligned: decisionAligned,
        conversation_available: conversationAvailable,
        qualification_tier: qualificationTier,
        alternative_offer: alternativeOffer,
        recommended_offer: alternativeOffer ? "plano_carreira" : "eurocamp",
      },
    }).catch((error) => {
      console.warn("Eurocamp Meta Lead event failed", error instanceof Error ? error.message : String(error));
      return false;
    });

    const metaQualifiedDelivered = priority
      ? await sendMetaQualityEvent({
          clientId,
          phone,
          status: "quente",
          eventName: "QualifiedLead",
          serviceInterest,
          leadScore: score,
          fbclid: traffic.fbclid || null,
          fbc: traffic.fbc || null,
          fbp: traffic.fbp || null,
          eventSourceUrl: sourceUrl,
          actionSource: "website",
          eventId: metaQualifiedEventId,
          customData: {
            campaign_project: FORM_SLUG,
            contact_role: relationship,
            athlete_age: athleteAge,
            age_group: group,
            plan_interest: planInterest,
            investment_stage: investmentStage,
            decision_timeline: decisionTimeline,
            decision_authority: decisionAuthority,
            commercial_priority: true,
            has_financial_capacity: hasFinancialCapacity,
            decision_aligned: decisionAligned,
            conversation_available: conversationAvailable,
            qualification_tier: qualificationTier,
            alternative_offer: alternativeOffer,
            recommended_offer: alternativeOffer ? "plano_carreira" : "eurocamp",
          },
        }).catch((error) => {
          console.warn("Eurocamp Meta QualifiedLead event failed", error instanceof Error ? error.message : String(error));
          return false;
        })
      : false;

    response.status(200).json({
      ok: true,
      clientId,
      leadScore: score,
      priority,
      alternativeOffer,
      recommendedOffer: alternativeOffer ? "plano_carreira" : "eurocamp",
      redirectUrl: alternativeOffer ? "https://ec10talentos.com/plano-de-carreira/" : null,
      readyForEurocamp,
      qualificationTier,
      metaEventName,
      metaEventId,
      metaQualifiedEventName,
      metaQualifiedEventId,
      metaDelivery: {
        lead: metaLeadDelivered,
        qualifiedLead: metaQualifiedDelivered,
      },
      commercialAction,
      status: responseStatus,
    });
  } catch (error) {
    console.error("Eurocamp public intake failed", error);
    response.status(500).json({ error: "Unable to register Eurocamp lead" });
  }
}
