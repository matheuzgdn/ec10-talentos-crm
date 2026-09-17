import crypto from "node:crypto";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;
const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
const pixelId = process.env.META_PIXEL_ID;
const capiToken = process.env.META_CAPI_ACCESS_TOKEN;
const metaToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const adAccountId = process.env.META_AD_ACCOUNT_ID;
const periodStart = "2026-06-24";
const today = new Date().toISOString().slice(0, 10);

if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const saoPauloDdds = new Set(["11", "12", "13", "14", "15", "16", "17", "18", "19"]);
const minasGeraisDdds = new Set(["31", "32", "33", "34", "35", "37", "38"]);

function cleanText(input, maxLength = 500) {
  const text = String(input ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeAscii(input) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input).trim().toLowerCase()).digest("hex");
}

function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeLocation(input) {
  const text = cleanText(input, 120);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function extractDdd(phone) {
  const digits = normalizePhone(phone) || "";
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  return national.length >= 10 ? national.slice(0, 2) : "";
}

function inferStateFromCity(city) {
  const normalized = normalizeAscii(city);
  if (!normalized) return null;
  if (/\bsp\b/.test(normalized) || normalized.includes("sao paulo") || normalized.includes("campinas") || normalized.includes("santos") || normalized.includes("sorocaba") || normalized.includes("ribeirao preto")) return "SP";
  if (/\bmg\b/.test(normalized) || normalized.includes("minas gerais") || normalized.includes("belo horizonte") || normalized.includes("contagem") || normalized.includes("betim") || normalized.includes("uberlandia") || normalized.includes("juiz de fora")) return "MG";
  return null;
}

function inferStateFromPhone(phone) {
  const ddd = extractDdd(phone);
  if (saoPauloDdds.has(ddd)) return "SP";
  if (minasGeraisDdds.has(ddd)) return "MG";
  return null;
}

function extractCityName(city) {
  const firstPart = String(city ?? "").split(/[-,/|]/)[0]?.trim() ?? "";
  if (!firstPart || firstPart.length < 2) return null;
  const normalized = normalizeAscii(firstPart);
  if (["sp", "mg", "brasil", "minas gerais", "sao paulo"].includes(normalized)) return null;
  return firstPart.slice(0, 80);
}

function resolveGeo(input) {
  const city = cleanText(input.city, 140) || "";
  const phone = cleanText(input.phone, 40) || "";
  const stateCode = inferStateFromCity(city) || inferStateFromPhone(phone);
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

function metadataObject(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function eventTimestamp(input) {
  const parsed = Date.parse(String(input ?? ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function buildFbc(fbclid, timestamp) {
  const clean = cleanText(fbclid, 240);
  return clean ? `fb.1.${timestamp}.${clean}` : null;
}

function buildPersona(row, metadata) {
  const role = cleanText(metadata.role, 80) || "";
  const age = Number(metadata.athleteAge ?? row.athlete_age ?? 0);
  if (role.toLowerCase().includes("respons") && age >= 13 && age <= 17) return "responsavel_atleta_13_17";
  if (role.toLowerCase().includes("respons")) return "responsavel_atleta";
  if (age >= 13 && age <= 17) return "atleta_13_17";
  return "triagem_plano_carreira";
}

async function sendCapiEvent(input) {
  if (!pixelId || !capiToken) return false;

  const eventTime = eventTimestamp(input.eventTime);
  const phone = normalizePhone(input.phone);
  const fbc = cleanText(input.fbc, 300) || buildFbc(input.fbclid, eventTime);
  const fbp = cleanText(input.fbp, 300);
  const city = normalizeLocation(input.city);
  const state = normalizeLocation(input.state);
  const country = normalizeLocation("BR");
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(capiToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: input.eventName,
            event_time: eventTime,
            event_id: input.eventId,
            action_source: input.eventSourceUrl ? "website" : "business_messaging",
            ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
            user_data: {
              ...(phone ? { ph: [sha256(phone)] } : {}),
              external_id: [sha256(input.clientId)],
              ...(city ? { ct: [sha256(city)] } : {}),
              ...(state ? { st: [sha256(state)] } : {}),
              ...(country ? { country: [sha256(country)] } : {}),
              ...(fbc ? { fbc } : {}),
              ...(fbp ? { fbp } : {})
            },
            custom_data: {
              lead_status: input.leadStatus,
              service_interest: "plano_carreira",
              lead_score: input.leadScore,
              source: "career_traffic_optimization",
              content_name: "EC10 Talentos",
              currency: "BRL",
              ...input.customData
            }
          }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  return response.ok;
}

async function metaGet(path, params = {}) {
  if (!metaToken) return null;
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  url.searchParams.set("access_token", metaToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) return null;
  return payload;
}

async function findMetaRegion(query) {
  const payload = await metaGet("search", {
    type: "adgeolocation",
    location_types: ["region"],
    country_code: "BR",
    q: query,
    limit: "10"
  });
  const rows = payload?.data ?? [];
  return rows.find((row) => normalizeAscii(row.name) === normalizeAscii(query)) ?? rows[0] ?? null;
}

async function ensureSpMgDraft(pool, targeting) {
  const name = `EC10 | Plano de Carreira | Responsaveis 13-17 | SP-MG | ${today}`;
  const destinationUrl = `https://ec10talentos.com/instagram?utm_source=meta&utm_medium=paid_social&utm_campaign=ec10-plano-carreira-sp-mg-${today}&utm_content={{ad.name}}&utm_term={{adset.name}}&origem=meta_ads&geo=sp-mg`;
  const existing = await pool.query(
    `
      select id, name, status
      from public.traffic_campaign_drafts
      where name = $1
      order by created_at desc
      limit 1
    `,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0];

  const metaPayload = {
    campaign: {
      name,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      buying_type: "AUCTION",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false
    },
    adset: {
      name: `${name} | Publico SP-MG`,
      optimization_goal: "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      daily_budget_cents: 4000,
      promoted_object: {
        pixel_id: pixelId || "{{META_PIXEL_ID}}",
        custom_event_type: "LEAD"
      },
      targeting
    },
    ad: {
      name: `${name} | Responsaveis`,
      destination_url: destinationUrl,
      body: "Seu filho joga futebol? A EC10 monta o plano de carreira com mentoria, evolucao e oportunidades reais."
    },
    safety: {
      publish_requires_manual_approval: true,
      created_as: "crm_draft_only",
      reason: "Foco SP/MG sem alterar conjunto ativo e sem reiniciar aprendizado atual."
    }
  };

  const { rows } = await pool.query(
    `
      insert into public.traffic_campaign_drafts
        (name, objective, status, platform, service_interest, budget_daily, budget_total,
         age_min, age_max, locations, interests, placements, destination_url,
         whatsapp_message, copy_text, creative_notes, ai_rationale, meta_payload)
      values
        ($1, 'OUTCOME_LEADS', 'approved', 'meta_ads', 'plano_carreira', 40, 200,
         30, 56, array['Sao Paulo', 'Minas Gerais']::text[],
         array['pais de atleta', 'futebol de base', 'escola de futebol', 'alto rendimento']::text[],
         array['instagram_reels', 'instagram_stories', 'instagram_feed', 'facebook_feed']::text[],
         $2, 'Ola, quero entender o Plano de Carreira EC10 para meu filho.',
         $3, $4, $5, $6::jsonb)
      returning id, name, status
    `,
    [
      name,
      destinationUrl,
      metaPayload.ad.body,
      "Criativo para pais/responsaveis de SP e MG; manter o mesmo aprendizado da LP e comparar qualidade dos agendamentos.",
      "Rascunho SP/MG criado para ampliar peso regional sem editar o conjunto ativo em aprendizado.",
      JSON.stringify(metaPayload)
    ]
  );

  return rows[0] ?? null;
}

async function main() {
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 10000
  });

  try {
    const [sandro, clientsResult, spRegion, mgRegion] = await Promise.all([
      pool.query("select id from public.sellers where active = true and lower(name) like '%sandro%' order by created_at asc limit 1"),
      pool.query(
        `
          select
            c.id,
            c.phone,
            c.name,
            c.status,
            c.region,
            c.tags,
            c.lead_score,
            c.fbclid,
            c.attribution_metadata,
            c.assigned_seller_id,
            s.role as assigned_seller_role,
            b.athlete_age,
            b.age_group,
            b.metadata as bot_metadata,
            b.metadata #>> '{meeting,startsAt}' as meeting_starts_at
          from public.clients c
          left join public.sellers s on s.id = c.assigned_seller_id
          left join public.bot_conversation_states b on b.client_id = c.id
          where c.created_at >= $1::timestamptz
            and c.service_interest = 'plano_carreira'
        `,
        [periodStart]
      ),
      findMetaRegion("Sao Paulo"),
      findMetaRegion("Minas Gerais")
    ]);

    const sandroId = sandro.rows[0]?.id ?? null;
    const stats = {
      scanned: clientsResult.rows.length,
      geoPriority: 0,
      regionUpdated: 0,
      statusUpdatedToMeeting: 0,
      reassignedToSandro: 0,
      idealSignalsInserted: 0,
      idealSignalsSent: 0,
      purchasesInserted: 0,
      purchasesSent: 0
    };

    for (const row of clientsResult.rows) {
      const metadata = metadataObject(row.attribution_metadata);
      const botMetadata = metadataObject(row.bot_metadata);
      const city = cleanText(metadata.city, 140) || cleanText(metadata.geoCity, 140) || "";
      const geo = resolveGeo({ city, phone: row.phone });
      const currentTags = Array.isArray(row.tags) ? row.tags : [];
      const mergedTags = Array.from(new Set([...currentTags, ...geo.tags]));
      const hasMeeting = Boolean(cleanText(row.meeting_starts_at, 80));
      const updateValues = [];
      const setParts = [];

      if (geo.isPriority) stats.geoPriority += 1;
      if (geo.region !== row.region && geo.isPriority) {
        updateValues.push(geo.region);
        setParts.push(`region = $${updateValues.length}`);
        stats.regionUpdated += 1;
      }

      if (mergedTags.length !== currentTags.length) {
        updateValues.push(mergedTags);
        setParts.push(`tags = $${updateValues.length}::text[]`);
      }

      if (hasMeeting && ["novo", "triagem"].includes(String(row.status))) {
        updateValues.push("orcamento");
        setParts.push(`status = $${updateValues.length}`);
        stats.statusUpdatedToMeeting += 1;
      }

      if (
        sandroId
        && ["novo", "triagem", "orcamento", "aguardando_cliente", "quente"].includes(String(row.status))
        && (!row.assigned_seller_id || row.assigned_seller_role === "admin")
      ) {
        updateValues.push(sandroId);
        setParts.push(`assigned_seller_id = $${updateValues.length}`);
        stats.reassignedToSandro += 1;
      }

      if (setParts.length) {
        updateValues.push(row.id);
        await pool.query(
          `
            update public.clients
            set ${setParts.join(", ")},
                attribution_metadata = coalesce(attribution_metadata, '{}'::jsonb) || $${updateValues.length + 1}::jsonb,
                updated_at = now()
            where id = $${updateValues.length}
          `,
          [
            ...updateValues,
            JSON.stringify({
              geoPriority: geo.priority,
              geoState: geo.stateCode,
              geoRegion: geo.region,
              geoCity: geo.city,
              trafficOptimizationAppliedAt: new Date().toISOString()
            })
          ]
        );
      }

      const age = Number(metadata.athleteAge ?? row.athlete_age ?? 0);
      const role = cleanText(metadata.role, 80) || "";
      const financialQualified = metadata.financialQualified === true || metadata.commercialPriority === true;
      const ideal = hasMeeting
        || financialQualified
        || ["orcamento", "quente", "fechado"].includes(String(row.status))
        || (role.toLowerCase().includes("respons") && age >= 13 && age <= 17);

      if (ideal) {
        const eventId = `crm-${row.id}-ideal-profile-v2`;
        const exists = await pool.query(
          "select 1 from public.traffic_events where client_id = $1 and metadata ->> 'eventId' = $2 limit 1",
          [row.id, eventId]
        );
        if (!exists.rows.length) {
          const persona = buildPersona(row, metadata);
          const customData = {
            persona,
            role: role || "nao_informado",
            athlete_age: Number.isFinite(age) ? age : 0,
            age_group: cleanText(metadata.ageGroup, 40) || row.age_group || "sem_faixa",
            financial_qualified: Boolean(financialQualified),
            ideal_customer_profile: true,
            geo_priority: geo.priority,
            geo_state: geo.stateCode ?? "nao_identificado",
            optimization_note: "retroalimentacao_cliente_ideal_sp_mg"
          };
          const capiSent = await sendCapiEvent({
            eventName: "QualifiedLead",
            eventId,
            clientId: row.id,
            phone: row.phone,
            leadStatus: "quente",
            leadScore: Math.max(85, Number(row.lead_score ?? 0)),
            fbclid: row.fbclid,
            fbc: metadata.fbc,
            fbp: metadata.fbp,
            city: geo.city || city,
            state: geo.stateCode,
            eventSourceUrl: metadata.eventSourceUrl || "https://ec10talentos.com/instagram",
            eventTime: new Date(),
            customData
          });
          await pool.query(
            `
              insert into public.traffic_events
                (client_id, phone, event_type, channel, platform, service_interest,
                 athlete_age, age_group, lead_status, quality_score, metadata)
              values
                ($1, $2, 'QualifiedLead', 'crm', 'meta_ads', 'plano_carreira',
                 $3, $4, 'quente', $5, $6::jsonb)
            `,
            [
              row.id,
              row.phone,
              Number.isFinite(age) && age > 0 ? age : null,
              customData.age_group,
              Math.max(85, Number(row.lead_score ?? 0)),
              JSON.stringify({
                source: "career_traffic_optimization_v2",
                eventId,
                capiSent,
                metaContext: customData,
                meetingStartsAt: row.meeting_starts_at || null
              })
            ]
          );
          stats.idealSignalsInserted += 1;
          if (capiSent) stats.idealSignalsSent += 1;
        }
      }

      if (String(row.status) === "fechado") {
        const eventId = `crm-${row.id}-purchase-ideal-v2`;
        const exists = await pool.query(
          "select 1 from public.traffic_events where client_id = $1 and metadata ->> 'eventId' = $2 limit 1",
          [row.id, eventId]
        );
        if (!exists.rows.length) {
          const capiSent = await sendCapiEvent({
            eventName: "Purchase",
            eventId,
            clientId: row.id,
            phone: row.phone,
            leadStatus: "fechado",
            leadScore: 100,
            fbclid: row.fbclid,
            fbc: metadata.fbc,
            fbp: metadata.fbp,
            city: geo.city || city,
            state: geo.stateCode,
            eventSourceUrl: metadata.eventSourceUrl || "https://ec10talentos.com/instagram",
            eventTime: new Date(),
            customData: {
              persona: buildPersona(row, metadata),
              ideal_customer_profile: true,
              geo_priority: geo.priority,
              geo_state: geo.stateCode ?? "nao_identificado",
              optimization_note: "compra_confirmada_cliente_ideal"
            }
          });
          await pool.query(
            `
              insert into public.traffic_events
                (client_id, phone, event_type, channel, platform, service_interest,
                 lead_status, quality_score, metadata)
              values
                ($1, $2, 'Purchase', 'crm', 'meta_ads', 'plano_carreira',
                 'fechado', 100, $3::jsonb)
            `,
            [
              row.id,
              row.phone,
              JSON.stringify({
                source: "career_traffic_optimization_v2",
                eventId,
                capiSent
              })
            ]
          );
          stats.purchasesInserted += 1;
          if (capiSent) stats.purchasesSent += 1;
        }
      }
    }

    const regionTargets = [spRegion, mgRegion]
      .filter(Boolean)
      .map((region) => ({ key: region.key }));
    const targeting = {
      geo_locations: regionTargets.length
        ? { countries: ["BR"], regions: regionTargets }
        : { countries: ["BR"] },
      age_min: 30,
      age_max: 56,
      publisher_platforms: ["facebook", "instagram"],
      targeting_automation: { advantage_audience: 1 }
    };
    const draft = await ensureSpMgDraft(pool, targeting);

    await pool.query(
      `
        insert into public.traffic_agent_recommendations
          (title, summary, recommendation_type, priority, status, confidence,
           impact_area, service_interest, age_group, reasoning, evidence, suggested_action)
        values
          ($1, $2, 'quality_signal', 'high', 'applied', 94,
           'meta_learning', 'plano_carreira', '13-17', $3, $4::jsonb, $5::jsonb)
      `,
      [
        "Foco SP/MG aplicado nos sinais do Plano de Carreira",
        "CRM reclassificou leads por DDD/cidade, corrigiu status de reuniao e reenviou sinais de cliente ideal para a Meta via CAPI.",
        "A Meta aprende melhor quando recebe eventos de qualidade com dados de correspondencia, persona e origem regional. A campanha ativa nao foi editada para evitar reinicio brusco de aprendizado.",
        JSON.stringify({ stats, spRegion: spRegion?.name ?? null, mgRegion: mgRegion?.name ?? null, draft }),
        JSON.stringify({
          activeCampaignTouched: false,
          reason: "Preservar aprendizado atual.",
          nextSafeAction: "Publicar rascunho SP/MG pausado ou ativar apos revisao no painel."
        })
      ]
    );

    console.log(JSON.stringify({
      ok: true,
      accountConfigured: Boolean(adAccountId),
      metaCapiConfigured: Boolean(pixelId && capiToken),
      regionTargetsFound: {
        saoPaulo: Boolean(spRegion),
        minasGerais: Boolean(mgRegion)
      },
      draft,
      stats
    }, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
