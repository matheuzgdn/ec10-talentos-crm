import { pool } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";

const MAIN_BOT_INSTANCE_ID = "main";
const EVENT_SLUG = "libertacademy_florianopolis_2027";
// The lead starts the conversation after registration. The CRM only records
// attribution and keeps the round-robin destination for operational control.
const WHATSAPP_DESTINATIONS = ["553197767223", "5493512602033"] as const;
const DECISION_MAKER_ROLES = new Set(["proprietario", "gestor"]);

const allowedOrigins = new Set([
  "https://ec10talentos.com",
  "https://www.ec10talentos.com",
  "http://localhost:3000",
  "http://localhost:4173",
]);

function cleanText(value: unknown, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePhone(value: unknown, dialCode: unknown) {
  const number = cleanText(value, 40).replace(/\D/g, "");
  const countryCode = cleanText(dialCode, 6).replace(/\D/g, "") || "55";
  if (!number) return "";
  if (number.startsWith(countryCode)) return number;
  return `${countryCode}${number.replace(/^0+/, "")}`;
}

function isValidPhone(phone: string) {
  return /^\d{10,15}$/.test(phone);
}

function metaCountryCode(country: string) {
  const normalized = country.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const codes: Record<string, string> = {
    brasil: "br", argentina: "ar", chile: "cl", uruguai: "uy", uruguay: "uy",
    paraguai: "py", paraguay: "py", bolivia: "bo", peru: "pe", colombia: "co",
    equador: "ec", ecuador: "ec",
  };
  return codes[normalized] || "br";
}

function setCors(request: any, response: any) {
  const origin = cleanText(request.headers?.origin, 200);
  if (allowedOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");
}

function destinationForDryRun(phone: string) {
  const checksum = [...phone].reduce((total, digit) => total + Number(digit || 0), 0);
  return WHATSAPP_DESTINATIONS[checksum % WHATSAPP_DESTINATIONS.length];
}

function buildWhatsappUrl(destination: string, language: string, name: string, academy: string) {
  const message = language === "es"
    ? `Hola, soy ${name}, de ${academy}. Envie mi inscripcion para Libertacademy Florianopolis 2027 y quiero hablar con el equipo.`
    : `Ola, sou ${name}, da ${academy}. Enviei minha inscricao para a Libertacademy Florianopolis 2027 e quero falar com a equipe.`;
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}

export default async function handler(request: any, response: any) {
  setCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const origin = cleanText(request.headers?.origin, 200);
  if (origin && !allowedOrigins.has(origin)) {
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
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < 700) {
      response.status(400).json({ error: "Form submitted too quickly" });
      return;
    }

    const name = cleanText(payload.name, 120);
    const academy = cleanText(payload.academy, 160);
    const email = cleanText(payload.email, 320).toLowerCase();
    const country = cleanText(payload.country, 80);
    const city = cleanText(payload.city, 120);
    const role = cleanText(payload.role, 80);
    const decisionMakerConfirmed = payload.decisionMakerConfirmed === true;
    const language = payload.language === "es" ? "es" : "pt";
    const dialCode = cleanText(payload.countryDialCode, 6) || "55";
    const phone = normalizePhone(payload.phone, dialCode);
    const categories = Array.isArray(payload.categories)
      ? payload.categories.map((item: unknown) => cleanText(item, 20)).filter(Boolean).slice(0, 4)
      : [];
    const athleteCount = Math.min(500, Math.max(1, Number(payload.athleteCount) || 1));
    const message = cleanText(payload.message, 1200);
    const eventId = cleanText(payload.eventId, 160) || `liberta-${Date.now()}-${phone}`;
    const dryRun = payload.dryRun === true;

    if (name.length < 2 || academy.length < 2) {
      response.status(400).json({ error: "Name and academy are required" });
      return;
    }
    if (!DECISION_MAKER_ROLES.has(role) || !decisionMakerConfirmed) {
      response.status(422).json({
        error: "Decision maker confirmation is required",
        code: "decision_maker_required",
      });
      return;
    }
    if (!isValidPhone(phone)) {
      response.status(400).json({ error: "Valid WhatsApp is required" });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      response.status(400).json({ error: "Valid email is required" });
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
      landingVariant: cleanText(payload.landingVariant, 120) || EVENT_SLUG,
      sourcePath: cleanText(payload.sourcePath, 200) || "/libertacademy-florianopolis/",
    };
    const trafficSource = traffic.utmSource || (traffic.fbclid ? "meta" : "site");
    const leadScore = Math.min(95, 82 + Math.min(8, athleteCount));
    const tags = [
      "libertacademy",
      "libertacademy_florianopolis_2027",
      "evento_b2b",
      "decisor_escola_confirmado",
      `cargo_${role}`,
      `idioma_${language}`,
      country ? `pais_${country.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "pais_nao_informado",
      ...(categories.length
        ? categories.map((category) => `categoria_${category.toLowerCase().replace(/\s+/g, "_")}`)
        : ["categoria_a_definir"]),
    ];
    const notes = [
      "INTERESSE LIBERTACADEMY FLORIANOPOLIS 2027",
      `Escola/escolinha/projeto: ${academy}`,
      `Responsavel: ${name}`,
      `Cargo: ${role || "Nao informado"}`,
      `Local: ${city || "Nao informado"} - ${country || "Nao informado"}`,
      `Categorias: ${categories.join(", ") || "A definir no atendimento"}`,
      `Quantidade estimada de atletas: ${payload.athleteCount ? athleteCount : "A definir no atendimento"}`,
      email ? `E-mail: ${email}` : "",
      message ? `Mensagem: ${message}` : "",
    ].filter(Boolean).join("\n");
    let routedWhatsapp: string = destinationForDryRun(phone);
    const attributionMetadata: Record<string, unknown> = {
      event: EVENT_SLUG,
      formType: "libertacademy_school_project_interest",
      academy,
      contactRole: role || null,
      decisionMakerConfirmed,
      persona: "football_school_project_owner_manager_v2",
      country: country || null,
      city: city || null,
      email: email || null,
      categories,
      athleteCount,
      language,
      sourcePath: traffic.sourcePath,
      landingVariant: traffic.landingVariant,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
    };
    let whatsappUrl = buildWhatsappUrl(routedWhatsapp, language, name, academy);

    if (dryRun) {
      response.status(200).json({
        ok: true,
        dryRun: true,
        normalizedPhone: phone,
        eventId,
        leadScore,
        tags,
        whatsappUrl,
        routedWhatsapp,
        metaReceived: false,
        queuedMessages: 0,
      });
      return;
    }

    const client = await pool.connect();
    let clientId = "";
    let queuedMessages = 0;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [EVENT_SLUG]);

      const existingRouting = await client.query(
        `
          select attribution_metadata ->> 'routedWhatsapp' as routed_whatsapp
          from public.clients
          where phone = $1
          limit 1
        `,
        [phone],
      );
      const previousDestination = cleanText(existingRouting.rows[0]?.routed_whatsapp, 20);
      if (WHATSAPP_DESTINATIONS.includes(previousDestination as typeof WHATSAPP_DESTINATIONS[number])) {
        routedWhatsapp = previousDestination;
      } else {
        const routingCount = await client.query(
          `
            select count(*)::int as total
            from public.clients
            where coalesce(tags, '{}') @> array['libertacademy_florianopolis_2027']::text[]
          `,
        );
        routedWhatsapp = WHATSAPP_DESTINATIONS[Number(routingCount.rows[0]?.total ?? 0) % WHATSAPP_DESTINATIONS.length];
      }
      attributionMetadata.routedWhatsapp = routedWhatsapp;
      attributionMetadata.routingStrategy = "server_round_robin_v1";
      whatsappUrl = buildWhatsappUrl(routedWhatsapp, language, name, academy);
      tags.push(routedWhatsapp === WHATSAPP_DESTINATIONS[0] ? "atendimento_liberta_1" : "atendimento_liberta_2");

      const result = await client.query(
        `
          with default_seller as (
            select id
            from public.sellers
            where active = true
            order by case when role = 'admin' then 0 else 1 end, created_at asc
            limit 1
          )
          insert into public.clients (
            phone, bot_instance_id, name, region, notes, service_interest, source, status,
            assigned_seller_id, tags, lead_score, traffic_source,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            fbclid, gclid, attribution_metadata, bot_paused, updated_at
          )
          values (
            $1, $16, $2, $3, $4, 'nao_definido', 'site', 'novo',
            (select id from default_seller), $5::text[], $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15::jsonb, true, now()
          )
          on conflict (phone)
          do update set
            name = coalesce(nullif(excluded.name, ''), public.clients.name),
            region = coalesce(nullif(excluded.region, ''), public.clients.region),
            notes = concat_ws(E'\n\n', nullif(public.clients.notes, ''), excluded.notes),
            source = 'site',
            assigned_seller_id = coalesce(public.clients.assigned_seller_id, excluded.assigned_seller_id),
            tags = (
              select array_agg(distinct merged_tag.tag)
              from unnest(coalesce(public.clients.tags, '{}'::text[]) || excluded.tags) as merged_tag(tag)
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
            bot_paused = true,
            updated_at = now()
          returning id
        `,
        [
          phone,
          name,
          country && country.toLowerCase() !== "brasil" ? "internacional" : "brasil",
          notes,
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
          MAIN_BOT_INSTANCE_ID,
        ],
      );
      clientId = result.rows[0]?.id;
      if (!clientId) throw new Error("Lead created without id");

      await client.query(
        `
          insert into public.traffic_events (
            client_id, bot_instance_id, phone, event_type, channel, platform,
            service_interest, lead_status, quality_score, metadata
          )
          values ($1, $2, $3, 'libertacademy_lead_submitted', 'site', 'whatsapp',
            'nao_definido', 'novo', $4, $5::jsonb)
        `,
        [clientId, MAIN_BOT_INSTANCE_ID, phone, leadScore, JSON.stringify(attributionMetadata)],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const sourceUrl = `${origin || "https://ec10talentos.com"}${traffic.sourcePath}`;
    const metaReceived = await sendMetaQualityEvent({
      clientId,
      phone,
      email: email || null,
      city: city || null,
      country: metaCountryCode(country),
      status: "novo",
      eventName: "Lead",
      serviceInterest: "libertacademy_florianopolis",
      leadScore,
      fbclid: traffic.fbclid || null,
      fbc: traffic.fbc || null,
      fbp: traffic.fbp || null,
      eventSourceUrl: sourceUrl,
      actionSource: "website",
      eventId,
      customData: {
        campaign_project: EVENT_SLUG,
        academy,
        contact_role: role,
        decision_maker_confirmed: true,
        persona: "football_school_project_owner_manager_v2",
        categories: categories.join("|"),
        athlete_count: athleteCount,
        language,
        landing_variant: traffic.landingVariant,
      },
    });

    await pool.query(
      `
        update public.clients
        set attribution_metadata = coalesce(attribution_metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = now()
        where id = $1
      `,
      [
        clientId,
        JSON.stringify({
          routedWhatsapp,
          metaEventId: eventId,
          metaLeadAccepted: metaReceived,
          metaLeadSentAt: new Date().toISOString(),
        }),
      ],
    );

    response.status(200).json({
      ok: true,
      clientId,
      queuedMessages,
      whatsappUrl,
      routedWhatsapp,
      eventId,
      metaReceived,
    });
  } catch (error) {
    console.error("Libertacademy public intake failed", error);
    response.status(500).json({ error: "Unable to register Libertacademy lead" });
  }
}
