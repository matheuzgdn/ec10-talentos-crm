import pg from 'pg';
import { SUPABASE_CA } from './_supabase-ca.js';

// Escopo fechado: IDs das campanhas novas autorizadas; conta e tokens sempre no ambiente.
export const BH_PRIME_CAMPAIGNS = [
  { id: '120248927547800601', label: 'Plano de Carreira', budget: 420, utm: 'pc_lead_bh_prime_v1_20260916', adsets:['120248927558640601','120248927563240601'], ads:['120248927560730601','120248927562610601','120248927568270601'] },
  { id: '120248927569070601', label: 'Plano Internacional', budget: 280, utm: 'pi_20_25_lead_bh_prime_v1_20260916', adsets:['120248927569250601','120248927580250601'], ads:['120248927575270601','120248927579980601','120248927588390601'] },
] as const;

function numeric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function graph(resource: string, parameters: Record<string, unknown> = {}) {
  const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
  if (!token) throw new Error('Meta indisponivel: token nao configurado.');
  const version = process.env.META_GRAPH_VERSION || process.env.META_GRAPH_API_VERSION || 'v25.0';
  const url = new URL(`https://graph.facebook.com/${version}/${resource}`);
  url.searchParams.set('access_token', token);
  for (const [k,v] of Object.entries(parameters)) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  for(let attempt=0;attempt<3;attempt++) {
    const response = await fetch(url, {signal: AbortSignal.timeout(25000)});
    const payload = await response.json();
    if(response.ok)return payload;
    if([4,17,32,613,80000,80004].includes(Number(payload.error?.code))&&attempt<2) {
      await new Promise(resolve=>setTimeout(resolve,(attempt+1)*3000));continue;
    }
    throw new Error(`Meta HTTP ${response.status}, codigo ${payload.error?.code ?? 'indisponivel'}: ${String(payload.error?.message||'Consulta indisponivel').slice(0,350)}`);
  }
}

async function edge(resource: string, parameters: Record<string, unknown>) {
  const first = await graph(resource, {...parameters, limit: '100'});
  const rows = [...(first.data || [])];
  let cursor = first.paging?.next ? first.paging.cursors?.after : null;
  for (let page=0; cursor && page<9; page++) {
    const next = await graph(resource, {...parameters,limit:'100',after:cursor});
    rows.push(...(next.data || []));
    cursor = next.paging?.next ? next.paging.cursors?.after : null;
  }
  return {rows,truncated:Boolean(cursor)};
}

function metrics(row: any) {
  const actions: Record<string, number|null> = {};
  for (const a of row?.actions || []) actions[a.action_type] = numeric(a.value);
  // Usar UMA familia de evento. Nao somar lead com fb_pixel_lead.
  const leads = actions['offsite_conversion.fb_pixel_lead'] ?? actions.lead ?? 0;
  const impressions = numeric(row?.impressions) ?? 0;
  const clicks = numeric(row?.inline_link_clicks) ?? 0;
  const spend = numeric(row?.spend) ?? 0;
  return {
    spend, impressions, clicks, reach:numeric(row?.reach), frequency:numeric(row?.frequency),
    landingPageViews:actions.landing_page_view ?? 0,
    metaLeads:leads,
    ctr:impressions ? clicks/impressions*100 : null,
    cpc:clicks ? spend/clicks : null,
    cpl:leads ? spend/leads : null,
    actionsByType:actions,
  };
}

