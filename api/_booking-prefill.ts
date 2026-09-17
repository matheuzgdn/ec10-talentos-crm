import {bookingPool} from './_booking-db.js';
import {campaignPrefill,tokenHash} from './_campaign-crm.js';
import {bookingProgramLabel} from './_booking-label.js';

export async function bookingPrefill(token:string,db:any=bookingPool) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('PREFILL_INVALID');
  const {rows}=await db.query(`select b.service,b.contact_name,b.contact_role,b.origin_phone as phone,
      b.client_id,b.booking_id,b.expires_at>now() as link_active,
      coalesce(s.athlete_age,c.athlete_age) as athlete_age,s.metadata
    from whatsapp_bot.ec10_bot_booking_links b
    join whatsapp_bot.clients c on c.id=b.client_id
    left join whatsapp_bot.bot_conversation_states s on s.client_id=c.id
    where b.access_token_hash=$1 and (b.expires_at>now() or exists(
      select 1 from whatsapp_bot.ec10_bookings saved where saved.id=b.booking_id and saved.status='confirmed')) limit 1`,[tokenHash(token)]);
  const row=rows[0];
  if(!row)return campaignPrefill(token,db);
  return {name:row.contact_name,phone:row.phone,email:row.metadata?.email||'',
    role:row.contact_role,service:row.service,athleteAge:row.athlete_age||null,
    productId:null,source:'whatsapp_bot',videoUrl:row.metadata?.athleteVideoUrl||'',
    clientId:row.client_id,bookingId:row.booking_id,linkActive:row.link_active};
}

export async function savedBooking(prefill:any,token:string,db:any=bookingPool) {
  if(!prefill.bookingId||!prefill.clientId)return null;
  const row=(await db.query(`select b.id,b.starts_at,b.ends_at,b.service,b.athlete_age,coalesce(p.full_name,s.name) as seller_name
    from whatsapp_bot.ec10_bookings b join whatsapp_bot.sellers s on s.id=b.seller_id
    left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
    where b.id=$1 and b.client_id=$2 and b.service=$3 and b.status='confirmed'`,[prefill.bookingId,prefill.clientId,prefill.service])).rows[0];
  if(!row)return null;
  return {id:row.id,startsAt:row.starts_at,endsAt:row.ends_at,sellerName:row.seller_name,service:row.service,programName:bookingProgramLabel(row.service,row.athlete_age),
    accessToken:token,groupInviteUrl:null};
}
