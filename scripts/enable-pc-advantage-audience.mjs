import fs from 'node:fs/promises';

if (!process.argv.includes('--apply')) throw new Error('Use --apply somente com autorizacao explicita.');

const version = process.env.META_GRAPH_VERSION || process.env.META_GRAPH_API_VERSION || 'v25.0';
const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
if (!token) throw new Error('META_SYSTEM_USER_ACCESS_TOKEN ausente.');

const expectedCampaign = '120248927547800601';
const expectedTotalCampaignBudget = 42000;
const targetAdsetId = '120248927558640601';
const protectedAdsetId = '120248927563240601';
const adsetIds = [targetAdsetId, protectedAdsetId];
const output = 'C:/Users/Admin/Documents/CODEX/2026-09-15/abr/outputs/EC10_PC_Advantage_Audience_2026-09-16.json';

async function graphGet(id, fields) {
  const url = new URL(`https://graph.facebook.com/${version}/${id}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', fields);
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `GET ${id} falhou`);
  return body;
}

async function setTargeting(id, targeting) {
  const response = await fetch(`https://graph.facebook.com/${version}/${id}`, {
    method: 'POST',
    body: new URLSearchParams({access_token: token, targeting: JSON.stringify(targeting)}),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    const safe = body?.error ? {
      message: body.error.message,
      type: body.error.type,
      code: body.error.code,
      error_subcode: body.error.error_subcode,
      error_user_title: body.error.error_user_title,
      error_user_msg: body.error.error_user_msg,
    } : {message: `POST ${id} falhou`};
    throw new Error(JSON.stringify(safe));
  }
}

const fields = 'id,name,campaign_id,status,effective_status,lifetime_budget,start_time,end_time,targeting,optimization_goal,promoted_object';
const before = [];
for (const id of adsetIds) before.push(await graphGet(id, fields));
if (before.some(row => row.campaign_id !== expectedCampaign)) throw new Error('Conjunto fora da campanha autorizada.');
if (before.reduce((sum, row) => sum + Number(row.lifetime_budget || 0), 0) !== expectedTotalCampaignBudget) throw new Error('Orcamento do Plano de Carreira divergiu de R$420.');

const changed = [];
try {
  const row = before.find(item => item.id === targetAdsetId);
  const targeting = {...row.targeting, age_max: 65, targeting_automation: {...row.targeting?.targeting_automation, advantage_audience: 1}};
  await setTargeting(row.id, targeting);
  changed.push(row.id);
} catch (error) {
  for (const row of before.filter(item => changed.includes(item.id))) {
    await setTargeting(row.id, row.targeting).catch(() => {});
  }
  throw error;
}

const after = [];
for (const id of adsetIds) after.push(await graphGet(id, fields));
const targetAfter = after.find(row => row.id === targetAdsetId);
const protectedAfter = after.find(row => row.id === protectedAdsetId);
if (Number(targetAfter.targeting?.targeting_automation?.advantage_audience) !== 1 || Number(targetAfter.targeting?.age_min) !== 25 || Number(targetAfter.targeting?.age_max) !== 65) throw new Error('Releitura nao confirmou Advantage Audience 25-65.');
if (Number(protectedAfter.targeting?.targeting_automation?.advantage_audience) !== 0 || Number(protectedAfter.targeting?.age_min) !== 18 || Number(protectedAfter.targeting?.age_max) !== 24) throw new Error('O conjunto protegido 18-24 mudou.');
if (after.reduce((sum, row) => sum + Number(row.lifetime_budget || 0), 0) !== expectedTotalCampaignBudget) throw new Error('Orcamento mudou durante a operacao.');

const report = {
  appliedAt: new Date().toISOString(),
  authorization: 'Usuario confirmou Advantage Audience somente no conjunto de responsaveis do Plano de Carreira, 25-65.',
  campaignId: expectedCampaign,
  change: 'Responsaveis: Advantage Audience 0 -> 1 e idade maxima 54 -> 65.',
  protected: {lifetimeBudgetBRL: 420, athleteAdset18To24Changed: false, internationalCampaignChanged: false, locationTargetingPreserved: true, pixelAndOptimizationPreserved: true},
  before: before.map(row => ({id: row.id, name: row.name, effectiveStatus: row.effective_status, lifetimeBudget: row.lifetime_budget, ageMin: row.targeting?.age_min, ageMax: row.targeting?.age_max, advantageAudience: row.targeting?.targeting_automation?.advantage_audience ?? 0})),
  after: after.map(row => ({id: row.id, name: row.name, effectiveStatus: row.effective_status, lifetimeBudget: row.lifetime_budget, ageMin: row.targeting?.age_min, ageMax: row.targeting?.age_max, advantageAudience: row.targeting?.targeting_automation?.advantage_audience ?? 0})),
  rollback: 'No conjunto de responsaveis, restaurar age_max 54 e targeting_automation.advantage_audience 0.',
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({status: 'applied_and_verified', campaignId: report.campaignId, protected: report.protected, after: report.after, output}, null, 2));
