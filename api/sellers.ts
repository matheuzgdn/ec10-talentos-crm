import { ensureSeller, handleApiError } from "./_auth.js";
import { pool, mapSeller } from "./_db.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await ensureSeller(request, { requireActive: true, requireAdmin: true });
    const { rows } = await pool.query(
      `
        select id, auth_user_id, name, email, region, role, active, approved_at, created_at
        from public.sellers
        order by active asc, created_at asc
      `
    );
    response.setHeader("cache-control", "no-store");
    response.status(200).json({ sellers: rows.map(mapSeller) });
  } catch (error) {
    handleApiError(response, error);
  }
}
