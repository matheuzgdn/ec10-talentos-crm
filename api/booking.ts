import crypto from "node:crypto";
import { bookingPool } from "./_booking-db.js";
import { ensureBookingSeller, loginBookingSeller } from "./_booking-auth.js";
import { handleApiError, HttpError } from "./_auth.js";
import calendarHandler from "./_booking-calendar.js";
import { bookingPrefill, savedBooking } from "./_booking-prefill.js";
import {bookingProgramLabel} from './_booking-label.js';

type Service = "plano_carreira" | "plano_internacional" | "eurocamp";
const services: Service[] = ["plano_carreira", "plano_internacional", "eurocamp"];
// Calendar downloads are served by the CRM deployment. The institutional site
// does not expose this API route and would return its HTML shell instead of an
// .ics file.
const bookingPublicBaseUrl = "https://cliente-whatsapp-crm.vercel.app";

function serviceOf(value: unknown): Service {
  if (services.includes(value as Service)) return value as Service;
  throw new HttpError(400, "Escolha um programa valido.");
}

function isoDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Data ou horario invalido.");
  return date;
}

function bookingAge(value: unknown) {
  const age = Number(value);
  if (!Number.isInteger(age) || age < 8 || age > 99) throw new HttpError(400, "Informe a idade do atleta, a partir de 8 anos.");
  return age;
}

function cleanPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new HttpError(400, "Informe um WhatsApp com DDD e codigo do pais.");
  return digits;
}

function videoUrl(value:unknown) {
  const text=String(value||'').trim();
  if(!text)return null;
  try {
    const url=new URL(text);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||text.length>2048)throw new Error('invalid');
    return url.href;
  }catch{throw new HttpError(400,'Informe um link válido do vídeo, começando com https://.');}
}

function publicSlot(row: any) {
  return { id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, sellerName: row.seller_name };
}

function calendarLinks(input:{id:string;startsAt:string|Date;endsAt:string|Date;service:Service;age:number;sellerName:string;token:string}) {
  const stamp=(value:string|Date)=>new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const googleParams=new URLSearchParams({
    action:"TEMPLATE",
    text:`EC10 | ${bookingProgramLabel(input.service,input.age)} | Reunião com ${input.sellerName}`,
    dates:`${stamp(input.startsAt)}/${stamp(input.endsAt)}`,
    details:"Reunião comercial EC10. Os detalhes da chamada serão confirmados pelo WhatsApp."
  });
  return {
    google:`https://calendar.google.com/calendar/render?${googleParams}`,
    apple:`${bookingPublicBaseUrl}/api/booking-calendar?id=${encodeURIComponent(input.id)}&t=${encodeURIComponent(input.token)}`
  };
}

function requiresPablo(service: Service) {
  return service === "plano_internacional";
}

async function getSlots(service: Service) {
  // Approved temporary defaults are replenished on agenda access, until each seller switches to manual.
  await bookingPool.query("select whatsapp_bot.ec10_refresh_default_slots()");
  const { rows } = await bookingPool.query(`
    select distinct on (sl.starts_at) sl.id, sl.starts_at, sl.ends_at, coalesce(p.full_name,s.name) as seller_name
    from whatsapp_bot.ec10_booking_slots sl
    join whatsapp_bot.sellers s on s.id=sl.seller_id and s.active
    left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
    where sl.enabled and (sl.service=$1 or $1=any(sl.allowed_services))
      and sl.starts_at>now()+interval '2 hours'
      and sl.starts_at<((date_trunc('day',now() at time zone 'America/Sao_Paulo')+interval '7 days') at time zone 'America/Sao_Paulo')
      and ($1<>'plano_internacional' or lower(s.name) like '%pablo%')
      and not exists(select 1 from whatsapp_bot.ec10_bookings b where b.seller_id=sl.seller_id and b.status='confirmed' and b.starts_at<sl.ends_at and b.ends_at>sl.starts_at)
      and not whatsapp_bot.ec10_crm_time_conflict(s.id,sl.starts_at,sl.ends_at)
      and not exists(select 1 from whatsapp_bot.bot_conversation_states bc
        where substring(bc.metadata->'meeting'->>'startsAt',1,19)=to_char(sl.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
          and lower(coalesce(bc.metadata->'meeting'->>'sellerName','')) in (lower(s.name),lower(coalesce(p.full_name,s.name))) and bc.completed_at is not null)
    order by sl.starts_at,
      (select count(*) from whatsapp_bot.ec10_bookings b where b.seller_id=s.id and b.status='confirmed' and b.starts_at>now()),s.name
    limit 240
  `,[service]);
  return rows.map(publicSlot);
}

