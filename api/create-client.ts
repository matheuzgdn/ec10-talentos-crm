import { ensureSeller, handleApiError } from "./_auth.js";
import { pool, mapClient } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";
import { buildMentoriaPrimeSequence } from "./_mentoria-prime.js";
import libertacademyLeadHandler from "./_libertacademy-lead.js";
import eurocampLeadHandler from "./_eurocamp-lead.js";
import eurocampSaasRepairHandler from "./_eurocamp-saas-repair.js";
import x1WhatsappHandler from "./_x1-whatsapp.js";
import sudamericaX1Handler from "./_sudamerica-x1.js";
import campaignLeadHandler from "./_campaign-lead.js";

const DEFAULT_WHATSAPP_NUMBER = "553198526146";
const MAIN_BOT_INSTANCE_ID = "main";
const MENTORIA_PRIME_BOT_INSTANCE_ID = "mentoria_prime";
const ALLOWED_SERVICE_INTERESTS = new Set([
  "plano_carreira",
  "plano_internacional",
  "ambos",
  "nao_definido",
]);

type PublicBotNiche = "mentoria_prime" | "plano_carreira";

type PublicBotSequenceItem = {
  body: string | null;
  mediaType: "text" | "audio" | "poll";
  mediaPath: string | null;
  delaySeconds: number;
  pollQuestion?: string | null;
  pollOptions?: string[] | null;
};

type SellerRegion =
  | "brasil"
  | "belo_horizonte"
  | "sao_paulo"
  | "minas_gerais"
  | "portugal"
  | "internacional";

type BrazilTrafficGeo = {
  region: SellerRegion;
  stateCode: "SP" | "MG" | null;
  city: string | null;
  priority: "sao_paulo" | "minas_gerais" | "outros";
  isPriority: boolean;
  tags: string[];
};

function normalizePhone(input: string, defaultCountryCode = "55") {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith(defaultCountryCode) || digits.length > 11) return digits;
  return `${defaultCountryCode}${digits}`;
}

function normalizePhoneFromParts(input: {
  raw: unknown;
  countryDialCode: string;
  areaCode?: unknown;
  number?: unknown;
}) {
  const countryDialCode = input.countryDialCode.replace(/\D/g, "") || "55";
  const areaCode = cleanText(input.areaCode, 8).replace(/\D/g, "");
  const number = cleanText(input.number, 24).replace(/\D/g, "");

  if (areaCode && number) {
    return normalizePhone(`${areaCode}${number}`, countryDialCode);
  }

  return normalizePhone(cleanText(input.raw, 40), countryDialCode);
}

function isValidNormalizedPhone(phone: string, countryDialCode = "55") {
  const digits = phone.replace(/\D/g, "");
  const dialCode = countryDialCode.replace(/\D/g, "") || "55";
  if (!digits || !digits.startsWith(dialCode) || digits.length > 15) return false;

  if (dialCode === "55") {
    const national = digits.slice(2);
    if (![10, 11].includes(national.length)) return false;
    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);
    if (!/^[1-9][0-9]$/.test(ddd)) return false;
    if (![8, 9].includes(subscriber.length)) return false;
    if (/^(\d)\1+$/.test(subscriber)) return false;
    return true;
  }

  return digits.length >= dialCode.length + 8;
}

function botInstanceForNiche(niche: PublicBotNiche) {
  return niche === "mentoria_prime" ? MENTORIA_PRIME_BOT_INSTANCE_ID : MAIN_BOT_INSTANCE_ID;
}

