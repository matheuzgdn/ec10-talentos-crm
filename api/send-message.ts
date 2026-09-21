import { ensureSeller, handleApiError } from "./_auth.js";
import { pool } from "./_db.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request, { requireActive: true });
    const { clientId, body, mediaType = "text", mediaPath = null } = request.body ?? {};
    if (!clientId || (!body && !mediaPath)) {
      response.status(400).json({ error: "clientId and body or mediaPath are required" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");

      const clientResult = await client.query(
        `
          select id, phone, bot_instance_id
          from whatsapp_bot.clients
          where id = $1
            and ($2::boolean or assigned_seller_id = $3)
          for update
        `,
        [clientId, seller.role === "admin", seller.id]
      );

      if (!clientResult.rowCount) {
        response.status(404).json({ error: "Client not found" });
        await client.query("rollback");
        return;
      }

      const phone = String(clientResult.rows[0].phone ?? "").trim();
      const botInstanceId = String(clientResult.rows[0].bot_instance_id ?? "main");
      if (!phone) {
        response.status(400).json({ error: "Este lead nao tem identificador de WhatsApp valido para envio." });
        await client.query("rollback");
        return;
      }
      const outbound = await client.query(
        `
          insert into whatsapp_bot.outbound_messages (client_id, bot_instance_id, phone, body, media_type, media_path, status)
          values ($1, $6, $2, $3, $4, $5, 'queued')
          returning id, created_at
        `,
        [clientId, phone, body ?? null, mediaType, mediaPath, botInstanceId]
      );

      await client.query(
        `
          insert into whatsapp_bot.traffic_events
            (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
          values
            ($1, $2, $3, 'seller_reply_queued', 'crm', 'whatsapp', $4::jsonb)
        `,
        [
          clientId,
          botInstanceId,
          phone,
          JSON.stringify({
            botInstanceId,
            sellerId: seller.id,
            mediaType
          })
        ]
      ).catch((error) => {
        console.warn("Failed to record traffic event", error instanceof Error ? error.message : String(error));
      });

      await client.query("commit");

      response.status(200).json({
        queued: true,
        outboundMessageId: outbound.rows[0].id,
        createdAt: outbound.rows[0].created_at
      });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    handleApiError(response, error);
  }
}
