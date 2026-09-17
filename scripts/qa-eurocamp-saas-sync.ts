import { syncEurocampLatamLead } from "../api/_ec10-saas-sync.ts";

function required(name: string) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const url = required("EC10_SAAS_SUPABASE_URL").replace(/\/$/, "");
const anonKey = required("EC10_SAAS_SUPABASE_ANON_KEY");
const email = required("EC10_SAAS_SYNC_EMAIL");
const password = required("EC10_SAAS_SYNC_PASSWORD");
const organizationId = required("EC10_SAAS_ORGANIZATION_ID");
const phone = `54935${Date.now().toString().slice(-8)}`;

const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error("QA authentication failed");

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${auth.access_token}`,
  "content-type": "application/json",
};

let leadId = "";
try {
  const result = await syncEurocampLatamLead({
    contactName: "QA Eurocamp Latam",
    email: "qa.eurocamp@example.com",
    phone,
    relationship: "responsavel",
    notes: "Temporary integration record",
    attribution: { utmSource: "qa", utmCampaign: "qa_eurocamp_latam" },
  });
  leadId = result.id;

  const params = new URLSearchParams({
    select: "id,data",
    id: `eq.${leadId}`,
    organization_id: `eq.${organizationId}`,
  });
  const verifyResponse = await fetch(`${url}/rest/v1/leads?${params}`, { headers });
  const rows = await verifyResponse.json();
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!verifyResponse.ok || lead?.data?.tipo_servico_interesse !== "eurocamp_latam") {
    throw new Error("QA record was not classified as eurocamp_latam");
  }

  console.log(JSON.stringify({ ok: true, operation: result.operation, pipeline: lead.data.tipo_servico_interesse }));
} finally {
  if (leadId) {
    const params = new URLSearchParams({ id: `eq.${leadId}`, organization_id: `eq.${organizationId}` });
    const deleteResponse = await fetch(`${url}/rest/v1/leads?${params}`, {
      method: "DELETE",
      headers: { ...headers, prefer: "return=minimal" },
    });
    if (!deleteResponse.ok) throw new Error("QA record cleanup failed");
  }
}
