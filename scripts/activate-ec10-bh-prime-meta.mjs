import fs from 'node:fs/promises';

const sourcePath = 'C:\\Users\\Admin\\Documents\\CODEX\\2026-09-15\\abr\\outputs\\EC10_Meta_BH_Prime_Creation_2026-09-16.json';
const outputPath = 'C:\\Users\\Admin\\Documents\\CODEX\\2026-09-15\\abr\\outputs\\EC10_Meta_BH_Prime_Activation_2026-09-16.json';
const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
const rawAccount = process.env.META_AD_ACCOUNT_ID;
const accountId = rawAccount?.startsWith('act_') ? rawAccount : `act_${rawAccount}`;
const version = process.env.META_GRAPH_VERSION || process.env.META_GRAPH_API_VERSION || 'v25.0';
const apply = process.argv.includes('--activate');
const budget = Number(process.argv.find(x => x.startsWith('--budget='))?.split('=')[1] || 0);
if (!token || !rawAccount || !process.env.META_PIXEL_ID) throw new Error('Perfil Meta incompleto.');
if (apply && budget !== 70000) throw new Error('Ativacao exige exatamente --budget=70000.');

async function graph(resource, fields, body) {
  const url = new URL(`https://graph.facebook.com/${version}/${resource}`);
  const options = { signal: AbortSignal.timeout(45000) };
  if (body) {
    if (!apply) throw new Error('POST bloqueado em auditoria.');
    options.method = 'POST';
    const form = new URLSearchParams({ access_token: token });
    for (const [k,v] of Object.entries(body)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    options.body = form;
  } else {
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', token);
  }
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error([payload.error?.message, payload.error?.error_user_msg].filter(Boolean).join(' - ').slice(0,1500));
  return payload;
}

const saved = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const state = { startedAt: new Date().toISOString(), authorization: 'Usuario: ative agora; teto R$700 em 7 dias; somente BH Prime PC e PI', result: 'AUDITING', changed: [], before: {}, after: {} };
try {
  const ids = saved.created;
  if (ids.campaigns.length !== 2 || ids.adsets.length !== 4 || ids.ads.length !== 6) throw new Error('Manifesto inesperado.');
  const [account, campaigns, adsets, ads, config, ...pages] = await Promise.all([
    graph(accountId, 'id,name,account_status,currency,timezone_name,spend_cap,amount_spent,balance,funding_source_details'),
    Promise.all(ids.campaigns.map(x => graph(x.id, 'id,name,account_id,status,effective_status,objective'))),
    Promise.all(ids.adsets.map(x => graph(x.id, 'id,name,account_id,status,effective_status,lifetime_budget,start_time,end_time,promoted_object,targeting'))),
    Promise.all(ids.ads.map(x => graph(x.id, 'id,name,account_id,status,effective_status,issues_info,creative{id,object_story_spec,url_tags}'))),
    fetch('https://ec10talentos.com/api/meta-config').then(x => x.json()),
    ...['plano-de-carreira','plano-internacional'].map(x => fetch(`https://ec10talentos.com/lp/${x}/`).then(r => ({path:x,status:r.status}))),
  ]);
  const remaining = Number(account.spend_cap) > 0 ? Number(account.spend_cap)-Number(account.amount_spent) : null;
  state.before = { account: {id:account.id,name:account.name,status:account.account_status,currency:account.currency,timezone:account.timezone_name,remainingSpendCapCents:remaining,balance:account.balance,funding:account.funding_source_details}, campaigns, adsets, ads, pages };
  const all = [...campaigns,...adsets,...ads];
  if (Number(account.account_status)!==1 || account.currency!=='BRL' || account.timezone_name!=='America/Sao_Paulo') throw new Error('Conta/moeda/fuso inesperados.');
  if (remaining !== null && remaining < 70000) throw new Error('Limite da conta insuficiente para o teto autorizado.');
  if (all.some(x => x.account_id !== accountId.slice(4))) throw new Error('Objeto fora da conta autorizada.');
  if (all.some(x => x.status !== 'PAUSED')) throw new Error('Objeto nao esta pausado; ativacao nao idempotente bloqueada.');
  if (ads.some(x => ['DISAPPROVED','WITH_ISSUES','PENDING_REVIEW','IN_PROCESS'].includes(x.effective_status) || x.issues_info?.length)) throw new Error('Anuncio em revisao ou com problema; nao ativar.');
  if (adsets.reduce((s,x)=>s+Number(x.lifetime_budget),0)!==70000) throw new Error('Teto vitalicio diferente de R$700.');
  if (adsets.some(x=>x.promoted_object?.pixel_id!==process.env.META_PIXEL_ID || x.promoted_object?.custom_event_type!=='LEAD')) throw new Error('Evento/pixel do conjunto inesperado.');
  if (config.pixelId!==process.env.META_PIXEL_ID || pages.some(x=>x.status!==200)) throw new Error('Pagina/pixel nao prontos.');
  for (const ad of ads) {
    const story = ad.creative.object_story_spec;
    if (story.page_id !== process.env.META_PAGE_ID || story.instagram_user_id !== (process.env.META_EC10_INSTAGRAM_ID || process.env.META_INSTAGRAM_BUSINESS_ID)) throw new Error('Pagina/Instagram inesperados.');
    const url=story.video_data?.call_to_action?.value?.link;
    if (!['https://ec10talentos.com/lp/plano-de-carreira/','https://ec10talentos.com/lp/plano-internacional/'].includes(url)) throw new Error('Destino inesperado.');
  }
  state.result='AUDIT_OK';
  if (apply) {
    const start=Math.floor(Date.now()/1000)+300;
    const end=start+7*86400;
    state.schedule={start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString(),durationDays:7};
    // Pais continuam pausados durante a atualizacao e a ativacao dos filhos.
    for (const adset of adsets) {
      await graph(adset.id,null,{start_time:start,end_time:end,status:'PAUSED'});
      state.changed.push({id:adset.id,kind:'schedule',start,end});
    }
    for (const ad of ads) { await graph(ad.id,null,{status:'ACTIVE'}); state.changed.push({id:ad.id,kind:'ad',status:'ACTIVE'}); }
    for (const adset of adsets) { await graph(adset.id,null,{status:'ACTIVE'}); state.changed.push({id:adset.id,kind:'adset',status:'ACTIVE'}); }
    for (const campaign of campaigns) { await graph(campaign.id,null,{status:'ACTIVE'}); state.changed.push({id:campaign.id,kind:'campaign',status:'ACTIVE'}); }
    state.after={
      campaigns:await Promise.all(ids.campaigns.map(x=>graph(x.id,'id,name,status,effective_status'))),
      adsets:await Promise.all(ids.adsets.map(x=>graph(x.id,'id,name,status,effective_status,lifetime_budget,start_time,end_time'))),
      ads:await Promise.all(ids.ads.map(x=>graph(x.id,'id,name,status,effective_status,issues_info'))),
    };
    if ([...state.after.campaigns,...state.after.adsets,...state.after.ads].some(x=>x.status!=='ACTIVE')) throw new Error('Ativacao nao confirmada em todos os objetos.');
    if (state.after.adsets.reduce((s,x)=>s+Number(x.lifetime_budget),0)!==70000) throw new Error('Verba alterada apos ativacao.');
    state.result='ACTIVATED';
  }
} catch (error) {
  state.result='BLOCKED_OR_PARTIAL';
  state.error=String(error.message || error);
  // Falha da propria operacao: bloquear entrega apenas das campanhas deste manifesto.
  if (apply && state.changed.length) {
    state.safetyPause=[];
    for (const c of saved.created.campaigns) {
      try {await graph(c.id,null,{status:'PAUSED'});state.safetyPause.push(await graph(c.id,'id,status,effective_status'));}
      catch {state.safetyPause.push({id:c.id,result:'FAILED_NEEDS_ATTENTION'});}
    }
  }
  process.exitCode=1;
}
state.finishedAt=new Date().toISOString();
state.rollback='Pausar somente as duas campanhas novas pelos IDs registrados; nao elevar limites nem alterar campanhas alheias.';
await fs.writeFile(outputPath,JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify({result:state.result,error:state.error,account:state.before.account,schedule:state.schedule,after:state.after,safetyPause:state.safetyPause,output:outputPath},null,2));