async function sellerView(request: any) {
  const seller = await ensureBookingSeller(request);
  const canViewTeam = seller.role === "admin" || seller.role === "superadmin";
  const { rows } = await bookingPool.query(`
    select sl.id, sl.seller_id, sl.service, sl.starts_at, sl.ends_at,
      assigned.name as seller_name,
      b.id as booking_id, b.contact_name, b.phone, b.athlete_age, b.status,b.athlete_video_url
    from whatsapp_bot.ec10_booking_slots sl
    join whatsapp_bot.sellers assigned on assigned.id = sl.seller_id
    left join whatsapp_bot.ec10_bookings b on b.slot_id = sl.id and b.status = 'confirmed'
    where ($1::boolean or sl.seller_id = $2)
      and assigned.active
      and sl.enabled
      and sl.starts_at > now() - interval '7 days'
    order by sl.starts_at
    limit 300
  `, [canViewTeam, seller.id]);
  return { seller, canViewTeam, slots: rows.map((row: any) => ({
    id: row.id, service: row.service, startsAt: row.starts_at, endsAt: row.ends_at,
    sellerId: row.seller_id, sellerName: row.seller_name, canManage: row.seller_id === seller.id,
    bookingId: row.booking_id, contactName: row.contact_name, phone: row.phone,
    athleteAge: row.athlete_age, status: row.status,videoUrl:row.athlete_video_url
  })) };
}

async function createSlot(request: any) {
  const seller = await ensureBookingSeller(request);
  const service = serviceOf(request.body?.service);
  if (requiresPablo(service) && !String(seller.name).toLowerCase().includes("pablo")) {
    throw new HttpError(403, "A agenda internacional e exclusiva do Pablo.");
  }
  const startsAt = isoDate(request.body?.startsAt);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  if (startsAt.getTime() < Date.now() + 2 * 60 * 60 * 1000 || startsAt.getTime() > Date.now() + 60 * 86400000) {
    throw new HttpError(400, "Abra horarios entre 2 horas e 60 dias a partir de agora.");
  }

  const {rows}=await bookingPool.query("select whatsapp_bot.ec10_open_manual_slot($1,$2,$3) as slot",[seller.id,service,startsAt]);
  return {slot:rows[0].slot};
}

async function removeSlot(request: any) {
  const seller = await ensureBookingSeller(request);
  const id = String(request.query?.id ?? "");
  const { rowCount } = await bookingPool.query(`
    update whatsapp_bot.ec10_booking_slots sl set enabled=false
    where sl.id = $1 and sl.seller_id = $2
      and not exists (select 1 from whatsapp_bot.ec10_bookings b where b.slot_id = sl.id)
  `, [id, seller.id]);
  if (!rowCount) throw new HttpError(409, "Horario reservado ou inexistente.");
  return { ok: true };
}

