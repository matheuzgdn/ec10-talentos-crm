import { bookingPool } from "./_booking-db.js";

export const mainBotInstanceId = "main";

export type RuntimeRow = {
  key: string;
  payload: Record<string, any> | null;
  updated_at: string | null;
};

export function normalizeInstanceId(input: unknown) {
  const value = String(input ?? mainBotInstanceId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return value || mainBotInstanceId;
}

export function runtimeKey(baseKey: string, instanceId: string) {
  return instanceId === mainBotInstanceId ? baseKey : `${baseKey}:${instanceId}`;
}

export function runtimeUpdatedAt(row: RuntimeRow | null) {
  return row?.payload?.updatedAt ?? row?.updated_at ?? null;
}

export function isRuntimeFresh(row: RuntimeRow | null, staleAfterMs: number) {
  const updatedAt = runtimeUpdatedAt(row);
  if (!updatedAt) return false;
  const timestamp = new Date(String(updatedAt)).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= staleAfterMs;
}

export async function readWhatsAppRuntime(instanceId: string) {
  const statusKey = runtimeKey("bot_status", instanceId);
  const qrKey = runtimeKey("whatsapp_qr", instanceId);
  const { rows } = await bookingPool.query<RuntimeRow>(
    `select key, payload, updated_at
       from whatsapp_bot.bot_runtime
      where key = any($1::text[])`,
    [[statusKey, qrKey]]
  );
  return {
    status: rows.find((row) => row.key === statusKey) ?? null,
    qr: rows.find((row) => row.key === qrKey) ?? null
  };
}

export function decodeCurrentQr(
  statusRow: RuntimeRow | null,
  qrRow: RuntimeRow | null,
  statusStaleAfterMs: number,
  qrStaleAfterMs: number
) {
  if (!isRuntimeFresh(statusRow, statusStaleAfterMs) || !isRuntimeFresh(qrRow, qrStaleAfterMs)) return null;
  if (statusRow?.payload?.status !== "waiting_qr_scan") return null;

  const statusHash = statusRow.payload?.qrHash;
  const qrHash = qrRow?.payload?.qrHash;
  if (typeof statusHash !== "string" || !statusHash || statusHash !== qrHash) return null;

  const qrDataUrl = qrRow?.payload?.qrDataUrl;
  if (typeof qrDataUrl !== "string") return null;
  const match = qrDataUrl.match(/^data:image\/png;base64,(.+)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}
