import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;
const apply = process.argv.includes('--apply');
const required = [
  'SUPABASE_DB_URL',
  'TARGET_SUPABASE_URL',
  'TARGET_SUPABASE_ANON_KEY',
  'TARGET_ADMIN_EMAIL',
  'TARGET_ADMIN_PASSWORD',
  'TARGET_ORGANIZATION_ID',
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Variavel obrigatoria ausente: ${name}`);
}

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2);
  return digits;
};

const textIncludes = (client, needle) => {
  const haystack = JSON.stringify({
    tags: client.tags || [],
    service: client.service_interest,
    source: client.source,
    attribution: client.attribution_metadata || {},
  }).toLowerCase();
  return haystack.includes(needle);
};

function classifyService(client) {
  if (textIncludes(client, 'libertacademy') || textIncludes(client, 'liberta_academy')) return 'Libertacademy';
  if (textIncludes(client, 'sudamerica') || textIncludes(client, 'sudamericana')) return 'Academy Sudamerica';
  if (textIncludes(client, 'eurocamp')) return 'EC10 Eurocamp';
  if (textIncludes(client, 'mentoria')) return 'Mentoria Instagram';
  if (client.service_interest === 'plano_internacional') return 'Plano Internacional';
  if (client.service_interest === 'plano_carreira') return 'Plano de Carreira';
  return 'A classificar';
}

const statusMap = {
  novo: 'novo_lead',
  triagem: 'contato_realizado',
  orcamento: 'qualificado',
  aguardando_cliente: 'reuniao_agendada',
  quente: 'negociacao',
  fechado: 'cliente_fechado',
  perdido: 'perdido',
};

function targetStatus(client) {
  const mapped = statusMap[client.status] || 'novo_lead';
  const meetingScheduled = (client.tags || []).some((tag) => /reuniao_agendada|presenca_confirmada/.test(tag));
  const earlierStages = ['novo_lead', 'contato_realizado', 'qualificado', 'transferido_para_vendas'];
  return meetingScheduled && earlierStages.includes(mapped) ? 'reuniao_agendada' : mapped;
}

function clientData(client) {
  const metadata = client.attribution_metadata || {};
  const service = classifyService(client);
  const status = targetStatus(client);
  const schoolLead = ['Libertacademy', 'Academy Sudamerica'].includes(service)
    || (client.tags || []).some((tag) => /escola|projeto_futebol|gestor/.test(tag));
  const adminEmail = process.env.TARGET_ADMIN_EMAIL;

  return {
    nome_atleta: client.name || metadata.athleteName || `Lead ${client.phone}`,
    telefone: client.phone,
    cidade: metadata.city || client.region || '',
    idade: metadata.athleteAge || metadata.age || null,
    status,
    convertido: status === 'cliente_fechado',
    tipo_lead: schoolLead ? 'escola' : 'atleta',
    tipo_servico_interesse: service,
    origem_captacao: client.source || client.traffic_source || metadata.utmSource || 'WhatsApp CRM',
    landing_variant: metadata.landingVariant || metadata.formVariant || '',
    responsavel: metadata.guardianName || metadata.responsibleName || '',
    responsavel_atual: adminEmail,
    responsavel_atual_nome: 'Matheus Gomes',
    responsavel_inicial: adminEmail,
    vendedor_responsavel: adminEmail,
    vendedor_nome: 'Matheus Gomes',
    observacoes: client.notes || '',
    lead_score: client.lead_score ?? metadata.qualificationScore ?? null,
    utm_source: client.utm_source || metadata.utmSource || '',
    utm_medium: client.utm_medium || metadata.utmMedium || '',
    utm_campaign: client.utm_campaign || metadata.utmCampaign || '',
    utm_content: client.utm_content || metadata.utmContent || '',
    utm_term: client.utm_term || metadata.utmTerm || '',
    fbclid: client.fbclid || metadata.fbclid || '',
    gclid: client.gclid || metadata.gclid || '',
    traffic_campaign_id: client.traffic_campaign_id || '',
    traffic_campaign_name: client.traffic_campaign_name || metadata.utmCampaign || '',
    traffic_adset_id: client.traffic_adset_id || '',
    traffic_ad_id: client.traffic_ad_id || '',
    whatsapp_crm_status: client.status,
    whatsapp_crm_tags: client.tags || [],
    whatsapp_crm_client_id: client.id,
    whatsapp_crm_last_message_at: client.last_message_at,
    attribution_metadata: metadata,
    foundation_status: metadata.foundationStatus || '',
    foundation_answer: metadata.foundationAnswer || '',
    sync_source: 'cliente-whatsapp-crm',
    synced_at: new Date().toISOString(),
  };
}

async function loadTargetLeads(supabase, organizationId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, created_date, updated_date, data, organization_id')
      .eq('organization_id', organizationId)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const sourceDb = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await sourceDb.connect();
const { rows: sourceClients } = await sourceDb.query(`
  select *
  from public.clients
  where created_at >= timestamp with time zone '2026-06-20T00:00:00-03:00'
    and not ('crm_excluido_manual' = any(coalesce(tags, array[]::text[])))
    and not ('crm_arquivado' = any(coalesce(tags, array[]::text[])))
    and not ('crm_arquivado_pre_2026_06_20' = any(coalesce(tags, array[]::text[])))
  order by created_at asc
`);
await sourceDb.end();

const target = createClient(
  process.env.TARGET_SUPABASE_URL,
  process.env.TARGET_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: auth, error: authError } = await target.auth.signInWithPassword({
  email: process.env.TARGET_ADMIN_EMAIL,
  password: process.env.TARGET_ADMIN_PASSWORD,
});
if (authError || !auth.user) throw authError || new Error('Falha de autenticacao no destino.');

const organizationId = process.env.TARGET_ORGANIZATION_ID;
const targetLeads = await loadTargetLeads(target, organizationId);
const targetByPhone = new Map();
for (const lead of targetLeads) {
  const phone = normalizePhone(lead.data?.telefone);
  if (phone && !targetByPhone.has(phone)) targetByPhone.set(phone, lead);
}

const inserts = [];
const updates = [];
const serviceCounts = {};
for (const client of sourceClients) {
  const data = clientData(client);
  serviceCounts[data.tipo_servico_interesse] = (serviceCounts[data.tipo_servico_interesse] || 0) + 1;
  const existing = targetByPhone.get(normalizePhone(client.phone));
  if (!existing) {
    inserts.push({
      organization_id: organizationId,
      created_date: client.created_at,
      updated_date: client.updated_at || client.created_at,
      created_by: process.env.TARGET_ADMIN_EMAIL,
      created_by_id: auth.user.id,
      updated_by: process.env.TARGET_ADMIN_EMAIL,
      updated_by_id: auth.user.id,
      data,
    });
    continue;
  }

  const previous = existing.data || {};
  const wasPreviouslySynced = previous.sync_source === 'cliente-whatsapp-crm';
  updates.push({
    id: existing.id,
    data: {
      ...data,
      ...previous,
      tipo_servico_interesse: previous.tipo_servico_interesse || data.tipo_servico_interesse,
      status: wasPreviouslySynced ? data.status : (previous.status || data.status),
      convertido: wasPreviouslySynced ? data.convertido : Boolean(previous.convertido || data.convertido),
      responsavel_atual: previous.responsavel_atual || data.responsavel_atual,
      responsavel_atual_nome: previous.responsavel_atual_nome || data.responsavel_atual_nome,
      vendedor_responsavel: previous.vendedor_responsavel || data.vendedor_responsavel,
      vendedor_nome: previous.vendedor_nome || data.vendedor_nome,
      whatsapp_crm_client_id: client.id,
      whatsapp_crm_status: client.status,
      whatsapp_crm_tags: client.tags || [],
      attribution_metadata: data.attribution_metadata,
      sync_source: 'cliente-whatsapp-crm',
      synced_at: data.synced_at,
    },
  });
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  source: sourceClients.length,
  targetBefore: targetLeads.length,
  inserts: inserts.length,
  updates: updates.length,
  services: serviceCounts,
}, null, 2));

if (!apply) process.exit(0);

for (let index = 0; index < inserts.length; index += 50) {
  const { error } = await target.from('leads').insert(inserts.slice(index, index + 50));
  if (error) throw error;
}
for (const update of updates) {
  const { error } = await target
    .from('leads')
    .update({ data: update.data, updated_date: new Date().toISOString() })
    .eq('id', update.id)
    .eq('organization_id', organizationId);
  if (error) throw error;
}

const after = await loadTargetLeads(target, organizationId);
console.log(JSON.stringify({ applied: true, targetAfter: after.length }, null, 2));
