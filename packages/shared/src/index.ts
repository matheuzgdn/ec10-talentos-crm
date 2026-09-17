export const leadStatuses = [
  "novo",
  "triagem",
  "orcamento",
  "aguardando_cliente",
  "quente",
  "fechado",
  "perdido"
] as const;

export type LeadStatus = (typeof leadStatuses)[number];

export type SellerRegion =
  | "brasil"
  | "belo_horizonte"
  | "sao_paulo"
  | "minas_gerais"
  | "portugal"
  | "internacional";

export type ServiceInterest =
  | "plano_internacional"
  | "plano_carreira"
  | "ambos"
  | "nao_definido"
  | "eurocamp"
  | "eurocamp_latam"
  | "mentoria_prime"
  | "libertacademy_florianopolis"
  | "academy_sudamerica";

export type CampaignKey =
  | "plano_carreira"
  | "plano_internacional"
  | "eurocamp"
  | "libertacademy"
  | "mentoria_prime"
  | "academy_sudamerica"
  | "outros";

export type SellerRole = "admin" | "seller";

export type SellerRecord = {
  id: string;
  authUserId: string | null;
  name: string;
  email: string | null;
  region: SellerRegion;
  role: SellerRole;
  active: boolean;
  approvedAt: string | null;
  createdAt: string;
};

export type ClientRecord = {
  id: string;
  botInstanceId?: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  region: SellerRegion | null;
  serviceInterest: ServiceInterest;
  campaignKey?: CampaignKey;
  source: "whatsapp" | "manual" | "indicacao" | "site";
  assignedSellerId: string | null;
  botPaused?: boolean;
  notes?: string | null;
  tags?: string[];
  nextFollowUpAt?: string | null;
  leadScore?: number;
  trafficSource?: string | null;
  trafficCampaignId?: string | null;
  trafficCampaignName?: string | null;
  trafficAdsetId?: string | null;
  trafficAdId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  attributionMetadata?: Record<string, unknown>;
  athleteName?: string | null;
  athleteVideoUrls?: string[];
  meetingStartsAt?: string | null;
  meetingEndsAt?: string | null;
  meetingSellerName?: string | null;
  meetingMeetUrl?: string | null;
  adhesionConfirmedAt?: string | null;
  archivedAt?: string | null;
  lastMessageAt: string | null;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  clientId: string;
  botInstanceId?: string;
  direction: "inbound" | "outbound";
  body: string | null;
  mediaType: "text" | "audio" | "image" | "document" | "poll" | "unknown";
  whatsappMessageId?: string | null;
  whatsappAck?: number | null;
  whatsappAckAt?: string | null;
  whatsappChatId?: string | null;
  createdAt: string;
};

export function normalizePhone(input: string, defaultCountryCode = "55") {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith(defaultCountryCode) || digits.length > 11) return digits;
  return `${defaultCountryCode}${digits}`;
}

export type BrazilTrafficGeo = {
  region: SellerRegion;
  stateCode: "SP" | "MG" | null;
  city: string | null;
  priority: "sao_paulo" | "minas_gerais" | "outros";
  isPriority: boolean;
  tags: string[];
};

const saoPauloDdds = new Set(["11", "12", "13", "14", "15", "16", "17", "18", "19"]);
const minasGeraisDdds = new Set(["31", "32", "33", "34", "35", "37", "38"]);

function normalizeAscii(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractBrazilDdd(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  return national.length >= 10 ? national.slice(0, 2) : "";
}

function inferStateFromCity(city: string) {
  const normalized = normalizeAscii(city);
  if (!normalized) return null;

  if (
    /\bsp\b/.test(normalized)
    || normalized.includes("sao paulo")
    || normalized.includes("campinas")
    || normalized.includes("santos")
    || normalized.includes("sorocaba")
    || normalized.includes("ribeirao preto")
  ) {
    return "SP" as const;
  }

  if (
    /\bmg\b/.test(normalized)
    || normalized.includes("minas gerais")
    || normalized.includes("belo horizonte")
    || normalized.includes("contagem")
    || normalized.includes("betim")
    || normalized.includes("uberlandia")
    || normalized.includes("juiz de fora")
  ) {
    return "MG" as const;
  }

  return null;
}

function inferStateFromPhone(phone: string) {
  const ddd = extractBrazilDdd(phone);
  if (saoPauloDdds.has(ddd)) return "SP" as const;
  if (minasGeraisDdds.has(ddd)) return "MG" as const;
  return null;
}

function extractCityName(city: string) {
  const firstPart = city.split(/[-,/|]/)[0]?.trim() ?? "";
  if (!firstPart || firstPart.length < 2) return null;
  const normalized = normalizeAscii(firstPart);
  if (["sp", "mg", "brasil", "minas gerais", "sao paulo"].includes(normalized)) return null;
  return firstPart.slice(0, 80);
}

export function resolveBrazilTrafficGeo(input: { city?: string | null; phone?: string | null }): BrazilTrafficGeo {
  const city = String(input.city ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const stateCode = inferStateFromCity(city) ?? inferStateFromPhone(phone);

  if (stateCode === "SP") {
    return {
      region: "sao_paulo",
      stateCode,
      city: extractCityName(city),
      priority: "sao_paulo",
      isPriority: true,
      tags: ["geo_sao_paulo", "geo_prioritario_sp_mg"]
    };
  }

  if (stateCode === "MG") {
    return {
      region: "minas_gerais",
      stateCode,
      city: extractCityName(city),
      priority: "minas_gerais",
      isPriority: true,
      tags: ["geo_minas_gerais", "geo_prioritario_sp_mg"]
    };
  }

  return {
    region: phone.startsWith("55") || !phone ? "brasil" : "internacional",
    stateCode: null,
    city: extractCityName(city),
    priority: "outros",
    isPriority: false,
    tags: ["geo_outros"]
  };
}
