import crypto from "node:crypto";

const statusToMetaEvent: Record<string, string> = {
  novo: "Lead",
  triagem: "Lead",
  orcamento: "Schedule",
  quente: "QualifiedLead",
  fechado: "Purchase",
  perdido: "DisqualifiedLead"
};

function sha256(input: string) {
  return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

type MetaCustomValue = string | number | boolean | null | undefined;

function normalizePhone(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits || null;
}

function cleanText(input: string | null | undefined, maxLength = 500) {
  const text = String(input ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeEmail(input: string | null | undefined) {
  const email = cleanText(input, 320)?.toLowerCase();
  return email && email.includes("@") ? email : null;
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

function eventTimestamp(input: Date | string | number | null | undefined) {
  if (!input) return Math.floor(Date.now() / 1000);
  if (input instanceof Date) return Math.floor(input.getTime() / 1000);
  if (typeof input === "number") {
    return input > 10_000_000_000 ? Math.floor(input / 1000) : Math.floor(input);
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function buildFbc(fbclid: string | null | undefined, timestamp: number) {
  const clean = cleanText(fbclid, 240);
  if (!clean) return null;
  return `fb.1.${timestamp}.${clean}`;
}

function buildUserData(input: {
  clientId: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  eventTime: number;
}) {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const city = normalizeLocationText(input.city);
  const state = normalizeLocationText(input.state);
  const country = normalizeLocationText(input.country ?? "br");
  const fbc = cleanText(input.fbc, 300) ?? buildFbc(input.fbclid, input.eventTime);
  const fbp = cleanText(input.fbp, 300);

  return {
    ...(phone ? { ph: [sha256(phone)] } : {}),
    ...(email ? { em: [sha256(email)] } : {}),
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
      output[normalizedKey] = value ? "true" : "false";
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
  email?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  status?: string;
  eventName?: string;
  serviceInterest?: string | null;
  leadScore?: number | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  eventSourceUrl?: string | null;
  actionSource?: "website" | "business_messaging" | "system_generated";
  value?: number | null;
  currency?: string | null;
  eventTime?: Date | string | number | null;
  eventId?: string | null;
  customData?: Record<string, MetaCustomValue>;
}) {
  const status = input.status ?? "novo";
  const eventName = input.eventName ?? statusToMetaEvent[status];
  const pixelId = process.env.META_PIXEL_ID ?? process.env.VITE_META_PIXEL_ID ?? "834310425674029";
  const accessTokens = [...new Set([
    process.env.META_SYSTEM_USER_ACCESS_TOKEN,
    process.env.META_CAPI_ACCESS_TOKEN,
  ].map((token) => token?.trim()).filter((token): token is string => Boolean(token)))];
  if (!eventName || !pixelId || accessTokens.length === 0) {
    console.warn("Meta CAPI configuration is incomplete");
    return false;
  }

  const configuredGraphVersion = process.env.META_GRAPH_VERSION ?? "";
  const graphVersion = /^v(?:2[5-9]|[3-9]\d)\.\d+$/.test(configuredGraphVersion)
    ? configuredGraphVersion
    : "v25.0";
  const eventTime = eventTimestamp(input.eventTime);
  const eventId = cleanText(input.eventId, 160) ?? `crm-${input.clientId}-${status}-${eventName}`;
  const eventSourceUrl = normalizeUrl(input.eventSourceUrl);
  const value = Number(input.value ?? 0);

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        event_id: eventId,
        action_source: input.actionSource ?? (eventSourceUrl ? "website" : "system_generated"),
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: buildUserData({
          clientId: input.clientId,
          phone: input.phone,
          email: input.email,
          city: input.city,
          state: input.state,
          country: input.country,
          fbclid: input.fbclid,
          fbc: input.fbc,
          fbp: input.fbp,
          eventTime
        }),
        custom_data: {
          lead_status: status,
          service_interest: input.serviceInterest ?? "nao_definido",
          lead_score: input.leadScore ?? 0,
          source: "whatsapp_crm",
          content_name: "EC10 Talentos",
          ...(Number.isFinite(value) && value > 0 ? { value, currency: input.currency ?? "BRL" } : {}),
          ...cleanCustomData(input.customData)
        }
      }
    ],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {})
  };

  try {
    for (const [index, accessToken] of accessTokens.entries()) {
      const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      });

      if (response.ok) return true;

      const responsePayload = await response.json().catch(() => ({}));
      const metaError = responsePayload && typeof responsePayload === "object" && "error" in responsePayload
        ? (responsePayload as { error?: { code?: unknown; error_subcode?: unknown } }).error
        : null;
      const canRetryAuthentication = Number(metaError?.code) === 190 && index < accessTokens.length - 1;
      if (canRetryAuthentication) continue;

      console.warn("Meta CAPI rejected quality event", {
        status: response.status,
        code: metaError?.code ?? null,
        subcode: metaError?.error_subcode ?? null,
      });
      return false;
    }
    return false;
  } catch (error) {
    console.warn("Failed to send Meta CAPI event", error instanceof Error ? error.message : String(error));
    return false;
  }
}
