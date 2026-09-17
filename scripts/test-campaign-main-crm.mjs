import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { bookingPool } from '../api/_booking-db.ts';
import { saveCampaignRegistration,campaignPrefill,CAMPAIGN_FUNNEL } from '../api/_campaign-crm.ts';
const db=await bookingPool.connect();
let checks=0;
const check=(condition)=>{assert.ok(condition);checks++;};
const count=async()=>Number((await db.query('select count(*) as n from whatsapp_bot.ec10_campaign_registrations')).rows[0].n);
const baseline=await count();
try {
 await db.query('begin');
 const outbound=Number((await db.query('select count(*) as n from whatsapp_bot.outbound_messages')).rows[0].n);
 for(const [id,service,role] of [['carreira','plano_carreira','responsavel'],['temporada','plano_internacional','atleta'],['kids','eurocamp','responsavel'],['juvenil','eurocamp','responsavel']]) {
  const phone='120255501'+String(checks%99).padStart(2,'0');
  check(!(await db.query('select id from whatsapp_bot.clients where phone=$1',[phone])).rowCount);
  const input={phone,name:'EC10 QA Rollback',email:'ec10-qa@example.invalid',role,countryCode:'US',productId:id,
   product:{service,label:'QA '+id},traffic:{utmSource:'qa_rollback',utmCampaign:'qa_rollback'},
   attribution:{capturedAt:new Date().toISOString()},eventId:'qa-rollback-'+crypto.randomUUID(),tags:['qa_rollback']};
  const result=await saveCampaignRegistration(db,input);
  check(result.botActivated && result.crmLeadId && result.bookingUrl);
  const token=new URL(result.bookingUrl).searchParams.get('cadastro');
  check(token.length===43 && !result.bookingUrl.includes(input.email) && !result.bookingUrl.includes(phone));
  const prefill=await campaignPrefill(token,db);
  check(prefill.name===input.name && prefill.phone===phone && prefill.email===input.email && prefill.role===role && prefill.service===service);
  const lead=(await db.query('select data from public.leads where id=$1',[result.crmLeadId])).rows[0].data;
  check(lead.funnel_key===CAMPAIGN_FUNNEL && lead.status==='novo_lead');
  const repeated=await saveCampaignRegistration(db,input);
  check(repeated.replayed && repeated.crmLeadId===result.crmLeadId);
  check(Number((await db.query("select count(*) as n from whatsapp_bot.traffic_events where client_id=$1 and event_type='Lead'",[result.clientId])).rows[0].n)===1);
  await db.query("update whatsapp_bot.clients set bot_paused=true,tags=tags||array['ia_transferencia_humana'] where id=$1",[result.clientId]);
  await db.query("update public.leads set data=data||'{\"status\":\"qualificado\",\"ia_qualificacao_status\":\"qualified\"}'::jsonb where id=$1",[result.crmLeadId]);
  const revisit=await saveCampaignRegistration(db,{...input,eventId:'qa-rollback-'+crypto.randomUUID()});
  const revisited=(await db.query('select data from public.leads where id=$1',[result.crmLeadId])).rows[0].data;
  check(!revisit.botActivated && revisited.status==='transferido_para_vendas' && revisited.ia_qualificacao_status==='transferencia_solicitada');
  await db.query('update whatsapp_bot.bot_conversation_states set athlete_age=$2 where client_id=$1',[result.clientId,id==='temporada'?22:12]);
  check((await campaignPrefill(new URL(revisit.bookingUrl).searchParams.get('cadastro'),db)).athleteAge===(id==='temporada'?22:12));
 }
 check(Number((await db.query('select count(*) as n from whatsapp_bot.outbound_messages')).rows[0].n)===outbound);
 await assert.rejects(()=>campaignPrefill('invalid',db));checks++;
}finally {await db.query('rollback');check(await count()===baseline);db.release();}
console.log(JSON.stringify({checks,result:'passed',persistentTestLeads:0,whatsappMessagesSent:0,capiEventsSent:0,mainCrm:true}));
