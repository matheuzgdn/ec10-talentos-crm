import { ensureSeller, handleApiError, HttpError } from "./_auth.js";
import { pool, mapClient } from "./_db.js";
import { sendMetaQualityEvent } from "./_meta.js";

const allowedStatuses = new Set([
  "novo",
  "triagem",
  "orcamento",
  "aguardando_cliente",
  "quente",
  "fechado",
  "perdido"
]);

const statusEventMap: Record<string, string> = {
  triagem: "lead_triage",
  orcamento: "proposal_requested",
  aguardando_cliente: "follow_up_pending",
  quente: "qualified_lead",
  fechado: "purchase",
  perdido: "lost_lead"
};

const campaignAutomationTags = [
  "campanha_revela_prioritario",
  "campanha_revela_enquete_enviada",
  "campanha_revela_igor_enviado"
];

const serviceNames: Record<string, string> = {
  plano_carreira: "Plano de Carreira EC10",
  plano_internacional: "Plano Internacional EC10",
  ambos: "Plano EC10",
  nao_definido: "servico EC10"
};

const serviceMetaProfile: Record<string, { productId: string; tier: string; category: string; audience: string }> = {
  plano_carreira: {
    productId: "carreira",
    tier: "entrada",
    category: "planejamento_de_carreira_no_futebol",
    audience: "atleta_8_mais_e_responsavel"
  },
  plano_internacional: {
    productId: "temporada",
    tier: "premium_individual",
    category: "avaliacao_internacional_direta_em_clubes",
    audience: "atleta_20_25_e_familia"
  },
  ambos: {
    productId: "portfolio_ec10",
    tier: "multiplos_produtos",
    category: "assessoria_de_carreira_e_mobilidade_esportiva",
    audience: "atleta_e_familia"
  },
  nao_definido: {
    productId: "nao_definido",
    tier: "nao_definido",
    category: "assessoria_esportiva",
    audience: "atleta_e_familia"
  }
};

const statusMetaEventMap: Record<string, string> = {
  novo: "Lead",
  triagem: "Lead",
  orcamento: "Schedule",
  quente: "QualifiedLead",
  fechado: "Purchase",
  perdido: "DisqualifiedLead"
};

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

