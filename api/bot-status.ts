import { pool } from "./_db.js";

const oracleBaseUrl = process.env.BOT_ORACLE_BASE_URL?.replace(/\/$/, "") ?? "";
const staleAfterMs = Number(process.env.BOT_STATUS_STALE_SECONDS ?? 120) * 1000;

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRuntimeStatus() {
  if (!process.env.SUPABASE_DB_URL) return null;

  try {
    const { rows } = await pool.query(
      "select payload, updated_at from public.bot_runtime where key = 'bot_status' limit 1"
    );

    const row = rows[0];
    if (!row?.payload) return null;
    return normalizeStatus(row.payload, row.updated_at);
  } catch {
    return null;
  }
}

function normalizeStatus(payload: any, updatedAtFallback?: string | null) {
  const updatedAt = payload?.updatedAt ?? updatedAtFallback ?? null;
  return {
    ...payload,
    updatedAt,
    source: payload?.source ?? "runtime"
  };
}

function isFresh(status: any) {
  const updatedAt = status?.updatedAt;
  if (!updatedAt) return false;
  const timestamp = new Date(updatedAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= staleAfterMs;
}

function staleStatus(status: any) {
  return {
    status: "offline",
    updatedAt: status?.updatedAt ?? null,
    stale: true,
    source: status?.source ?? "runtime",
    message: "O bot nao envia heartbeat recente. Reinicie o bot para gerar um novo QR Code."
  };
}

export default async function handler(_request: unknown, response: any) {
  const runtimeStatus = await fetchRuntimeStatus();
  if (runtimeStatus && isFresh(runtimeStatus)) {
    response.setHeader("cache-control", "no-store");
    response.status(200).json(runtimeStatus);
    return;
  }

  try {
    if (!oracleBaseUrl) throw new Error("BOT_ORACLE_BASE_URL ausente");
    const upstream = await fetchWithTimeout(`${oracleBaseUrl}/status`);
    if (upstream.ok) {
      const payload = await upstream.json().catch(async () => ({ status: "unknown", message: await upstream.text() }));
      const liveStatus = normalizeStatus(payload, null);
      response.setHeader("cache-control", "no-store");
      response.status(200).json(isFresh(liveStatus) ? { ...liveStatus, source: "oracle" } : staleStatus({ ...liveStatus, source: "oracle" }));
      return;
    }
  } catch {
    // Fall back to the last runtime row below.
  }

  response.setHeader("cache-control", "no-store");
  response.status(200).json(runtimeStatus ? staleStatus(runtimeStatus) : {
    status: "offline",
    stale: true,
    source: "unavailable",
    message: "Bot indisponivel. Inicie o bot para gerar um novo QR Code."
  });
}