async function readCrm() {
  if (!process.env.EC10_BOOKING_DB_URL) return {status:'unavailable',reason:'Banco principal EC10 nao configurado.',rows:[]};
  const dbUrl=new URL(process.env.EC10_BOOKING_DB_URL);
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])dbUrl.searchParams.delete(key);
  // Nova leitura nao reutiliza o relaxamento TLS legado de _db.ts.
  const client = new pg.Client({
    connectionString:dbUrl.href,
    ssl:{rejectUnauthorized:true,ca:process.env.SUPABASE_DB_SSL_CA?.replace(/\\n/g,'\n') || SUPABASE_CA},
    connectionTimeoutMillis:8000,
    query_timeout:10000,
  });
  try {
    await client.connect();
    await client.query('begin read only');
    const columns = await client.query("select table_name,column_name from information_schema.columns where table_schema='whatsapp_bot' and table_name in ('clients','traffic_events')");
    const has=(table:string,col:string)=>columns.rows.some(x=>x.table_name===table&&x.column_name===col);
    const clientsRequired=['id','traffic_campaign_id','traffic_ad_id','attribution_metadata','utm_campaign','status'];
    if (clientsRequired.some(x=>!has('clients',x))) throw new Error('CRM schema incomplete');
    const eventsReady=['client_id','event_type'].every(x=>has('traffic_events',x));
    const eventFlags = eventsReady ? `,
      exists(select 1 from whatsapp_bot.traffic_events e where e.client_id=c.id and e.event_type in ('QualifiedLead','qualified_lead')) as qualified,
      (exists(select 1 from whatsapp_bot.traffic_events e where e.client_id=c.id and e.event_type in ('Schedule','bot_meeting_scheduled')) or exists(select 1 from whatsapp_bot.ec10_bookings b where b.client_id=c.id and b.status='confirmed')) as scheduled,
      exists(select 1 from whatsapp_bot.traffic_events e where e.client_id=c.id and e.event_type in ('AttendedMeeting','meeting_attended')) as attended,
      exists(select 1 from whatsapp_bot.traffic_events e where e.client_id=c.id and e.event_type in ('Proposal','proposal_sent')) as proposed
    ` : ', null::boolean as qualified, null::boolean as scheduled, null::boolean as attended, null::boolean as proposed';
    const result = await client.query(`
      with cohort as (
        select c.id,
          coalesce(nullif(c.traffic_campaign_id,''),c.attribution_metadata->>'campaignId',case c.utm_campaign when $3 then $1 when $4 then $2 end) as campaign_id,
          coalesce(nullif(c.traffic_ad_id,''),c.attribution_metadata->>'adId') as ad_id,
          c.status ${eventFlags}
        from whatsapp_bot.clients c
        where c.traffic_campaign_id in ($1,$2) or c.attribution_metadata->>'campaignId' in ($1,$2) or c.utm_campaign in ($3,$4)
      )
      select campaign_id,ad_id,count(distinct id)::int as contacts,
        count(distinct id) filter(where qualified)::int as qualified,
        count(distinct id) filter(where scheduled)::int as scheduled,
        count(distinct id) filter(where attended)::int as attended,
        count(distinct id) filter(where proposed)::int as proposed,
        count(distinct id) filter(where status='fechado')::int as closed_status
      from cohort group by campaign_id,ad_id
    `,[BH_PRIME_CAMPAIGNS[0].id,BH_PRIME_CAMPAIGNS[1].id,BH_PRIME_CAMPAIGNS[0].utm,BH_PRIME_CAMPAIGNS[1].utm]);
    await client.query('rollback');
    return {status:eventsReady?'ok':'partial',reason:eventsReady?null:'Eventos CRM indisponiveis.',rows:result.rows};
  } catch(error:any) {
    const code=String(error?.code||'CRM_READ_FAILED');
    return {status:'unavailable',reason:`Leitura CRM nao validada (${/^[A-Z0-9_]+$/.test(code)?code:'CRM_READ_FAILED'}); nao significa zero leads.`,rows:[]};
  } finally {await client.end().catch(()=>{});}
}

function aggregateCrm(rows:any[],campaignId:string,adId?:string) {
  const selected=rows.filter(x=>x.campaign_id===campaignId&&(!adId||x.ad_id===adId));
  return Object.fromEntries(['contacts','qualified','scheduled','attended','proposed','closed_status'].map(k=>[k,selected.reduce((s,x)=>s+Number(x[k]||0),0)]));
}

