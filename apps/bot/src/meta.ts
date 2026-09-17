import crypto from "node:crypto";
import { config } from "./config.js";

type MetaCustomValue = string | number | boolean | null | undefined;

function cleanText(input: string | null | undefined, maxLength = 500) {
  const text = String(input ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizePhone(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeLocationText(input: string | null | undefined) {
  const text = cleanText(input, 120);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function normalizeUrl(input: string | null | undefined) {
  const text = cleanText(input, 800);
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

function eventTimestamp(input: Date | string | number | null | undefined) {
  if (!input) return Math.floor(Date.now() / 1000);
  if (input instanceof Date) return Math.floor(input.getTime() / 1000);
  if (typeof input === "number") return input > 10_000_000_000 ? Math.floor(input / 1000) : Math.floor(input);
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function buildFbc(fbclid: string | null | undefined, timestamp: number) {
  const clean = cleanText(fbclid, 240);
  return clean ? `fb.1.${timestamp}.${clean}` : null;
}

function buildUserData(input: {
  clientId: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  eventTime: number;
}) {
  const phone = normalizePhone(input.phone);
  const city = normalizeLocationText(input.city);
  const state = normalizeLocationText(input.state);
  const country = normalizeLocationText(input.country ?? "br");
  const fbc = cleanText(input.fbc, 300) ?? buildFbc(input.fbclid, input.eventTime);
  const fbp = cleanText(input.fbp, 300);

  return {
    ...(phone ? { ph: [sha256(phone)] } : {}),
    ...(city ? { ct: [sha256(city)] } : {}),
    ...(state ? { st: [sha256(state)] } : {}),
    ...(country ? { country: [sha256(country)] } : {}),
    external_id: [sha256(input.clientId)],
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {})
  };
}

function cleanCustomData(input: Record<string, MetaCustomValue> | null | undefined) {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const normalizedKey = key.trim().replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 40);
    if (!normalizedKey || value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) output[normalizedKey] = value;
      continue;
    }
    if (typeof value === "boolean") {
      output[normalizedKey] = value;
      continue;
    }
    const text = String(value).trim();
    if (text) output[normalizedKey] = text.slice(0, 200);
  }
  return output;
}

export async function sendMetaQualityEvent(input: {
  clientId: string;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  eventName: "QualifiedLead" | "Schedule" | "Purchase";
  status?: string;
  serviceInterest?: string | null;
  leadScore?: number | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  eventSourceUrl?: string | null;
  eventTime?: Date | string | number | null;
  eventId: string;
  customData?: Record<string, MetaCustomValue>;
}) {
  if (!config.META_PIXEL_ID || !config.META_CAPI_ACCESS_TOKEN) return false;

  const eventTime = eventTimestamp(input.eventTime);
  const eventSourceUrl = normalizeUrl(input.eventSourceUrl);
  const payload = {
    data: [
      {
        event_name: input.eventName,
        event_time: eventTime,
        event_id: cleanText(input.eventId, 160),
        action_source: eventSourceUrl ? "website" : "business_messaging",
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: buildUserData({
          clientId: input.clientId,
          phone: input.phone,
          city: input.city,
          state: input.state,
          country: input.country,
          fbclid: input.fbclid,
          fbc: input.fbc,
          fbp: input.fbp,
          eventTime
        }),
        custom_data: {
          lead_status: input.status ?? "triagem",
          service_interest: input.serviceInterest ?? "nao_definido",
          lead_score: input.leadScore ?? 0,
          source: "whatsapp_bot",
          content_name: "EC10 Talentos",
          currency: "BRL",
          ...cleanCustomData(input.customData)
        }
      }
    ]
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.META_PIXEL_ID}/events?access_token=${encodeURIComponent(config.META_CAPI_ACCESS_TOKEN)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      }
    );

    if (!response.ok) {
      console.warn("Meta CAPI rejected bot quality event", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("Failed to send bot Meta CAPI event", error instanceof Error ? error.message : String(error));
    return false;
  }
}
