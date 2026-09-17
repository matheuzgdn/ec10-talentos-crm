import { ensureSeller, handleApiError } from "./_auth.js";
import { pool, mapClient } from "./_db.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await ensureSeller(request, { requireActive: true });
    const search = String(request.query?.search ?? "").trim();
    const service = String(request.query?.service ?? "").trim();
    const folder = String(request.query?.folder ?? "todos").trim();
    const params: string[] = [];
    const whereParts: string[] = [];

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

    if (folder === "revela") {
      whereParts.push(`coalesce(c.tags, '{}') @> array['campanha_revela_prioritario']::text[]`);
    } else if (folder === "ec10") {
      whereParts.push(`not (coalesce(c.tags, '{}') @> array['campanha_revela_prioritario']::text[])`);
    }

    const where = whereParts.length ? `where ${whereParts.join(" and ")}` : "";

    const { rows } = await pool.query(
      `
        select
          c.id,
          c.phone,
          c.name,
          c.status,
          c.region,
          c.service_interest,
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
        ${where}
        order by coalesce(c.last_message_at, c.created_at) desc
        limit 500
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
