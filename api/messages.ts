import { ensureSeller, handleApiError } from "./_auth.js";
import { pool } from "./_db.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await ensureSeller(request, { requireActive: true });
    const clientId = String(request.query?.clientId ?? "");
    if (!clientId) {
      response.status(400).json({ error: "clientId is required" });
      return;
    }

    const { rows } = await pool.query(
      `
        select id, client_id, direction, body, media_type, media_path, whatsapp_message_id, created_at
        from public.messages
        where client_id = $1
        order by created_at asc
        limit 300
      `,
      [clientId]
    );

    response.setHeader("cache-control", "no-store");
    response.status(200).json({
      messages: rows.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        direction: row.direction,
        body: row.body,
        mediaType: row.media_type,
        mediaPath: row.media_path,
        whatsappMessageId: row.whatsapp_message_id,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    handleApiError(response, error);
  }
}
