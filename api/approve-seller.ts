import { ensureSeller, handleApiError } from "./_auth.js";
import { pool, mapSeller } from "./_db.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "PATCH") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller: admin } = await ensureSeller(request, { requireActive: true, requireAdmin: true });
    const { sellerId, active = true, role = "seller" } = request.body ?? {};

    if (!sellerId) {
      response.status(400).json({ error: "sellerId is required" });
      return;
    }

    if (!["admin", "seller"].includes(role)) {
      response.status(400).json({ error: "Invalid role" });
      return;
    }

    const { rows } = await pool.query(
      `
        update whatsapp_bot.sellers
        set active = $2,
            role = $3,
            approved_at = case when $2 then coalesce(approved_at, now()) else null end,
            approved_by = case when $2 then $4 else null end
        where id = $1
        returning id, auth_user_id, name, email, region, role, active, approved_at, created_at
      `,
      [sellerId, Boolean(active), role, admin.id]
    );

    if (!rows.length) {
      response.status(404).json({ error: "Seller not found" });
      return;
    }

    response.status(200).json({ seller: mapSeller(rows[0]) });
  } catch (error) {
    handleApiError(response, error);
  }
}
