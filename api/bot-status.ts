import { pool } from "./_db.js";
import { bookingPool } from "./_booking-db.js";
import botLabHandler from "./_bot-lab.js";

export const maxDuration = 60;

const oracleBaseUrl = process.env.BOT_ORACLE_BASE_URL ?? "http://147.15.27.235:3001";
const staleAfterMs = Number(process.env.BOT_STATUS_STALE_SECONDS ?? 300) * 1000;
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

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRuntimeStatus(instanceId: string) {
  try {
    const { rows } = await bookingPool.query(
      "select payload, updated_at from whatsapp_bot.bot_runtime where key = $1 limit 1",
      [runtimeKey("bot_status", instanceId)]
    );

    const row = rows[0];
    if (!row?.payload) return null;
    return normalizeStatus(row.payload, row.updated_at, instanceId);
  } catch {
    if (!process.env.SUPABASE_DB_URL) return null;
    try {
      const { rows } = await pool.query("select payload, updated_at from whatsapp_bot.bot_runtime where key = $1 limit 1", [runtimeKey("bot_status", instanceId)]);
      return rows[0]?.payload ? normalizeStatus(rows[0].payload, rows[0].updated_at, instanceId) : null;
    } catch { return null; }
  }
}

function normalizeStatus(payload: any, updatedAtFallback?: string | null, instanceId = mainBotInstanceId) {
  const updatedAt = payload?.updatedAt ?? updatedAtFallback ?? null;
  return {
    ...payload,
    botInstanceId: payload?.botInstanceId ?? instanceId,
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
    botInstanceId: status?.botInstanceId ?? mainBotInstanceId,
    message: "O bot nao envia heartbeat recente. Reinicie o bot para gerar um novo QR Code."
  };
}

export default async function handler(request: any, response: any) {
  if (String(request?.query?.lab ?? "") === "1") {
    return botLabHandler(request, response);
  }

  const instanceId = normalizeInstanceId(request?.query?.instanceId);
  const runtimeStatus = await fetchRuntimeStatus(instanceId);
  if (runtimeStatus && isFresh(runtimeStatus)) {
    response.setHeader("cache-control", "no-store");
    response.status(200).json(runtimeStatus);
    return;
  }

  if (instanceId !== mainBotInstanceId) {
    response.setHeader("cache-control", "no-store");
    response.status(200).json(runtimeStatus ? staleStatus(runtimeStatus) : {
      status: "offline",
      stale: true,
      source: "unavailable",
      botInstanceId: instanceId,
      message: "Bot desta instancia indisponivel. Inicie o servico da instancia para gerar um QR Code."
    });
    return;
  }

  try {
    const upstream = await fetchWithTimeout(`${oracleBaseUrl}/status`);
    if (upstream.ok) {
      const payload = await upstream.json().catch(async () => ({ status: "unknown", message: await upstream.text() }));
      const liveStatus = normalizeStatus(payload, null, instanceId);
      response.setHeader("cache-control", "no-store");
      response.status(200).json(isFresh(liveStatus) ? { ...liveStatus, source: "oracle" } : staleStatus({ ...liveStatus, source: "oracle" }));
      return;
    }

    const health = await fetchWithTimeout(`${oracleBaseUrl}/health`);
    if (health.ok) {
      const payload = await health.json().catch(() => ({ ok: true, status: "starting" }));
      response.setHeader("cache-control", "no-store");
      response.status(200).json({
        status: payload.status ?? "starting",
        updatedAt: payload.updatedAt ?? new Date().toISOString(),
        botInstanceId: payload.botInstanceId ?? instanceId,
        source: "oracle_health",
        stale: false
      });
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
    botInstanceId: instanceId,
    message: "Bot indisponivel. Inicie o bot para gerar um novo QR Code."
  });
}
