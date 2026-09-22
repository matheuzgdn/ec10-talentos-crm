import crypto from 'node:crypto';
import { bookingPool } from './_booking-db.js';

export const CAMPAIGN_FUNNEL = 'ec10_campaign_landing_pages';
export const CAMPAIGN_PIPELINE = 'service:campanhas-lp';
export const tokenHash = (value:string) => crypto.createHash('sha256').update(value).digest('hex');

// Called inside one transaction. No WhatsApp send, outbound queue or CAPI call.
export async function saveCampaignRegistration(db:any, input:any) {
  const {phone,name,email,role,countryCode,productId,product,traffic,attribution,eventId,tags}=input;
  const org=await db.query("select id from public.organizations where slug='ec10-talentos' and status='active'");
  if(org.rows.length!==1)throw new Error('MAIN_CRM_ORGANIZATION_UNAVAILABLE');
  const orgId=org.rows[0].id;
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`ec10-campaign:${phone}`]);
  const previous=(await db.query('select id, bot_paused, tags, attribution_metadata from whatsapp_bot.clients where phone=$1 for update',[phone])).rows[0];
  const existingCrm=(await db.query(`select data from public.leads where organization_id=$1
    and (data->>'whatsapp_client_id'=$2 or regexp_replace(coalesce(data->>'telefone_e164',data->>'telefone',''),'[^0-9]','','g')=$3)
    order by created_date limit 1 for update`,[orgId,previous?.id||'',phone])).rows[0]?.data;
  const retry=(await db.query('select r.*, c.phone from whatsapp_bot.ec10_campaign_registrations r join whatsapp_bot.clients c on c.id=r.client_id where r.event_id=$1',[eventId])).rows[0];
  if(retry){
    if(retry.phone!==phone||retry.product_id!==productId)throw new Error('REGISTRATION_ID_CONFLICT');
    const state=(await db.query('select metadata from whatsapp_bot.bot_conversation_states where client_id=$1',[retry.client_id])).rows[0];
    return {clientId:retry.client_id,crmLeadId:retry.crm_lead_id,bookingUrl:state?.metadata?.campaignBookingUrl||null,botActivated:previous?.bot_paused===false,replayed:true,capiAccepted:!!retry.capi_accepted_at};
  }
  // Preserve human handoffs, opt-outs and ongoing conversations on repeat visits.
  const blocked=(previous?.tags||[]).some((t:string)=>/opt.?out|nao_contatar|bloqueado|ia_transferencia_humana/.test(t));
  const botActivated=!blocked && (!previous || previous.bot_paused===false);
  const enrichedAttribution={...attribution,ai_sdr:{speakerRole:role,guardianConfirmed:false,
    qualificationStatus:'more_info',...(previous?.attribution_metadata?.ai_sdr||{})}};
  const client=(await db.query(`insert into whatsapp_bot.clients as existing
    (phone,name,status,service_interest,bot_instance_id,bot_paused,tags,attribution_metadata,
     traffic_source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,fbclid,gclid,
     traffic_campaign_id,traffic_campaign_name,traffic_adset_id,traffic_ad_id)
    values($1,$2,'novo',$3,'main',false,$4::text[],$5::jsonb,'ec10_campaign_lp',$6,$7,$8,$9,$10,$11,$12,$13,$8,$14,$15)
    on conflict(phone) do update set
      name=coalesce(nullif(existing.name,''),excluded.name),
      tags=array(select distinct unnest(existing.tags||excluded.tags)),
      attribution_metadata=coalesce(existing.attribution_metadata,'{}'::jsonb)||excluded.attribution_metadata,
      traffic_source=excluded.traffic_source,
      utm_source=coalesce(excluded.utm_source,existing.utm_source),utm_medium=coalesce(excluded.utm_medium,existing.utm_medium),
      utm_campaign=coalesce(excluded.utm_campaign,existing.utm_campaign),utm_content=coalesce(excluded.utm_content,existing.utm_content),
      utm_term=coalesce(excluded.utm_term,existing.utm_term),fbclid=coalesce(excluded.fbclid,existing.fbclid),gclid=coalesce(excluded.gclid,existing.gclid),
      traffic_campaign_id=coalesce(excluded.traffic_campaign_id,existing.traffic_campaign_id),
      traffic_campaign_name=coalesce(excluded.traffic_campaign_name,existing.traffic_campaign_name),
      traffic_adset_id=coalesce(excluded.traffic_adset_id,existing.traffic_adset_id),
      traffic_ad_id=coalesce(excluded.traffic_ad_id,existing.traffic_ad_id),updated_at=now()
    returning id,bot_paused`,[phone,name,product.service,tags,JSON.stringify(enrichedAttribution),
    traffic.utmSource||null,traffic.utmMedium||null,traffic.utmCampaign||null,traffic.utmContent||null,traffic.utmTerm||null,
    traffic.fbclid||null,traffic.gclid||null,traffic.campaignId||null,traffic.adsetId||null,traffic.adId||null])).rows[0];
  const lead=(await db.query(`select id,data from public.leads where organization_id=$1
    and (data->>'whatsapp_client_id'=$2 or regexp_replace(coalesce(data->>'telefone_e164',data->>'telefone',''),'[^0-9]','','g')=$3)
    order by case when data->>'whatsapp_client_id'=$2 then 0 else 1 end,created_date limit 1 for update`,[orgId,client.id,phone])).rows[0];
  const crmLeadId=lead?.id||`wa-${client.id}`;
  const token=crypto.randomBytes(32).toString('base64url');
  const bookingBaseUrl=(process.env.EC10_BOOKING_PUBLIC_BASE_URL||'https://cliente-whatsapp-crm.vercel.app').replace(/\/+$/,'');
  const bookingUrl=`${bookingBaseUrl}/agendar?servico=${product.service}&cadastro=${token}`;
  const data={
    ...lead?.data,
    nome_atleta:lead?.data?.nome_atleta||name, nome_contato:name, telefone:phone,telefone_e164:phone,
    email,country_code:countryCode,perfil_contato:role,responsavel:role==='responsavel'?name:lead?.data?.responsavel,
    tipo_lead:'atleta',tipo_servico_interesse:lead?.data?.tipo_servico_interesse||product.service,
    status:(!blocked && existingCrm?.status)||lead?.data?.status||'novo_lead',convertido:existingCrm?.convertido||lead?.data?.convertido||false,
    pipeline_id:lead?.data?.pipeline_id||CAMPAIGN_PIPELINE,
    funnel_key:CAMPAIGN_FUNNEL,origem_captacao:'Campanhas LP EC10',canal_origem:'site',
    campaign_product_id:productId,campaign_product_name:product.label,
    whatsapp_client_id:client.id,whatsapp_instance_id:'main',bot_paused:client.bot_paused,
    ia_sdr_ativa:botActivated,ia_qualificacao_status:(!blocked && existingCrm?.ia_qualificacao_status)||lead?.data?.ia_qualificacao_status||'pendente',
    utm_source:traffic.utmSource,utm_medium:traffic.utmMedium,utm_campaign:traffic.utmCampaign,
    utm_content:traffic.utmContent,utm_term:traffic.utmTerm,fbclid:traffic.fbclid,gclid:traffic.gclid,
    traffic_campaign_id:traffic.campaignId,traffic_adset_id:traffic.adsetId,traffic_ad_id:traffic.adId,
    landing_variant:traffic.landingVariant,source_path:traffic.sourcePath,
    consentimento_contato_em:attribution.capturedAt,observacoes:lead?.data?.observacoes||`Interesse: ${product.label}. Qualificação pendente.`,
  };
  await db.query(`insert into public.leads(id,organization_id,created_by,updated_by,data)
    values($1,$2,'campanhas-lp','campanhas-lp',$3::jsonb)
    on conflict(id) do update set data=excluded.data,updated_by='campanhas-lp',updated_date=now()`,[crmLeadId,orgId,JSON.stringify(data)]);
  await db.query(`insert into whatsapp_bot.ec10_campaign_registrations
    (organization_id,client_id,crm_lead_id,event_id,access_token_hash,product_id,contact_role,contact_email,country_code)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[orgId,client.id,crmLeadId,eventId,tokenHash(token),productId,role,email,countryCode]);
  const metadata={leadName:name,role,email,countryCode,source:'ec10_campaign_lp',funnelKey:CAMPAIGN_FUNNEL,
    campaignProductId:productId,campaignProductName:product.label,campaignService:product.service,
    campaignBookingUrl:bookingUrl,campaignEventId:eventId,guardianConfirmed:false};
  await db.query(`insert into whatsapp_bot.bot_conversation_states
    (client_id,phone,bot_instance_id,stage,role_answer,service_interest,metadata)
    values($1,$2,'main','awaiting_age',$3,$4,$5::jsonb)
    on conflict(phone) do update set metadata=coalesce(whatsapp_bot.bot_conversation_states.metadata,'{}'::jsonb)||
      (excluded.metadata - 'guardianConfirmed'),updated_at=now()`,[client.id,phone,role,product.service,JSON.stringify(metadata)]);
  await db.query(`insert into whatsapp_bot.traffic_events
    (client_id,bot_instance_id,phone,event_type,channel,platform,service_interest,lead_status,quality_score,metadata)
    values($1,'main',$2,'Lead','site','meta',$3,'novo',50,$4::jsonb)`,[client.id,phone,product.service,JSON.stringify({eventId,funnelKey:CAMPAIGN_FUNNEL,productId,crmLeadId})]);
  await db.query(`insert into public.historico_interacoes(id,organization_id,created_by,updated_by,data)
    values($1,$2,'campanhas-lp','campanhas-lp',$3::jsonb) on conflict(id) do nothing`,[`lp-${eventId}`,orgId,JSON.stringify({entity_type:'Lead',entity_id:crmLeadId,tipo_interacao:'cadastro_site',descricao:`Cadastro confirmado: ${product.label}. Aguardando mensagem recebida no WhatsApp.`,autor_nome:'Landing Page EC10',data_interacao:new Date().toISOString().slice(0,10)})]);
  return {clientId:client.id,crmLeadId,bookingUrl,botActivated,replayed:false,capiAccepted:false};
}

export async function campaignPrefill(token:string, db:any=bookingPool) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('PREFILL_INVALID');
  const row=(await db.query(`select r.contact_role,r.contact_email,r.country_code,r.product_id,
    c.phone,c.name,c.athlete_age,s.athlete_age as state_age,s.metadata,l.data
    from whatsapp_bot.ec10_campaign_registrations r
    join whatsapp_bot.clients c on c.id=r.client_id
    join public.leads l on l.id=r.crm_lead_id and l.organization_id=r.organization_id
    left join whatsapp_bot.bot_conversation_states s on s.client_id=c.id
    where r.access_token_hash=$1 and r.expires_at>now()`,[tokenHash(token)])).rows[0];
  if(!row)throw new Error('PREFILL_EXPIRED');
  const services:any={carreira:'plano_carreira',kids:'eurocamp',juvenil:'eurocamp',temporada:'plano_internacional'};
  return {name:row.data.nome_contato||row.name,phone:row.phone,email:row.contact_email,
    role:row.contact_role,countryCode:row.country_code,productId:row.product_id,service:services[row.product_id],
    athleteAge:row.state_age||row.athlete_age||row.data.idade||null,videoUrl:row.data.videos||''};
}

export async function sendCampaignCapi(input:any) {
  const token=process.env.META_CAPI_ACCESS_TOKEN||process.env.META_SYSTEM_USER_ACCESS_TOKEN;
  const pixel=process.env.META_PIXEL_ID;
  if(!token||!pixel)return false;
  const hash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex');
  try{
    const response=await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION||'v25.0'}/${pixel}/events`,{
      method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({data:[{event_name:'Lead',event_time:Math.floor(Date.now()/1000),event_id:input.eventId,
        event_source_url:input.eventSourceUrl,action_source:'website',
        user_data:{em:[hash(input.email)],ph:[hash(input.phone)],country:[hash(input.countryCode.toLowerCase())],
          ...(input.traffic.fbc?{fbc:input.traffic.fbc}:{}),...(input.traffic.fbp?{fbp:input.traffic.fbp}:{})},
        custom_data:input.customData}]}),signal:AbortSignal.timeout(6000)});
    const p=await response.json();return response.ok&&p.events_received===1;
  }catch{return false;}
}
