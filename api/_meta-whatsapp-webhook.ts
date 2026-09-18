import crypto from "node:crypto";
import { bookingPool } from "./_booking-db.js";

// Internal handler, exposed through the existing /api/messages function to stay within Vercel Hobby limits.

export const config = { api: { bodyParser: false } };

function readRawBody(request: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function validSignature(raw: Buffer, signature: string | undefined) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export default async function handler(request: any, response: any) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "GET") {
    const mode = String(request.query?.["hub.mode"] ?? "");
    const token = String(request.query?.["hub.verify_token"] ?? "");
    const challenge = String(request.query?.["hub.challenge"] ?? "");
    if (mode === "subscribe" && token && token === process.env.META_WHATSAPP_VERIFY_TOKEN) {
      return response.status(200).send(challenge);
    }
    return response.status(403).json({ error: "Verificacao recusada." });
  }

  if (request.method !== "POST") return response.status(405).json({ error: "Metodo nao permitido." });

  const raw = await readRawBody(request);
  if (!validSignature(raw, request.headers["x-hub-signature-256"])) {
    return response.status(401).json({ error: "Assinatura invalida." });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return response.status(400).json({ error: "JSON invalido." });
  }

  const eventHash = crypto.createHash("sha256").update(raw).digest("hex");
  await bookingPool.query(
    `insert into whatsapp_bot.meta_webhook_events(event_hash,payload)
     values($1,$2::jsonb) on conflict(event_hash) do nothing`,
    [eventHash, JSON.stringify(payload)]
  );
  return response.status(200).json({ received: true });
}
