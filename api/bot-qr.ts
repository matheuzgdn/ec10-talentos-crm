import { pool } from "./_db.js";
import { bookingPool } from "./_booking-db.js";

const oracleBaseUrl = process.env.BOT_ORACLE_BASE_URL ?? "http://147.15.27.235:3001";
const qrStaleAfterMs = Number(process.env.BOT_QR_STALE_SECONDS ?? 600) * 1000;
const mainBotInstanceId = "main";

function normalizeInstanceId(input: unknown) {
  const value = String(input ?? mainBotInstanceId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return value || mainBotInstanceId;
}

function runtimeKey(baseKey: string, instanceId: string) {
  return instanceId === mainBotInstanceId ? baseKey : `${baseKey}:${instanceId}`;
}

function isFresh(updatedAt: unknown) {
  if (!updatedAt) return false;
  const timestamp = new Date(String(updatedAt)).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= qrStaleAfterMs;
}

async function fetchOracleQr() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetch(`${oracleBaseUrl}/qr.png`, {
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRuntimeStatus(instanceId: string) {
  if (!process.env.SUPABASE_DB_URL) return null;

  try {
    const { rows } = await pool.query(
      "select payload, updated_at from public.bot_runtime where key = $1 limit 1",
      [runtimeKey("bot_status", instanceId)]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchRuntimeQr(instanceId: string) {
  try {
    const { rows } = await bookingPool.query(
      "select payload, updated_at from whatsapp_bot.bot_runtime where key = $1 limit 1",
      [runtimeKey("whatsapp_qr", instanceId)]
    );
    return decodeRuntimeQr(rows[0]);
  } catch {
    if (!process.env.SUPABASE_DB_URL) return null;
    try {
      const { rows } = await pool.query(
        "select payload, updated_at from public.bot_runtime where key = $1 limit 1",
        [runtimeKey("whatsapp_qr", instanceId)]
      );
      return decodeRuntimeQr(rows[0]);
    } catch {
      return null;
    }
  }
}

function decodeRuntimeQr(row: any) {
  if (!isFresh(row?.payload?.updatedAt ?? row?.updated_at)) return null;
  const qrDataUrl = row?.payload?.qrDataUrl;
  if (typeof qrDataUrl !== "string") return null;
  const match = qrDataUrl.match(/^data:image\/png;base64,(.+)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}

export default async function handler(request: any, response: any) {
  const instanceId = normalizeInstanceId(request?.query?.instanceId);
  const runtimeStatus = await fetchRuntimeStatus(instanceId);
  if (runtimeStatus && isFresh(runtimeStatus.payload?.updatedAt ?? runtimeStatus.updated_at) && runtimeStatus.payload?.status === "ready") {
    response.status(404).json({ error: "QR not required while bot is connected" });
    return;
  }

  if (instanceId === mainBotInstanceId) {
    try {
      const upstream = await fetchOracleQr();
      if (upstream.ok) {
        response.setHeader("cache-control", "no-store");
        response.setHeader("content-type", upstream.headers.get("content-type") || "image/png");
        response.status(200).send(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
    } catch {
      // Fall back to the most recent database snapshot.
    }
  }

  const runtimeQr = await fetchRuntimeQr(instanceId);
  if (runtimeQr) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "image/png");
    response.status(200).send(runtimeQr);
    return;
  }

  response.status(404).json({ error: "QR not available" });
}
