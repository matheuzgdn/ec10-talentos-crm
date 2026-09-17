import {bookingPool} from '../api/_booking-db.ts';
const db=await bookingPool.connect();
try{
 await db.query('begin read only');
 const phone='5531995391330';
 const clients=(await db.query(`select id,phone,name,status,source,service_interest,athlete_age,bot_paused,tags,
   traffic_source,utm_source,utm_campaign,attribution_metadata from whatsapp_bot.clients
   where app_private.whatsapp_phone_match_key(phone)=app_private.whatsapp_phone_match_key($1)`,[phone])).rows;
 const ids=clients.map((c:any)=>c.id);
 const states=ids.length?(await db.query(`select client_id,stage,role_answer,athlete_age,service_interest,metadata from whatsapp_bot.bot_conversation_states where client_id=any($1::uuid[])`,[ids])).rows:[];
 const leads=(await db.query(`select id,data->>'nome_atleta' as name,data->>'status' as status,data->>'campaign_product_name' as product,
   data->>'landing_variant' as landing,data->>'source_path' as source_path,data->>'whatsapp_client_id' as client_id
   from public.leads where organization_id=app_private.ec10_organization_id() and
   app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164',data->>'telefone'))=app_private.whatsapp_phone_match_key($1)`,[phone])).rows;
 console.log(JSON.stringify({clients,states,leads}));
}finally{await db.query('rollback');db.release();}
