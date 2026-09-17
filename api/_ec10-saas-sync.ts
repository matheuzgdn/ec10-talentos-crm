type EurocampLatamLead = {
  contactName: string;
  email: string;
  phone: string;
  relationship: "responsavel" | "atleta" | "nao_informado";
  notes: string;
  attribution: Record<string, unknown>;
  countryCode?: string;
  countryDialCode?: string;
};

const COUNTRY_BY_CODE: Record<string, { name: string; dial: string }> = {
  AR: { name: "Argentina", dial: "54" }, BO: { name: "Bolivia", dial: "591" },
  BR: { name: "Brasil", dial: "55" }, CL: { name: "Chile", dial: "56" },
  CO: { name: "Colombia", dial: "57" }, CR: { name: "Costa Rica", dial: "506" },
  EC: { name: "Ecuador", dial: "593" }, ES: { name: "Espana", dial: "34" },
  MX: { name: "Mexico", dial: "52" }, PA: { name: "Panama", dial: "507" },
  PE: { name: "Peru", dial: "51" }, PY: { name: "Paraguay", dial: "595" },
  PT: { name: "Portugal", dial: "351" }, UY: { name: "Uruguay", dial: "598" },
  VE: { name: "Venezuela", dial: "58" },
};

function inferCountryCode(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 11) return "";
  return Object.entries(COUNTRY_BY_CODE)
    .sort(([, left], [, right]) => right.dial.length - left.dial.length)
    .find(([, country]) => digits.startsWith(country.dial) && digits.length - country.dial.length >= 7)?.[0] || "";
}

function normalizePhone(phone: string, countryCode: string) {
  const country = COUNTRY_BY_CODE[countryCode];
  let digits = String(phone || "").replace(/\D/g, "").replace(/^00/, "").replace(/^0+/, "");
  if (!country || !digits) return digits;
  if (countryCode === "AR") {
    if (digits.startsWith("549")) return digits;
    if (digits.startsWith("54")) digits = digits.slice(2);
    if (digits.startsWith("9") && digits.length === 11) return `54${digits}`;
    return `549${digits.replace(/^15/, "")}`;
  }
  return digits.startsWith(country.dial) && digits.length - country.dial.length >= 7
    ? digits
    : `${country.dial}${digits}`;
}

function isValidPhoneForCountry(phone: string, countryCode: string) {
  const patterns: Record<string, RegExp> = {
    AR: /^549\d{10}$/, BR: /^55\d{10,11}$/, CL: /^56\d{9}$/, PY: /^595\d{9}$/,
    UY: /^598\d{8}$/, BO: /^591\d{8}$/, CO: /^57\d{10}$/, PE: /^51\d{9}$/,
    EC: /^593\d{9}$/, CR: /^506\d{8}$/,
  };
  return patterns[countryCode] ? patterns[countryCode].test(phone) : /^\d{8,15}$/.test(phone);
}

function requiredEnvironment() {
  const url = String(process.env.EC10_SAAS_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = String(process.env.EC10_SAAS_SUPABASE_ANON_KEY || "");
  const email = String(process.env.EC10_SAAS_SYNC_EMAIL || "");
  const password = String(process.env.EC10_SAAS_SYNC_PASSWORD || "");
  const organizationId = String(process.env.EC10_SAAS_ORGANIZATION_ID || "");
  if (!url || !anonKey || !email || !password || !organizationId) {
    throw new Error("EC10 SaaS sync environment is incomplete");
  }
  return { url, anonKey, email, password, organizationId };
}

async function authenticatedClient() {
  const config = requiredEnvironment();
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token || !payload.user?.id) {
    throw new Error(payload?.error_description || payload?.msg || "EC10 SaaS authentication failed");
  }
  return {
    ...config,
    accessToken: String(payload.access_token),
    userId: String(payload.user.id),
    userEmail: String(payload.user.email || config.email),
  };
}

async function rest(config: Awaited<ReturnType<typeof authenticatedClient>>, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.accessToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.hint || `EC10 SaaS REST ${response.status}`);
  }
  return payload;
}

