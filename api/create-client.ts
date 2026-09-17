import { ensureSeller, handleApiError } from "./_auth.js";
import { pool, mapClient } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";
import { buildMentoriaPrimeSequence } from "./_mentoria-prime.js";

const DEFAULT_WHATSAPP_NUMBER = "553198526146";
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

function normalizePhone(input: string, defaultCountryCode = "55") {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith(defaultCountryCode) || digits.length > 11) return digits;
  return `${defaultCountryCode}${digits}`;
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
    const phone = normalizePhone(cleanText(payload.phone, 40), countryDialCode);
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

    if (phone.length < 10 || phone.length > 15) {
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
    const whatsappUrl = buildWhatsappUrl({ name, athleteAge, city, objective, role });
    const sequenceCreatedAt = new Date();
    const mentoriaSequence = buildMentoriaPrimeSequence(name, sequenceCreatedAt);

    if (dryRun) {
      response.status(200).json({
        ok: true,
        dryRun: true,
        normalizedPhone: phone,
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
        returning id, phone, status
        `,
        [
          phone,
          name,
          phone.startsWith("55") ? "brasil" : "internacional",
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
          values ($1, $2, 'awaiting_meeting_date', $3, $4, $5, $6, null, $7::jsonb, $8, now())
          on conflict (phone)
          do update set
            client_id = excluded.client_id,
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
        ],
      );

      let queuedMessages = 0;
      for (const item of mentoriaSequence.items) {
        const scheduledAt = new Date(sequenceCreatedAt.getTime() + item.delaySeconds * 1_000).toISOString();
        const outbound = await client.query(
          `
            insert into public.outbound_messages (
              client_id, phone, body, media_type, media_path, status, scheduled_at
            )
            select $1, $2, $3, $4, $5, 'queued', $6
            where not exists (
              select 1
              from public.outbound_messages
              where client_id = $1
                and coalesce(body, '') = coalesce($3, '')
                and coalesce(media_path, '') = coalesce($5, '')
                and created_at >= now() - interval '24 hours'
                and status in ('queued', 'sent')
            )
            returning id
          `,
          [clientId, phone, item.body, item.mediaType, item.mediaPath, scheduledAt],
        );

        if (!outbound.rowCount) continue;
        queuedMessages += 1;
        await client.query(
          `
            insert into public.messages (client_id, direction, body, media_type, media_path)
            values ($1, 'outbound', $2, $3, $4)
          `,
          [clientId, item.body, item.mediaType, item.mediaPath],
        );
      }

      await client.query(
        `
          insert into public.traffic_events (
            client_id, phone, event_type, channel, platform, service_interest,
            athlete_age, age_group, lead_status, quality_score, metadata
          )
          values ($1, $2, 'mentoria_prime_bot_activated', 'site', 'whatsapp', $3, $4, $5, 'novo', 92, $6::jsonb)
        `,
        [
          clientId,
          phone,
          serviceInterest,
          athleteAge,
          athleteAge <= 12 ? "8-12" : athleteAge <= 17 ? "13-17" : "18-plus",
          JSON.stringify({
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
      await sendMetaQualityEvent({
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
    const phone = normalizePhone(cleanText(payload.phone, 40), countryDialCode);
    const role = payload.role === "atleta" ? "atleta" : "responsavel";
    const niche = cleanText(payload.botNiche, 40) as PublicBotNiche;
    const startedAt = Number(payload.startedAt);
    const dryRun = payload.dryRun === true;

    if (honeypot) {
      response.status(200).json({ ok: true });
      return;
    }

    if (name.trim().split(/\s+/).filter(Boolean).length < 2) {
      response.status(400).json({ error: "full name is required" });
      return;
    }

    if (phone.length < 10 || phone.length > 15) {
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

    if (dryRun) {
      response.status(200).json({
        ok: true,
        dryRun: true,
        botActivated: true,
        botNiche: niche,
        normalizedPhone: phone,
        whatsappUrl,
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
      `Bot ativado: ${nicheLabel}`,
      `Origem: ${traffic.sourcePath}`,
    ].join("\n");
    const tags = niche === "mentoria_prime"
      ? ["mentoria_prime", "lead_page", "mentoria_prime_bot_ativo", "mentoria_prime_onboarding_enfileirado"]
      : ["plano_carreira", "lead_page", "plano_carreira_bot_ativo", "plano_carreira_onboarding_enfileirado"];
    const leadScore = niche === "mentoria_prime" ? 88 : 82;
    const trafficSource = niche === "mentoria_prime" ? "mentoria_prime_landing" : "career_plan_landing";
    const attributionMetadata = {
      role,
      botNiche: niche,
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
          flowVersion: "mentoria_prime_quick_2026_06",
          leadName: name,
          meetingDateOptions: mentoriaSequence?.meetingDateOptions ?? [],
          meetingDateAskedAt: mentoriaSequence?.meetingPromptScheduledAt ?? null,
          meetingCustomDateAllowed: false,
          sequenceQueuedAt: sequenceCreatedAt.toISOString(),
        }
      : {
          source: "career_plan_form",
          flowVersion: "career_plan_site_2026_06",
          leadName: name,
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
              case when role = 'admin' then 0 else 1 end,
              case when region = 'brasil' then 0 else 1 end,
              created_at asc
            limit 1
          )
          insert into public.clients (
            phone, name, region, notes, service_interest, source, status,
            assigned_seller_id, tags, lead_score, traffic_source,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, gclid, attribution_metadata, updated_at
          )
          values (
            $1, $2, $3, $4, $5, 'site', 'novo', (select id from default_seller),
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
            bot_paused = false,
            updated_at = now()
          returning id, phone, status
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
        ],
      );

      const clientId = rows[0]?.id;
      if (!clientId) throw new Error("Lead created without a client id");

      await client.query(
        `
          insert into public.bot_conversation_states (
            client_id, phone, stage, role_answer, athlete_age, age_group,
            service_interest, completed_at, metadata, last_outbound_at, updated_at
          )
          values ($1, $2, $3, $4, null, null, $5, null, $6::jsonb, $7, now())
          on conflict (phone)
          do update set
            client_id = excluded.client_id,
            stage = excluded.stage,
            role_answer = excluded.role_answer,
            athlete_age = null,
            age_group = null,
            service_interest = excluded.service_interest,
            completed_at = null,
            metadata = excluded.metadata,
            last_outbound_at = excluded.last_outbound_at,
            updated_at = now()
        `,
        [clientId, phone, stateStage, roleLabel, serviceInterest, JSON.stringify(stateMetadata), lastOutboundAt],
      );

      let queuedMessages = 0;
      for (const item of sequenceItems) {
        const scheduledAt = new Date(sequenceCreatedAt.getTime() + item.delaySeconds * 1_000).toISOString();
        const outbound = await client.query(
          `
            insert into public.outbound_messages (
              client_id, phone, body, media_type, media_path, status, scheduled_at
            )
            select $1, $2, $3, $4, $5, 'queued', $6
            where not exists (
              select 1
              from public.outbound_messages
              where client_id = $1
                and coalesce(body, '') = coalesce($3, '')
                and coalesce(media_path, '') = coalesce($5, '')
                and created_at >= now() - interval '15 minutes'
                and status in ('queued', 'sent')
            )
            returning id
          `,
          [clientId, phone, item.body, item.mediaType, item.mediaPath, scheduledAt],
        );

        if (!outbound.rowCount) continue;
        queuedMessages += 1;
        await client.query(
          `
            insert into public.messages (client_id, direction, body, media_type, media_path)
            values ($1, 'outbound', $2, $3, $4)
          `,
          [clientId, item.body, item.mediaType, item.mediaPath],
        );
      }

      await client.query(
        `
          insert into public.traffic_events (
            client_id, phone, event_type, channel, platform, service_interest,
            athlete_age, age_group, lead_status, quality_score, metadata
          )
          values ($1, $2, $3, 'site', 'whatsapp', $4, null, null, 'novo', $5, $6::jsonb)
        `,
        [
          clientId,
          phone,
          niche === "mentoria_prime" ? "mentoria_prime_bot_activated" : "career_plan_bot_activated",
          serviceInterest,
          leadScore,
          JSON.stringify({ botNiche: niche, queuedMessages, initialStage: stateStage }),
        ],
      );

      await client.query("commit");
      await sendMetaQualityEvent({
        clientId,
        phone,
        status: "novo",
        eventName: "Lead",
        serviceInterest,
        leadScore,
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
        botNiche: niche,
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
          (phone, name, region, notes, service_interest, source, status, assigned_seller_id, updated_at)
        values
          ($1, $2, $3, $4, $5, $6, 'novo', $7, now())
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
                  utm_term, fbclid, gclid, attribution_metadata, last_message_at, created_at
      `,
      [normalizedPhone, name || null, region || null, notes || null, serviceInterest, source, seller.id]
    );

    response.status(200).json({ client: mapClient(rows[0]) });
  } catch (error) {
    handleApiError(response, error);
  }
}

export default async function handler(request: any, response: any) {
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
