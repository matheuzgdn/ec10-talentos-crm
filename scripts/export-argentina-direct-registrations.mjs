import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(
  process.argv[2] ||
    path.join(
      process.cwd(),
      "exports",
      `cadastros_atletas_argentina_${new Date().toISOString().slice(0, 10)}.xlsx`,
    ),
);
const dbUrl = String(process.env.SUPABASE_DB_URL || "").trim();
const python = process.env.CODEX_PYTHON || "python";

if (!dbUrl) {
  throw new Error("SUPABASE_DB_URL ausente. Carregue o perfil cliente-whatsapp-crm-supabase.");
}

const text = (value = "") => String(value ?? "").trim();
const normalize = (value = "") => text(value).toLowerCase().replace(/\s+/g, " ");
const phoneDigits = (value = "") => text(value).replace(/\D/g, "");
const parseExtra = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const paymentLabel = (currency, amount) => {
  const normalizedCurrency = text(currency).toUpperCase();
  const normalizedAmount = text(amount);
  if (!normalizedCurrency || !normalizedAmount) return "";

  const number = Number(normalizedAmount);
  if (!Number.isFinite(number)) return `${normalizedCurrency} ${normalizedAmount}`;

  return `${normalizedCurrency} ${new Intl.NumberFormat(normalizedCurrency === "ARS" ? "es-AR" : "en-US", {
    maximumFractionDigits: 0,
  }).format(number)}`;
};

const statusLabel = (status = "") => {
  const normalized = normalize(status);
  const labels = {
    pendiente: "Pendente de pagamento",
    pendiente_pago: "Pendente de pagamento",
    comprobante_recibido: "Comprovante recebido",
    prevalidado_para_revision: "Comprovante em revisão",
    pago_validado: "Pagamento validado",
    pago_rechazado: "Pagamento reprovado",
  };
  return labels[normalized] || text(status);
};