function cleanText(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function allowedOrigin(origin: string) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      url.hostname === "ec10talentos.com"
      || url.hostname === "www.ec10talentos.com"
      || url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

function buildEventSourceUrl(origin: string, sourcePath: string) {
  const fallbackBase = process.env.EC10_PUBLIC_SITE_URL ?? "https://ec10talentos.com";
  const base = allowedOrigin(origin) && origin ? origin : fallbackBase;

  try {
    return new URL(sourcePath || "/", base).toString();
  } catch {
    return fallbackBase;
  }
}

function setPublicCors(request: any, response: any) {
  const origin = String(request.headers?.origin ?? "");
  if (origin && allowedOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");
}

function buildWhatsappUrl(input: {
  name: string;
  athleteAge: number;
  city: string;
  objective: string;
  role: string;
}) {
  const whatsappNumber = normalizePhone(
    process.env.EC10_PUBLIC_WHATSAPP_NUMBER ?? DEFAULT_WHATSAPP_NUMBER,
  );
  const message = [
    "Olá, EC10 Talentos. Acabei de solicitar uma avaliação para a Mentoria Esportiva Prime.",
    "",
    `Nome: ${input.name}`,
    `Perfil: ${input.role === "atleta" ? "Atleta" : "Responsável pelo atleta"}`,
    `Idade do atleta: ${input.athleteAge}`,
    `Cidade/país: ${input.city}`,
    `Principal objetivo: ${input.objective}`,
  ].join("\n");

  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function buildCareerPlanWelcome(name: string) {
  const firstName = name.trim().split(/\s+/)[0] || name.trim();
  return [
    `Olá, ${firstName}! Seu cadastro no Plano de Carreira EC10 foi realizado com sucesso. ⚽`,
    "Em alguns instantes, nossa equipe continuará o atendimento por aqui.",
    "Para eu indicar a sequência correta, qual é a idade do atleta? Responda somente com o número. Exemplo: 15.",
  ].join("\n\n");
}

function buildPublicBotFallbackUrl(name: string, niche: PublicBotNiche) {
  const whatsappNumber = normalizePhone(
    process.env.EC10_PUBLIC_WHATSAPP_NUMBER ?? DEFAULT_WHATSAPP_NUMBER,
  );
  const serviceLabel = niche === "mentoria_prime"
    ? "Mentoria Esportiva Prime"
    : "Plano de Carreira EC10";
  const message = `Olá, EC10 Talentos! Sou ${name} e acabei de ativar o atendimento de ${serviceLabel} pelo site.`;
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function normalizeOptionalAge(input: unknown) {
  const age = Number(input);
  if (!Number.isInteger(age) || age < 6 || age > 40) return null;
  return age;
}

function ageGroupFor(age: number | null) {
  if (!age) return null;
  if (age <= 12) return "8-12";
  if (age <= 17) return "13-17";
  return "18-plus";
}

const saoPauloDdds = new Set(["11", "12", "13", "14", "15", "16", "17", "18", "19"]);
const minasGeraisDdds = new Set(["31", "32", "33", "34", "35", "37", "38"]);

function normalizeAscii(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractBrazilDdd(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  return national.length >= 10 ? national.slice(0, 2) : "";
}

function inferStateFromCity(city: string) {
  const normalized = normalizeAscii(city);
  if (!normalized) return null;

  if (
    /\bsp\b/.test(normalized)
    || normalized.includes("sao paulo")
    || normalized.includes("campinas")
    || normalized.includes("santos")
    || normalized.includes("sorocaba")
    || normalized.includes("ribeirao preto")
  ) {
    return "SP" as const;
  }

  if (
    /\bmg\b/.test(normalized)
    || normalized.includes("minas gerais")
    || normalized.includes("belo horizonte")
    || normalized.includes("contagem")
    || normalized.includes("betim")
    || normalized.includes("uberlandia")
    || normalized.includes("juiz de fora")
  ) {
    return "MG" as const;
  }

  return null;
}

function inferStateFromPhone(phone: string) {
  const ddd = extractBrazilDdd(phone);
  if (saoPauloDdds.has(ddd)) return "SP" as const;
  if (minasGeraisDdds.has(ddd)) return "MG" as const;
  return null;
}

function extractCityName(city: string) {
  const firstPart = city.split(/[-,/|]/)[0]?.trim() ?? "";
  if (!firstPart || firstPart.length < 2) return null;
  const normalized = normalizeAscii(firstPart);
  if (["sp", "mg", "brasil", "minas gerais", "sao paulo"].includes(normalized)) return null;
  return firstPart.slice(0, 80);
}

function resolveBrazilTrafficGeo(input: { city?: string | null; phone?: string | null }): BrazilTrafficGeo {
  const city = String(input.city ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const stateCode = inferStateFromCity(city) ?? inferStateFromPhone(phone);

  if (stateCode === "SP") {
    return {
      region: "sao_paulo",
      stateCode,
      city: extractCityName(city),
      priority: "sao_paulo",
      isPriority: true,
      tags: ["geo_sao_paulo", "geo_prioritario_sp_mg"]
    };
  }

  if (stateCode === "MG") {
    return {
      region: "minas_gerais",
      stateCode,
      city: extractCityName(city),
      priority: "minas_gerais",
      isPriority: true,
      tags: ["geo_minas_gerais", "geo_prioritario_sp_mg"]
    };
  }

  return {
    region: phone.startsWith("55") || !phone ? "brasil" : "internacional",
    stateCode: null,
    city: extractCityName(city),
    priority: "outros",
    isPriority: false,
    tags: ["geo_outros"]
  };
}

function scoreFromCareerProfile(input: {
  athleteAge: number | null;
  trainingLevel: string;
  investmentRange: string;
  readiness: string;
  videoLink: string;
  currentClub: string;
  objective: string;
  qualificationScore: number;
}) {
  if (Number.isFinite(input.qualificationScore)) {
    return Math.max(0, Math.min(100, Math.round(input.qualificationScore)));
  }

  let score = 42;
  if (input.athleteAge && input.athleteAge >= 9 && input.athleteAge <= 23) score += 14;
  if (input.athleteAge && input.athleteAge >= 13 && input.athleteAge <= 19) score += 8;
  if (input.videoLink) score += 8;
  if (input.currentClub) score += 7;
  if (["competitivo", "federado", "profissional"].includes(input.trainingLevel)) score += 8;
  if (input.readiness === "agora") score += 9;
  if (input.readiness === "30_dias") score += 5;
  if (input.investmentRange === "300_600") score += 6;
  if (input.investmentRange === "600_1000") score += 10;
  if (input.investmentRange === "1000_plus") score += 14;
  if (input.objective.length > 40) score += 4;
  return Math.max(0, Math.min(100, score));
}

function buildCareerPersona(input: { role: string; athleteAge: number | null }) {
  if (input.role === "responsavel" && input.athleteAge && input.athleteAge >= 13 && input.athleteAge <= 17) {
    return "responsavel_atleta_13_17";
  }
  if (input.role === "responsavel") return "responsavel_atleta";
  if (input.athleteAge && input.athleteAge >= 13 && input.athleteAge <= 17) return "atleta_13_17";
  return "triagem_plano_carreira";
}

function buildCareerMetaCustomData(input: {
  role: string;
  athleteAge: number | null;
  ageGroup: string | null;
  leadScore: number;
  investmentRange: string;
  financialQualified: boolean;
  priorityCareerLead: boolean;
  geo: BrazilTrafficGeo;
  sourcePath: string;
  landingVariant: string;
}) {
  return {
    persona: buildCareerPersona(input),
    role: input.role,
    athlete_age: input.athleteAge ?? 0,
    age_group: input.ageGroup ?? "sem_faixa",
    financial_qualified: input.financialQualified,
    ideal_customer_profile: input.priorityCareerLead,
    investment_range: input.investmentRange || "nao_informado",
    geo_priority: input.geo.priority,
    geo_state: input.geo.stateCode ?? "nao_identificado",
    source_path: input.sourcePath,
    landing_variant: input.landingVariant,
    optimization_note: "responsavel_13_17_sp_mg_financeiro"
  };
}

function buildPublicBotQueueMediaPath(niche: PublicBotNiche, item: PublicBotSequenceItem, index: number) {
  if (item.mediaPath) return item.mediaPath;
  if (niche === "plano_carreira") return "site_bot:plano_carreira:welcome:v1";
  if (item.mediaType === "poll") return "site_bot:mentoria_prime:meeting_poll:v1";
  if (index === 0) return "site_bot:mentoria_prime:welcome:v1";
  return `site_bot:mentoria_prime:text:${index + 1}:v1`;
}

function sendMetaQualityEventInBackground(input: Parameters<typeof sendMetaQualityEvent>[0]) {
  void sendMetaQualityEvent(input).catch((error) => {
    console.warn("Failed to send public lead Meta event", error instanceof Error ? error.message : String(error));
  });
}

async function handlePublicLead(request: any, response: any) {
  setPublicCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const origin = String(request.headers?.origin ?? "");
  if (!allowedOrigin(origin)) {
    response.status(403).json({ error: "Origin not allowed" });
    return;
  }

  try {
    const payload = request.body ?? {};
    const honeypot = cleanText(payload.website, 120);
    const name = cleanText(payload.name, 120);
    const countryDialCode = cleanText(payload.countryDialCode, 5).replace(/\D/g, "") || "55";
    const phone = normalizePhoneFromParts({
      raw: payload.phone,
      countryDialCode,
      areaCode: payload.phoneAreaCode,
      number: payload.phoneNumber,
    });
    const city = cleanText(payload.city, 120);
    const objective = cleanText(payload.objective, 220);
    const position = cleanText(payload.position, 80);
    const role = payload.role === "atleta" ? "atleta" : "responsavel";
    const athleteAge = Number(payload.athleteAge);
    const startedAt = Number(payload.startedAt);
    const dryRun = payload.dryRun === true;
    const serviceInterest = ALLOWED_SERVICE_INTERESTS.has(payload.serviceInterest)
      ? payload.serviceInterest
      : "plano_carreira";

    if (honeypot) {
      response.status(200).json({ ok: true });
      return;
    }

    if (name.length < 2) {
      response.status(400).json({ error: "name is required" });
      return;
    }

    if (!isValidNormalizedPhone(phone, countryDialCode)) {
      response.status(400).json({ error: "valid phone is required" });
      return;
    }

    if (!Number.isInteger(athleteAge) || athleteAge < 6 || athleteAge > 40) {
      response.status(400).json({ error: "athleteAge must be between 6 and 40" });
      return;
    }

    if (city.length < 2 || objective.length < 3) {
      response.status(400).json({ error: "city and objective are required" });
      return;
    }

    if (!dryRun && (!Number.isFinite(startedAt) || Date.now() - startedAt < 1200)) {
      response.status(400).json({ error: "form submitted too quickly" });
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
      landingVariant: cleanText(payload.landingVariant, 120) || "mentoria_prime_conversion_v3",
      sourcePath: cleanText(payload.sourcePath, 200) || "/mentoria-prime-planos",
    };
    const eventSourceUrl = buildEventSourceUrl(origin, traffic.sourcePath);
    const trafficGeo = resolveBrazilTrafficGeo({ city, phone });
    const whatsappUrl = buildWhatsappUrl({ name, athleteAge, city, objective, role });
    const sequenceCreatedAt = new Date();
    const mentoriaSequence = buildMentoriaPrimeSequence(name, sequenceCreatedAt);
    const botInstanceId = MENTORIA_PRIME_BOT_INSTANCE_ID;

    if (dryRun) {
      response.status(200).json({
        ok: true,
        dryRun: true,
        normalizedPhone: phone,
        botInstanceId,
        whatsappUrl,
        botSequence: mentoriaSequence.items.map((item) => ({
          mediaType: item.mediaType,
          mediaPath: item.mediaPath,
          delaySeconds: item.delaySeconds,
          pollQuestion: item.pollQuestion ?? null,
          pollOptions: item.pollOptions ?? null,
        })),
      });
      return;
    }

    const notes = [
      "Lead capturado pela landing Mentoria Esportiva Prime.",
      `Perfil: ${role === "atleta" ? "atleta" : "responsável"}`,
      `Idade do atleta: ${athleteAge}`,
      position ? `Posição: ${position}` : "",
      `Objetivo: ${objective}`,
      `Origem: ${traffic.sourcePath}`,
    ].filter(Boolean).join("\n");

    const attributionMetadata = {
      athleteAge,
      role,
      position: position || null,
      objective,
      landingVariant: traffic.landingVariant,
      sourcePath: traffic.sourcePath,
      eventSourceUrl,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
      capturedAt: new Date().toISOString(),
    };

    const client = await pool.connect();
    try {
      await client.query("begin");

      const { rows } = await client.query(
        `
        with default_seller as (
          select id
          from public.sellers
          where active = true
          order by
            case when role = 'admin' then 0 else 1 end,
            case when region = 'brasil' then 0 else 1 end,
            created_at asc
          limit 1
        )
        insert into public.clients (
          phone,
          bot_instance_id,
          name,
          region,
          notes,
          service_interest,
          source,
          status,
          assigned_seller_id,
          tags,
          lead_score,
          traffic_source,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          fbclid,
          gclid,
          attribution_metadata,
          updated_at
        )
        values (
          $1,
          $14,
          $2,
          $3,
          $4,
          $5,
          'site',
          'novo',
          (select id from default_seller),
          array['mentoria_prime', 'lead_page', 'mentoria_prime_bot_ativo', 'mentoria_prime_onboarding_enfileirado']::text[],
          88,
          'mentoria_prime_landing',
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13::jsonb,
          now()
        )
        on conflict (phone)
        do update set
          name = coalesce(nullif(excluded.name, ''), public.clients.name),
          region = coalesce(excluded.region, public.clients.region),
          notes = concat_ws(E'\\n\\n', nullif(public.clients.notes, ''), excluded.notes),
          service_interest = excluded.service_interest,
          source = 'site',
          assigned_seller_id = coalesce(public.clients.assigned_seller_id, excluded.assigned_seller_id),
          tags = array_remove(
            (
              select array_agg(distinct merged_tag.tag)
              from unnest(coalesce(public.clients.tags, '{}'::text[]) || excluded.tags) as merged_tag(tag)
            ),
            'aguardando_whatsapp'
          ),
          lead_score = greatest(coalesce(public.clients.lead_score, 0), excluded.lead_score),
          traffic_source = excluded.traffic_source,
          utm_source = coalesce(nullif(excluded.utm_source, ''), public.clients.utm_source),
          utm_medium = coalesce(nullif(excluded.utm_medium, ''), public.clients.utm_medium),
          utm_campaign = coalesce(nullif(excluded.utm_campaign, ''), public.clients.utm_campaign),
          utm_content = coalesce(nullif(excluded.utm_content, ''), public.clients.utm_content),
          utm_term = coalesce(nullif(excluded.utm_term, ''), public.clients.utm_term),
          fbclid = coalesce(nullif(excluded.fbclid, ''), public.clients.fbclid),
          gclid = coalesce(nullif(excluded.gclid, ''), public.clients.gclid),
          attribution_metadata = coalesce(public.clients.attribution_metadata, '{}'::jsonb) || excluded.attribution_metadata,
          updated_at = now()
        returning id, phone, status, bot_instance_id
        `,
        [
          phone,
          name,
          trafficGeo.region,
          notes,
          serviceInterest,
          traffic.utmSource || null,
          traffic.utmMedium || null,
          traffic.utmCampaign || null,
          traffic.utmContent || null,
          traffic.utmTerm || null,
          traffic.fbclid || null,
          traffic.gclid || null,
          JSON.stringify(attributionMetadata),
          botInstanceId,
        ],
      );

      const clientId = rows[0]?.id;
      if (!clientId) {
        throw new Error("Lead created without a client id");
      }

      await client.query(
        `
          insert into public.bot_conversation_states (
            client_id,
            bot_instance_id,
            phone,
            stage,
            role_answer,
            athlete_age,
            age_group,
            service_interest,
            completed_at,
            metadata,
            last_outbound_at,
            updated_at
          )
          values ($1, $9, $2, 'awaiting_meeting_date', $3, $4, $5, $6, null, $7::jsonb, $8, now())
          on conflict (phone)
          do update set
            client_id = excluded.client_id,
            bot_instance_id = excluded.bot_instance_id,
            stage = excluded.stage,
            role_answer = excluded.role_answer,
            athlete_age = excluded.athlete_age,
            age_group = excluded.age_group,
            service_interest = excluded.service_interest,
            completed_at = null,
            metadata = excluded.metadata,
            last_outbound_at = excluded.last_outbound_at,
            updated_at = now()
        `,
        [
          clientId,
          phone,
          role === "atleta" ? "Atleta" : "Responsável pelo atleta",
          athleteAge,
          athleteAge <= 12 ? "8-12" : athleteAge <= 17 ? "13-17" : "18-plus",
          serviceInterest,
          JSON.stringify({
            botInstanceId,
            source: "mentoria_prime_form",
            flowVersion: "mentoria_prime_2026_06",
            leadName: name,
            city,
            objective,
            position: position || null,
            meetingDateOptions: mentoriaSequence.meetingDateOptions,
            meetingDateAskedAt: mentoriaSequence.meetingPromptScheduledAt,
            meetingCustomDateAllowed: false,
            sequenceQueuedAt: sequenceCreatedAt.toISOString(),
          }),
          mentoriaSequence.meetingPromptScheduledAt,
          botInstanceId,
        ],
      );

      let queuedMessages = 0;
      for (const [index, item] of mentoriaSequence.items.entries()) {
        const scheduledAt = new Date(sequenceCreatedAt.getTime() + item.delaySeconds * 1_000).toISOString();
        const queueMediaPath = buildPublicBotQueueMediaPath("mentoria_prime", item, index);
        const outbound = await client.query(
          `
            insert into public.outbound_messages (
              client_id, bot_instance_id, phone, body, media_type, media_path, status, scheduled_at
            )
            select $1, $7, $2, $3, $4, $5, 'queued', $6
            where not exists (
              select 1
              from public.outbound_messages
              where client_id = $1
                and bot_instance_id = $7
                and media_type = $4
                and (
                  ($5::text is not null and coalesce(media_path, '') = $5::text)
                  or ($5::text is null and coalesce(body, '') = coalesce($3, ''))
                )
                and created_at >= now() - interval '24 hours'
                and status in ('queued', 'sent')
            )
            returning id
          `,
          [clientId, phone, item.body, item.mediaType, queueMediaPath, scheduledAt, botInstanceId],
        );

        if (!outbound.rowCount) continue;
        queuedMessages += 1;
      }

      await client.query(
        `
          insert into public.traffic_events (
            client_id, bot_instance_id, phone, event_type, channel, platform, service_interest,
            athlete_age, age_group, lead_status, quality_score, metadata
          )
          values ($1, $2, $3, 'mentoria_prime_bot_activated', 'site', 'whatsapp', $4, $5, $6, 'novo', 92, $7::jsonb)
        `,
        [
          clientId,
          botInstanceId,
          phone,
          serviceInterest,
          athleteAge,
          athleteAge <= 12 ? "8-12" : athleteAge <= 17 ? "13-17" : "18-plus",
          JSON.stringify({
            botInstanceId,
            queuedMessages,
            audioOrder: [
              "01_apresentacao_eric.ogg",
              "02_plano_seis_meses.ogg",
            ],
            meetingPromptType: "poll",
            meetingPromptScheduledAt: mentoriaSequence.meetingPromptScheduledAt,
          }),
        ],
      );

      await client.query("commit");
      sendMetaQualityEventInBackground({
        clientId,
        phone,
        status: "novo",
        eventName: "Lead",
        serviceInterest,
        leadScore: 88,
        fbclid: traffic.fbclid || null,
        fbc: traffic.fbc || null,
        fbp: traffic.fbp || null,
        eventSourceUrl,
        actionSource: "website",
        eventId: `site-${clientId}-${traffic.landingVariant}-lead`
      });
      response.status(200).json({
        ok: true,
        clientId,
        status: rows[0]?.status ?? "novo",
        botActivated: true,
        queuedMessages,
        whatsappUrl,
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("public lead intake failed", error);
    response.status(500).json({ error: "Unable to create lead" });
  }
}

async function handlePublicSiteBotLead(request: any, response: any) {
  setPublicCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const origin = String(request.headers?.origin ?? "");
  if (!allowedOrigin(origin)) {
    response.status(403).json({ error: "Origin not allowed" });
    return;
  }

  try {
    const payload = request.body ?? {};
    const honeypot = cleanText(payload.website, 120);
    const name = cleanText(payload.name, 120);
    const countryDialCode = cleanText(payload.countryDialCode, 5).replace(/\D/g, "") || "55";
    const phone = normalizePhoneFromParts({
      raw: payload.phone,
      countryDialCode,
      areaCode: payload.phoneAreaCode,
      number: payload.phoneNumber,
    });
    const role = payload.role === "atleta" ? "atleta" : "responsavel";
    const niche = cleanText(payload.botNiche, 40) as PublicBotNiche;
    const startedAt = Number(payload.startedAt);
    const dryRun = payload.dryRun === true;
    const athleteName = cleanText(payload.athleteName, 140);
    const athleteAge = normalizeOptionalAge(payload.athleteAge);
    const ageGroup = ageGroupFor(athleteAge);
    const city = cleanText(payload.city, 140);
    const position = cleanText(payload.position, 80);
    const currentClub = cleanText(payload.currentClub, 140);
    const trainingLevel = cleanText(payload.trainingLevel, 80);
    const objective = cleanText(payload.objective, 500);
    const investmentRange = cleanText(payload.investmentRange, 80);
    const investmentLabel = cleanText(payload.investmentLabel, 160);
    const readiness = cleanText(payload.readiness, 80);
    const rawVideoLink = cleanText(payload.videoLink, 300);
    const noVideoMaterial = payload.noVideoMaterial === true
      || payload.noVideoMaterial === "true"
      || cleanText(payload.videoMaterialStatus, 80) === "sem_material";
    const videoLink = noVideoMaterial ? "" : rawVideoLink;
    const videoMaterialStatus = noVideoMaterial
      ? "sem_material"
      : (videoLink ? "link_informado" : "nao_informado");
    const guardianName = cleanText(payload.guardianName, 140);
    const guardianCountryDialCode = cleanText(payload.guardianCountryDialCode, 5).replace(/\D/g, "") || countryDialCode;
    const guardianPhone = normalizePhoneFromParts({
      raw: payload.guardianPhone,
      countryDialCode: guardianCountryDialCode,
      areaCode: payload.guardianPhoneAreaCode,
      number: payload.guardianPhoneNumber,
    });
    const qualificationTemperature = cleanText(payload.qualificationTemperature, 80);
    const qualificationScore = Number(payload.qualificationScore);
    const formVariant = cleanText(payload.formVariant, 120);
    const requestedCommercialPriority = payload.commercialPriority === true || payload.commercialPriority === "true";
    const financialQualified = payload.financialQualified === true
      || payload.financialQualified === "true"
      || ["300_600", "600_1000", "1000_plus"].includes(investmentRange);
    const priorityReason = cleanText(payload.priorityReason, 180);

    if (honeypot) {
      response.status(200).json({ ok: true });
      return;
    }

    if (name.trim().split(/\s+/).filter(Boolean).length < 2) {
      response.status(400).json({ error: "full name is required" });
      return;
    }

    if (!isValidNormalizedPhone(phone, countryDialCode)) {
      response.status(400).json({ error: "valid phone is required" });
      return;
    }

    if (niche !== "mentoria_prime" && niche !== "plano_carreira") {
      response.status(400).json({ error: "valid bot niche is required" });
      return;
    }

    if (!dryRun && (!Number.isFinite(startedAt) || Date.now() - startedAt < 600)) {
      response.status(400).json({ error: "form submitted too quickly" });
      return;
    }

    if (
      niche === "plano_carreira"
      && athleteAge
      && athleteAge < 18
      && role === "atleta"
      && (!guardianName || !isValidNormalizedPhone(guardianPhone, guardianCountryDialCode))
    ) {
      response.status(400).json({ error: "guardian is required for minor athlete" });
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
      landingVariant: cleanText(payload.landingVariant, 120)
        || (niche === "mentoria_prime" ? "mentoria_prime_quick_form" : "career_plan_quick_form"),
      sourcePath: cleanText(payload.sourcePath, 200)
        || (niche === "mentoria_prime" ? "/mentoria-prime-planos" : "/instagram"),
    };
    const eventSourceUrl = buildEventSourceUrl(origin, traffic.sourcePath);
    const trafficGeo = resolveBrazilTrafficGeo({ city, phone });

    const sequenceCreatedAt = new Date();
    const mentoriaSequence = niche === "mentoria_prime"
      ? buildMentoriaPrimeSequence(name, sequenceCreatedAt)
      : null;
    const sequenceItems: PublicBotSequenceItem[] = mentoriaSequence
      ? mentoriaSequence.items
      : [{
          body: buildCareerPlanWelcome(name),
          mediaType: "text",
          mediaPath: null,
          delaySeconds: 0,
        }];
    const lastSequenceDelay = Math.max(...sequenceItems.map((item) => item.delaySeconds), 0);
    const lastOutboundAt = new Date(sequenceCreatedAt.getTime() + lastSequenceDelay * 1_000).toISOString();
    const serviceInterest = "plano_carreira";
    const roleLabel = role === "atleta" ? "Atleta" : "Responsável pelo atleta";
    const nicheLabel = niche === "mentoria_prime" ? "Mentoria Esportiva Prime" : "Plano de Carreira EC10";
    const whatsappUrl = buildPublicBotFallbackUrl(name, niche);
    const botInstanceId = botInstanceForNiche(niche);
    const rawBaseLeadScore = niche === "mentoria_prime" ? 88 : scoreFromCareerProfile({
      athleteAge,
      trainingLevel,
      investmentRange,
      readiness,
      videoLink,
      currentClub,
      objective,
      qualificationScore,
    });
    const baseLeadScore = niche === "plano_carreira" && trafficGeo.isPriority
      ? Math.min(100, rawBaseLeadScore + 4)
      : rawBaseLeadScore;
    const priorityCareerLead = niche === "plano_carreira"
      && role === "responsavel"
      && (requestedCommercialPriority || financialQualified);
    const qualifiedCareerLead = niche === "plano_carreira"
      && role === "responsavel"
      && financialQualified;
    const leadScore = priorityCareerLead
      ? Math.max(baseLeadScore, 92)
      : (qualifiedCareerLead ? Math.max(baseLeadScore, 84) : baseLeadScore);
    const leadTemperature = qualificationTemperature || (
      leadScore >= 82 ? "Lead quente" : leadScore >= 68 ? "Bom potencial" : leadScore >= 54 ? "Em analise" : "Precisa triagem"
    );

    if (dryRun) {
      response.status(200).json({
        ok: true,
        dryRun: true,
        botActivated: true,
        botNiche: niche,
        botInstanceId,
        normalizedPhone: phone,
        whatsappUrl,
        leadScore,
        leadTemperature,
        financialQualified,
        commercialPriority: priorityCareerLead,
        priorityReason: priorityReason || null,
        geoPriority: trafficGeo.priority,
        geoState: trafficGeo.stateCode,
        geoRegion: trafficGeo.region,
        initialStage: niche === "mentoria_prime" ? "awaiting_meeting_date" : "awaiting_age",
        botSequence: sequenceItems.map((item) => ({
          mediaType: item.mediaType,
          mediaPath: item.mediaPath,
          delaySeconds: item.delaySeconds,
          hasBody: Boolean(item.body),
          pollQuestion: item.pollQuestion ?? null,
          pollOptions: item.pollOptions ?? null,
        })),
      });
      return;
    }

    const notes = [
      `Lead capturado pelo formulário rápido de ${nicheLabel}.`,
      `Perfil: ${role === "atleta" ? "atleta" : "responsável"}`,
      athleteName ? `Atleta: ${athleteName}` : "",
      athleteAge ? `Idade do atleta: ${athleteAge}` : "",
      ageGroup ? `Faixa: ${ageGroup}` : "",
      city ? `Cidade: ${city}` : "",
      position ? `Posicao: ${position}` : "",
      currentClub ? `Clube/escola atual: ${currentClub}` : "",
      trainingLevel ? `Nivel atual: ${trainingLevel}` : "",
      objective ? `Objetivo: ${objective}` : "",
      investmentLabel || investmentRange ? `Investimento declarado: ${investmentLabel || investmentRange}` : "",
      financialQualified ? "Filtro financeiro: aprovado" : "",
      priorityCareerLead ? "Prioridade CRM: responsavel com capacidade de investimento." : "",
      trafficGeo.isPriority ? `Regiao prioritaria trafego: ${trafficGeo.stateCode}` : "",
      readiness ? `Prazo para comecar: ${readiness}` : "",
      noVideoMaterial ? "Material de video: lead informou que ainda nao tem material." : "",
      videoLink ? `Video/rede social: ${videoLink}` : "",
      guardianName ? `Responsavel do menor: ${guardianName}` : "",
      guardianPhone && guardianPhone !== phone ? `WhatsApp responsavel: +${guardianPhone}` : "",
      `Temperatura: ${leadTemperature} (${leadScore}/100)`,
      `Bot ativado: ${nicheLabel}`,
      `Origem: ${traffic.sourcePath}`,
    ].filter(Boolean).join("\n");
    const tags = niche === "mentoria_prime"
      ? ["mentoria_prime", "lead_page", "mentoria_prime_bot_ativo", "mentoria_prime_onboarding_enfileirado"]
      : [
          "plano_carreira",
          "lead_page",
          "plano_carreira_bot_ativo",
          "plano_carreira_onboarding_enfileirado",
          leadScore >= 82 ? "lead_quente" : leadScore >= 68 ? "lead_morno" : "lead_triagem",
          role === "responsavel" ? "responsavel_atleta" : "atleta",
          financialQualified ? "financeiro_aprovado" : "financeiro_pendente",
          qualifiedCareerLead ? "responsavel_financeiro_apto" : "triagem_padrao",
          priorityCareerLead ? "lead_prioritario" : "prioridade_normal",
          priorityCareerLead ? "qualified_lead_site" : "lead_site",
          ...trafficGeo.tags,
          noVideoMaterial ? "sem_material_video" : (videoLink ? "video_informado" : "video_nao_informado"),
          traffic.sourcePath.includes("cadastro-plano-carreira") ? "lp_cadastro_plano_carreira" : "lp_instagram",
        ];
    const trafficSource = niche === "mentoria_prime" ? "mentoria_prime_landing" : "career_plan_landing";
    const attributionMetadata = {
      role,
      botNiche: niche,
      athleteName: athleteName || null,
      athleteAge,
      ageGroup,
      city: city || null,
      geoPriority: trafficGeo.priority,
      geoState: trafficGeo.stateCode,
      geoRegion: trafficGeo.region,
      geoCity: trafficGeo.city,
      position: position || null,
      currentClub: currentClub || null,
      trainingLevel: trainingLevel || null,
      objective: objective || null,
      investmentRange: investmentRange || null,
      investmentLabel: investmentLabel || null,
      readiness: readiness || null,
      videoLink: videoLink || null,
      noVideoMaterial,
      videoMaterialStatus,
      guardianName: guardianName || null,
      guardianPhone: guardianPhone || null,
      formVariant: formVariant || null,
      financialQualified,
      commercialPriority: priorityCareerLead,
      priorityReason: priorityReason || null,
      qualificationScore: leadScore,
      qualificationTemperature: leadTemperature,
      landingVariant: traffic.landingVariant,
      sourcePath: traffic.sourcePath,
      eventSourceUrl,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
      capturedAt: sequenceCreatedAt.toISOString(),
    };

    const stateStage = niche === "mentoria_prime" ? "awaiting_meeting_date" : "awaiting_age";
    const stateMetadata = niche === "mentoria_prime"
      ? {
          source: "mentoria_prime_form",
          botInstanceId,
          flowVersion: "mentoria_prime_quick_2026_06",
          leadName: name,
          meetingDateOptions: mentoriaSequence?.meetingDateOptions ?? [],
          meetingDateAskedAt: mentoriaSequence?.meetingPromptScheduledAt ?? null,
          meetingCustomDateAllowed: false,
          sequenceQueuedAt: sequenceCreatedAt.toISOString(),
        }
      : {
          source: "career_plan_form",
          botInstanceId,
          flowVersion: "career_plan_site_2026_06",
          leadName: name,
          athleteName: athleteName || null,
          athleteAge,
          ageGroup,
          city: city || null,
          geoPriority: trafficGeo.priority,
          geoState: trafficGeo.stateCode,
          geoRegion: trafficGeo.region,
          position: position || null,
          objective: objective || null,
          investmentRange: investmentRange || null,
          financialQualified,
          commercialPriority: priorityCareerLead,
          priorityReason: priorityReason || null,
          qualificationScore: leadScore,
          qualificationTemperature: leadTemperature,
          requestedFlow: null,
          ageQuestionAskedAt: sequenceCreatedAt.toISOString(),
          sequenceQueuedAt: sequenceCreatedAt.toISOString(),
        };

    const client = await pool.connect();
    try {
      await client.query("begin");

      const { rows } = await client.query(
        `
          with default_seller as (
            select id
            from public.sellers
            where active = true
            order by
              case
                when $18::text = 'plano_carreira' and lower(name) like '%sandro%' then 0
                when role = 'admin' then 2
                else 1
              end,
              case when region = 'brasil' then 0 else 1 end,
              created_at asc
            limit 1
          )
          insert into public.clients (
            phone, bot_instance_id, name, region, notes, service_interest, source, status,
            assigned_seller_id, tags, lead_score, traffic_source,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, gclid, attribution_metadata, updated_at
          )
          values (
            $1, $17, $2, $3, $4, $5, 'site', 'novo', (select id from default_seller),
            $6::text[], $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, now()
          )
          on conflict (phone)
          do update set
            name = coalesce(nullif(excluded.name, ''), public.clients.name),
            region = coalesce(excluded.region, public.clients.region),
            notes = concat_ws(E'\\n\\n', nullif(public.clients.notes, ''), excluded.notes),
            service_interest = excluded.service_interest,
            source = 'site',
            assigned_seller_id = coalesce(public.clients.assigned_seller_id, excluded.assigned_seller_id),
            tags = array_remove(
              (
                select array_agg(distinct merged_tag.tag)
                from unnest(
                  array_remove(
                    array_remove(coalesce(public.clients.tags, '{}'::text[]), 'lp_instagram'),
                    'lp_cadastro_plano_carreira'
                  ) || excluded.tags
                ) as merged_tag(tag)
              ),
              'aguardando_whatsapp'
            ),
            lead_score = greatest(coalesce(public.clients.lead_score, 0), excluded.lead_score),
            traffic_source = excluded.traffic_source,
            utm_source = coalesce(nullif(excluded.utm_source, ''), public.clients.utm_source),
            utm_medium = coalesce(nullif(excluded.utm_medium, ''), public.clients.utm_medium),
            utm_campaign = coalesce(nullif(excluded.utm_campaign, ''), public.clients.utm_campaign),
            utm_content = coalesce(nullif(excluded.utm_content, ''), public.clients.utm_content),
            utm_term = coalesce(nullif(excluded.utm_term, ''), public.clients.utm_term),
            fbclid = coalesce(nullif(excluded.fbclid, ''), public.clients.fbclid),
            gclid = coalesce(nullif(excluded.gclid, ''), public.clients.gclid),
            attribution_metadata = coalesce(public.clients.attribution_metadata, '{}'::jsonb) || excluded.attribution_metadata,
            bot_paused = false,
            updated_at = now()
          returning id, phone, status, bot_instance_id
        `,
        [
          phone,
          name,
          phone.startsWith("55") ? "brasil" : "internacional",
          notes,
          serviceInterest,
          tags,
          leadScore,
          trafficSource,
          traffic.utmSource || null,
          traffic.utmMedium || null,
          traffic.utmCampaign || null,
          traffic.utmContent || null,
          traffic.utmTerm || null,
          traffic.fbclid || null,
          traffic.gclid || null,
          JSON.stringify(attributionMetadata),
          botInstanceId,
          serviceInterest,
        ],
      );

      const clientId = rows[0]?.id;
      if (!clientId) throw new Error("Lead created without a client id");

      await client.query(
        `
          insert into public.bot_conversation_states (
            client_id, bot_instance_id, phone, stage, role_answer, athlete_age, age_group,
            service_interest, completed_at, metadata, last_outbound_at, updated_at
          )
          values ($1, $10, $2, $3, $4, $8, $9, $5, null, $6::jsonb, $7, now())
          on conflict (phone)
          do update set
            client_id = excluded.client_id,
            bot_instance_id = excluded.bot_instance_id,
            stage = excluded.stage,
            role_answer = excluded.role_answer,
            athlete_age = excluded.athlete_age,
            age_group = excluded.age_group,
            service_interest = excluded.service_interest,
            completed_at = null,
            metadata = excluded.metadata,
            last_outbound_at = excluded.last_outbound_at,
            updated_at = now()
        `,
        [
          clientId,
          phone,
          stateStage,
          roleLabel,
          serviceInterest,
          JSON.stringify(stateMetadata),
          lastOutboundAt,
          athleteAge,
          ageGroup,
          botInstanceId,
        ],
      );

      let queuedMessages = 0;
      for (const [index, item] of sequenceItems.entries()) {
        const scheduledAt = new Date(sequenceCreatedAt.getTime() + item.delaySeconds * 1_000).toISOString();
        const queueMediaPath = buildPublicBotQueueMediaPath(niche, item, index);
        const outbound = await client.query(
          `
            insert into public.outbound_messages (
              client_id, bot_instance_id, phone, body, media_type, media_path, status, scheduled_at
            )
            select $1, $7, $2, $3, $4, $5, 'queued', $6
            where not exists (
              select 1
              from public.outbound_messages
              where client_id = $1
                and bot_instance_id = $7
                and media_type = $4
                and (
                  ($5::text is not null and coalesce(media_path, '') = $5::text)
                  or ($5::text is null and coalesce(body, '') = coalesce($3, ''))
                )
                and created_at >= now() - interval '24 hours'
                and status in ('queued', 'sent')
            )
            returning id
          `,
          [clientId, phone, item.body, item.mediaType, queueMediaPath, scheduledAt, botInstanceId],
        );

        if (!outbound.rowCount) continue;
        queuedMessages += 1;
      }

      await client.query(
        `
          insert into public.traffic_events (
            client_id, bot_instance_id, phone, event_type, channel, platform, service_interest,
            athlete_age, age_group, lead_status, quality_score, metadata
          )
          values ($1, $2, $3, $4, 'site', 'whatsapp', $5, $8, $9, 'novo', $6, $7::jsonb)
        `,
        [
          clientId,
          botInstanceId,
          phone,
          niche === "mentoria_prime" ? "mentoria_prime_bot_activated" : "career_plan_bot_activated",
          serviceInterest,
          leadScore,
          JSON.stringify({
            botNiche: niche,
            botInstanceId,
            queuedMessages,
            initialStage: stateStage,
            athleteName: athleteName || null,
            investmentRange: investmentRange || null,
            financialQualified,
            commercialPriority: priorityCareerLead,
            geoPriority: trafficGeo.priority,
            geoState: trafficGeo.stateCode,
            geoRegion: trafficGeo.region,
            priorityReason: priorityReason || null,
            qualificationTemperature: leadTemperature,
          }),
          athleteAge,
          ageGroup,
        ],
      );

      if (priorityCareerLead) {
        await client.query(
          `
            insert into public.traffic_events (
              client_id, bot_instance_id, phone, event_type, channel, platform, service_interest,
              athlete_age, age_group, lead_status, quality_score, metadata
            )
            values ($1, $2, $3, 'QualifiedLead', 'site', 'meta', $4, $7, $8, 'quente', $5, $6::jsonb)
          `,
          [
            clientId,
            botInstanceId,
            phone,
            serviceInterest,
            leadScore,
            JSON.stringify({
              botNiche: niche,
              sourcePath: traffic.sourcePath,
              landingVariant: traffic.landingVariant,
              formVariant: formVariant || null,
              athleteName: athleteName || null,
              investmentRange: investmentRange || null,
              investmentLabel: investmentLabel || null,
              financialQualified,
              commercialPriority: true,
              geoPriority: trafficGeo.priority,
              geoState: trafficGeo.stateCode,
              geoRegion: trafficGeo.region,
              priorityReason: priorityReason || "responsavel_com_investimento_600_plus",
              qualificationTemperature: leadTemperature,
            }),
            athleteAge,
            ageGroup,
          ],
        );
      }

      await client.query("commit");
      sendMetaQualityEventInBackground({
        clientId,
        phone,
        status: "novo",
        eventName: "Lead",
        serviceInterest,
        leadScore,
        fbclid: traffic.fbclid || null,
        fbc: traffic.fbc || null,
        fbp: traffic.fbp || null,
        city: trafficGeo.city || city || null,
        state: trafficGeo.stateCode,
        country: "BR",
        eventSourceUrl,
        actionSource: "website",
        eventId: `site-${clientId}-${traffic.landingVariant}-lead`,
        customData: buildCareerMetaCustomData({
          role,
          athleteAge,
          ageGroup,
          leadScore,
          investmentRange,
          financialQualified,
          priorityCareerLead,
          geo: trafficGeo,
          sourcePath: traffic.sourcePath,
          landingVariant: traffic.landingVariant
        })
      });
      if (priorityCareerLead) {
        sendMetaQualityEventInBackground({
          clientId,
          phone,
          status: "quente",
          eventName: "QualifiedLead",
          serviceInterest,
          leadScore,
          fbclid: traffic.fbclid || null,
          fbc: traffic.fbc || null,
          fbp: traffic.fbp || null,
          city: trafficGeo.city || city || null,
          state: trafficGeo.stateCode,
          country: "BR",
          eventSourceUrl,
          actionSource: "website",
          eventId: `site-${clientId}-${traffic.landingVariant}-qualified`,
          customData: buildCareerMetaCustomData({
            role,
            athleteAge,
            ageGroup,
            leadScore,
            investmentRange,
            financialQualified,
            priorityCareerLead: true,
            geo: trafficGeo,
            sourcePath: traffic.sourcePath,
            landingVariant: traffic.landingVariant
          })
        });
      }
      response.status(200).json({
        ok: true,
        clientId,
        status: rows[0]?.status ?? "novo",
        botActivated: true,
        botNiche: niche,
        queuedMessages,
        whatsappUrl,
        financialQualified,
        commercialPriority: priorityCareerLead,
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("public site bot intake failed", error);
    response.status(500).json({ error: "Unable to activate bot" });
  }
}

async function handleAuthenticatedClient(request: any, response: any) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request, { requireActive: true });
    const {
      name,
      phone,
      region = "brasil",
      notes = "",
      serviceInterest = "nao_definido",
      source = "manual"
    } = request.body ?? {};
    const normalizedPhone = normalizePhone(String(phone ?? ""));

    if (!normalizedPhone) {
      response.status(400).json({ error: "phone is required" });
      return;
    }

    const { rows } = await pool.query(
      `
        insert into public.clients
          (phone, bot_instance_id, name, region, notes, service_interest, source, status, assigned_seller_id, updated_at)
        values
          ($1, $8, $2, $3, $4, $5, $6, 'novo', $7, now())
        on conflict (phone)
        do update set
          name = coalesce(excluded.name, public.clients.name),
          region = coalesce(excluded.region, public.clients.region),
          notes = coalesce(excluded.notes, public.clients.notes),
          service_interest = coalesce(excluded.service_interest, public.clients.service_interest),
          source = coalesce(excluded.source, public.clients.source),
          assigned_seller_id = coalesce(public.clients.assigned_seller_id, excluded.assigned_seller_id),
          updated_at = now()
        returning id, phone, name, status, region, service_interest, source, assigned_seller_id, bot_paused, notes, tags,
                  next_follow_up_at, lead_score, traffic_source, traffic_campaign_id, traffic_campaign_name,
                  traffic_adset_id, traffic_ad_id, utm_source, utm_medium, utm_campaign, utm_content,
                  utm_term, fbclid, gclid, attribution_metadata, bot_instance_id, last_message_at, created_at
      `,
      [normalizedPhone, name || null, region || null, notes || null, serviceInterest, source, seller.id, MAIN_BOT_INSTANCE_ID]
    );

    response.status(200).json({ client: mapClient(rows[0]) });
  } catch (error) {
    handleApiError(response, error);
  }
}

export default async function handler(request: any, response: any) {
  if (String(request.query?.public ?? "") === "campaign-lp") {
    return campaignLeadHandler(request, response);
  }

  if (String(request.query?.public ?? "") === "eurocamp-saas-repair") {
    await eurocampSaasRepairHandler(request, response);
    return;
  }

  if (String(request.query?.public ?? "") === "eurocamp") {
    await eurocampLeadHandler(request, response);
    return;
  }

  if (String(request.query?.public ?? "") === "sudamerica-x1") {
    await sudamericaX1Handler(request, response);
    return;
  }

  if (String(request.query?.public ?? "") === "x1") {
    await x1WhatsappHandler(request, response);
    return;
  }

  if (String(request.query?.public ?? "") === "libertacademy") {
    await libertacademyLeadHandler(request, response);
    return;
  }

  if (String(request.query?.public ?? "") === "site-bot") {
    await handlePublicSiteBotLead(request, response);
    return;
  }

  if (String(request.query?.public ?? "") === "mentoria-prime") {
    await handlePublicLead(request, response);
    return;
  }

  await handleAuthenticatedClient(request, response);
}