function resolveBrazilTrafficGeo(input: { city?: string | null; phone?: string | null }) {
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

function phoneResetCandidates(input: string | null | undefined) {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const candidates = new Set<string>();
  if (raw) candidates.add(raw);
  if (digits) {
    candidates.add(digits);
    candidates.add(`+${digits}`);
    if (digits.startsWith("55")) {
      const national = digits.slice(2);
      if (national.length === 11 && national[2] === "9") {
        const withoutNine = `55${national.slice(0, 2)}${national.slice(3)}`;
        candidates.add(withoutNine);
        candidates.add(`+${withoutNine}`);
      }
      if (national.length === 10) {
        const withNine = `55${national.slice(0, 2)}9${national.slice(2)}`;
        candidates.add(withNine);
        candidates.add(`+${withNine}`);
      }
    }
  }
  return [...candidates];
}

function cleanVideoUrls(input: unknown) {
  if (!Array.isArray(input)) return null;
  const urls = input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .filter((item) => {
      try {
        const url = new URL(item);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    })
    .slice(0, 8);
  return urls;
}

function appendTags(fields: string[], values: unknown[], tags: string[]) {
  if (!tags.length) return;
  values.push(tags);
  fields.push(`
    tags = coalesce((
      select array_agg(distinct tag order by tag)
      from unnest(coalesce(whatsapp_bot.clients.tags, '{}'::text[]) || $${values.length}::text[]) as merged(tag)
    ), '{}'::text[])
  `);
}

function buildAdhesionMessage(input: { leadName: string | null; athleteName: string | null; serviceInterest: string | null }) {
  const serviceName = serviceNames[input.serviceInterest ?? "nao_definido"] ?? serviceNames.nao_definido;
  const name = input.athleteName || input.leadName || "tudo bem";
  return [
    `Ola, ${name}! Passando para agradecer pela confirmacao da adesao ao ${serviceName}.`,
    "A partir de agora a equipe EC10 vai acompanhar o seu processo com mais proximidade, organizando as proximas orientacoes e os passos combinados para evoluir com clareza.",
    "Estamos felizes em ter voce com a gente. Qualquer duvida, pode responder por aqui que seguimos acompanhando tudo pelo WhatsApp."
  ].join("\n\n");
}

function metadataText(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function buildMetaEventContext(row: any, attribution: Record<string, unknown>, eventName: string) {
  const geo = resolveBrazilTrafficGeo({
    city: metadataText(attribution, "city", "geoCity"),
    phone: row.phone
  });
  const role = metadataText(attribution, "role") || "nao_informado";
  const athleteAge = Number(attribution.athleteAge ?? 0);
  const ageGroup = metadataText(attribution, "ageGroup") || "sem_faixa";
  const serviceInterest = String(row.service_interest || "nao_definido");
  const serviceProfile = serviceMetaProfile[serviceInterest] ?? serviceMetaProfile.nao_definido;
  const funnelStage = eventName === "Purchase"
    ? "purchase"
    : eventName === "Proposal"
      ? "proposal"
    : eventName === "Schedule"
      ? "meeting_scheduled"
      : eventName === "QualifiedLead"
        ? "qualified_lead"
        : eventName === "DisqualifiedLead"
          ? "disqualified"
          : "lead";
  const persona = role.toLowerCase().includes("respons")
    && Number.isFinite(athleteAge)
    && athleteAge >= 13
    && athleteAge <= 17
      ? "responsavel_atleta_13_17"
      : role.toLowerCase().includes("respons")
        ? "responsavel_atleta"
        : "cliente_fechado_ec10";

  return {
    city: geo.city || metadataText(attribution, "city", "geoCity") || null,
    state: geo.stateCode,
    customData: {
      persona,
      role,
      athlete_age: Number.isFinite(athleteAge) ? athleteAge : 0,
      age_group: ageGroup,
      geo_priority: geo.priority,
      geo_state: geo.stateCode ?? "nao_identificado",
      ideal_customer_profile: eventName === "Purchase" || eventName === "QualifiedLead",
      event_kind: eventName,
      funnel_stage: funnelStage,
      funnel_key: metadataText(attribution, "funnelKey") || "crm_ec10",
      business_model: "assessoria_de_carreira_e_mobilidade_esportiva",
      product_id: serviceProfile.productId,
      product_name: serviceNames[serviceInterest] ?? serviceNames.nao_definido,
      content_name: serviceNames[serviceInterest] ?? serviceNames.nao_definido,
      content_type: "product",
      product_tier: serviceProfile.tier,
      content_category: serviceProfile.category,
      audience_profile: serviceProfile.audience,
      beneficiary: "atleta_de_futebol",
      buyer_role: role,
      campaign_id: (row.traffic_campaign_id ?? metadataText(attribution, "campaignId")) || "nao_informado",
      adset_id: (row.traffic_adset_id ?? metadataText(attribution, "adsetId")) || "nao_informado",
      ad_id: (row.traffic_ad_id ?? metadataText(attribution, "adId")) || "nao_informado",
      utm_campaign: row.utm_campaign ?? "nao_informado",
      utm_content: row.utm_content ?? "nao_informado",
      utm_term: row.utm_term ?? "nao_informado",
      placement: metadataText(attribution, "placement") || "nao_informado",
      site_source_name: metadataText(attribution, "siteSourceName") || "nao_informado",
      optimization_note: `${funnelStage}_${serviceInterest}`
    }
  };
}

async function recordStatusTrafficEvent(input: { sellerId: string; row: any; status: string }) {
  const eventType = statusEventMap[input.status];
  if (!eventType) return;

  try {
    const attribution = input.row.attribution_metadata && typeof input.row.attribution_metadata === "object"
      ? input.row.attribution_metadata
      : {};

    await pool.query(
      `
        insert into whatsapp_bot.traffic_events
          (client_id, bot_instance_id, phone, event_type, channel, platform, service_interest,
           lead_status, quality_score, campaign_id, campaign_name, adset_id, ad_id,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           fbclid, gclid, metadata)
        values
          ($1, $2, $3, $4, 'crm', 'meta_ads', $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
      `,
      [
        input.row.id,
        input.row.bot_instance_id ?? "main",
        input.row.phone,
        eventType,
        input.row.service_interest,
        input.row.status,
        input.row.lead_score ?? null,
        input.row.traffic_campaign_id ?? null,
        input.row.traffic_campaign_name ?? null,
        input.row.traffic_adset_id ?? null,
        input.row.traffic_ad_id ?? null,
        input.row.utm_source ?? null,
        input.row.utm_medium ?? null,
        input.row.utm_campaign ?? null,
        input.row.utm_content ?? null,
        input.row.utm_term ?? null,
        input.row.fbclid ?? null,
        input.row.gclid ?? null,
        JSON.stringify({
          botInstanceId: input.row.bot_instance_id ?? "main",
          source: "crm_status_update",
          sellerId: input.sellerId,
          eventSourceUrl: attribution.eventSourceUrl ?? null,
          fbp: attribution.fbp ?? null,
          fbc: attribution.fbc ?? null
        })
      ]
    );
  } catch (error) {
    console.warn("Failed to record traffic event", error instanceof Error ? error.message : String(error));
  }
}

export default async function handler(request: any, response: any) {
  if (!["PATCH", "DELETE"].includes(request.method)) {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request, { requireActive: true });
    if (request.method === "DELETE") {
      const clientId = String(request.query?.clientId ?? request.body?.clientId ?? "").trim();
      if (!clientId) {
        response.status(400).json({ error: "clientId is required" });
        return;
      }

      const { rows } = await pool.query(
        `
          delete from whatsapp_bot.clients
          where id = $1
            and ($2::boolean or assigned_seller_id = $3)
          returning id
        `,
        [clientId, seller.role === "admin", seller.id]
      );

      if (!rows.length) {
        response.status(404).json({ error: "Lead nao encontrado ou sem permissao." });
        return;
      }

      response.status(200).json({ deleted: true, clientId });
      return;
    }

    const {
      clientId,
      status,
      botPaused,
      resetBot,
      notes,
      region,
      serviceInterest,
      nextFollowUpAt,
      leadScore,
      assignedSellerId,
      athleteName,
      athleteVideoUrls,
      archiveClient,
      confirmAdhesion
    } = request.body ?? {};

    if (!clientId) {
      response.status(400).json({ error: "clientId is required" });
      return;
    }

    if (resetBot === true) {
      const database = await pool.connect();
      try {
        await database.query("begin");

        const target = await database.query(
          `
            select id, phone, bot_instance_id
            from whatsapp_bot.clients
            where id = $1
              and ($2::boolean or assigned_seller_id = $3)
            for update
          `,
          [clientId, seller.role === "admin", seller.id]
        );

        const row = target.rows[0];
        if (!row) {
          await database.query("rollback");
          response.status(404).json({ error: "Client not found" });
          return;
        }
        const resetPhoneCandidates = phoneResetCandidates(row.phone);
        const botInstanceId = String(row.bot_instance_id ?? "main");

        await database.query(
          `
            delete from whatsapp_bot.bot_conversation_states
            where bot_instance_id = $3
              and (
                client_id = $1
                or phone = any($2::text[])
              )
          `,
          [row.id, resetPhoneCandidates, botInstanceId]
        );

        await database.query(
          `
            update whatsapp_bot.outbound_messages
            set status = 'cancelled',
                error_message = coalesce(error_message, 'Cancelado pelo reset manual do bot.'),
                sent_at = null
            where client_id = $1
              and bot_instance_id = $2
              and status = 'queued'
          `,
          [row.id, botInstanceId]
        );

        await database.query(
          `
            delete from whatsapp_bot.bot_dedupe_locks
            where client_id = $1
               or phone = any($2::text[])
               or exists (
                 select 1
                 from unnest($2::text[]) as candidate(phone)
                 where whatsapp_bot.bot_dedupe_locks.key like '%' || candidate.phone || '%'
               )
          `,
          [row.id, resetPhoneCandidates]
        );

        const updated = await database.query(
          `
            update whatsapp_bot.clients
            set bot_paused = false,
                tags = coalesce((
                  select array_agg(distinct tag order by tag)
                  from unnest(coalesce(whatsapp_bot.clients.tags, '{}'::text[])) as tag
                  where not (tag = any($2::text[]))
                ), '{}'::text[]),
                updated_at = now()
            where id = $1
            returning id, phone, name, status, region, service_interest, source, assigned_seller_id, bot_paused, notes, tags,
                      next_follow_up_at, lead_score, traffic_source, traffic_campaign_id, traffic_campaign_name,
                      traffic_adset_id, traffic_ad_id, utm_source, utm_medium, utm_campaign, utm_content,
                      utm_term, fbclid, gclid, attribution_metadata, bot_instance_id, last_message_at, created_at
          `,
          [row.id, campaignAutomationTags]
        );

        await database.query("commit");
        response.status(200).json({ client: mapClient(updated.rows[0]) });
        return;
      } catch (error) {
        await database.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        database.release();
      }
    }

    if (status && !allowedStatuses.has(status)) {
      response.status(400).json({ error: "Invalid status" });
      return;
    }

    if (seller.role !== "admin" && (typeof assignedSellerId === "string" || assignedSellerId === null)) {
      throw new HttpError(403, "Somente administrador pode transferir lead para outro vendedor.");
    }

    const fields: string[] = [];
    const values: unknown[] = [clientId];
    const metadataPatch: Record<string, unknown> = {};
    let finalStatusForEvent: string | null = null;

    if (confirmAdhesion === true) {
      values.push("fechado");
      fields.push(`status = $${values.length}`);
      finalStatusForEvent = "fechado";
      values.push(100);
      fields.push(`lead_score = $${values.length}`);
      metadataPatch.adhesionConfirmedAt = new Date().toISOString();
      metadataPatch.adhesionConfirmedBySellerId = seller.id;
      appendTags(fields, values, ["adesao_confirmada", "cliente_ideal_meta"]);
    } else if (status) {
      values.push(status);
      fields.push(`status = $${values.length}`);
      finalStatusForEvent = status;
    }

    if (typeof botPaused === "boolean") {
      values.push(botPaused);
      fields.push(`bot_paused = $${values.length}`);
    }

    if (typeof notes === "string") {
      values.push(notes);
      fields.push(`notes = $${values.length}`);
    }

    if (typeof region === "string") {
      values.push(region || null);
      fields.push(`region = $${values.length}`);
    }

    if (typeof serviceInterest === "string") {
      values.push(serviceInterest || "nao_definido");
      fields.push(`service_interest = $${values.length}`);
    }

    if (typeof nextFollowUpAt === "string" || nextFollowUpAt === null) {
      values.push(nextFollowUpAt || null);
      fields.push(`next_follow_up_at = $${values.length}`);
    }

    if (typeof leadScore === "number") {
      values.push(Math.max(0, Math.min(100, Math.round(leadScore))));
      fields.push(`lead_score = $${values.length}`);
    }

    if (typeof assignedSellerId === "string" || assignedSellerId === null) {
      values.push(assignedSellerId || null);
      fields.push(`assigned_seller_id = $${values.length}`);
    }

    if (typeof athleteName === "string") {
      metadataPatch.athleteName = athleteName.trim() || null;
    }

    const videoUrls = cleanVideoUrls(athleteVideoUrls);
    if (videoUrls) {
      metadataPatch.athleteVideoUrls = videoUrls;
    }

    if (archiveClient === true) {
      metadataPatch.archivedAt = new Date().toISOString();
      metadataPatch.archiveReason = "manual_crm";
      appendTags(fields, values, ["crm_arquivado"]);
    }

    if (Object.keys(metadataPatch).length) {
      values.push(JSON.stringify(metadataPatch));
      fields.push(`attribution_metadata = coalesce(whatsapp_bot.clients.attribution_metadata, '{}'::jsonb) || $${values.length}::jsonb`);
    }

    if (!fields.length) {
      response.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(new Date());
    fields.push(`updated_at = $${values.length}`);

    let accessWhere = "";
    if (seller.role !== "admin") {
      values.push(seller.id);
      accessWhere = `and assigned_seller_id = $${values.length}`;
    }

    const { rows } = await pool.query(
      `
        update whatsapp_bot.clients
        set ${fields.join(", ")}
        where id = $1
          ${accessWhere}
        returning id, phone, name, status, region, service_interest, source, assigned_seller_id, bot_paused, notes, tags,
                  next_follow_up_at, lead_score, traffic_source, traffic_campaign_id, traffic_campaign_name,
                  traffic_adset_id, traffic_ad_id, utm_source, utm_medium, utm_campaign, utm_content,
                  utm_term, fbclid, gclid, attribution_metadata, bot_instance_id, last_message_at, created_at
      `,
      values
    );

    if (!rows.length) {
      response.status(404).json({ error: "Client not found" });
      return;
    }

    if (confirmAdhesion === true) {
      const row = rows[0];
      const attribution = row.attribution_metadata && typeof row.attribution_metadata === "object"
        ? row.attribution_metadata
        : {};
      const body = buildAdhesionMessage({
        leadName: row.name,
        athleteName: typeof attribution.athleteName === "string" ? attribution.athleteName : null,
        serviceInterest: row.service_interest
      });
      const botInstanceId = String(row.bot_instance_id ?? "main");

      await pool.query(
        `
          insert into whatsapp_bot.outbound_messages (client_id, bot_instance_id, phone, body, media_type, status)
          values ($1, $4, $2, $3, 'text', 'queued')
        `,
        [row.id, row.phone, body, botInstanceId]
      );
    }

    if (finalStatusForEvent) {
      await recordStatusTrafficEvent({ sellerId: seller.id, row: rows[0], status: finalStatusForEvent });
      const attribution = rows[0].attribution_metadata && typeof rows[0].attribution_metadata === "object"
        ? rows[0].attribution_metadata
        : {};
      const metaEventName = confirmAdhesion === true
        ? "Purchase"
        : attribution.funnelKey === "ec10_campaign_landing_pages" && finalStatusForEvent === "orcamento"
          ? "Proposal"
          : statusMetaEventMap[finalStatusForEvent];
      if (metaEventName) {
        const metaEventContext = buildMetaEventContext(rows[0], attribution, metaEventName);

      await sendMetaQualityEvent({
        clientId: rows[0].id,
        phone: rows[0].phone,
        email: metadataText(attribution, "email") || null,
        status: finalStatusForEvent,
        eventName: metaEventName,
        serviceInterest: rows[0].service_interest,
        leadScore: confirmAdhesion === true ? 100 : rows[0].lead_score,
        fbclid: rows[0].fbclid,
        fbc: attribution.fbc,
        fbp: attribution.fbp,
        city: metaEventContext.city,
        state: metaEventContext.state,
        country: metadataText(attribution, "countryCode") || "BR",
        eventSourceUrl: attribution.eventSourceUrl,
        actionSource: confirmAdhesion === true ? "business_messaging" : "system_generated",
        eventId: confirmAdhesion === true ? `crm-${rows[0].id}-purchase-confirmed` : undefined,
        customData: metaEventContext.customData
      });
      }
    }

    response.status(200).json({ client: mapClient(rows[0]) });
  } catch (error) {
    handleApiError(response, error);
  }
}
