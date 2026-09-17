import { ensureSeller, handleApiError } from "./_auth.js";
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

async function recordStatusTrafficEvent(input: { sellerId: string; row: any; status: string }) {
  const eventType = statusEventMap[input.status];
  if (!eventType) return;

  try {
    await pool.query(
      `
        insert into public.traffic_events
          (client_id, phone, event_type, channel, platform, service_interest,
           lead_status, quality_score, metadata)
        values
          ($1, $2, $3, 'crm', 'meta_ads', $4, $5, $6, $7::jsonb)
      `,
      [
        input.row.id,
        input.row.phone,
        eventType,
        input.row.service_interest,
        input.row.status,
        input.row.lead_score ?? null,
        JSON.stringify({
          source: "crm_status_update",
          sellerId: input.sellerId
        })
      ]
    );
  } catch (error) {
    console.warn("Failed to record traffic event", error instanceof Error ? error.message : String(error));
  }
}

export default async function handler(request: any, response: any) {
  if (request.method !== "PATCH") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request, { requireActive: true });
    const {
      clientId,
      status,
      botPaused,
      notes,
      region,
      serviceInterest,
      nextFollowUpAt,
      leadScore,
      assignedSellerId
    } = request.body ?? {};

    if (!clientId) {
      response.status(400).json({ error: "clientId is required" });
      return;
    }

    if (status && !allowedStatuses.has(status)) {
      response.status(400).json({ error: "Invalid status" });
      return;
    }

    const fields: string[] = [];
    const values: unknown[] = [clientId];

    if (status) {
      values.push(status);
      fields.push(`status = $${values.length}`);
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

    if (!fields.length) {
      response.status(400).json({ error: "No fields to update" });
      return;
    }

    values.push(new Date());
    fields.push(`updated_at = $${values.length}`);

    const { rows } = await pool.query(
      `
        update public.clients
        set ${fields.join(", ")}
        where id = $1
        returning id, phone, name, status, region, service_interest, source, assigned_seller_id, bot_paused, notes, tags,
                  next_follow_up_at, lead_score, traffic_source, traffic_campaign_id, traffic_campaign_name,
                  traffic_adset_id, traffic_ad_id, utm_source, utm_medium, utm_campaign, utm_content,
                  utm_term, fbclid, gclid, attribution_metadata, last_message_at, created_at
      `,
      values
    );

    if (!rows.length) {
      response.status(404).json({ error: "Client not found" });
      return;
    }

    if (status) {
      await recordStatusTrafficEvent({ sellerId: seller.id, row: rows[0], status });
      await sendMetaQualityEvent({
        clientId: rows[0].id,
        phone: rows[0].phone,
        status,
        serviceInterest: rows[0].service_interest,
        leadScore: rows[0].lead_score
      });
    }

    response.status(200).json({ client: mapClient(rows[0]) });
  } catch (error) {
    handleApiError(response, error);
  }
}
