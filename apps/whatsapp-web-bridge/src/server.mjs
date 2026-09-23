import crypto from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { StateStore } from "./state-store.mjs";
import { buildSellerNotification, detectLanguage, digits, inferCampaignService, inferService, selectSeller } from "./routing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const runtime = path.join(root, ".runtime", "whatsapp-web-bridge");
const port = Number(process.env.EC10_WEB_BRIDGE_PORT || 3219);
const oracleUrl = process.env.GUSTAVO_V2_LOCAL_URL || "http://127.0.0.1:8781";
const secret = (process.env.EC10_WEB_BRIDGE_SECRET || "").trim();
if (!secret || secret.length < 24) throw new Error("EC10_WEB_BRIDGE_SECRET ausente ou curto");
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL ausente");

const database = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const store = new StateStore(path.join(runtime, "state.json"));
await store.open();

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 300_000) throw new Error("payload_too_large");
  }
  return raw ? JSON.parse(raw) : {};
}

function authorized(request) {
  const supplied = String(request.headers["x-ec10-bridge-secret"] || "");
  if (supplied.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

function hashMessage(phone, lastInbound) {
  return crypto.createHash("sha256").update(`${digits(phone)}|${lastInbound.pre}|${lastInbound.text}`).digest("hex");
}

function safeDisplayName(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(normalized)) return "";
  if (digits(normalized).length >= 8) return "";
  return normalized.slice(0, 160);
}

async function ensureClient(phone, displayName, service, language) {
  const normalized = digits(phone);
  if (normalized.length < 10) throw new Error("contact_phone_unavailable");
  const result = await database.query(`
    insert into whatsapp_bot.clients(phone,name,status,region,service_interest,source,bot_instance_id,last_message_at)
    values($1,nullif($2,''),'novo',$3,$4,'whatsapp','main',now())
    on conflict(phone) do update set
      name=coalesce(nullif(whatsapp_bot.clients.name,''),excluded.name),
      region=coalesce(whatsapp_bot.clients.region,excluded.region),
      service_interest=case when whatsapp_bot.clients.service_interest='nao_definido' then excluded.service_interest else whatsapp_bot.clients.service_interest end,
      last_message_at=now(),updated_at=now()
    returning id,name,athlete_age,service_interest,bot_paused
  `, [normalized, displayName || "", language === "es" ? "latam" : "brasil", service || "nao_definido"]);
  return result.rows[0];
}

async function mirrorMessage(clientId, direction, text, messageId) {
  const found = await database.query(`select 1 from whatsapp_bot.messages where whatsapp_message_id=$1 limit 1`, [messageId]);
  if (found.rowCount) return;
  await database.query(`insert into whatsapp_bot.messages(client_id,direction,body,whatsapp_message_id,bot_instance_id) values($1,$2,$3,$4,'main')`, [clientId, direction, text, messageId]);
}

function serializePoll(result) {
  if (!result.poll?.options?.length) return result.reply;
  return `${result.reply}\n\n${result.poll.question}\n${result.poll.options.map((option, index) => `${index + 1}. ${option}`).join("\n")}`;
}

async function handleTurn(payload) {
  const history = Array.isArray(payload.messages) ? payload.messages.slice(-24).map(item => ({
    direction: item.direction === "outbound" ? "outbound" : "inbound",
    text: String(item.text || "").trim().slice(0, 4000), pre: String(item.pre || "")
  })).filter(item => item.text) : [];
  const lastInbound = [...history].reverse().find(item => item.direction === "inbound");
  if (!lastInbound) throw new Error("inbound_message_missing");
  const phone = digits(payload.phone);
  const messageId = hashMessage(phone, lastInbound);
  const cached = store.getResult(messageId);
  if (cached) { await store.markDuplicate(); return { ...cached, cached: true, sent: store.isSent(messageId) }; }
  const language = detectLanguage(history, phone);
  const campaignService = inferCampaignService(history);
  const displayName = safeDisplayName(payload.displayName);
  const client = await ensureClient(phone, displayName, campaignService, language);
  if (client.bot_paused || store.isPaused(phone)) return { ignored: true, reason: "human_takeover" };
  await mirrorMessage(client.id, "inbound", lastInbound.text, `web:${messageId}`);
  const age = Number.isInteger(client.athlete_age) ? client.athlete_age : null;
  const service = inferService({ language, athleteAge: age, explicitService: campaignService || client.service_interest });
  const seller = selectSeller({ language, athleteAge: age, serviceInterest: service });
  const oracleResponse = await fetch(`${oracleUrl}/oracle/respond`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(18_000),
    body: JSON.stringify({ phone, message_id: `web-${messageId}`, inbound: lastInbound.text, client_id: client.id,
      known_name: client.name || displayName || null, known_age: age, lead_source: "whatsapp_web_local",
      service_interest: service, language, route_key: seller.routeKey })
  });
  if (!oracleResponse.ok) throw new Error(`oracle_${oracleResponse.status}`);
  const oracle = await oracleResponse.json();
  const response = {
    messageId, clientId: client.id, phone, language, service, seller, text: serializePoll(oracle), audioKey: oracle.audio_key || null,
    booking: oracle.booking || null, stage: oracle.stage, cached: false
  };
  if (oracle.booking) {
    const notification = { phone: seller.phone, seller: seller.name, text: buildSellerNotification({
      seller, contactName: client.name || displayName, athleteName: oracle.athlete_name,
      athleteAge: oracle.athlete_age, phone, booking: { ...oracle.booking, service_label: service === "plano_internacional" ? "Plano Internacional" : service === "eurocamp" ? "Eurocamp" : "Plano de Carreira" }
    }) };
    await store.queueNotification(`booking:${oracle.booking.id}:${seller.phone}`, notification);
  }
  await store.rememberResult(messageId, response);
  return response;
}

