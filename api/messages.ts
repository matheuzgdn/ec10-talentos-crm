import { ensureSeller, handleApiError } from "./_auth.js";
import { pool } from "./_db.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request, { requireActive: true });
    const clientId = String(request.query?.clientId ?? "");
    if (!clientId) {
      response.status(400).json({ error: "clientId is required" });
      return;
    }

    const params = [clientId];
    const accessWhere = seller.role === "admin" ? "" : "and c.assigned_seller_id = $2";
    if (seller.role !== "admin") params.push(seller.id);

    const { rows } = await pool.query(
      `
        select
          m.id, m.client_id, m.bot_instance_id, m.direction, m.body, m.media_type, m.media_path,
          m.whatsapp_message_id, m.whatsapp_ack, m.whatsapp_ack_at, m.whatsapp_chat_id, m.created_at
        from public.messages m
        join public.clients c on c.id = m.client_id
        where m.client_id = $1
          ${accessWhere}
        order by m.created_at asc
        limit 300
      `,
      params
    );

    response.setHeader("cache-control", "no-store");
    response.status(200).json({
      messages: rows.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        botInstanceId: row.bot_instance_id,
        direction: row.direction,
        body: row.body,
        mediaType: row.media_type,
        mediaPath: row.media_path,
        whatsappMessageId: row.whatsapp_message_id,
        whatsappAck: row.whatsapp_ack,
        whatsappAckAt: row.whatsapp_ack_at,
        whatsappChatId: row.whatsapp_chat_id,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    handleApiError(response, error);
  }
}
