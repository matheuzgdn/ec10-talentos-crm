import crypto from "node:crypto";

const statusToMetaEvent: Record<string, string> = {
  triagem: "Lead",
  orcamento: "Schedule",
  quente: "QualifiedLead",
  fechado: "Purchase"
};

function sha256(input: string) {
  return crypto.createHash("sha256").update(input.trim().toLowerCase()).digest("hex");
}

function normalizePhone(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits || null;
}

export async function sendMetaQualityEvent(input: {
  clientId: string;
  phone: string | null;
  status: string;
  serviceInterest?: string | null;
  leadScore?: number | null;
}) {
  const eventName = statusToMetaEvent[input.status];
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!eventName || !pixelId || !accessToken) return;

  const phone = normalizePhone(input.phone);
  if (!phone) return;

  const graphVersion = process.env.META_GRAPH_VERSION ?? "v25.0";
  const eventId = `crm-${input.clientId}-${eventName}-${Date.now()}`;
  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "system_generated",
        user_data: {
          ph: [sha256(phone)]
        },
        custom_data: {
          lead_status: input.status,
          service_interest: input.serviceInterest ?? "nao_definido",
          lead_score: input.leadScore ?? 0,
          source: "whatsapp_crm"
        }
      }
    ]
  };

  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      console.warn("Meta CAPI rejected quality event", response.status);
    }
  } catch (error) {
    console.warn("Failed to send Meta CAPI event", error instanceof Error ? error.message : String(error));
  }
}