const identityKey = (row) => {
  const extra = parseExtra(row.extra_data);
  const athleteName = normalize(extra.athlete_full_name || row.name);
  const phone = phoneDigits(row.phone || extra.phone);
  const email = normalize(row.email || extra.email);
  if (athleteName && phone) return `name-phone:${athleteName}:${phone}`;
  if (athleteName && email) return `name-email:${athleteName}:${email}`;
  return `id:${row.id}`;
};

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const [registrationQuery, receiptQuery] = await Promise.all([
    client.query(`
      select id, name, email, phone, country, sport, plan, message, status, created_date, updated_date, extra_data
      from public.international_leads
      where lower(country) = 'argentina'
        and extra_data ->> 'flow' = 'argentina_registration'
        and coalesce(extra_data ->> 'record_type', 'registration') <> 'payment_receipt'
      order by created_date asc
    `),
    client.query(`
      select id, name, email, phone, country, sport, plan, message, status, created_date, updated_date, extra_data
      from public.international_leads
      where lower(country) = 'argentina'
        and extra_data ->> 'flow' = 'argentina_payment_receipt_validation'
        and extra_data ->> 'record_type' = 'payment_receipt'
      order by created_date asc
    `),
  ]);

  const receiptByRegistrationId = new Map();
  const receiptByIdentityFallback = new Map();
  for (const receipt of receiptQuery.rows) {
    const extra = parseExtra(receipt.extra_data);
    const linkedIds = [text(extra.linked_registration_id), text(extra.admin_lead_id)].filter(Boolean);
    for (const key of linkedIds) {
      if (!key) continue;
      const existing = receiptByRegistrationId.get(key);
      if (!existing || new Date(receipt.created_date) > new Date(existing.created_date)) {
        receiptByRegistrationId.set(key, receipt);
      }
    }
    if (!linkedIds.length) {
      const key = identityKey(receipt);
      const existing = receiptByIdentityFallback.get(key);
      if (!existing || new Date(receipt.created_date) > new Date(existing.created_date)) {
        receiptByIdentityFallback.set(key, receipt);
      }
    }
  }

  const duplicateCounts = new Map();
  for (const registration of registrationQuery.rows) {
    const extra = parseExtra(registration.extra_data);
    const email = normalize(registration.email || extra.email);
    const phone = phoneDigits(registration.phone || extra.phone);
    const key = email && phone ? `${email}:${phone}` : "";
    if (key) duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }

  const registrations = registrationQuery.rows.map((registration) => {
    const extra = parseExtra(registration.extra_data);
    const receipt =
      receiptByRegistrationId.get(text(registration.id)) ||
      receiptByRegistrationId.get(text(extra.admin_lead_id)) ||
      receiptByIdentityFallback.get(identityKey(registration)) ||
      null;
    const receiptExtra = receipt ? parseExtra(receipt.extra_data) : {};
    const email = text(registration.email || extra.email).toLowerCase();
    const phone = text(registration.phone || extra.phone);
    const duplicateKey = email && phoneDigits(phone) ? `${normalize(email)}:${phoneDigits(phone)}` : "";
    const paymentCurrency = text(extra.payment_currency) || (text(extra.payment_amount_ars) ? "ARS" : text(extra.payment_amount_usd) ? "USD" : "");
    const paymentAmount = text(extra.payment_amount) || text(extra.payment_amount_ars) || text(extra.payment_amount_usd);
    const effectivePaymentStatus = text(receiptExtra.payment_status) || text(extra.payment_status) || text(registration.status);
    const utm = extra.utm && typeof extra.utm === "object" ? extra.utm : {};

    return {
      registration_id: text(registration.id),
      registered_at: registration.created_date ? new Date(registration.created_date).toISOString() : "",
      updated_at: registration.updated_date ? new Date(registration.updated_date).toISOString() : "",
      athlete_name: text(extra.athlete_full_name || registration.name),
      athlete_age: text(extra.athlete_age),
      position: text(extra.position),
      phone,
      email,
      guardian_name: text(extra.guardian_full_name),
      guardian_phone: text(extra.guardian_phone),
      consent: extra.consent_contact === true ? "Sim" : "Não informado",
      consent_at: text(extra.consent_recorded_at),
      payment_status: statusLabel(effectivePaymentStatus),
      payment_amount: paymentLabel(paymentCurrency, paymentAmount),
      payment_currency: paymentCurrency,
      payment_method: text(extra.payment_method),
      payment_alias: text(extra.payment_alias),
      payment_cvu: text(extra.payment_cvu || extra.payment_cvu_reference),
      payment_holder: text(extra.payment_holder),
      receipt_received: receipt ? "Sim" : "Não",
      receipt_status: statusLabel(receiptExtra.receipt_status || receiptExtra.payment_status),
      receipt_reference: text(receiptExtra.receipt_reference),
      receipt_uploaded_at: text(receiptExtra.receipt_uploaded_at || (receipt?.created_date ? new Date(receipt.created_date).toISOString() : "")),
      flow: text(extra.flow),
      source_page: "/argentina",
      source_url: text(extra.source_url),
      landing_url: text(extra.landing_url),
      campaign: text(extra.campaign),
      event_dates: text(extra.event_dates),
      utm_source: text(utm.source),
      utm_medium: text(utm.medium),
      utm_campaign: text(utm.campaign),
      utm_content: text(utm.content),
      utm_term: text(utm.term),
      referrer: text(extra.referrer),
      meta_event_id: text(extra.meta_event_id),
      possible_duplicate: duplicateKey && duplicateCounts.get(duplicateKey) > 1 ? "Sim — revisar" : "Não",
      internal_status: text(registration.status),
    };
  });

  const receipts = receiptQuery.rows.map((receipt) => {
    const extra = parseExtra(receipt.extra_data);
    return {
      receipt_id: text(receipt.id),
      linked_registration_id: text(extra.linked_registration_id || extra.admin_lead_id),
      uploaded_at: text(extra.receipt_uploaded_at || (receipt.created_date ? new Date(receipt.created_date).toISOString() : "")),
      athlete_name: text(extra.athlete_full_name || receipt.name),
      phone: text(receipt.phone || extra.phone),
      email: text(receipt.email || extra.email).toLowerCase(),
      payment_status: statusLabel(extra.payment_status || receipt.status),
      receipt_status: statusLabel(extra.receipt_status),
      receipt_reference: text(extra.receipt_reference),
      file_name: text(extra.receipt_file_name),
      file_type: text(extra.receipt_file_type),
      file_size: text(extra.receipt_file_size_label || extra.receipt_file_size),
      payment_amount: paymentLabel(
        text(extra.payment_currency) || (text(extra.payment_amount_ars) ? "ARS" : text(extra.payment_amount_usd) ? "USD" : ""),
        text(extra.payment_amount) || text(extra.payment_amount_ars) || text(extra.payment_amount_usd),
      ),
    };
  });

  const payload = {
    generated_at: new Date().toISOString(),
    registrations,
    receipts,
    summary: {
      total_registrations: registrations.length,
      total_receipts: receipts.length,
      with_receipt: registrations.filter((item) => item.receipt_received === "Sim").length,
      pending_payment: registrations.filter((item) => item.payment_status === "Pendente de pagamento").length,
      validated_payment: registrations.filter((item) => item.payment_status === "Pagamento validado").length,
      possible_duplicates: registrations.filter((item) => item.possible_duplicate.startsWith("Sim")).length,
    },
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  const pythonResult = spawnSync(
    python,
    [path.join(__dirname, "build-argentina-direct-registrations-xlsx.py"), outputPath],
    { input: JSON.stringify(payload), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (pythonResult.status !== 0) {
    throw new Error((pythonResult.stderr || pythonResult.stdout || "Falha ao criar a planilha.").trim());
  }

  console.log(JSON.stringify({ outputPath, ...payload.summary }));
} finally {
  await client.end();
}
