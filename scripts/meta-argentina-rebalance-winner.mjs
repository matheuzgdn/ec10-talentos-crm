/**
 * Redistribui o saldo futuro da campanha Argentina para 75% no LAL vencedor
 * e 25% no publico quente, preservando o teto vitalicio exato de R$175.
 *
 * Padrao: somente leitura.
 * Aplicacao: --apply --confirm=REBALANCEAR-ARGENTINA-75-25
 */

const GRAPH_VERSION = "v25.0";
const TOKEN = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const ACCOUNT_ID = normalizeAccountId(process.env.META_AD_ACCOUNT_ID || "");
const TOTAL_LIFETIME_BUDGET_CENTS = 17_500;
const WARM_FUTURE_SHARE = 0.25;
const CONFIRMATION = "REBALANCEAR-ARGENTINA-75-25";

const IDS = Object.freeze({
  campaign: "120247606271030601",
  warmAdset: "120247606274320601",
  lookalikeAdset: "120247645356200601",
  warmWinnerAd: "120247634325330601",
  lookalikeWinnerAd: "120247645356580601",
  paymentStaticAd: "120247606282860601",
  paymentVideoAd: "120247611422200601",
});

const args = parseArgs(process.argv.slice(2));
const APPLY = args.apply === true;

if (!TOKEN || !ACCOUNT_ID) throw new Error("Carregue o perfil ec10-manager.");
if (APPLY && args.confirm !== CONFIRMATION) {
  throw new Error(`Aplicacao bloqueada. Use --confirm=${CONFIRMATION}.`);
}

