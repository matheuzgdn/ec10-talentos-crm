import { ensureSeller, handleApiError } from "./_auth.js";
import { pool, mapClient } from "./_db.js";

async function handleFormSubmissions(request: any, response: any, seller: any) {
  const search = String(request.query?.search ?? "").trim();
  const page = String(request.query?.page ?? "todas").trim();
  const params: string[] = [];
  const whereParts: string[] = ["c.page_variant is not null"];

  if (page === "site_a" || page === "site_b") {
    params.push(page);
    whereParts.push(`c.page_variant = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    whereParts.push(`
      (
        c.phone ilike $${params.length}
        or coalesce(c.name, '') ilike $${params.length}
        or coalesce(c.athlete_name, '') ilike $${params.length}
        or coalesce(c.seller_name, '') ilike $${params.length}
        or coalesce(c.campaign_name, '') ilike $${params.length}
      )
    `);
  }

  if (seller.role !== "admin") {
    params.push(seller.id);
    whereParts.push(`c.assigned_seller_id = $${params.length}`);
  }

  const where = `where ${whereParts.join(" and ")}`;
  const { rows } = await pool.query(
    `
      with base as (
        select
          c.*,
          s.name as seller_name,
          coalesce(nullif(c.traffic_campaign_name, ''), nullif(c.utm_campaign, '')) as campaign_name,
          coalesce(
            nullif(c.attribution_metadata ->> 'athleteName', ''),
            nullif(c.attribution_metadata ->> 'athlete_name', '')
          ) as athlete_name,
          case
            when lower(coalesce(c.attribution_metadata ->> 'sourcePath', '')) like '%cadastro-plano-carreira%'
              or lower(coalesce(c.attribution_metadata ->> 'eventSourceUrl', '')) like '%cadastro-plano-carreira%'
              or coalesce(c.tags, '{}') @> array['lp_cadastro_plano_carreira']::text[]
              or lower(coalesce(c.attribution_metadata ->> 'landingVariant', '')) like '%career_plan_full%'
              or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%career_plan_full%'
              or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%career_plan_registration%'
              then 'site_b'
            when lower(coalesce(c.attribution_metadata ->> 'sourcePath', '')) like '%/instagram%'
              or lower(coalesce(c.attribution_metadata ->> 'eventSourceUrl', '')) like '%/instagram%'
              or coalesce(c.tags, '{}') && array['lp_instagram', 'instagram', 'lead_instagram', 'origem_instagram']::text[]
              or lower(coalesce(c.attribution_metadata ->> 'landingVariant', '')) like '%instagram%'
              or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%instagram%'
              or lower(coalesce(c.attribution_metadata ->> 'landingVariant', '')) like '%quick_form%'
              then 'site_a'
            else null
          end as page_variant
        from public.clients c
        left join public.sellers s on s.id = c.assigned_seller_id
        where c.source = 'site'
          and not (coalesce(c.tags, '{}') @> array['campanha_revela_prioritario']::text[])
      )
      select
        c.id,
        c.name,
        c.phone,
        c.status::text,
        c.service_interest,
        c.assigned_seller_id,
        c.seller_name,
        c.tags,
        c.lead_score,
        c.created_at,
        c.updated_at,
        c.last_message_at,
        c.page_variant,
        coalesce(c.campaign_name, nullif(la.campaign_name, '')) as campaign_name,
        coalesce(
          nullif(c.attribution_metadata ->> 'eventSourceUrl', ''),
          nullif(la.landing_url, ''),
          nullif(b.lead_page_url, ''),
          nullif(c.attribution_metadata ->> 'sourcePath', '')
        ) as landing_url,
        coalesce(
          nullif(c.attribution_metadata ->> 'sourcePath', ''),
          nullif(c.attribution_metadata ->> 'page_path', ''),
          nullif(c.attribution_metadata ->> 'eventSourceUrl', '')
        ) as source_path,
        coalesce(
          nullif(c.attribution_metadata ->> 'landingVariant', ''),
          nullif(c.attribution_metadata ->> 'formVariant', '')
        ) as form_variant,
        coalesce(
          nullif(c.attribution_metadata ->> 'role', ''),
          nullif(b.metadata ->> 'role', ''),
          nullif(b.role_answer, '')
        ) as role_answer,
        coalesce(
          nullif(c.athlete_name, ''),
          nullif(b.metadata ->> 'athleteName', '')
        ) as athlete_name,
        coalesce(
          nullif(c.attribution_metadata ->> 'investmentRange', ''),
          nullif(b.metadata ->> 'investmentRange', '')
        ) as investment_range,
        coalesce(
          nullif(c.attribution_metadata ->> 'videoMaterialStatus', ''),
          nullif(b.metadata ->> 'videoMaterialStatus', '')
        ) as video_material_status,
        coalesce(
          nullif(c.attribution_metadata ->> 'financialQualified', ''),
          nullif(b.metadata ->> 'financialQualified', '')
        ) as financial_qualified,
        coalesce(
          nullif(c.attribution_metadata ->> 'commercialPriority', ''),
          nullif(b.metadata ->> 'commercialPriority', '')
        ) as commercial_priority,
        b.stage as bot_stage,
        b.athlete_age,
        b.age_group,
        b.metadata #>> '{meeting,startsAt}' as meeting_starts_at,
        b.metadata #>> '{meetingSellerName}' as meeting_seller_name,
        coalesce(outbound.sent, 0)::int as whatsapp_sent,
        coalesce(outbound.queued, 0)::int as whatsapp_queued,
        coalesce(outbound.failed, 0)::int as whatsapp_failed,
        coalesce(outbound.cancelled, 0)::int as whatsapp_cancelled,
        outbound.last_sent_at,
        outbound.last_error,
        coalesce(messages.confirmed, 0)::int as confirmed_messages,
        coalesce(messages.unconfirmed, 0)::int as unconfirmed_messages
      from base c
      left join lateral (
        select *
        from public.bot_conversation_states
        where client_id = c.id
        order by updated_at desc
        limit 1
      ) b on true
      left join lateral (
        select *
        from public.lead_attribution
        where client_id = c.id
        order by last_touch_at desc nulls last, updated_at desc nulls last
        limit 1
      ) la on true
      left join lateral (
        select
          count(*) filter (where status = 'sent') as sent,
          count(*) filter (where status = 'queued') as queued,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where status = 'cancelled') as cancelled,
          max(sent_at) as last_sent_at,
          (
            array_agg(error_message order by coalesce(sent_at, created_at) desc)
            filter (where status in ('failed', 'cancelled') and nullif(error_message, '') is not null)
          )[1] as last_error
        from public.outbound_messages
        where client_id = c.id
      ) outbound on true
      left join lateral (
        select
          count(*) filter (where direction = 'outbound' and coalesce(whatsapp_ack, -1) >= 1) as confirmed,
          count(*) filter (where direction = 'outbound' and coalesce(whatsapp_ack, -1) < 1) as unconfirmed
        from public.messages
        where client_id = c.id
      ) messages on true
      ${where}
      order by c.created_at desc
      limit 800
    `,
    params
  );

  response.setHeader("cache-control", "no-store");
  response.status(200).json({
    submissions: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      serviceInterest: row.service_interest ?? "nao_definido",
      assignedSellerId: row.assigned_seller_id,
      sellerName: row.seller_name,
      tags: row.tags ?? [],
      leadScore: row.lead_score ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      pageVariant: row.page_variant,
      campaignName: row.campaign_name,
      landingUrl: row.landing_url,
      sourcePath: row.source_path,
      formVariant: row.form_variant,
      roleAnswer: row.role_answer,
      athleteName: row.athlete_name,
      investmentRange: row.investment_range,
      videoMaterialStatus: row.video_material_status,
      financialQualified: row.financial_qualified,
      commercialPriority: row.commercial_priority,
      botStage: row.bot_stage,
      athleteAge: row.athlete_age,
      ageGroup: row.age_group,
      meetingStartsAt: row.meeting_starts_at,
      meetingSellerName: row.meeting_seller_name,
      whatsappSent: row.whatsapp_sent,
      whatsappQueued: row.whatsapp_queued,
      whatsappFailed: row.whatsapp_failed,
      whatsappCancelled: row.whatsapp_cancelled,
      lastSentAt: row.last_sent_at,
      lastError: row.last_error,
      confirmedMessages: row.confirmed_messages,
      unconfirmedMessages: row.unconfirmed_messages
    }))
  });
}

async function handleLibertacademySubmissions(request: any, response: any, seller: any) {
  const search = String(request.query?.search ?? "").trim();
  const destination = String(request.query?.destination ?? "todos").replace(/\D/g, "");
  const params: string[] = [];
  const whereParts = [
    `coalesce(c.tags, '{}') @> array['libertacademy_florianopolis_2027']::text[]`
  ];

  if (search) {
    params.push(`%${search}%`);
    whereParts.push(`(
      c.phone ilike $${params.length}
      or coalesce(c.name, '') ilike $${params.length}
      or coalesce(c.attribution_metadata ->> 'academy', '') ilike $${params.length}
      or coalesce(c.attribution_metadata ->> 'country', '') ilike $${params.length}
      or coalesce(c.utm_campaign, '') ilike $${params.length}
    )`);
  }

  if (destination && destination !== "todos") {
    params.push(destination);
    whereParts.push(`c.attribution_metadata ->> 'routedWhatsapp' = $${params.length}`);
  }

  if (seller.role !== "admin") {
    params.push(seller.id);
    whereParts.push(`c.assigned_seller_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `
      select
        c.id,
        c.name,
        c.phone,
        c.status::text,
        c.assigned_seller_id,
        s.name as seller_name,
        c.lead_score,
        c.created_at,
        c.updated_at,
        c.utm_source,
        c.utm_medium,
        c.utm_campaign,
        c.utm_content,
        c.attribution_metadata ->> 'academy' as academy,
        c.attribution_metadata ->> 'country' as country,
        c.attribution_metadata ->> 'contactRole' as contact_role,
        coalesce((c.attribution_metadata ->> 'decisionMakerConfirmed')::boolean, false) as decision_maker_confirmed,
        c.attribution_metadata -> 'categories' as categories,
        case
          when coalesce(c.attribution_metadata ->> 'athleteCount', '') ~ '^\d+$'
            then (c.attribution_metadata ->> 'athleteCount')::int
          else null
        end as athlete_count,
        c.attribution_metadata ->> 'language' as language,
        c.attribution_metadata ->> 'routedWhatsapp' as routed_whatsapp,
        c.attribution_metadata ->> 'routingStrategy' as routing_strategy,
        c.attribution_metadata ->> 'metaEventId' as meta_event_id,
        coalesce((c.attribution_metadata ->> 'metaLeadAccepted')::boolean, false) as meta_lead_accepted,
        coalesce(outbound.sent, 0)::int as whatsapp_sent,
        coalesce(outbound.queued, 0)::int as whatsapp_queued,
        coalesce(outbound.failed, 0)::int as whatsapp_failed,
        coalesce(messages.confirmed, 0)::int as confirmed_messages,
        b.metadata #>> '{meeting,startsAt}' as meeting_starts_at
      from public.clients c
      left join public.sellers s on s.id = c.assigned_seller_id
      left join lateral (
        select
          count(*) filter (where status = 'sent') as sent,
          count(*) filter (where status = 'queued') as queued,
          count(*) filter (where status = 'failed') as failed
        from public.outbound_messages
        where client_id = c.id
      ) outbound on true
      left join lateral (
        select count(*) filter (where direction = 'outbound' and coalesce(whatsapp_ack, -1) >= 1) as confirmed
        from public.messages
        where client_id = c.id
      ) messages on true
      left join lateral (
        select metadata
        from public.bot_conversation_states
        where client_id = c.id
        order by updated_at desc
        limit 1
      ) b on true
      where ${whereParts.join(" and ")}
      order by c.created_at desc
      limit 1000
    `,
    params
  );

  response.setHeader("cache-control", "no-store");
  response.status(200).json({
    submissions: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      assignedSellerId: row.assigned_seller_id,
      sellerName: row.seller_name,
      leadScore: row.lead_score ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      academy: row.academy,
      country: row.country,
      contactRole: row.contact_role,
      decisionMakerConfirmed: row.decision_maker_confirmed,
      categories: Array.isArray(row.categories) ? row.categories : [],
      athleteCount: row.athlete_count,
      language: row.language === "es" ? "es" : "pt",
      routedWhatsapp: row.routed_whatsapp,
      routingStrategy: row.routing_strategy,
      metaEventId: row.meta_event_id,
      metaLeadAccepted: row.meta_lead_accepted,
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      utmContent: row.utm_content,
      whatsappSent: row.whatsapp_sent,
      whatsappQueued: row.whatsapp_queued,
      whatsappFailed: row.whatsapp_failed,
      confirmedMessages: row.confirmed_messages,
      meetingStartsAt: row.meeting_starts_at
    }))
  });
}

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request, { requireActive: true });
    if (String(request.query?.forms ?? "") === "1") {
      await handleFormSubmissions(request, response, seller);
      return;
    }
    if (String(request.query?.libertacademy ?? "") === "1") {
      await handleLibertacademySubmissions(request, response, seller);
      return;
    }

    const search = String(request.query?.search ?? "").trim();
    const service = String(request.query?.service ?? "").trim();
    const campaign = String(request.query?.campaign ?? "").trim();
    const campaignsMode = String(request.query?.campaigns ?? "") === "1";
    const folder = String(request.query?.folder ?? "todos").trim();
    const bucket = String(request.query?.bucket ?? "ativos").trim();
    const sellerId = String(request.query?.sellerId ?? "todos").trim();
    const origin = String(request.query?.origin ?? "todas").trim();
    const params: string[] = [];
    const whereParts: string[] = [];
    const campaignKeyExpression = `(
      case
        when coalesce(c.tags, '{}') && array['libertacademy', 'libertacademy_florianopolis_2027']::text[]
          or lower(coalesce(c.attribution_metadata ->> 'formType', '')) like '%libertacademy%'
          then 'libertacademy'
        when coalesce(c.tags, '{}') && array['academy_sudamerica', 'academy_sudamerica_x1_2026']::text[]
          or lower(coalesce(c.traffic_campaign_name, '')) like '%sudamerica%'
          or lower(coalesce(c.utm_campaign, '')) like '%sudamerica%'
          then 'academy_sudamerica'
        when coalesce(c.tags, '{}') && array['eurocamp', 'eurocamp_lista_espera_2027']::text[]
          or lower(coalesce(c.attribution_metadata ->> 'formType', '')) like '%eurocamp%'
          or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%eurocamp%'
          then 'eurocamp'
        when coalesce(c.tags, '{}') && array['mentoria_prime', 'mentoria_prime_bot_ativo']::text[]
          then 'mentoria_prime'
        when c.service_interest = 'plano_internacional' then 'plano_internacional'
        when c.service_interest = 'plano_carreira' then 'plano_carreira'
        else 'outros'
      end
    )`;
    const trafficAttributedExpression = `(
      c.source = 'site'
      or nullif(c.traffic_source, '') is not null
      or nullif(c.traffic_campaign_name, '') is not null
      or nullif(c.utm_source, '') is not null
      or nullif(c.utm_campaign, '') is not null
      or nullif(c.fbclid, '') is not null
      or nullif(c.gclid, '') is not null
      or coalesce(c.tags, '{}') && array[
        'plano_carreira', 'plano_internacional', 'mentoria_prime',
        'eurocamp', 'eurocamp_lista_espera_2027',
        'libertacademy', 'libertacademy_florianopolis_2027',
        'academy_sudamerica', 'academy_sudamerica_x1_2026'
      ]::text[]
    )`;
    const archiveExpression = `(
      c.created_at < date '2026-06-20'
      or coalesce(c.tags, '{}') && array['crm_arquivado', 'crm_arquivado_pre_2026_06_20', 'crm_excluido_manual']::text[]
    )`;
    const meetingRecordExpression = `(
      nullif(b.meeting_starts_at, '') is not null
      or coalesce(c.tags, '{}') && array[
        'bot_meeting_scheduled',
        'reuniao_agendada',
        'ec10_reuniao_agendada',
        'mentoria_prime_reuniao_agendada'
      ]::text[]
    )`;

    if (search) {
      params.push(`%${search}%`);
      whereParts.push(`
        (
          c.phone ilike $${params.length}
          or coalesce(c.name, '') ilike $${params.length}
          or coalesce(c.region, '') ilike $${params.length}
          or coalesce(c.notes, '') ilike $${params.length}
          or coalesce(c.service_interest, '') ilike $${params.length}
        )
      `);
    }

    if (service && service !== "todos") {
      params.push(service);
      whereParts.push(`c.service_interest = $${params.length}`);
    }

    if (campaignsMode) {
      whereParts.push(trafficAttributedExpression);
      if (campaign && campaign !== "todos") {
        params.push(campaign);
        whereParts.push(`${campaignKeyExpression} = $${params.length}`);
      }
    }

    if (folder === "revela") {
      whereParts.push(`coalesce(c.tags, '{}') @> array['campanha_revela_prioritario']::text[]`);
    } else if (folder === "ec10") {
      whereParts.push(`not (coalesce(c.tags, '{}') @> array['campanha_revela_prioritario']::text[])`);
    }

    if (origin === "site_a") {
      whereParts.push(`
        (
          c.source = 'site'
          and (
            lower(coalesce(c.attribution_metadata ->> 'sourcePath', '')) like '%/instagram%'
            or lower(coalesce(c.attribution_metadata ->> 'eventSourceUrl', '')) like '%/instagram%'
            or (
              lower(coalesce(c.attribution_metadata ->> 'sourcePath', '')) not like '%cadastro-plano-carreira%'
              and lower(coalesce(c.attribution_metadata ->> 'eventSourceUrl', '')) not like '%cadastro-plano-carreira%'
              and (
                lower(coalesce(c.attribution_metadata ->> 'landingVariant', '')) like '%instagram%'
                or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%instagram%'
                or coalesce(c.tags, '{}') && array['lp_instagram', 'instagram', 'lead_instagram', 'origem_instagram']::text[]
              )
            )
          )
        )
      `);
    } else if (origin === "site_b") {
      whereParts.push(`
        (
          c.source = 'site'
          and (
            lower(coalesce(c.attribution_metadata ->> 'sourcePath', '')) like '%cadastro-plano-carreira%'
            or lower(coalesce(c.attribution_metadata ->> 'eventSourceUrl', '')) like '%cadastro-plano-carreira%'
            or (
              lower(coalesce(c.attribution_metadata ->> 'sourcePath', '')) not like '%/instagram%'
              and lower(coalesce(c.attribution_metadata ->> 'eventSourceUrl', '')) not like '%/instagram%'
              and (
                coalesce(c.tags, '{}') @> array['lp_cadastro_plano_carreira']::text[]
                or lower(coalesce(c.attribution_metadata ->> 'landingVariant', '')) like '%career_plan_full%'
                or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%career_plan_full%'
                or lower(coalesce(c.attribution_metadata ->> 'formVariant', '')) like '%career_plan_registration%'
              )
            )
          )
        )
      `);
    } else if (origin === "instagram") {
      whereParts.push(`
        (
          lower(coalesce(c.utm_source, '')) like '%instagram%'
          or lower(coalesce(c.traffic_source, '')) like '%instagram%'
          or lower(coalesce(c.utm_medium, '')) like '%instagram%'
          or lower(coalesce(c.source, '')) like '%instagram%'
          or coalesce(c.tags, '{}') && array['instagram', 'lead_instagram', 'origem_instagram']::text[]
        )
      `);
    }

    if (seller.role !== "admin") {
      params.push(seller.id);
      whereParts.push(`c.assigned_seller_id = $${params.length}`);
    } else if (sellerId && sellerId !== "todos") {
      params.push(sellerId);
      whereParts.push(`c.assigned_seller_id = $${params.length}`);
    }

    if (bucket === "arquivados") {
      whereParts.push(archiveExpression);
    } else if (bucket !== "todos") {
      whereParts.push(`not ${archiveExpression}`);
      if (bucket === "agendados") {
        whereParts.push(meetingRecordExpression);
      } else if (bucket === "sem_agenda") {
        whereParts.push(`not ${meetingRecordExpression}`);
      }
    }

    const where = whereParts.length ? `where ${whereParts.join(" and ")}` : "";

    const { rows } = await pool.query(
      `
        select
          c.id,
          c.phone,
          c.bot_instance_id,
          c.name,
          c.status,
          c.region,
          c.service_interest,
          ${campaignKeyExpression} as campaign_key,
          c.source,
          c.assigned_seller_id,
          c.bot_paused,
          c.notes,
          c.tags,
          c.next_follow_up_at,
          c.lead_score,
          c.traffic_source,
          c.traffic_campaign_id,
          c.traffic_campaign_name,
          c.traffic_adset_id,
          c.traffic_ad_id,
          c.utm_source,
          c.utm_medium,
          c.utm_campaign,
          c.utm_content,
          c.utm_term,
          c.fbclid,
          c.gclid,
          c.attribution_metadata,
          c.last_message_at,
          c.created_at,
          b.meeting_starts_at,
          b.meeting_ends_at,
          b.meeting_seller_name,
          b.meeting_meet_url,
          m.body as last_message_body,
          m.direction as last_message_direction,
          m.media_type as last_message_media_type,
          m.created_at as last_message_created_at
        from public.clients c
        left join lateral (
          select body, direction, media_type, created_at
          from public.messages
          where client_id = c.id
          order by created_at desc
          limit 1
        ) m on true
        left join lateral (
          select
            metadata #>> '{meeting,startsAt}' as meeting_starts_at,
            metadata #>> '{meeting,endsAt}' as meeting_ends_at,
            coalesce(metadata #>> '{meetingSellerName}', metadata #>> '{sellerName}') as meeting_seller_name,
            coalesce(metadata #>> '{meetingMeetUrl}', metadata #>> '{meeting,meetUrl}') as meeting_meet_url
          from public.bot_conversation_states
          where client_id = c.id
          order by updated_at desc
          limit 1
        ) b on true
        ${where}
        order by coalesce(c.last_message_at, c.created_at) desc
        limit ${campaignsMode ? 1500 : 500}
      `,
      params
    );

    response.setHeader("cache-control", "no-store");
    response.status(200).json({
      clients: rows.map((row) => ({
        ...mapClient(row),
        lastMessage: row.last_message_created_at
          ? {
              body: row.last_message_body,
              direction: row.last_message_direction,
              mediaType: row.last_message_media_type,
              createdAt: row.last_message_created_at
            }
          : null
      }))
    });
  } catch (error) {
    handleApiError(response, error);
  }
}
