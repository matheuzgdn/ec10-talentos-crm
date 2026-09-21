import crypto from "node:crypto";
import { pool } from "./_db.js";
import { inspectEurocampSaasSync, repairEurocampLatamPhoneMetadata, syncEurocampLatamLeads } from "./_ec10-saas-sync.js";

function authorized(request: any) {
  const expected = String(process.env.EC10_SAAS_REPAIR_TOKEN || "");
  const provided = String(request.headers?.["x-ec10-repair-token"] || "");
  if (!expected || !provided || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function cleanRelationship(value: unknown): "responsavel" | "atleta" | "nao_informado" {
  return value === "responsavel" || value === "atleta" ? value : "nao_informado";
}

export default async function handler(request: any, response: any) {
  response.setHeader("cache-control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!authorized(request)) {
    response.status(404).json({ error: "Not found" });
    return;
  }

  try {
    if (String(request.body?.action || "") === "phone-metadata") {
      const before = await inspectEurocampSaasSync();
      const repair = await repairEurocampLatamPhoneMetadata();
      const after = await inspectEurocampSaasSync();
      response.status(200).json({ ok: true, before, repair, after });
      return;
    }
    const { rows } = await pool.query(
      `
        select distinct on (c.id)
          c.id, c.name, c.phone, c.notes, c.attribution_metadata, c.created_at
        from whatsapp_bot.clients c
        join whatsapp_bot.traffic_events te on te.client_id = c.id
        where te.event_type = 'eurocamp_latam_simple_submitted'
        order by c.id, c.created_at asc
      `,
    );
    const inputs = rows.map((row: any) => {
      const attribution = row.attribution_metadata || {};
      return {
        contactName: String(row.name || `Lead ${row.phone}`),
        email: String(attribution.email || ""),
        phone: String(row.phone || ""),
        relationship: cleanRelationship(attribution.contactRole),
        notes: String(row.notes || ""),
        attribution,
        countryCode: String(attribution.countryCode || ""),
        countryDialCode: String(attribution.countryDialCode || ""),
      };
    }).filter((input: any) => input.phone);

    const before = await inspectEurocampSaasSync();
    if (String(request.body?.action || "inspect") !== "backfill") {
      response.status(200).json({ ok: true, sourceLeadCount: inputs.length, target: before });
      return;
    }

    const backfill = await syncEurocampLatamLeads(inputs);
    const after = await inspectEurocampSaasSync();
    response.status(200).json({ ok: true, sourceLeadCount: inputs.length, before, backfill, after });
  } catch (error) {
    console.error("Eurocamp SaaS repair failed", error instanceof Error ? error.message : String(error));
    response.status(500).json({ error: error instanceof Error ? error.message : "Repair failed" });
  }
}
