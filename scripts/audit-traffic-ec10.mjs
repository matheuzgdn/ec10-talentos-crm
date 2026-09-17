import pg from "pg";

const accountId = "act_1235838336986319";
const campaignId = "120246705254850601";
const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const pixelId = process.env.META_PIXEL_ID;
const capiToken = process.env.META_CAPI_ACCESS_TOKEN;
const dbUrl = process.env.SUPABASE_DB_URL;
const now = new Date();
const until = now.toISOString().slice(0, 10);
const sinceDate = new Date(now.getTime());
sinceDate.setDate(sinceDate.getDate() - 30);
const since = sinceDate.toISOString().slice(0, 10);

function n(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + n(row[key]), 0);
}

function actionValue(actions, names) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((item) => names.includes(String(item.action_type || "")))
    .reduce((highest, item) => Math.max(highest, n(item.value)), 0);
}

function parseBudgetCents(value) {
  const parsed = n(value);
  return parsed ? parsed / 100 : 0;
}

function shortError(error) {
  return error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400);
}

async function metaGet(path, params = {}) {
  if (!token) throw new Error("META_SYSTEM_USER_ACCESS_TOKEN ausente.");
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Meta HTTP ${response.status}`);
  return payload;
}

async function metaAll(path, params) {
  if (!token) throw new Error("META_SYSTEM_USER_ACCESS_TOKEN ausente.");
  const firstUrl = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    firstUrl.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  firstUrl.searchParams.set("access_token", token);

  let nextUrl = firstUrl.toString();
  const rows = [];
  while (nextUrl) {
    const response = await fetch(nextUrl, { signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(async () => ({ message: await response.text() }));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Meta HTTP ${response.status}`);
    rows.push(...(payload.data || []));
    nextUrl = payload.paging?.next || null;
  }
  return rows;
}