function normalizeAccountId(value) {
  const text = String(value || "").trim();
  return text.startsWith("act_") ? text : `act_${text}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    parsed[key] = rest.length ? rest.join("=") : true;
  }
  return parsed;
}

function sanitizeError(payload, status) {
  const error = payload?.error || {};
  return [
    error.message || `Meta HTTP ${status}`,
    error.code ? `code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""}` : "",
    error.error_user_title,
    error.error_user_msg,
  ].filter(Boolean).join(" - ").slice(0, 1600);
}

async function metaGet(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  url.searchParams.set("access_token", TOKEN);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function metaPost(path, body) {
  if (!APPLY) throw new Error("POST bloqueado no modo somente leitura.");
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  form.set("access_token", TOKEN);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(sanitizeError(payload, response.status));
  return payload;
}

async function readState() {
  const fields = "id,name,status,effective_status,lifetime_budget,budget_remaining,end_time,issues_info";
  const [account, campaign, warmAdset, lookalikeAdset, warmWinnerAd, lookalikeWinnerAd, paymentStaticAd, paymentVideoAd] =
    await Promise.all([
      metaGet(ACCOUNT_ID, { fields: "id,name,account_status,currency,balance,amount_spent,spend_cap" }),
      metaGet(IDS.campaign, { fields: "id,name,status,effective_status,issues_info" }),
      metaGet(IDS.warmAdset, { fields }),
      metaGet(IDS.lookalikeAdset, { fields }),
      metaGet(IDS.warmWinnerAd, { fields: "id,status,effective_status,issues_info" }),
      metaGet(IDS.lookalikeWinnerAd, { fields: "id,status,effective_status,issues_info" }),
      metaGet(IDS.paymentStaticAd, { fields: "id,status,effective_status" }),
      metaGet(IDS.paymentVideoAd, { fields: "id,status,effective_status" }),
    ]);

  return {
    account,
    campaign,
    warmAdset,
    lookalikeAdset,
    warmWinnerAd,
    lookalikeWinnerAd,
    paymentStaticAd,
    paymentVideoAd,
  };
}

function validateState(state) {
  if (state.account.account_status !== 1) throw new Error("Conta Meta nao esta ativa.");
  if (state.campaign.effective_status !== "ACTIVE") throw new Error("Campanha nao esta ativa.");
  for (const adset of [state.warmAdset, state.lookalikeAdset]) {
    if (adset.effective_status !== "ACTIVE") throw new Error(`Conjunto ${adset.id} nao esta ativo.`);
    if (Array.isArray(adset.issues_info) && adset.issues_info.length) {
      throw new Error(`Conjunto ${adset.id} possui alerta de entrega.`);
    }
  }
  for (const ad of [state.warmWinnerAd, state.lookalikeWinnerAd]) {
    if (ad.effective_status !== "ACTIVE") throw new Error(`Anuncio vencedor ${ad.id} nao esta ativo.`);
  }
  for (const ad of [state.paymentStaticAd, state.paymentVideoAd]) {
    if (ad.status !== "PAUSED") throw new Error(`Anuncio perdedor ${ad.id} nao esta pausado.`);
  }
}

function calculatePlan(state) {
  const warmSpent = Number(state.warmAdset.lifetime_budget) - Number(state.warmAdset.budget_remaining);
  const lookalikeSpent = Number(state.lookalikeAdset.lifetime_budget) - Number(state.lookalikeAdset.budget_remaining);
  const totalSpent = warmSpent + lookalikeSpent;
  const futureBudget = TOTAL_LIFETIME_BUDGET_CENTS - totalSpent;

  if (!Number.isFinite(futureBudget) || futureBudget <= 0) {
    throw new Error("Nao ha saldo vitalicio futuro para redistribuir.");
  }

  const warmFuture = Math.round(futureBudget * WARM_FUTURE_SHARE);
  const warmLifetime = warmSpent + warmFuture;
  const lookalikeLifetime = TOTAL_LIFETIME_BUDGET_CENTS - warmLifetime;
  const lookalikeFuture = lookalikeLifetime - lookalikeSpent;

  if (warmFuture <= 0 || lookalikeFuture <= 0) throw new Error("Redistribuicao resultou em saldo invalido.");

  return {
    warmSpent,
    lookalikeSpent,
    totalSpent,
    futureBudget,
    warmFuture,
    lookalikeFuture,
    warmLifetime,
    lookalikeLifetime,
  };
}

function brl(cents) {
  return Number((Number(cents) / 100).toFixed(2));
}

function snapshot(state, plan) {
  const accountBalance = Number(state.account.balance || 0);
  return {
    checkedAt: new Date().toISOString(),
    account: {
      id: state.account.id,
      status: state.account.account_status,
      prepaidBalanceBrl: brl(accountBalance),
    },
    campaign: {
      id: state.campaign.id,
      name: state.campaign.name,
      status: state.campaign.effective_status,
      exactLifetimeBudgetBrl: brl(plan.warmLifetime + plan.lookalikeLifetime),
    },
    spentBrl: {
      warm: brl(plan.warmSpent),
      lookalike: brl(plan.lookalikeSpent),
      total: brl(plan.totalSpent),
    },
    futureBrl: {
      warm: brl(plan.warmFuture),
      lookalike: brl(plan.lookalikeFuture),
      total: brl(plan.futureBudget),
      warmSharePercent: Number(((plan.warmFuture / plan.futureBudget) * 100).toFixed(1)),
      lookalikeSharePercent: Number(((plan.lookalikeFuture / plan.futureBudget) * 100).toFixed(1)),
    },
    newLifetimeBrl: {
      warm: brl(plan.warmLifetime),
      lookalike: brl(plan.lookalikeLifetime),
      total: brl(plan.warmLifetime + plan.lookalikeLifetime),
    },
  };
}

const before = await readState();
validateState(before);
const plan = calculatePlan(before);

if (!APPLY) {
  console.log(JSON.stringify({ mode: "read_only", ready: true, proposed: snapshot(before, plan) }, null, 2));
} else {
  const warmName = `GRUPO VIDEO ORIGINAL | WARM EC10 | BA 40KM | SALDO 25% | LT R$${Math.round(brl(plan.warmLifetime))}`;
  const lookalikeName = `VENCEDOR | LAL AR 1% EC10 | IG | BA 40KM | 18-44 | SALDO 75% | LT R$${Math.round(brl(plan.lookalikeLifetime))}`;
  const campaignName = "LEADS | RT ARG | VIDEO ORIGINAL | LAL 75% + WARM 25% | LT R$175 | 13-17 JUL";

  await metaPost(IDS.warmAdset, {
    name: warmName,
    lifetime_budget: String(plan.warmLifetime),
  });
  await metaPost(IDS.lookalikeAdset, {
    name: lookalikeName,
    lifetime_budget: String(plan.lookalikeLifetime),
  });
  await metaPost(IDS.campaign, { name: campaignName });

  const after = await readState();
  validateState(after);
  const finalTotal = Number(after.warmAdset.lifetime_budget) + Number(after.lookalikeAdset.lifetime_budget);
  if (finalTotal !== TOTAL_LIFETIME_BUDGET_CENTS) {
    throw new Error(`Teto final incorreto: ${finalTotal}.`);
  }

  console.log(JSON.stringify({
    mode: "applied",
    appliedAt: new Date().toISOString(),
    plannedFromSnapshot: snapshot(before, plan),
    final: {
      campaign: { id: after.campaign.id, name: after.campaign.name, status: after.campaign.effective_status },
      warm: {
        id: after.warmAdset.id,
        name: after.warmAdset.name,
        status: after.warmAdset.effective_status,
        lifetimeBudgetBrl: brl(after.warmAdset.lifetime_budget),
        budgetRemainingBrl: brl(after.warmAdset.budget_remaining),
      },
      lookalike: {
        id: after.lookalikeAdset.id,
        name: after.lookalikeAdset.name,
        status: after.lookalikeAdset.effective_status,
        lifetimeBudgetBrl: brl(after.lookalikeAdset.lifetime_budget),
        budgetRemainingBrl: brl(after.lookalikeAdset.budget_remaining),
      },
      exactLifetimeBudgetBrl: brl(finalTotal),
    },
  }, null, 2));
}
