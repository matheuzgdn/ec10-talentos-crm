import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import {bookingPool} from '../api/_booking-db.ts';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const db=await bookingPool.connect();
const bookingId='1b55f8e5-1a61-4e5c-a5c6-55cc0254b3a4';
const queueId='2a7bc701-f15d-4271-bf99-784a4b8f7993';
const originId='b13498cb-b426-403a-a402-665241bfe572';
try {
  if(process.argv.includes('--migrate')) {
    await db.query(readFileSync(new URL('../supabase/migrations/20260916173000_booking_original_contact.sql',import.meta.url),'utf8'));
    console.log(JSON.stringify({migration:'booking_original_contact',applied:true}));
  } else if(process.argv.includes('--repair')) {
    await db.query('begin');
    const b=(await db.query('select * from whatsapp_bot.ec10_bookings where id=$1 for update',[bookingId])).rows[0];
    const q=(await db.query('select * from whatsapp_bot.outbound_messages where id=$1 for update',[queueId])).rows[0];
    const origin=(await db.query(`select c.* from whatsapp_bot.clients c where c.id=$1 and c.phone='559294432962'
      and exists(select 1 from whatsapp_bot.messages m where m.client_id=c.id and direction='inbound') for update`,[originId])).rows[0];
    if(!origin||!b||b.status!=='confirmed'||!q)throw new Error('Identity or booking verification failed');
    if(b.client_id===originId&&q.client_id===originId){console.log(JSON.stringify({alreadyRepaired:true,bookingId}));await db.query('rollback');}
    else {
      if(b.client_id!=='baa0e8c6-e632-43b6-a613-6481cac302cb'||b.phone!=='55994432962'
        ||q.status!=='failed'||q.whatsapp_message_id||q.sent_at||q.whatsapp_ack)throw new Error('Unexpected booking or queue state; not resending');
      await db.query('update whatsapp_bot.ec10_bookings set client_id=$2,phone=$3 where id=$1',[bookingId,originId,origin.phone]);
      const access=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(access).digest('hex');
      await db.query(`insert into whatsapp_bot.ec10_bot_booking_links(access_token_hash,client_id,service,contact_name,contact_role,booking_id)
        values($1,$2,$3,$4,$5,$6)`,[hash,originId,b.service,b.contact_name,b.contact_role,bookingId]);
      const bookingUrl=`https://ec10talentos.com/agendar?servico=${b.service}&cadastro=${access}`;
      const sellerName='Pablo Jardins';
      await db.query(`update whatsapp_bot.clients set status='orcamento',service_interest=$2,assigned_seller_id=$3,updated_at=now() where id=$1`,[originId,b.service,b.seller_id]);
      // Preserve the conflicting age answers for the team to review, rather than inventing a corrected age.
      await db.query(`update whatsapp_bot.bot_conversation_states set stage='completed',completed_at=now(),
        metadata=metadata||jsonb_build_object('bookingContactPending',false,'bookingContactName',$2::text,'bookingUrl',$3::text,
          'bookingEligibilityReviewRequired',$4::boolean,'meeting',jsonb_build_object('bookingId',$5::text,'startsAt',$6::text,
          'endsAt',$7::text,'sellerName',$8::text,'source','booking_original_contact_repair')),updated_at=now() where client_id=$1`,
        [originId,b.contact_name,bookingUrl,b.service==='plano_internacional'&&b.athlete_age<20,bookingId,b.starts_at.toISOString(),b.ends_at.toISOString(),sellerName]);
      await db.query(`update public.leads set data=data||jsonb_build_object('status','reuniao_agendada','nome_contato',$2::text,
        'perfil_contato',$3::text,'responsavel',case when $3='responsavel' then $2::text else data->>'responsavel' end,
        'booking_id',$4::text,'reuniao_agendada_em',$5::text,'reuniao_vendedor',$6::text,
        'booking_original_whatsapp',$7::text,'booking_age_recorded',$8::integer,'bookingEligibilityReviewRequired',$9::boolean),
        updated_by='agenda-ec10',updated_date=now() where data->>'whatsapp_client_id'=$1`,
        [originId,b.contact_name,b.contact_role,bookingId,b.starts_at.toISOString(),sellerName,origin.phone,b.athlete_age,b.service==='plano_internacional'&&b.athlete_age<20]);
      await db.query(`update public.tarefas set data=data||jsonb_build_object('lead_id',$2::text,'atleta_id',$2::text,
        'bookingEligibilityReviewRequired',$3::boolean),updated_date=now() where id=$1`,
        ['booking-'+bookingId,'wa-'+originId,b.service==='plano_internacional'&&b.athlete_age<20]);
      await db.query(`update public.leads set data=data||jsonb_build_object('booking_contact_superseded_by',$2::text,
        'status','contato_realizado','booking_id',null,'reuniao_agendada_em',null),updated_by='agenda-ec10',updated_date=now()
        where data->>'whatsapp_client_id'=$1 and data->>'booking_id'=$3`,[b.client_id,originId,bookingId]);
      const body=q.body+`\n\nSua reunião fica salva. Consulte novamente neste link individual: ${bookingUrl}`;
      await db.query(`update whatsapp_bot.outbound_messages set client_id=$2,phone=$3,body=$4,status='queued',
        error_message=null,scheduled_at=now() where id=$1`,[queueId,originId,origin.phone,body]);
      await db.query('commit');
      console.log(JSON.stringify({repaired:true,bookingId,confirmationRequeued:true,sameBooking:true,originalPhone:origin.phone,eligibilityReviewRequired:b.athlete_age<20}));
    }
  } else if(process.argv.includes('--status')) {
    const queue=(await db.query('select id,phone,status,error_message,whatsapp_message_id is not null as has_message_id,whatsapp_ack,sent_at from whatsapp_bot.outbound_messages where id=$1',[queueId])).rows[0];
    console.log(JSON.stringify({queue}));
  } else if(process.argv.includes('--verify')) {
    const state=(await db.query('select metadata from whatsapp_bot.bot_conversation_states where client_id=$1',[originId])).rows[0];
    const url=new URL(state.metadata.bookingUrl);
    const token=url.searchParams.get('cadastro');
    const prefill=await fetch(`https://cliente-whatsapp-crm.vercel.app/api/booking?mode=prefill&cadastro=${encodeURIComponent(token)}`).then(r=>r.json());
    assert.equal(prefill.prefill.phone,'559294432962');assert.equal(prefill.booking.id,bookingId);
    const slots=await fetch(`https://cliente-whatsapp-crm.vercel.app/api/booking?service=plano_internacional&cadastro=${encodeURIComponent(token)}`).then(r=>r.json());
    assert.equal(slots.slots.length,0);assert.equal(slots.booking.id,bookingId);
    const calendar=await fetch(`https://cliente-whatsapp-crm.vercel.app/api/booking-calendar?id=${bookingId}&t=${encodeURIComponent(token)}`);
    assert.equal(calendar.status,200);assert.ok((await calendar.text()).includes(`UID:${bookingId}@ec10talentos.com`));
    const browser=await chromium.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await page.goto(url.href);
      await page.getByRole('heading',{name:'Sua reunião está agendada',exact:true}).waitFor();
      assert.equal(await page.locator('.booking-date-grid button').count(),0);
      await page.reload();await page.getByText('ENCONTRO MARCADO',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Confirmar reunião',exact:true}).count(),0);
      await page.screenshot({path:'C:/Users/Admin/Documents/CODEX/2026-09-15/abr/outputs/EC10_Agenda_Salva_Validada.png',fullPage:true});
    }finally{await browser.close();}
    const queue=(await db.query('select id,phone,status,error_message,whatsapp_message_id is not null as has_message_id,whatsapp_ack,sent_at from whatsapp_bot.outbound_messages where id=$1',[queueId])).rows[0];
    console.log(JSON.stringify({productionVerified:true,sameBooking:true,originalPhonePrefilled:true,reopenedBookingRestored:true,calendarWorks:true,queue}));
  } else {
    await db.query('begin read only');
    console.log(JSON.stringify({booking:(await db.query(`select b.*,coalesce(p.full_name,s.name) as seller_name from whatsapp_bot.ec10_bookings b join whatsapp_bot.sellers s on s.id=b.seller_id left join public.profiles p on p.auth_user_id=s.auth_user_id where b.id=$1`,[bookingId])).rows}));
    console.log(JSON.stringify({origin:(await db.query(`select c.id,c.phone,c.name,c.status,(select count(*) from whatsapp_bot.messages m where m.client_id=c.id and direction='inbound') as inbound_messages from whatsapp_bot.clients c where id=$1`,[originId])).rows,
      queue:(await db.query(`select id,client_id,phone,body,status,whatsapp_message_id,whatsapp_ack from whatsapp_bot.outbound_messages where id=$1`,[queueId])).rows}));
    console.log(JSON.stringify({leads:(await db.query(`select id,organization_id,data from public.leads where data->>'whatsapp_client_id' in ($1,$2)`,[originId,'baa0e8c6-e632-43b6-a613-6481cac302cb'])).rows,
      task:(await db.query('select id,organization_id,data from public.tarefas where id=$1',['booking-'+bookingId])).rows}));
    console.log(JSON.stringify({messageColumns:(await db.query(`select column_name,column_default,is_nullable from information_schema.columns where table_schema='whatsapp_bot' and table_name='messages'`)).rows}));
    await db.query('rollback');
  }
}finally{db.release();}
