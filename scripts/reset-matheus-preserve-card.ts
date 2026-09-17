import {bookingPool} from '../api/_booking-db.ts';
const target='b13498cb-b426-403a-a402-665241bfe572';
const leadId='wa-'+target;
const organization='ec100000-0000-4000-8000-000000000001';
const apply=process.argv.includes('--apply');
const db=await bookingPool.connect();
try{
 await db.query('begin');
 await db.query("select set_config('statement_timeout','20000',true)");
 const contact=(await db.query(`select * from whatsapp_bot.clients where id=$1 and bot_instance_id='main'
   and app_private.whatsapp_phone_match_key(phone)=app_private.whatsapp_phone_match_key('559294432962') for update`,[target])).rows;
 if(contact.length!==1||contact[0].name!=='Matheus')throw new Error('Target identity changed; reset refused');
 const leads=(await db.query(`select * from public.leads where organization_id=$2 and
   (data->>'whatsapp_client_id'=$1::text or app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164',data->>'telefone'))
   =app_private.whatsapp_phone_match_key('559294432962')) for update`,[target,organization])).rows;
 if(leads.length!==1||leads[0].id!==leadId)throw new Error('Card identity changed; reset refused');
 const snapshot:any={client:contact[0],leads};
 for(const table of ['messages','outbound_messages','bot_conversation_states','ec10_bookings','ec10_bot_booking_links'])
   snapshot[table]=(await db.query(`select * from whatsapp_bot.${table} where client_id=$1 for update`,[target])).rows;
 if(snapshot.ec10_bookings.filter((b:any)=>b.status==='confirmed').length!==1)throw new Error('Booking identity changed; reset refused');
 const beforeCount=(await db.query('select count(*)::int as count from public.leads')).rows[0].count;
 const backup=(await db.query(`insert into app_private.ec10_maintenance_backups(reason,target_id,payload)
   values('user-requested-bot-reset-preserve-card-and-booking',$1,$2::jsonb) returning id`,[target,JSON.stringify(snapshot)])).rows[0].id;
 const removedMessages=(await db.query('delete from whatsapp_bot.messages where client_id=$1',[target])).rowCount;
 const removedOutbound=(await db.query('delete from whatsapp_bot.outbound_messages where client_id=$1',[target])).rowCount;
 await db.query(`update whatsapp_bot.clients set bot_paused=false,status='novo',athlete_age=null,service_interest='nao_definido',
   lead_score=0,next_follow_up_at=null,attribution_metadata=coalesce(attribution_metadata,'{}')-'ai_sdr',
   tags=array(select t from unnest(coalesce(tags,'{}'::text[])) t where t !~ '^(ec10_|ia_|idade_|faixa_|temperatura_|mentoria_prime_)'
     and t not in ('agendamento_link','plano_carreira','plano_internacional','eurocamp','reuniao_recusada')),
   updated_at=now() where id=$1`,[target]);
 await db.query(`update whatsapp_bot.bot_conversation_states set stage='awaiting_age',role_answer=null,athlete_age=null,
   age_group=null,service_interest=null,lead_page_url=null,completed_at=null,last_inbound_at=null,last_outbound_at=null,
   metadata=jsonb_build_object('resetAt',now(),'resetReason','user_requested','existingBookingPreserved',true),
   updated_at=now() where client_id=$1`,[target]);
 // Keep the CRM card and its confirmed meeting exactly as they were; only bot context is reset.
 await db.query(`update public.leads set data=$2::jsonb,updated_by='ec10-bot-reset',updated_date=now()
   where id=$1 and organization_id=$3`,[leadId,JSON.stringify(leads[0].data),organization]);
 const after=(await db.query(`select c.bot_paused,s.stage,l.data->>'status' as card_status,
   (select count(*)::int from whatsapp_bot.ec10_bookings where client_id=$1 and status='confirmed') as confirmed_bookings,
   (select count(*)::int from public.leads) as lead_count from whatsapp_bot.clients c
   join whatsapp_bot.bot_conversation_states s on s.client_id=c.id join public.leads l on l.id=$2
   where c.id=$1`,[target,leadId])).rows[0];
 if(!after||after.bot_paused||after.stage!=='awaiting_age'||after.card_status!=='reuniao_agendada'||after.confirmed_bookings!==1||after.lead_count!==beforeCount)throw new Error('Reset verification failed');
 await db.query(apply?'commit':'rollback');
 console.log(JSON.stringify({applied:apply,botReadyForNewMessage:true,cardPreserved:true,bookingPreserved:true,
   archivedMessages:removedMessages,archivedOutbound:removedOutbound,backupId:apply?backup:null,outboundMessagesSent:0}));
}catch(e){await db.query('rollback');throw e;}finally{db.release();}