async function syncLead(
  config: Awaited<ReturnType<typeof authenticatedClient>>,
  input: EurocampLatamLead,
) {
  const leadOwnerEmail = String(process.env.EC10_SAAS_LEAD_OWNER_EMAIL || config.userEmail);
  const leadOwnerName = String(process.env.EC10_SAAS_LEAD_OWNER_NAME || "Matheus Gomes");
  const countryCode = String(input.countryCode || input.attribution.countryCode || inferCountryCode(input.phone)).toUpperCase();
  const country = COUNTRY_BY_CODE[countryCode];
  const countryDialCode = String(input.countryDialCode || input.attribution.countryDialCode || country?.dial || "").replace(/\D/g, "");
  const normalizedPhone = normalizePhone(input.phone, countryCode);
  let existing: any[] = [];
  for (const candidate of [...new Set([normalizedPhone, input.phone].filter(Boolean))]) {
    const existingParams = new URLSearchParams({
      select: "id,data",
      organization_id: `eq.${config.organizationId}`,
      "data->>telefone": `eq.${candidate}`,
      limit: "1",
    });
    existing = await rest(config, `leads?${existingParams.toString()}`);
    if (Array.isArray(existing) && existing.length) break;
  }
  const now = new Date().toISOString();
  const leadData = {
    tipo_lead: "atleta",
    origem_captacao: "meta_ads_eurocamp_latam",
    nome_atleta: input.contactName,
    telefone: normalizedPhone,
    telefone_e164: normalizedPhone,
    country_code: countryCode,
    country_dial_code: countryDialCode,
    pais: country?.name || "",
    email: input.email,
    responsavel: input.relationship === "responsavel" ? input.contactName : "",
    status: "novo_lead",
    convertido: false,
    responsavel_atual: leadOwnerEmail,
    responsavel_atual_nome: leadOwnerName,
    responsavel_inicial: leadOwnerEmail,
    vendedor_responsavel: leadOwnerEmail,
    vendedor_nome: leadOwnerName,
    tipo_servico_interesse: "eurocamp_latam",
    campanha_nome: String(input.attribution.utmCampaign || "EUROCAMP 2027 LATAM"),
    landing_variant: "eurocamp_latam_simple_v1",
    observacoes: input.notes,
    papel_cadastro: input.relationship,
    utm_source: input.attribution.utmSource || "",
    utm_medium: input.attribution.utmMedium || "",
    utm_campaign: input.attribution.utmCampaign || "",
    utm_content: input.attribution.utmContent || "",
    utm_term: input.attribution.utmTerm || "",
    campaign_id: input.attribution.campaignId || "",
    adset_id: input.attribution.adsetId || "",
    ad_id: input.attribution.adId || "",
    fbclid: input.attribution.fbclid || "",
    fbp: input.attribution.fbp || "",
    fbc: input.attribution.fbc || "",
    whatsapp_group_redirect: true,
    updated_date: now,
  };

  if (Array.isArray(existing) && existing[0]?.id) {
    const id = String(existing[0].id);
    const params = new URLSearchParams({ id: `eq.${id}`, organization_id: `eq.${config.organizationId}` });
    await rest(config, `leads?${params.toString()}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ data: { ...(existing[0].data || {}), ...leadData }, updated_by: config.userEmail, updated_by_id: config.userId, updated_date: now }),
    });
    return { id, operation: "updated" as const };
  }

  const inserted = await rest(config, "leads?select=id", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: config.organizationId,
      data: { ...leadData, created_date: now },
      created_by: config.userEmail,
      created_by_id: config.userId,
      updated_by: config.userEmail,
      updated_by_id: config.userId,
      created_date: now,
      updated_date: now,
    }),
  });
  if (!Array.isArray(inserted) || !inserted[0]?.id) throw new Error("EC10 SaaS lead insert returned no id");
  return { id: String(inserted[0].id), operation: "created" as const };
}

export async function syncEurocampLatamLead(input: EurocampLatamLead) {
  const config = await authenticatedClient();
  return syncLead(config, input);
}

export async function syncEurocampLatamLeads(inputs: EurocampLatamLead[]) {
  const config = await authenticatedClient();
  const results: Array<{ id: string; operation: "created" | "updated" }> = [];

  for (const input of inputs) {
    results.push(await syncLead(config, input));
  }

  return {
    total: results.length,
    created: results.filter((result) => result.operation === "created").length,
    updated: results.filter((result) => result.operation === "updated").length,
  };
}

export async function repairEurocampLatamPhoneMetadata() {
  const config = await authenticatedClient();
  const params = new URLSearchParams({
    select: "id,data",
    organization_id: `eq.${config.organizationId}`,
    order: "created_date.asc",
    limit: "1000",
  });
  const rows = await rest(config, `leads?${params.toString()}`);
  const eurocampRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    String(row?.data?.tipo_servico_interesse || "").toLowerCase() === "eurocamp_latam"
  );
  let updated = 0;
  let skipped = 0;

  for (const row of eurocampRows) {
    const data = row?.data || {};
    const countryCode = String(data.country_code || inferCountryCode(data.telefone_e164 || data.telefone)).toUpperCase();
    const country = COUNTRY_BY_CODE[countryCode];
    const phone = normalizePhone(String(data.telefone_e164 || data.telefone || ""), countryCode);
    if (!country || !phone) {
      skipped += 1;
      continue;
    }
    const repairedData = {
      ...data,
      telefone: phone,
      telefone_e164: phone,
      country_code: countryCode,
      country_dial_code: country.dial,
      pais: country.name,
      telefone_status: isValidPhoneForCountry(phone, countryCode) ? "valido" : "revisar",
      telefone_status_motivo: isValidPhoneForCountry(phone, countryCode) ? "" : "Quantidade de digitos incompativel com o pais informado",
      updated_date: new Date().toISOString(),
    };
    const changed = ["telefone", "telefone_e164", "country_code", "country_dial_code", "pais", "telefone_status", "telefone_status_motivo"]
      .some((field) => String(data[field] || "") !== String(repairedData[field] || ""));
    if (!changed) continue;
    const rowParams = new URLSearchParams({ id: `eq.${row.id}`, organization_id: `eq.${config.organizationId}` });
    await rest(config, `leads?${rowParams.toString()}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ data: repairedData, updated_by: config.userEmail, updated_by_id: config.userId, updated_date: repairedData.updated_date }),
    });
    updated += 1;
  }

  return { scanned: eurocampRows.length, updated, skipped };
}

