import {
  decodeCurrentQr,
  normalizeInstanceId,
  readWhatsAppRuntime
} from "./_whatsapp-runtime.js";

const statusStaleAfterMs = Number(process.env.BOT_STATUS_STALE_SECONDS ?? 300) * 1000;
const qrStaleAfterMs = Number(process.env.BOT_QR_STALE_SECONDS ?? 180) * 1000;

export default async function handler(request: any, response: any) {
  const instanceId = normalizeInstanceId(request?.query?.instanceId);
  response.setHeader("cache-control", "no-store");

  try {
    const { status, qr } = await readWhatsAppRuntime(instanceId);
    const image = decodeCurrentQr(status, qr, statusStaleAfterMs, qrStaleAfterMs);
    if (!image) {
      response.status(404).json({ error: "QR atual ainda nao esta disponivel" });
      return;
    }

    response.setHeader("content-type", "image/png");
    response.status(200).send(image);
  } catch {
    response.status(503).json({ error: "Estado do WhatsApp indisponivel" });
  }
}
