import { pool } from "./_db.js";

const qrStaleAfterMs = Number(process.env.BOT_QR_STALE_SECONDS ?? 600) * 1000;

function isFresh(updatedAt: unknown) {
  if (!updatedAt) return false;
  const timestamp = new Date(String(updatedAt)).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= qrStaleAfterMs;
}

async function fetchRuntimeStatus() {
  if (!process.env.SUPABASE_DB_URL) return null;

  try {
    const { rows } = await pool.query(
      "select payload, updated_at from public.bot_runtime where key = 'bot_status' limit 1"
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchRuntimeQr() {
  if (!process.env.SUPABASE_DB_URL) return null;

  try {
    const { rows } = await pool.query(
      "select payload, updated_at from public.bot_runtime where key = 'whatsapp_qr' limit 1"
    );
    const row = rows[0];
    if (!isFresh(row?.payload?.updatedAt ?? row?.updated_at)) return null;

    const qrDataUrl = row?.payload?.qrDataUrl;
    if (typeof qrDataUrl !== "string") return null;

    const match = qrDataUrl.match(/^data:image\/png;base64,(.+)$/);
    return match ? Buffer.from(match[1], "base64") : null;
  } catch {
    return null;
  }
}

export default async function handler(_request: unknown, response: any) {
  const runtimeStatus = await fetchRuntimeStatus();
  if (runtimeStatus && isFresh(runtimeStatus.payload?.updatedAt ?? runtimeStatus.updated_at) && runtimeStatus.payload?.status === "ready") {
    response.status(404).json({ error: "QR not required while bot is connected" });
    return;
  }

  const runtimeQr = await fetchRuntimeQr();
  if (runtimeQr) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "image/png");
    response.status(200).send(runtimeQr);
    return;
  }

  response.status(404).json({ error: "QR not available" });
}
