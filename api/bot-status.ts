import botLabHandler from "./_bot-lab.js";
import {
  isRuntimeFresh,
  normalizeInstanceId,
  readWhatsAppRuntime,
  runtimeUpdatedAt
} from "./_whatsapp-runtime.js";

export const maxDuration = 60;

const staleAfterMs = Number(process.env.BOT_STATUS_STALE_SECONDS ?? 300) * 1000;

function offlineStatus(instanceId: string, updatedAt: string | null = null) {
  return {
    status: "offline",
    updatedAt,
    stale: true,
    source: "contatoec10",
    botInstanceId: instanceId,
    message: "O Oracle nao publicou um estado recente do WhatsApp."
  };
}

export default async function handler(request: any, response: any) {
  if (String(request?.query?.lab ?? "") === "1") {
    return botLabHandler(request, response);
  }

  const instanceId = normalizeInstanceId(request?.query?.instanceId);
  response.setHeader("cache-control", "no-store");

  try {
    const { status } = await readWhatsAppRuntime(instanceId);
    if (!status?.payload || !isRuntimeFresh(status, staleAfterMs)) {
      response.status(200).json(offlineStatus(instanceId, runtimeUpdatedAt(status)));
      return;
    }

    response.status(200).json({
      ...status.payload,
      botInstanceId: status.payload.botInstanceId ?? instanceId,
      updatedAt: runtimeUpdatedAt(status),
      stale: false,
      source: "contatoec10"
    });
  } catch {
    response.status(503).json({
      ...offlineStatus(instanceId),
      databaseUnavailable: true
    });
  }
}