export async function inspectEurocampSaasSync() {
  const config = await authenticatedClient();
  const memberships = await rest(
    config,
    "organization_members?select=id,user_id,organization_id,status,is_owner&status=eq.active",
  );
  const profiles = await rest(
    config,
    "profiles?select=id,auth_user_id,email,full_name,role,is_active&is_active=eq.true",
  );
  const organizations = await rest(
    config,
    `organizations?select=id,name,slug,status&id=eq.${encodeURIComponent(config.organizationId)}`,
  );
  const params = new URLSearchParams({
    select: "id,organization_id,created_date,data",
    organization_id: `eq.${config.organizationId}`,
    order: "created_date.desc",
    limit: "1000",
  });
  const leads = await rest(config, `leads?${params.toString()}`);
  const rows = Array.isArray(leads) ? leads : [];
  const eurocampLatam = rows.filter((row) => row?.data?.tipo_servico_interesse === "eurocamp_latam");
  const profileRows = Array.isArray(profiles) ? profiles : [];
  const activeMemberUserIds = new Set(
    Array.isArray(memberships)
      ? memberships.map((membership) => String(membership.user_id || "")).filter(Boolean)
      : [],
  );

  return {
    authenticated: true,
    configuredOrganizationId: config.organizationId,
    configuredOrganizationVisible: Array.isArray(organizations) && organizations.length === 1,
    activeMembershipOrganizationIds: Array.isArray(memberships)
      ? memberships.map((membership) => String(membership.organization_id || "")).filter(Boolean)
      : [],
    activeOrganizationMembers: profileRows
      .filter((profile) => activeMemberUserIds.has(String(profile.auth_user_id || profile.id || "")))
      .map((profile) => ({ email: profile.email, role: profile.role, fullName: profile.full_name })),
    visibleLeadCount: rows.length,
    eurocampLatamLeadCount: eurocampLatam.length,
    latestEurocampLatamLeadAt: eurocampLatam[0]?.created_date || null,
  };
}
