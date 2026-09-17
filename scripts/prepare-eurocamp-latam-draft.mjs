import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("CRM database profile is not loaded");

const name = "EUROCAMP 2027 | AR + CL + PY | ADVANTAGE+ | LEADS ES | 3D | 40-30-30";
const destinationUrl = "https://ec10talentos.com/eurocamp/?lang=es&utm_source=meta&utm_medium=paid_social&utm_campaign=eurocamp_2027_latam_3d&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}";
const groupUrl = "https://chat.whatsapp.com/LcOtqReBF3u7QVUEkEf8e6?s=cl&p=a&mlu=4";
const creativePath = "C:/Users/Admin/Desktop/videos erick/PROVAS SOCIAIS-cópia-cópia (3)-cópia(1)/PROVAS SOCIAIS-cópia-cópia (3)-cópia(1).mp4";

const payload = {
  readiness: "waiting_total_budget",
  account_id: "act_1235838336986319",
  identity: "EC10 Talentos / Eurocamp 2027",
  objective: "OUTCOME_LEADS",
  optimization_event: "Lead",
  schedule: {
    timezone: "America/Sao_Paulo",
    duration_days: 3,
    allocation_percent: [40, 30, 30],
    hard_stop: true,
  },
  adsets: [{
    key: "latam_hispana",
    label: "ARGENTINA + CHILE + PARAGUAI | ADVANTAGE+ | ATLETAS E RESPONSAVEIS 18-65",
    countries: ["AR", "CL", "PY"],
    language: "es",
    audience: "Padres, madres y responsables de atletas; el creativo y el formulario hacen la autoseleccion",
    advantage_audience: true,
  }],
  creative: {
    path: creativePath,
    format: "9:16",
    language: "es",
    proof: "Eric en Madrid / Bernabeu",
  },
  tracking: {
    pixel_id: "834310425674029",
    browser_event: "Lead",
    capi_event: "Lead",
    crm_event: "eurocamp_latam_simple_submitted",
    crm_pipeline: "eurocamp_latam",
    deduplication: "shared_event_id",
    required_parameters: ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "campaign_id", "adset_id", "ad_id", "fbclid", "fbp", "fbc"],
  },
  final_destination: groupUrl,
  exclusions: ["existing_eurocamp_leads", "eurocamp_latam_submitters"],
  guards: {
    maximum_available_account_cap_brl: 291.09,
    authorized_total_budget_brl: null,
    activation_requires_exact_budget: true,
    no_qualified_lead_optimization_until_volume: true,
  },
};

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
try {
  const existing = await pool.query(
    `select id from public.traffic_campaign_drafts where name = $1 and status in ('draft', 'pending_approval', 'approved') order by created_at desc limit 1`,
    [name],
  );
  const values = [
    name,
    "OUTCOME_LEADS",
    "pending_approval",
    "eurocamp_latam",
    18,
    65,
    ["Argentina", "Chile", "Paraguai"],
    ["Pais e responsaveis", "Futebol juvenil", "Viagens internacionais"],
    ["advantage_plus_placements"],
    destinationUrl,
    "Video em espanhol com prova social real de Eric em Madrid. Uma variavel criativa principal para preservar aprendizado.",
    "Aprendizado EC10 favorece pagina com formulario; Argentina mostrou melhor CPL historico, enquanto o bloco premium deve ser lido por qualidade comercial.",
    JSON.stringify(payload),
  ];

  let result;
  if (existing.rows[0]?.id) {
    result = await pool.query(
      `update public.traffic_campaign_drafts set objective=$2,status=$3,service_interest=$4,budget_daily=null,budget_total=null,age_min=$5,age_max=$6,locations=$7,interests=$8,placements=$9,destination_url=$10,creative_notes=$11,ai_rationale=$12,meta_payload=$13::jsonb,publish_error=null,updated_at=now() where id=$14 returning id,name,status,budget_total`,
      [...values, existing.rows[0].id],
    );
  } else {
    result = await pool.query(
      `insert into public.traffic_campaign_drafts (name,objective,status,service_interest,budget_daily,budget_total,age_min,age_max,locations,interests,placements,destination_url,creative_notes,ai_rationale,meta_payload) values ($1,$2,$3,$4,null,null,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) returning id,name,status,budget_total`,
      values,
    );
  }
  console.log(JSON.stringify({ ok: true, draft: result.rows[0], activationBlockedBy: "exact_total_budget" }));
} finally {
  await pool.end();
}