async function reserve(request: any) {
  const service = serviceOf(request.body?.service);
  const age = bookingAge(request.body?.athleteAge);
  const role = request.body?.contactRole === "responsavel" ? "responsavel" : "atleta";
  if (age < 18 && role !== "responsavel") throw new HttpError(400, "Para menores de 18 anos, o responsavel deve agendar.");
  const guardianConfirmed=age>=18||request.body?.guardianConfirmed===true;
  if(!guardianConfirmed)throw new HttpError(400,'O responsável deve confirmar que participará da reunião.');
  const name = String(request.body?.contactName ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 100) throw new HttpError(400, "Informe o nome de quem participara da reuniao.");
  const athleteVideoUrl=videoUrl(request.body?.athleteVideoUrl);
  const registrationToken = String(request.body?.registrationToken || "");
  if (!registrationToken) throw new HttpError(400, 'Use o link individual enviado pelo bot no WhatsApp para agendar com seus dados preenchidos.');
  {
    const prefill = await bookingPrefill(registrationToken).catch(() => { throw new HttpError(410, "O link do cadastro expirou. Solicite um novo link à EC10."); });
    if (prefill.service !== service) throw new HttpError(400, "Este agendamento precisa corresponder ao programa cadastrado.");
    if ((prefill.productId === "temporada" && (age < 20 || age > 25))
      || (prefill.productId === "kids" && (age < 8 || age > 13))
      || (prefill.productId === "juvenil" && (age < 14 || age > 19))) {
      throw new HttpError(400, "A idade não corresponde ao programa escolhido. Confirme o caminho adequado com a EC10.");
    }
  }
  const slotId = String(request.body?.slotId ?? "");
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const client = await bookingPool.connect();
  try {
    await client.query("begin");
    // Lock the private link: identity comes only from the original bot conversation, never from form input.
    await client.query('select access_token_hash from whatsapp_bot.ec10_bot_booking_links where access_token_hash=$1 for update',
      [crypto.createHash('sha256').update(registrationToken).digest('hex')]);
    const origin:any=await bookingPrefill(registrationToken,client);
    if(origin.source!=='whatsapp_bot'||!origin.clientId)throw new HttpError(400,'Abra o link individual enviado pelo bot no WhatsApp.');
    // A booking moves an existing CRM card; it is never a lead-acquisition action.
    await client.query('select pg_advisory_xact_lock(hashtext($1))',['ec10-booking-client:'+origin.clientId]);
    const leadResult=await client.query(`select l.id,l.organization_id from public.leads l
      where l.organization_id=app_private.ec10_organization_id() and (
        l.data->>'whatsapp_client_id'=$1::text or l.data->>'whatsapp_crm_client_id'=$1::text
        or app_private.whatsapp_phone_match_key(coalesce(l.data->>'telefone_e164',l.data->>'telefone'))
          =app_private.whatsapp_phone_match_key($2))
      order by (l.data->>'whatsapp_client_id'=$1::text) desc nulls last,
        (l.id not like 'wa-%') desc,l.created_date,l.id limit 1 for update`,[origin.clientId,origin.phone]);
    const lead=leadResult.rows[0];
    if(!lead)throw new HttpError(409,'Seu cadastro não foi encontrado no CRM. Chame a EC10 no WhatsApp para recuperar seu atendimento.');
    const existing=await savedBooking(origin,registrationToken,client);
    if(existing){await client.query('commit');return {booking:existing,replayed:true};}
    if(!origin.linkActive)throw new HttpError(410,'Solicite um novo link de agendamento ao bot.');
    if(origin.service!==service)throw new HttpError(400,'O programa deve corresponder ao atendimento.');
    const phone=cleanPhone(origin.phone);
    const clientId=origin.clientId;
    if(origin.athleteAge&&Number(origin.athleteAge)!==age)throw new HttpError(400,'A idade deve corresponder à informação confirmada no bot.');
    if((service==='plano_internacional'&&(age<20||age>25))||(service==='eurocamp'&&age>19))
      throw new HttpError(400,'A idade não corresponde ao programa indicado pelo bot.');
    const activated=await client.query(`select id from whatsapp_bot.clients c where c.id=$1 and exists(
      select 1 from whatsapp_bot.messages m where m.client_id=c.id and m.direction='inbound')`,[clientId]);
    if(!activated.rowCount)throw new HttpError(400,'Inicie o atendimento no WhatsApp antes de reservar.');
    const slotResult = await client.query(`
      select sl.*, coalesce(p.full_name,s.name) as seller_name, s.active,
        sl.starts_at<((date_trunc('day',now() at time zone 'America/Sao_Paulo')+interval '7 days') at time zone 'America/Sao_Paulo') as in_booking_week
      from whatsapp_bot.ec10_booking_slots sl
      join whatsapp_bot.sellers s on s.id = sl.seller_id
      left join public.profiles p on p.auth_user_id=s.auth_user_id or lower(p.email)=lower(s.email)
      where sl.id = $1 for update of sl
    `, [slotId]);
    const slot = slotResult.rows[0];
    if (!slot || !slot.in_booking_week || !slot.enabled || (slot.service !== service && !slot.allowed_services?.includes(service)) || !slot.active || new Date(slot.starts_at).getTime() < Date.now() + 2 * 3600000) {
      throw new HttpError(409, "Este horario nao esta disponivel. Atualize a agenda.");
    }
    if (requiresPablo(service) && !String(slot.seller_name).toLowerCase().includes("pablo")) {
      throw new HttpError(409, "Este horario nao pertence a agenda do Pablo.");
    }
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[slot.seller_id]);
    const conflicts=await client.query(`select whatsapp_bot.ec10_crm_time_conflict($1,$2,$3) as crm,
      exists(select 1 from whatsapp_bot.ec10_bookings where seller_id=$1 and status='confirmed' and starts_at<$3 and ends_at>$2) as booked`,[slot.seller_id,slot.starts_at,slot.ends_at]);
    if(conflicts.rows[0].crm||conflicts.rows[0].booked)throw new HttpError(409,"Este horário foi ocupado por outro compromisso. Escolha outro.");
    const occupied = await client.query("select id from whatsapp_bot.ec10_bookings where slot_id = $1 and status = 'confirmed'", [slotId]);
    if (occupied.rowCount) throw new HttpError(409, "Horario reservado. Escolha outro.");
    const existingMeeting = await client.query(`
      select id from whatsapp_bot.bot_conversation_states
      where metadata->'meeting'->>'startsAt' = $1
        and lower(coalesce(metadata->'meeting'->>'sellerName', '')) = lower($2)
        and completed_at is not null limit 1
    `, [new Date(slot.starts_at).toISOString(), slot.seller_name]);
    if (existingMeeting.rowCount) throw new HttpError(409, "Horario ocupado. Escolha outro.");

    await client.query(`update public.leads set data=data||jsonb_build_object('whatsapp_client_id',$2::text),
      updated_date=now() where id=$1 and organization_id=$3`,[lead.id,clientId,lead.organization_id]);
    await client.query(`update whatsapp_bot.clients set name=coalesce(nullif(name,''),$2),status='orcamento',
      service_interest=$3,assigned_seller_id=$4,tags=array(select distinct unnest(coalesce(tags,'{}')||array['agendamento_link'])),
      updated_at=now() where id=$1`,[clientId,name,service,slot.seller_id]);
    const bookingResult = await client.query(`
      insert into whatsapp_bot.ec10_bookings
        (slot_id, client_id, seller_id, service, contact_name, contact_role, athlete_age, phone,
         access_token_hash, starts_at, ends_at,athlete_video_url)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      returning id, starts_at, ends_at
    `, [slotId, clientId, slot.seller_id, service, name, role, age, phone, tokenHash, slot.starts_at, slot.ends_at,athleteVideoUrl]);
    const booking = bookingResult.rows[0];
    await client.query('update whatsapp_bot.ec10_bot_booking_links set booking_id=$2 where access_token_hash=$1',
      [crypto.createHash('sha256').update(registrationToken).digest('hex'),booking.id]);
    await client.query(`
      update whatsapp_bot.bot_conversation_states
      set stage = 'completed', completed_at = now(), athlete_age=$6, role_answer=$7,
        metadata = metadata || jsonb_build_object('bookingContactPending',false,'guardianConfirmed',$9::boolean,'meeting', jsonb_build_object(
          'startsAt', $2::text, 'endsAt', $3::text, 'sellerName', $4::text,
          'source', 'booking_link', 'bookingId', $5::text,'athleteVideoUrl',$8::text)), updated_at = now()
      where client_id = $1
    `, [clientId, new Date(slot.starts_at).toISOString(), new Date(slot.ends_at).toISOString(), slot.seller_name, booking.id, age, role,athleteVideoUrl,guardianConfirmed]);
    await client.query(`update public.leads set data=data||jsonb_build_object(
      'status','reuniao_agendada','idade',$2::integer,'perfil_contato',$3::text,
      'nome_contato',$7::text,'responsavel',case when $3='responsavel' then $7::text else data->>'responsavel' end,
      'videos',coalesce($8::text,data->>'videos'),
      'reuniao_agendada_em',$4::text,'reuniao_vendedor',$5::text,'booking_id',$6::text),
      updated_by='agenda-ec10',updated_date=now()
      where id=$1 and organization_id=$9`,[lead.id,age,role,new Date(slot.starts_at).toISOString(),slot.seller_name,booking.id,name,athleteVideoUrl,lead.organization_id]);
    if(athleteVideoUrl)await client.query(`update public.tarefas set data=data||jsonb_build_object('videos',$2::text),updated_date=now() where id=$1`,['booking-'+booking.id,athleteVideoUrl]);
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full", timeStyle: "short", timeZone: "America/Sao_Paulo"
    }).format(new Date(slot.starts_at));
    const label = bookingProgramLabel(service,age);
    const calendars=calendarLinks({id:booking.id,startsAt:booking.starts_at,endsAt:booking.ends_at,service,age,sellerName:slot.seller_name,token});
    const confirmation = `Olá, ${name}! Sua reunião EC10 — ${label} está confirmada.\n\n📅 ${formatted}\n🕒 Horário de Brasília\n👤 Atendimento com ${slot.seller_name}\n\nAdicionar à agenda:\nGoogle Agenda: ${calendars.google}\niPhone / Apple Calendar: ${calendars.apple}\n\nOs detalhes da chamada serão enviados por este WhatsApp.`;
    await client.query(`
      insert into whatsapp_bot.outbound_messages (client_id, bot_instance_id, phone, body, media_type, status, scheduled_at)
      values ($1, 'main', $2, $3, 'text', 'queued', now())
    `, [clientId, phone, confirmation]);
    await client.query("commit");
    return {
      booking: { id: booking.id, startsAt: booking.starts_at, endsAt: booking.ends_at,
        sellerName: slot.seller_name, service, programName:label,accessToken: token,
        groupInviteUrl: null }
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export default async function handler(request: any, response: any) {
  response.setHeader("cache-control", "no-store");
  try {
    if (request.method === "GET") {
      if (request.query?.mode === "prefill") {
        response.setHeader("referrer-policy", "no-referrer");
        const token=String(request.query?.cadastro || '');
        const prefill:any = await bookingPrefill(token).catch(() => { throw new HttpError(410, "Link de cadastro inválido ou expirado. Solicite um novo link à EC10."); });
        const booking=await savedBooking(prefill,token);
        const {clientId,bookingId,linkActive,...publicPrefill}=prefill;
        return response.status(200).json({ prefill:publicPrefill,booking });
      }
      if (request.query?.mode === "calendar") return calendarHandler(request, response);
      if (request.query?.mode === "seller") return response.status(200).json(await sellerView(request));
      const prefill=request.query?.cadastro?await bookingPrefill(String(request.query.cadastro)).catch(()=>{throw new HttpError(410,'Link inválido ou expirado. Solicite um novo link ao bot.');}):null;
      const booking=prefill?await savedBooking(prefill,String(request.query.cadastro)):null;
      return response.status(200).json({ slots: booking?[]:await getSlots(prefill?.service||serviceOf(request.query?.service)), booking,windowDays:7 });
    }
    if (request.method === "POST") {
      if (request.body?.action === "seller_login") {
        const seller = await loginBookingSeller(response, String(request.body?.email ?? ""), String(request.body?.password ?? ""));
        return response.status(200).json({ seller });
      }
      if (request.body?.action === "open_slot") return response.status(201).json(await createSlot(request));
      if (request.body?.action === "reserve") return response.status(201).json(await reserve(request));
      throw new HttpError(400, "Acao invalida.");
    }
    if (request.method === "DELETE") return response.status(200).json(await removeSlot(request));
    response.status(405).json({ error: "Metodo nao permitido." });
  } catch (error) {
    handleApiError(response, error);
  }
}