function landingScriptUrls(html, landingUrl) {
  const scripts = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi));
  return scripts
    .map((match) => {
      try {
        return new URL(match[1], landingUrl).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((url) => new URL(url).origin === new URL(landingUrl).origin)
    .slice(0, 12);
}

async function checkLanding() {
  const landingUrl = "https://ec10talentos.com/instagram";
  const result = {
    url: landingUrl,
    ok: false,
    status: 0,
    hasPixelId: false,
    hasFbq: false,
    bundleCount: 0,
    checkedBundles: []
  };

  try {
    const response = await fetch(landingUrl, { signal: AbortSignal.timeout(20000) });
    result.status = response.status;
    const html = await response.text();
    result.hasPixelId = Boolean(pixelId && html.includes(pixelId));
    result.hasFbq = /fbq\s*\(/i.test(html);
    const scripts = landingScriptUrls(html, landingUrl);
    result.bundleCount = scripts.length;

    for (const scriptUrl of scripts) {
      const scriptResponse = await fetch(scriptUrl, { signal: AbortSignal.timeout(20000) });
      if (!scriptResponse.ok) continue;
      const js = await scriptResponse.text();
      const hit = {
        path: new URL(scriptUrl).pathname,
        hasPixelId: Boolean(pixelId && js.includes(pixelId)),
        hasFbq: /fbq\s*\(/i.test(js),
        bytes: js.length
      };
      result.checkedBundles.push(hit);
      result.hasPixelId ||= hit.hasPixelId;
      result.hasFbq ||= hit.hasFbq;
    }

    result.ok = response.ok && result.hasPixelId && result.hasFbq;
  } catch (error) {
    result.error = shortError(error);
  }

  return result;
}

async function checkBot() {
  try {
    const response = await fetch("https://cliente-whatsapp-crm.vercel.app/api/bot-status", {
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(async () => ({ text: await response.text() }));
    return {
      ok: response.ok,
      httpStatus: response.status,
      status: payload.status ?? null,
      stale: payload.stale ?? null,
      source: payload.source ?? null,
      updatedAt: payload.updatedAt ?? null,
      message: payload.message ?? null
    };
  } catch (error) {
    return { ok: false, error: shortError(error) };
  }
}

async function query(pool, text, params = []) {
  return (await pool.query(text, params)).rows;
}

async function syncSnapshots(pool, campaign, insights) {
  await pool.query("begin");
  try {
    await pool.query(
      `
        delete from public.traffic_campaign_snapshots
        where account_id = $1
          and campaign_id = $2
          and date_start >= $3::date
          and date_end <= $4::date
      `,
      [accountId, campaignId, since, until]
    );

    for (const item of insights) {
      const actions = item.actions || [];
      await pool.query(
        `
          insert into public.traffic_campaign_snapshots
            (platform, account_id, campaign_id, campaign_name, adset_id, adset_name,
             ad_id, ad_name, status, date_start, date_end, spend, impressions, reach,
             clicks, conversations, leads, qualified_leads, proposals, purchases,
             ctr, cpc, cpl, cpql, raw_payload)
          values
            ('meta_ads', $1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date,
             $11::numeric, $12::integer, $13::integer, $14::integer, $15::integer,
             $16::integer, $17::integer, $18::integer, $19::integer,
             $20::numeric, $21::numeric,
             case when $16::integer > 0 then $11::numeric / $16::numeric else 0 end,
             case when $17::integer > 0 then $11::numeric / $17::numeric else 0 end,
             $22::jsonb)
        `,
        [
          accountId,
          item.campaign_id ?? null,
          item.campaign_name ?? null,
          item.adset_id ?? null,
          item.adset_name ?? null,
          item.ad_id ?? null,
          item.ad_name ?? null,
          campaign.effective_status ?? campaign.status ?? null,
          item.date_start,
          item.date_stop,
          n(item.spend),
          Math.round(n(item.impressions)),
          Math.round(n(item.reach)),
          Math.round(n(item.clicks)),
          Math.round(actionValue(actions, ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.messaging_first_reply"])),
          Math.round(actionValue(actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"])),
          Math.round(actionValue(actions, ["qualified_lead", "onsite_conversion.qualified_lead", "offsite_conversion.fb_pixel_qualified_lead"])),
          Math.round(actionValue(actions, ["schedule", "onsite_conversion.schedule", "offsite_conversion.fb_pixel_schedule"])),
          Math.round(actionValue(actions, ["purchase", "offsite_conversion.fb_pixel_purchase"])),
          n(item.ctr),
          n(item.cpc),
          JSON.stringify(item)
        ]
      );
    }
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function loadSupabaseContext(pool) {
  const [
    snapshotAgg,
    clients,
    attribution,
    events,
    meetings,
    sellers,
    recentRecommendations
  ] = await Promise.all([
    query(
      pool,
      `
        select max(created_at) last_synced_at, count(*)::int rows,
               sum(spend)::numeric(12,2) spend, sum(impressions)::int impressions,
               sum(clicks)::int clicks, sum(leads)::int leads,
               sum(qualified_leads)::int qualified_leads, sum(proposals)::int schedules,
               sum(purchases)::int purchases
        from public.traffic_campaign_snapshots
        where account_id = $1 and campaign_id = $2 and date_start >= $3::date
      `,
      [accountId, campaignId, since]
    ),
    query(
      pool,
      `
        select count(*)::int total,
               count(*) filter (where service_interest = 'plano_carreira')::int career,
               count(*) filter (where source = 'site')::int site,
               count(*) filter (where status = 'quente')::int hot,
               count(*) filter (where status = 'orcamento')::int proposals,
               count(*) filter (where status = 'fechado')::int closed
        from public.clients
        where created_at >= now() - interval '30 days'
      `
    ),
    query(
      pool,
      `
        select count(*) filter (where source = 'site')::int site_leads,
               count(*) filter (
                 where source = 'site'
                   and (
                     nullif(utm_source, '') is not null
                     or nullif(utm_campaign, '') is not null
                     or nullif(fbclid, '') is not null
                     or nullif(attribution_metadata ->> 'fbp', '') is not null
                     or nullif(attribution_metadata ->> 'fbc', '') is not null
                   )
               )::int attributed_site,
               count(*) filter (where nullif(attribution_metadata ->> 'fbp', '') is not null)::int fbp,
               count(*) filter (where nullif(attribution_metadata ->> 'fbc', '') is not null)::int fbc,
               count(*) filter (where nullif(fbclid, '') is not null)::int fbclid
        from public.clients
        where created_at >= now() - interval '30 days'
      `
    ),
    query(
      pool,
      `
        select event_type, count(*)::int total
        from public.traffic_events
        where occurred_at >= now() - interval '30 days'
          and event_type in ('qualified_lead', 'bot_meeting_scheduled', 'proposal_requested', 'purchase', 'QualifiedLead', 'Schedule', 'Purchase')
        group by event_type
        order by event_type
      `
    ),
    query(
      pool,
      `
        select coalesce(s.name, b.metadata #>> '{meetingSellerName}', 'Sem vendedor') seller_name,
               coalesce(c.service_interest, 'nao_definido') service_interest,
               count(*)::int total,
               min((b.metadata #>> '{meeting,startsAt}')::timestamptz) next_meeting
        from public.bot_conversation_states b
        join public.clients c on c.id = b.client_id
        left join public.sellers s on s.id = c.assigned_seller_id
        where nullif(b.metadata #>> '{meeting,startsAt}', '') is not null
          and (b.metadata #>> '{meeting,startsAt}') ~ '^\\d{4}-\\d{2}-\\d{2}'
          and (b.metadata #>> '{meeting,startsAt}')::timestamptz >= now()
          and (b.metadata #>> '{meeting,startsAt}')::timestamptz <= now() + interval '60 days'
        group by 1, 2
        order by 1, 2
      `
    ),
    query(
      pool,
      `
        select coalesce(s.name, 'Sem vendedor') seller_name,
               count(*)::int total,
               count(*) filter (where c.service_interest = 'plano_carreira')::int career
        from public.clients c
        left join public.sellers s on s.id = c.assigned_seller_id
        where c.created_at >= now() - interval '30 days'
        group by 1
        order by total desc
      `
    ),
    query(
      pool,
      `
        select title, priority, status, created_at
        from public.traffic_agent_recommendations
        where created_at >= now() - interval '24 hours'
        order by created_at desc
        limit 10
      `
    )
  ]);

  return {
    snapshotsSynced: snapshotAgg[0],
    clients30d: clients[0],
    attribution30d: attribution[0],
    events30d: events,
    futureMeetingsBySellerService: meetings,
    leadDistribution30d: sellers,
    recentRecommendations24h: recentRecommendations
  };
}

async function insertRecommendation(pool, report, anomaly) {
  const exists = await pool.query(
    `
      select id
      from public.traffic_agent_recommendations
      where created_at >= now() - interval '24 hours'
        and lower(title) = lower($1)
      limit 1
    `,
    [anomaly.title]
  );
  if (exists.rows.length) {
    report.recommendationsSkippedDuplicate = anomaly.title;
    return;
  }

  const inserted = await pool.query(
    `
      insert into public.traffic_agent_recommendations
        (title, summary, recommendation_type, priority, status, confidence,
         impact_area, service_interest, campaign_id, campaign_name,
         reasoning, evidence, suggested_action)
      values
        ($1, $2, 'traffic_audit', $3, 'pending_approval', 88,
         'meta_learning', 'plano_carreira', $4, $5, $6, $7::jsonb, $8::jsonb)
      returning id, title, priority, created_at
    `,
    [
      anomaly.title,
      anomaly.summary,
      anomaly.priority,
      campaignId,
      report.meta?.campaign?.name ?? "Plano de Carreira",
      `Anomalia detectada na auditoria EC10 de ${report.checkedAt}: ${anomaly.summary}.`,
      JSON.stringify({
        anomaly,
        meta: report.meta,
        site: report.site,
        bot: report.bot,
        capi: report.capi,
        supabase: report.supabase
      }),
      JSON.stringify({
        requiresHumanApproval: true,
        doNotChangeBudgetAutomatically: true,
        recommendedNextStep: "Revisar no Gerenciador Meta/CRM antes de alterar verba ou status."
      })
    ]
  );
  report.recommendationsInserted.push(inserted.rows[0]);
}

function buildAlerts(report) {
  const alerts = [];
  if (report.meta?.campaign && report.meta.campaign.effectiveStatus !== "ACTIVE") {
    alerts.push({
      key: "campaign_not_active",
      priority: "high",
      title: "Campanha Plano de Carreira inativa",
      summary: `Meta efetivo: ${report.meta.campaign.effectiveStatus}`
    });
  }
  if (report.meta?.insights && report.meta.insights.spend < 1 && report.meta.campaign?.effectiveStatus === "ACTIVE") {
    alerts.push({
      key: "active_no_spend",
      priority: "high",
      title: "Campanha ativa sem gasto relevante",
      summary: `Gasto 30d R$${report.meta.insights.spend}`
    });
  }
  if (report.meta?.insights && report.meta.insights.clicks > 20 && report.meta.insights.leads === 0) {
    alerts.push({
      key: "clicks_no_leads",
      priority: "high",
      title: "Cliques Meta sem leads reportados",
      summary: `${report.meta.insights.clicks} cliques e 0 leads Meta`
    });
  }
  if (!report.site.ok) {
    alerts.push({
      key: "landing_pixel_missing",
      priority: "urgent",
      title: "Pixel ausente na landing Instagram",
      summary: `Landing status ${report.site.status}, pixel=${report.site.hasPixelId}, fbq=${report.site.hasFbq}`
    });
  }
  if (!report.capi.configured) {
    alerts.push({
      key: "capi_not_configured",
      priority: "high",
      title: "CAPI incompleta no CRM",
      summary: "META_PIXEL_ID ou META_CAPI_ACCESS_TOKEN ausente"
    });
  }
  const healthyBotStatuses = new Set(["online", "ready", "authenticated"]);
  if (!healthyBotStatuses.has(String(report.bot?.status ?? "")) || report.bot?.stale) {
    alerts.push({
      key: "bot_not_online",
      priority: "urgent",
      title: "Bot publico nao esta online",
      summary: `status=${report.bot?.status ?? "indefinido"}, stale=${report.bot?.stale ?? "n/a"}`
    });
  }

  const eventCounts = Object.fromEntries((report.supabase?.events30d || []).map((item) => [item.event_type, n(item.total)]));
  const qualityEvents = n(eventCounts.qualified_lead)
    + n(eventCounts.QualifiedLead)
    + n(eventCounts.Schedule)
    + n(eventCounts.purchase)
    + n(eventCounts.Purchase);
  const meetingEvents = n(eventCounts.bot_meeting_scheduled);
  if (meetingEvents > 0 && qualityEvents === 0) {
    alerts.push({
      key: "quality_events_missing",
      priority: "high",
      title: "Eventos de qualidade nao chegam ao Meta",
      summary: `${meetingEvents} reunioes no CRM e 0 QualifiedLead/Schedule/Purchase em 30 dias`
    });
  }

  const attribution = report.supabase?.attribution30d || {};
  if (n(attribution.site_leads) > 0 && n(attribution.attributed_site) / n(attribution.site_leads) < 0.8) {
    alerts.push({
      key: "low_site_attribution",
      priority: "medium",
      title: "Atribuicao de leads do site baixa",
      summary: `${attribution.attributed_site}/${attribution.site_leads} leads do site com UTM/fbclid/fbp/fbc`
    });
  }
  return alerts;
}

const report = {
  checkedAt: now.toISOString(),
  period: { since, until },
  meta: {},
  supabase: {},
  site: {},
  bot: {},
  recommendationsInserted: []
};

let pool;
try {
  const [account, campaign, adsets, ads, insights] = await Promise.all([
    metaGet(accountId, { fields: "id,name,account_status,currency,timezone_name,amount_spent,balance" }),
    metaGet(campaignId, {
      fields: "id,name,status,effective_status,configured_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time"
    }),
    metaAll(`${campaignId}/adsets`, {
      fields: "id,name,status,effective_status,configured_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,optimization_goal,billing_event,updated_time",
      limit: "200"
    }),
    metaAll(`${campaignId}/ads`, {
      fields: "id,name,status,effective_status,configured_status,adset_id,updated_time",
      limit: "200"
    }),
    metaAll(`${accountId}/insights`, {
      level: "ad",
      fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,ctr,cpc,actions,date_start,date_stop",
      time_increment: "1",
      time_range: { since, until },
      filtering: [{ field: "campaign.id", operator: "IN", value: [campaignId] }],
      limit: "500"
    })
  ]);

  const leads = insights.reduce((total, row) => total + actionValue(row.actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]), 0);
  const qualified = insights.reduce((total, row) => total + actionValue(row.actions, ["qualified_lead", "onsite_conversion.qualified_lead", "offsite_conversion.fb_pixel_qualified_lead"]), 0);
  const schedules = insights.reduce((total, row) => total + actionValue(row.actions, ["schedule", "onsite_conversion.schedule", "offsite_conversion.fb_pixel_schedule"]), 0);
  const purchases = insights.reduce((total, row) => total + actionValue(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]), 0);
  const spend = sum(insights, "spend");
  const impressions = sum(insights, "impressions");
  const clicks = sum(insights, "clicks");
  const budgetTotal = parseBudgetCents(campaign.lifetime_budget)
    || adsets.reduce((total, row) => total + parseBudgetCents(row.lifetime_budget), 0)
    || parseBudgetCents(campaign.daily_budget) * 5
    || adsets.reduce((total, row) => total + parseBudgetCents(row.daily_budget), 0) * 5;

  report.meta = {
    account: {
      id: account.id,
      name: account.name,
      status: account.account_status,
      currency: account.currency,
      timezone: account.timezone_name
    },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      effectiveStatus: campaign.effective_status,
      configuredStatus: campaign.configured_status,
      objective: campaign.objective,
      lifetimeBudget: parseBudgetCents(campaign.lifetime_budget),
      dailyBudget: parseBudgetCents(campaign.daily_budget),
      budgetRemaining: parseBudgetCents(campaign.budget_remaining),
      startTime: campaign.start_time ?? null,
      stopTime: campaign.stop_time ?? null,
      updatedTime: campaign.updated_time ?? null
    },
    adsets: adsets.map((adset) => ({
      id: adset.id,
      name: adset.name,
      status: adset.status,
      effectiveStatus: adset.effective_status,
      configuredStatus: adset.configured_status,
      dailyBudget: parseBudgetCents(adset.daily_budget),
      lifetimeBudget: parseBudgetCents(adset.lifetime_budget),
      budgetRemaining: parseBudgetCents(adset.budget_remaining),
      optimizationGoal: adset.optimization_goal,
      updatedTime: adset.updated_time
    })),
    ads: ads.map((ad) => ({
      id: ad.id,
      name: ad.name,
      adsetId: ad.adset_id,
      status: ad.status,
      effectiveStatus: ad.effective_status,
      configuredStatus: ad.configured_status,
      updatedTime: ad.updated_time
    })),
    insights: {
      rows: insights.length,
      spend: Number(spend.toFixed(2)),
      impressions,
      clicks,
      ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      cpc: clicks ? Number((spend / clicks).toFixed(2)) : 0,
      leads,
      qualifiedLeads: qualified,
      schedules,
      purchases,
      plannedBudget: budgetTotal ? Number(budgetTotal.toFixed(2)) : null,
      spendVsBudgetPct: budgetTotal ? Number(((spend / budgetTotal) * 100).toFixed(1)) : null
    }
  };

  if (dbUrl) {
    pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 10000
    });
    await syncSnapshots(pool, campaign, insights);
    report.supabase = await loadSupabaseContext(pool);
  }
} catch (error) {
  report.meta.error = shortError(error);
}

report.site = await checkLanding();
report.bot = await checkBot();
report.capi = {
  configured: Boolean(pixelId && capiToken),
  pixelConfigured: Boolean(pixelId),
  tokenConfigured: Boolean(capiToken)
};
report.alerts = buildAlerts(report);

if (pool && report.alerts.length) {
  await insertRecommendation(pool, report, report.alerts[0]);
}
if (pool) await pool.end();

console.log(JSON.stringify(report, null, 2));
