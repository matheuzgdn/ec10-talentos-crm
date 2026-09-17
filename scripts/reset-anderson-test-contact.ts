import {bookingPool} from '../api/_booking-db.ts';
const requestedPhone='5531995391330';
const apply=process.argv.includes('--apply');
const db=await bookingPool.connect();
try{
 await db.query('begin');
 const contacts=(await db.query(`select * from whatsapp_bot.clients where bot_instance_id='main'
   and app_private.whatsapp_phone_match_key(phone)=app_private.whatsapp_phone_match_key($1) for update`,[requestedPhone])).rows;
 if(contacts.length!==1)throw new Error('Test contact is missing or ambiguous');
 const contact=contacts[0];
 const leads=(await db.query(`select * from public.leads where organization_id=app_private.ec10_organization_id() and
   (data->>'whatsapp_client_id'=$1::text or app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164',data->>'telefone'))
    =app_private.whatsapp_phone_match_key($2)) for update`,[contact.id,requestedPhone])).rows;
 if(leads.length!==1)throw new Error('Test CRM card is missing or ambiguous');
 const snapshot:any={client:contact,leads};
 for(const table of ['messages','outbound_messages','bot_conversation_states','ec10_bookings','ec10_bot_booking_links'])
   snapshot[table]=(await db.query(`select * from whatsapp_bot.${table} where client_id=$1 for update`,[contact.id])).rows;
 const backup=(await db.query(`insert into app_private.ec10_maintenance_backups(reason,target_id,payload)
   values('anderson-isolated-sdr-test-reset',$1,$2::jsonb) returning id`,[contact.id,JSON.stringify(snapshot)])).rows[0].id;
 const removedMessages=(await db.query('delete from whatsapp_bot.messages where client_id=$1',[contact.id])).rowCount;
 const removedOutbound=(await db.query('delete from whatsapp_bot.outbound_messages where client_id=$1',[contact.id])).rowCount;
 await db.query(`update whatsapp_bot.clients set bot_paused=false,status='novo',athlete_age=null,service_interest='nao_definido',
   lead_score=0,next_follow_up_at=null,attribution_metadata=coalesce(attribution_metadata,'{}')-'ai_sdr',
   tags=array(select t from unnest(coalesce(tags,'{}'::text[])) t where t !~ '^(ec10_|ia_|idade_|faixa_|temperatura_|sdr_|mentoria_prime_)'
     and t not in ('agendamento_link','plano_carreira','plano_internacional','eurocamp','reuniao_recusada')),
   updated_at=now() where id=$1`,[contact.id]);
 const stateMetadata={source:'crm_existing',crmRegistered:true,leadName:contact.name||leads[0].data?.nome_atleta||'',
   sdrPersona:'anderson',purchaseStage:'descoberta',testIsolation:true,resetAt:new Date().toISOString()};
 const resetState=await db.query(`update whatsapp_bot.bot_conversation_states set stage='awaiting_age',role_answer=null,
   athlete_age=null,age_group=null,service_interest=null,lead_page_url=null,completed_at=null,last_inbound_at=null,last_outbound_at=null,
   metadata=$2::jsonb,updated_at=now() where client_id=$1`,[contact.id,JSON.stringify(stateMetadata)]);
 if(!resetState.rowCount)await db.query(`insert into whatsapp_bot.bot_conversation_states(client_id,phone,bot_instance_id,stage,metadata)
   values($1,$2,'main','awaiting_age',$3::jsonb)`,[contact.id,contact.phone,JSON.stringify(stateMetadata)]);
 const check=(await db.query(`select c.id,c.bot_paused,c.service_interest,s.stage,s.metadata,
   (select count(*)::int from public.leads l where l.organization_id=app_private.ec10_organization_id() and l.data->>'whatsapp_client_id'=c.id::text) cards,
   (select count(*)::int from whatsapp_bot.messages m where m.client_id=c.id) messages,
   (select count(*)::int from whatsapp_bot.ec10_bookings b where b.client_id=c.id and b.status='confirmed') bookings
   from whatsapp_bot.clients c join whatsapp_bot.bot_conversation_states s on s.client_id=c.id where c.id=$1`,[contact.id])).rows[0];
 if(!check||check.bot_paused||check.stage!=='awaiting_age'||check.cards!==1||check.messages!==0)throw new Error('Reset verification failed');
 await db.query(apply?'commit':'rollback');
 console.log(JSON.stringify({applied:apply,clientId:contact.id,cardPreserved:true,bookingsPreserved:check.bookings,
   readyStage:check.stage,removedMessages,removedOutbound,backupId:apply?backup:null}));
}catch(e){await db.query('rollback');throw e;}finally{db.release();}