const audioFiles = {
  eric_8_13: path.join(root, "media", "audio", "ec10", "eric-2026-09-14", "02_8-13_plano-de-carreira.ogg"),
  eric_14_18: path.join(root, "media", "audio", "bot-principal", "13-17-plano-carreira", "02_plano_1m49.ogg"),
  eric_20_25: path.join(root, "media", "audio", "ec10", "sdr-2026-09-16", "internacional_eric.ogg")
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") { response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-ec10-bridge-secret" }); return response.end(); }
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/" && request.method === "GET") {
      const html = await readFile(path.join(here, "..", "public", "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return response.end(html);
    }
    if (url.pathname === "/health" && request.method === "GET") {
      const oracle = await fetch(`${oracleUrl}/health`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => ({ ok: false }));
      return json(response, 200, { ok: true, mode: "new-inbound-only", oracle: Boolean(oracle.ok), stats: store.data.stats, notificationsQueued: Object.values(store.data.notifications).filter(item => item.status === "queued").length });
    }
    if (url.pathname === "/bootstrap" && request.method === "GET") {
      const origin = String(request.headers.origin || "");
      if (!origin.startsWith("chrome-extension://")) return json(response, 403, { error: "extension_only" });
      return json(response, 200, { secret });
    }
    if (!authorized(request)) return json(response, 401, { error: "unauthorized" });
    if (url.pathname === "/turn" && request.method === "POST") return json(response, 200, await handleTurn(await body(request)));
    if (url.pathname === "/ack" && request.method === "POST") {
      const input = await body(request); await store.markSent(input.messageId, input.text);
      if (input.audioKey) await fetch(`${oracleUrl}/oracle/audio-delivered`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: digits(input.phone), audio_key: input.audioKey }) });
      if (input.clientId && input.text) await mirrorMessage(input.clientId, "outbound", input.text, `web-out:${input.messageId}`);
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/notification" && request.method === "GET") {
      const next = store.nextNotification(); return json(response, 200, next ? { key: next[0], ...next[1] } : { key: null });
    }
    if (url.pathname === "/notification/ack" && request.method === "POST") {
      const input = await body(request); await store.finishNotification(input.key, Boolean(input.ok), input.error || null); return json(response, 200, { ok: true });
    }
    if (url.pathname.startsWith("/audio/") && request.method === "GET") {
      const key = path.basename(url.pathname).replace(/\.ogg$/i, ""); const file = audioFiles[key];
      if (!file) return json(response, 404, { error: "audio_not_approved" });
      const data = await readFile(file); response.writeHead(200, { "content-type": "audio/ogg", "content-length": data.length, "cache-control": "private, max-age=3600", "access-control-allow-origin": "*" }); return response.end(data);
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    await store.markError().catch(() => {});
    return json(response, 500, { error: error instanceof Error ? error.message : "internal_error" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ service: "ec10-whatsapp-web-bridge", port, mode: "new-inbound-only" })));
process.on("SIGINT", async () => { server.close(); await database.end(); process.exit(0); });