export async function loadBhPrimeManager() {
  const raw=process.env.META_AD_ACCOUNT_ID;
  if (!raw) throw new Error('Conta Meta nao configurada.');
  const accountId=raw.startsWith('act_')?raw:`act_${raw}`;
  const [account,crm,campaignData] = await Promise.all([
    graph(accountId,{fields:'id,name,account_status,currency,timezone_name,amount_spent,spend_cap'}),
    readCrm(),
    Promise.all(BH_PRIME_CAMPAIGNS.map(async spec=>{
      const [state,sets,ads,insights,total]=await Promise.all([
        graph(spec.id,{fields:'id,name,account_id,status,effective_status'}),
        Promise.all(spec.adsets.map(id=>graph(id,{fields:'id,name,status,effective_status,lifetime_budget,start_time,end_time'}))).then(rows=>({rows,truncated:false})),
        Promise.all(spec.ads.map(id=>graph(id,{fields:'id,name,status,effective_status,adset_id,issues_info,creative{id,name,object_story_spec,url_tags}'}))).then(rows=>({rows,truncated:false})),
        edge(`${spec.id}/insights`,{level:'ad',date_preset:'maximum',fields:'campaign_id,ad_id,ad_name,spend,impressions,reach,frequency,inline_link_clicks,actions',action_report_time:'conversion'}),
        graph(`${spec.id}/insights`,{date_preset:'maximum',fields:'spend,impressions,reach,frequency,inline_link_clicks,actions',action_report_time:'conversion'}),
      ]);
      if (state.account_id!==accountId.replace('act_','')) throw new Error('Campanha nao pertence a conta autorizada.');
      return {spec,state,sets,ads,insights,total};
    })),
  ]);
  const alerts:{severity:string,message:string}[]=[];
  const campaigns=campaignData.map(({spec,state,sets,ads,insights,total})=>{
    const campaignMetrics=metrics(total.data?.[0]);
    const budget=sets.rows.reduce((s,x)=>s+Number(x.lifetime_budget||0)/100,0);
    const start=sets.rows[0]?.start_time ?? null;
    const end=sets.rows[0]?.end_time ?? null;
    const elapsed=start&&end?Math.max(0,Math.min(1,(Date.now()-Date.parse(start))/(Date.parse(end)-Date.parse(start)))):null;
    const cr=crm.status==='ok'?aggregateCrm(crm.rows,spec.id):null;
    if (budget!==spec.budget) alerts.push({severity:'critical',message:`${spec.label}: verba diverge do autorizado (${budget} vs ${spec.budget}).`});
    if (end&&Date.now()>Date.parse(end)) alerts.push({severity:'info',message:`${spec.label}: janela encerrada; nao reativar sem nova autorizacao.`});
    if (elapsed!==null&&elapsed>.3&&campaignMetrics.spend>budget*elapsed*1.5) alerts.push({severity:'warning',message:`${spec.label}: consumo acima do ritmo linear de referencia; verba vitalicia nao equivale a teto diario.`});
    const creativeRows=ads.rows.map(ad=>{
      const row=insights.rows.find(x=>x.ad_id===ad.id);
      const m=metrics(row);
      const leadCrm=crm.status==='ok'?aggregateCrm(crm.rows,spec.id,ad.id):null;
      let decision='manter';
      let rationale='Coletar dados; ainda nao ha evidencia suficiente para trocar a peca.';
      if (ad.issues_info?.length||['DISAPPROVED','WITH_ISSUES'].includes(ad.effective_status)) {
        decision='investigar';rationale='Problema objetivo de entrega: revisar motivo antes de editar.';
        alerts.push({severity:'critical',message:`${ad.name}: problema de entrega ${ad.effective_status}.`});
      } else if (m.impressions>=1500&&m.clicks>=20&&m.landingPageViews/m.clicks<.5) {
        decision='investigar';rationale='Menos de metade dos cliques virou LPV; conferir carregamento e rastreamento antes de trocar criativo.';
      } else if (m.impressions>=1500&&m.ctr!==null&&m.ctr<.7) {
        decision='testar';rationale='CTR de link abaixo de 0,7% com 1.500 impressoes: hipotese de gancho, nao prova de ausencia de vendas.';
      } else if (leadCrm&&leadCrm.contacts>=10&&leadCrm.qualified===0) {
        decision='investigar';rationale='10+ contatos sem qualificado: revisar elegibilidade, atendimento e promessa.';
      }
      const video=ad.creative?.object_story_spec?.video_data;
      return {
        id:ad.id,name:ad.name,adsetId:ad.adset_id,status:ad.status,effectiveStatus:ad.effective_status,
        ...m,crm:leadCrm,cpql:leadCrm?.qualified?m.spend/leadCrm.qualified:null,
        decision,rationale,destination:video?.call_to_action?.value?.link||null,
        currentText:video?.message||null,
        nextTest:spec.id===BH_PRIME_CAMPAIGNS[0].id
          ? 'Gancho: Treinar muito nao substitui um plano. Para atletas a partir de 8 anos, a EC10 organiza o momento atual e os proximos passos com a familia. CTA: Solicite uma analise inicial.'
          : 'Gancho: Nao e viagem em grupo: e o seu projeto individual. A EC10 analisa o perfil do atleta de 20 a 25 anos e organiza o direcionamento para avaliacao internacional. CTA: Entenda se o seu perfil e compativel. Sem promessa de contrato.',
      };
    });
    return {
      id:spec.id,label:spec.label,name:state.name,status:state.status,effectiveStatus:state.effective_status,
      authorizedBudget:spec.budget,configuredBudget:budget,remaining:Math.max(0,spec.budget-campaignMetrics.spend),
      spentPercent:campaignMetrics.spend/spec.budget*100,elapsedPercent:elapsed!==null?elapsed*100:null,start,end,
      ...campaignMetrics,crm:cr,cpql:cr?.qualified?campaignMetrics.spend/cr.qualified:null,
      adsets:sets.rows,ads:creativeRows,
      truncated:sets.truncated||ads.truncated||insights.truncated,
    };
  });
  const spend=campaigns.reduce((s,x)=>s+x.spend,0);
  const cap=Number(account.spend_cap||0);
  const accountRemaining=cap>0?Math.max(0,cap-Number(account.amount_spent||0))/100:null;
  if (spend>=700) alerts.push({severity:'critical',message:'Teto de R$700 consumido. Pausar somente as duas campanhas do piloto; nao elevar verba.'});
  if (accountRemaining!==null&&accountRemaining<700-spend) alerts.push({severity:'warning',message:'Limite compartilhado da conta menor que o restante do piloto; campanhas alheias podem consumir esse limite.'});
  if (crm.status!=='ok') alerts.push({severity:'warning',message:crm.reason||'Dados comerciais indisponiveis.'});
  return {
    collectedAt:new Date().toISOString(),mode:'read_only',timezone:account.timezone_name,currency:account.currency,
    account:{id:account.id,name:account.name,status:account.account_status,remainingSpendCap:accountRemaining},
    total:{authorized:700,configured:campaigns.reduce((s,x)=>s+x.configuredBudget,0),spend,remaining:Math.max(0,700-spend)},
    crmStatus:crm.status,crmReason:crm.reason,alerts,campaigns,
    measurement:'Leads Meta usam uma familia de acao; contatos CRM por client_id. Fechado e status, nao receita paga. Atribuicao Meta pode ter atraso. Ritmo linear e referencia, nao limite diario.',
    policy:'Nao aumentar verba, criar campanhas ou substituir criativos automaticamente. Preparar variantes e propor teste apos evidencia; qualquer acao de seguranca usa somente os IDs deste piloto.',
  };
}
