const accountId = String(process.env.META_AD_ACCOUNT_ID || '').trim();
const accessToken = String(process.env.META_SYSTEM_USER_ACCESS_TOKEN || '').trim();
const graphVersion = String(process.env.META_GRAPH_VERSION || 'v25.0').trim();
const apply = process.argv.includes('--apply');

if (!/^act_\d+$/.test(accountId)) throw new Error('META_AD_ACCOUNT_ID ausente ou invalido.');
if (!accessToken) throw new Error('META_SYSTEM_USER_ACCESS_TOKEN ausente.');

async function graphGet(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Meta HTTP ${response.status}`);
  return body;
}

async function graphPost(path, params) {
  const body = new URLSearchParams(params);
  body.set('access_token', accessToken);
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error?.message || `Meta HTTP ${response.status}`);
  }
  return payload;
}

async function allCampaigns() {
  let next = new URL(`https://graph.facebook.com/${graphVersion}/${accountId}/campaigns`);
  next.searchParams.set('fields', 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,updated_time');
  next.searchParams.set('limit', '250');
  next.searchParams.set('access_token', accessToken);
  const rows = [];
  while (next) {
    const response = await fetch(next, { signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Meta HTTP ${response.status}`);
    rows.push(...(payload.data || []));
    next = payload.paging?.next ? new URL(payload.paging.next) : null;
  }
  return rows;
}

const account = await graphGet(accountId, {
  fields: 'id,name,account_status,currency,timezone_name,disable_reason'
});
const before = await allCampaigns();
const activeBefore = before.filter((campaign) => campaign.status === 'ACTIVE');
const changed = [];

if (apply) {
  for (const campaign of activeBefore) {
    await graphPost(campaign.id, { status: 'PAUSED' });
    changed.push({ id: campaign.id, name: campaign.name, from: campaign.status, to: 'PAUSED' });
  }
}

const after = apply ? await allCampaigns() : before;
const activeAfter = after.filter((campaign) => campaign.status === 'ACTIVE');
const effectiveActiveAfter = after.filter((campaign) => campaign.effective_status === 'ACTIVE');

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry_run',
  checkedAt: new Date().toISOString(),
  account: {
    id: account.id,
    name: account.name,
    accountStatus: account.account_status,
    currency: account.currency,
    timezone: account.timezone_name,
    disableReason: account.disable_reason
  },
  totals: {
    campaigns: before.length,
    activeBefore: activeBefore.length,
    pausedNow: changed.length,
    activeAfter: activeAfter.length,
    effectiveActiveAfter: effectiveActiveAfter.length
  },
  activeBefore: activeBefore.map(({ id, name, status, effective_status, objective, updated_time }) => ({
    id, name, status, effectiveStatus: effective_status, objective, updatedTime: updated_time
  })),
  changed,
  activeAfter: activeAfter.map(({ id, name, status, effective_status }) => ({
    id, name, status, effectiveStatus: effective_status
  })),
  verification: apply
    ? activeAfter.length === 0 && effectiveActiveAfter.length === 0
    : null
}, null, 2));
