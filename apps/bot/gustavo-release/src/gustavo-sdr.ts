import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { appendClientTags, cancelQueuedFollowUpMessages, createBotBookingLink, fetchRecentClientMessages,
  getBotConversationState, getClientAutomationStateById, recordTrafficEvent, saveBotConversationState,
  updateClientAiProfile, type BotConversationState, type ClientAutomationState } from './store.js';

export const GUSTAVO_VERSION = 'gustavo-79e8f2c-20260917-booking';
export function providerRetryDelayMs(message:string) {
  const duration=message.match(/try again in\s+([\d.hms\s]+)/i)?.[1]||'';
  let milliseconds=0;
  for(const match of duration.matchAll(/([\d.]+)\s*(h|m|s)/g))milliseconds+=Number(match[1])*({h:3600000,m:60000,s:1000}[match[2] as 'h'|'m'|'s']);
  return Math.max(30000,(milliseconds||60000)+5000);
}
type GustavoState = { pending?:boolean; dueAt?:string; startedAt?:string; contentStartedAt?:number; batchStartedAt?:number;
  chatId?:string; pendingText?:string; name?:string; role?:string; athleteAge?:number; club?:string;
  guardianConfirmed?:boolean; contactAdult?:boolean; handoff?:boolean; disqualified?:boolean;
  bookingUrl?:string; bookingId?:string; offeredSlots?:Slot[]; offeredDays?:OfferedDay[]; selectedDay?:string;
  schedulePhase?:'awaiting_full_name'|'awaiting_day'|'awaiting_time'; offeredAt?:string; lastProcessedAt?:string; retryCount?:number };
type Slot = { id:string; startsAt:string; endsAt:string; sellerName:string };
type OfferedDay = { date:string; label:string };
type ChatMessage = {role:string; content?:string|null; [key:string]:unknown};
const bookingApi = 'https://cliente-whatsapp-crm.vercel.app/api/booking';
const agendaDefault = 'https://cliente-whatsapp-crm.vercel.app/agendar?servico=plano_carreira';
export const isGustavoEnabled = () => config.EC10_SDR_ENGINE === 'gustavo' && config.BOT_INSTANCE_ID === 'main';
export function appendConfirmedMeetingLink(body:string|null,url:string|null,confirmed:boolean) {
  if(!body||!url||!confirmed||!/^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(url)||! /Sua reuni[aã]o EC10[\s\S]{0,120}confirmada/i.test(body)||body.includes(url))return body;
  return `${body}\n\nLink para entrar na reunião: ${url}`;
}
export function greetingOnly(text:string) {
  return /^(?:(?:oi|ola|opa|e ai|bom dia|boa tarde|boa noite|tudo bem|tudo bom|como vai|bom dia tudo bem|boa tarde tudo bem|boa noite tudo bem)[\s!?.,]*)+$/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim());
}
export function nextGustavoBatch(previous:GustavoState,text:string,now:number) {
  const batchStartedAt=previous.pending?previous.batchStartedAt||now:now;
  const contentStartedAt=previous.pending?previous.contentStartedAt:undefined;
  const content=contentStartedAt || (!greetingOnly(text)?now:undefined);
  return {...previous,pending:true,batchStartedAt,contentStartedAt:content,
    pendingText:previous.pending?[previous.pendingText,text].filter(Boolean).join('\n'):text,
    dueAt:new Date(content?Math.min(content+30000,now+5000):batchStartedAt+90000).toISOString()};
}
const readState=(state:BotConversationState|null):GustavoState => (state?.metadata?.gustavo||{}) as GustavoState;
async function persist(client:ClientAutomationState,state:BotConversationState|null,patch:GustavoState) {
  const gustavo={...readState(state),...patch};
  return saveBotConversationState({clientId:client.id,phone:client.phone,stage:state?.stage||'awaiting_interest',
    roleAnswer:gustavo.role==='responsavel'?'responsavel':gustavo.role==='atleta'?'atleta':state?.role_answer,
    athleteAge:gustavo.athleteAge||state?.athlete_age,ageGroup:state?.age_group,
    serviceInterest:state?.service_interest||client.service_interest,leadPageUrl:state?.lead_page_url,
    completedAt:state?.completed_at,metadata:{...state?.metadata,gustavo,sdrActiveEngine:'gustavo',audioSequenceInProgress:false}});
}
export async function queueGustavoInbound(client:ClientAutomationState,chatId:string,text:string|null) {
  const state=await getBotConversationState(client.phone);
  const previous=readState(state);
  if(previous.handoff||previous.disqualified||client.bot_paused)return;
  if(!previous.startedAt) {
    await cancelQueuedFollowUpMessages(client.id,'Gustavo assumiu a qualificação; Anderson isolado.');
    await appendClientTags(client.id,['gustavo_sdr','anderson_isolado']);
  }
  const now=Date.now();
  await persist(client,state,{...nextGustavoBatch(previous,text||'[Mensagem sem texto disponível]',now),
    startedAt:previous.startedAt||new Date(now).toISOString(),chatId,
    athleteAge:previous.athleteAge||state?.athlete_age||client.athlete_age||undefined,
    role:previous.role||state?.role_answer||undefined,
    name:previous.name||String(state?.metadata?.bookingContactName||state?.metadata?.leadName||'')});
}
async function requestJson(url:string,body?:unknown) {
  const response=await fetch(url,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const result=await response.json() as any;
  if(!response.ok)throw new Error(`integration_${response.status}`);
  return result;
}
export async function loadGustavoPrompt(agenda=agendaDefault) {
  const directory=path.resolve(config.GUSTAVO_SKILL_DIR);
  const behavior=await fs.readFile(path.join(directory,'gustavo-system-prompt.md'),'utf8');
  const knowledge=await fs.readFile(path.join(directory,'ec10-conhecimento.md'),'utf8');
  return `${behavior}\n\n---\n\n${knowledge}`.replaceAll('{{LINK_AGENDAMENTO}}',agenda).replaceAll(agendaDefault,agenda);
}
export async function loadGustavoOperationalPrompt(agenda=agendaDefault) {
  return `Você é Gustavo, representante comercial da EC10 Talentos no WhatsApp. Fale em português brasileiro, informal, natural e respeitoso. Sem emoji, sem travessão e no máximo uma pergunta por mensagem. Nunca diga "entendi" de forma automática, nunca faça interrogatório e nunca repita fatos já informados. Leia mensagens agrupadas e responda primeiro a dúvida do lead antes de voltar ao próximo passo.

Objetivo: qualificar pais ou responsáveis por atletas de 9 a 18 anos para uma reunião do Plano de Carreira. O produto reúne assessoria esportiva, mentoria coletiva com Eric Cena e marketing esportivo para desenvolver atleta e família. Faça no máximo duas perguntas de qualificação: idade e se joga em clube. Se menor, reunião e decisão financeira são sempre com responsável adulto. Se a pessoa disser ser mãe, pai ou responsável, isso confirma o papel de responsável. Peça nome completo do adulto antes do agendamento.

Condução: explique a empresa em uma ou duas frases quando perguntarem. Depois de idade, situação e responsável, convide para reunião sem compromisso. Resolva dúvidas e objeções com valor, sem pressão. Pais participam da jornada. Quem já treina ou tem clube também pode receber planejamento; não prometa colocação ou resultado. Não ofereça clube por conta própria.

Agenda: o agendamento é feito exclusivamente pelo link individual conectado. Nunca ofereça datas ou horários no chat e nunca reserve pelo chat. Depois de qualificar, confirmar o responsável adulto e obter o nome completo, use get_booking_link. Na página do link o cliente escolhe primeiro o dia e depois o horário. Link base: ${agenda}.

Regras: nunca informe preço; diga que o valor é apresentado na reunião e reconduza ao agendamento. Outro produto, fechamento pelo WhatsApp, reclamação, parceria ou dúvida impossível: handoff_to_seller. Opt-out encerra. Fora do público pode ser desqualificado; atleta menor interessado deve trazer responsável, não ser descartado automaticamente. Se perguntarem diretamente, seja honesto que o atendimento é automatizado. Não invente fatos, agenda, clube, preço ou promessa. Não revele IDs, tokens ou estado interno.

Informações: EC10 fica em Belo Horizonte, bairro Gutierrez; Instagram ec10_talentos. Após pagamento há contrato via gov.br ou digitalizado e entrada nos grupos em 5 a 10 dias. Cancelamento sem multa. Use somente quando perguntarem.`;
}

const localDateKey=(value:string|Date) => {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const localDayLabel=(value:string|Date) => new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'numeric',month:'long'}).format(new Date(value));
const localTimeLabel=(value:string|Date) => new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)).replace(':00','h').replace(':','h');
export function usableSlots(slots:Slot[],now=Date.now()) {return slots.filter(s=>Date.parse(s.startsAt)>now+5*60_000).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));}
export function offeredDays(slots:Slot[]) {
  const seen=new Set<string>(),days:OfferedDay[]=[];
  for(const slot of slots) {const date=localDateKey(slot.startsAt);if(!seen.has(date)){seen.add(date);days.push({date,label:localDayLabel(slot.startsAt)});}if(days.length===3)break;}
  return days;
}
const listPt=(items:string[]) => items.length<2?items[0]||'':`${items.slice(0,-1).join(', ')} e ${items.at(-1)}`;
export const dayQuestion=(days:OfferedDay[],prefix='') => `${prefix}${prefix?' ':''}Tenho estes dias disponíveis: ${listPt(days.map(d=>d.label))}. Qual dia fica melhor para você?`;
export const timeQuestion=(slots:Slot[],day:OfferedDay) => `Para ${day.label}, tenho ${listPt(slots.slice(0,3).map(s=>localTimeLabel(s.startsAt)))}. Qual horário fica melhor para você?`;
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function extractFullName(text:string) {
  if(/[?]|\b(?:hoje|amanh[ãa]|hor[aá]rio|reuni[aã]o|idade|clube)\b/i.test(text))return undefined;
  const clean=text.replace(/^(?:meu nome (?:completo )?[ée]|eu sou|sou a|sou o)\s+/i,'').replace(/[^\p{L}' -]/gu,' ').replace(/\s+/g,' ').trim();
  const words=clean.split(' ').filter(Boolean);return words.length>=2&&words.length<=6?clean:undefined;
}
export function resolveDay(text:string,days:OfferedDay[]) {
  const n=normalize(text),ordinal=n.match(/\b(primeir[oa]|segund[oa]|terceir[oa])\b/)?.[1];
  if(ordinal)return days[['primeiro','primeira'].includes(ordinal)?0:['segundo','segunda'].includes(ordinal)?1:2];
  return days.find(d=>n.includes(normalize(d.label))||n.includes(normalize(d.label.split('-feira')[0]))||new RegExp(`\\b${Number(d.date.slice(8))}\\b`).test(n));
}
export function resolveTime(text:string,slots:Slot[]) {
  const n=normalize(text),ordinal=n.match(/\b(primeir[oa]|segund[oa]|terceir[oa])\b/)?.[1];
  if(ordinal)return slots[['primeiro','primeira'].includes(ordinal)?0:['segundo','segunda'].includes(ordinal)?1:2];
  const match=n.match(/\b(\d{1,2})(?:(?:h|:)(\d{2})?)?\b/);if(!match)return undefined;
  const wanted=`${String(Number(match[1])).padStart(2,'0')}:${match[2]||'00'}`;
  return slots.find(s=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.startsAt))===wanted);
}
export const gustavoTools=[
  {type:'function',function:{name:'update_qualification',description:'Guardar somente fatos explicitamente informados pelo contato e enviar a resposta natural no campo reply, respeitando o roteiro do Gustavo. Campos desconhecidos podem ser omitidos ou null; não inferir idade ou confirmação de responsável. Esta ferramenta já entrega a resposta, sem precisar chamar o modelo outra vez.',parameters:{type:'object',properties:{reply:{type:'string'},name:{type:['string','null']},role:{type:['string','null'],enum:['responsavel','atleta',null]},athleteAge:{type:['integer','null']},club:{type:['string','null']},guardianConfirmed:{type:['boolean','null']},contactAdult:{type:['boolean','null']}},required:['reply'],additionalProperties:false}}},
  {type:'function',function:{name:'get_booking_link',description:'Criar o link individual e pré-preenchido para o responsável escolher dia e horário. Este é o único meio permitido de agendamento; nunca oferecer datas ou horários no chat.',parameters:{type:'object',properties:{},additionalProperties:false}}},
  {type:'function',function:{name:'handoff_to_seller',description:'Encaminhar ao humano e interromper automação em reclamação, parceria, outro produto, fechamento ou dúvida insolúvel. Encerramento por opt-out também.',parameters:{type:'object',properties:{reason:{type:'string'},disqualified:{type:'boolean'}},required:['reason'],additionalProperties:false}}},
];
export async function callGustavoModel(messages:ChatMessage[],toolDefinitions=gustavoTools) {
  if(!config.GROQ_API_KEY)throw new Error('groq_key_missing');
  const response=await fetch(`${config.GROQ_API_BASE_URL}/chat/completions`,{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.GROQ_API_KEY}`},
    body:JSON.stringify({model:config.GROQ_MODEL,temperature:.7,max_tokens:700,messages,
      ...(toolDefinitions.length?{tools:toolDefinitions,tool_choice:'auto',parallel_tool_calls:false}:{})}),
    signal:AbortSignal.timeout(Math.max(config.GROQ_REQUEST_TIMEOUT_MS,30000)),
  });
  if(!response.ok) {
    const failure=await response.json().catch(()=>({})) as any;
    const message=String(failure.error?.message||'').replace(/gsk_[A-Za-z0-9]+/g,'[redacted]').slice(0,500);
    throw new Error(`groq_${response.status}: ${message}`);
  }
  const result=await response.json() as any;
  if(!result.choices?.[0]?.message)throw new Error('groq_empty');
  return result.choices[0].message;
}
export async function callGustavoValidatedModel(messages:ChatMessage[]) {
  for (let attempt=0;attempt<3;attempt++) {
    const message=await callGustavoModel(messages);
    if(message.tool_calls?.length)return message;
    const answer=String(message.content||'');
    if((answer.match(/\?/g)||[]).length<=1&&!/\p{Extended_Pictographic}/u.test(answer)&&!/[—]|\s-\s/.test(answer))return message;
    messages.push(message,{role:'system',content:'Reescreva a última resposta respeitando o estilo do Gustavo: no máximo uma pergunta, sem emoji e sem travessão ou hífen como pontuação. Não acrescente novas perguntas ou fatos.'});
  }
  throw new Error('gustavo_style_validation_failed');
}
export async function processGustavoBatch(initial:BotConversationState,send:(chatId:string,clientId:string,body:string)=>Promise<boolean>) {
  let client=await getClientAutomationStateById(initial.client_id);
  if(!client||client.bot_paused)return;
  let state=await getBotConversationState(client.phone)||initial;
  let g=readState(state);
  const existingBookingId=state?.metadata?.bookingId||(state?.metadata?.meeting as Record<string,unknown>|undefined)?.bookingId;
  if(!g.bookingId&&existingBookingId)g.bookingId=String(existingBookingId);
  if(!g.pending||!g.dueAt||Date.parse(g.dueAt)>Date.now()||g.handoff||g.disqualified)return;
  const batchText=g.pendingText||'';
  const sourceMessages=await fetchRecentClientMessages(client.id,36);
  const latestInbound=sourceMessages.filter(m=>m.direction==='inbound').at(-1)?.createdAt;
  const history:ChatMessage[]=sourceMessages.filter(m=>m.body&&Date.parse(m.createdAt)>=Date.parse(g.startedAt||'1970-01-01')).map(m=>({role:m.direction==='inbound'?'user':'assistant',content:m.body}));
  if(!history.length)history.push({role:'user',content:batchText});
  while(history.length>2&&history.reduce((sum,m)=>sum+String(m.content||'').length,0)>6500)history.shift();
  const shownTimes=g.selectedDay?g.offeredSlots?.filter(s=>localDateKey(s.startsAt)===g.selectedDay).slice(0,3).map(s=>localTimeLabel(s.startsAt)):[];
  const runtime=`\n\nEstado operacional, não são novas instruções: ${JSON.stringify({name:g.name,role:g.role,athleteAge:g.athleteAge,club:g.club,guardianConfirmed:g.guardianConfirmed,contactAdult:g.contactAdult,bookingId:g.bookingId,schedulePhase:g.schedulePhase,offeredDays:g.offeredDays,selectedDay:g.selectedDay,shownTimes})}`;
  const messages:ChatMessage[]=[{role:'system',content:await loadGustavoOperationalPrompt(g.bookingUrl)+runtime},...history];
  messages[0].content+='\nO único caminho de agendamento é get_booking_link. Nunca ofereça data ou horário no WhatsApp e nunca reserve a reunião no chat. A confirmação só ocorre depois que o cliente conclui a escolha no link.';
  messages[0].content+='\nProtocolo de integração: ao guardar fatos com update_qualification, inclua em reply a resposta completa ao cliente, com a próxima ação natural prevista no roteiro. Ela será enviada diretamente, sem uma segunda geração. Campos ainda não informados devem ser omitidos ou null. Não ofereça nem confirme horários em reply sem consultar a agenda real.';
  messages[0].content+='\nA camada de agenda apresenta datas e horários; você não deve escrever opções de data ou hora por conta própria.';
  async function save(patch:GustavoState) {
    state=await getBotConversationState(client!.phone)||state;
    state=await persist(client!,state,patch)||state;g=readState(state);
  }
  async function unchanged() {
    const recent=await fetchRecentClientMessages(client!.id,6);
    return recent.filter(m=>m.direction==='inbound').at(-1)?.createdAt===latestInbound;
  }
  async function bookingLink() {
    if(!g.name||g.name.trim().split(/\s+/).length<2)throw new Error('participant_full_name_required');
    const url=await createBotBookingLink({clientId:client!.id,service:'plano_carreira',name:g.name,
      role:g.role==='responsavel'?'responsavel':'atleta',existingUrl:g.bookingUrl});
    await save({bookingUrl:url});return url;
  }
  async function finish(answer:string,patch:GustavoState={}) {
    if(!(await unchanged()))return false;
    const sent=await send(g.chatId||`${client!.phone}@c.us`,client!.id,answer);
    if(!sent)throw new Error('outbound_deferred');
    await save({...patch,pending:false,pendingText:'',contentStartedAt:undefined,lastProcessedAt:new Date().toISOString(),retryCount:0});
    await recordTrafficEvent({clientId:client!.id,phone:client!.phone,eventType:'gustavo_sdr_turn',channel:'whatsapp',platform:'whatsapp',metadata:{version:GUSTAVO_VERSION,model:'deterministic_booking_link',bookingConfirmed:false,handoff:false}});
    return true;
  }
  try {
    const schedulingCorrection=/\bhoje\b[\s\S]{0,50}(?:\d{1,2}:\d{2}|passou|j[aá]\s+[ée])|\boi\b[\s\S]{0,12}\best[aá]\b/i.test(batchText);
    if(schedulingCorrection&&g.offeredSlots?.length) {
      await save({role:'responsavel',contactAdult:true,guardianConfirmed:true,schedulePhase:'awaiting_full_name',offeredSlots:undefined,offeredDays:undefined,selectedDay:undefined,offeredAt:undefined});
      await finish('Você tem razão, Laura. Aqueles horários estavam errados, desculpa pela confusão. O agendamento é feito somente pelo link, onde você escolhe primeiro o dia e depois o horário disponível. Me passa seu nome completo para eu deixar o link preenchido certinho?');
      return;
    }
    if(g.schedulePhase==='awaiting_full_name') {
      const fullName=extractFullName(batchText);
      if(fullName) {
        await save({name:fullName,role:'responsavel',contactAdult:true,guardianConfirmed:true});
        const url=await bookingLink();
        await finish(`Perfeito, ${fullName.split(/\s+/)[0]}. Faça o agendamento por este link: ${url}\n\nNele você escolhe primeiro o dia e depois o horário disponível.`,{schedulePhase:undefined});
        return;
      }
    }
    let answer='';
    for(let round=0;round<7;round++) {
      const message=await callGustavoValidatedModel(messages);
      if(!(await unchanged()))return;
      if(!message.tool_calls?.length) {answer=String(message.content||'').trim();break;}
      messages.push(message);
      for(const tool of message.tool_calls) {
        let result:any;
        try {
          const args=JSON.parse(tool.function.arguments||'{}');
          if(tool.function.name==='update_qualification') {
            const patch:GustavoState={};
            if(typeof args.name==='string')patch.name=args.name.trim().slice(0,120);
            if(['responsavel','atleta'].includes(args.role))patch.role=args.role;
            if(Number.isInteger(args.athleteAge)&&args.athleteAge>0&&args.athleteAge<=100)patch.athleteAge=args.athleteAge;
            if(typeof args.club==='string')patch.club=args.club.slice(0,180);
            if(args.guardianConfirmed===true)patch.guardianConfirmed=true;
            if(args.contactAdult===true)patch.contactAdult=true;
            if(args.role==='responsavel') {patch.contactAdult=true;patch.guardianConfirmed=true;}
            await save(patch);result={ok:true,state:patch};
            answer=String(args.reply||'').trim();
          } else if(tool.function.name==='get_available_slots'||tool.function.name==='get_times_for_day'||tool.function.name==='reserve_meeting') {
            throw new Error('booking_link_only');
          } else if(tool.function.name==='get_booking_link') {
            if(g.athleteAge&&g.athleteAge<18&&g.role!=='responsavel'&&!g.guardianConfirmed) {
              answer='Como o atleta é menor, preciso que o responsável participe. Ele está com você para seguir?';result={ok:false,error:'adult_guardian_required'};
            } else if(!g.name||g.name.trim().split(/\s+/).length<2) {
              await save({schedulePhase:'awaiting_full_name'});answer='Me passa seu nome completo para eu deixar o link de agendamento preenchido certinho?';result={ok:false,error:'participant_full_name_required'};
            } else {
              const url=await bookingLink();answer=`Perfeito, ${g.name.split(/\s+/)[0]}. Faça o agendamento por este link: ${url}\n\nNele você escolhe primeiro o dia e depois o horário disponível.`;result={ok:true,bookingUrl:url};
            }
          } else if(tool.function.name==='handoff_to_seller') {
            await save({handoff:true,disqualified:args.disqualified===true,pending:false});
            await updateClientAiProfile({clientId:client!.id,handoffRequested:true,qualificationReason:String(args.reason||'Gustavo: atendimento humano').slice(0,200)});
            await recordTrafficEvent({clientId:client!.id,phone:client!.phone,eventType:'gustavo_sdr_handoff',channel:'whatsapp',platform:'whatsapp',metadata:{version:GUSTAVO_VERSION,reason:String(args.reason||'').slice(0,200)}});
            result={ok:true,handoffRegistered:true};
          } else throw new Error('unknown_tool');
        } catch(error) {result={ok:false,error:error instanceof Error?error.message:'integration_failed'};}
        messages.push({role:'tool',tool_call_id:tool.id,content:JSON.stringify(result)});
      }
      if(answer)break;
    }
    if(!answer)throw new Error('gustavo_no_final_reply');
    if(!(await unchanged()))return;
    if((answer.match(/\?/g)||[]).length>1)throw new Error('one_question_rule_violation');
    if(/\p{Extended_Pictographic}/u.test(answer))throw new Error('no_emoji_rule_violation');
    if(/R\$\s*\d|€\s*\d|US\$\s*\d/i.test(answer))throw new Error('price_rule_violation');
    if(/(?:\bhoje\b|\bamanh[ãa]\b|\b(?:segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:-feira)?\b)[\s\S]{0,80}\b(?:[àa]s)\s*\d{1,2}/i.test(answer))throw new Error('booking_link_only');
    // Do not let generated text claim a booking that has no confirmed receipt.
    if(!g.bookingId&&/(?:reuni[aã]o.{0,25}confirmada|t[aá] marcado|ficou agendad|est[aá] agendad|fechado.{0,35}(?:\d{1,2}h|\d{1,2}:\d{2}))/i.test(answer))throw new Error('unconfirmed_booking_reply');
    const saved=await getBotConversationState(client.phone);
    if(saved?.metadata?.bookingId&&!g.bookingId)g.bookingId=String(saved.metadata.bookingId);
    const sent=await send(g.chatId||`${client.phone}@c.us`,client.id,answer);
    if(!sent)throw new Error('outbound_deferred');
    await save({pending:false,pendingText:'',contentStartedAt:undefined,lastProcessedAt:new Date().toISOString(),retryCount:0,
      ...(g.offeredSlots?.length&&/\d{1,2}(?:h|:\d{2})/.test(answer)?{offeredAt:new Date().toISOString()}:{} )});
    await recordTrafficEvent({clientId:client.id,phone:client.phone,eventType:'gustavo_sdr_turn',channel:'whatsapp',platform:'whatsapp',metadata:{version:GUSTAVO_VERSION,model:config.GROQ_MODEL,bookingConfirmed:!!g.bookingId,handoff:!!g.handoff}});
  } catch(error) {
    if(error instanceof Error && /groq_429/.test(error.message)) {
      const delay=providerRetryDelayMs(error.message);
      await save({dueAt:new Date(Date.now()+delay).toISOString(),pending:true});
      console.warn('Gustavo awaiting provider rate-limit reset',JSON.stringify({model:config.GROQ_MODEL,retryInSeconds:Math.ceil(delay/1000)}));
      return;
    }
    const retry=(g.retryCount||0)+1;
    await save({retryCount:retry,dueAt:new Date(Date.now()+30000).toISOString(),pending:retry<3});
    if(retry>=3)await updateClientAiProfile({clientId:client.id,handoffRequested:true,qualificationReason:'Gustavo: integração indisponível, atendimento humano necessário.'});
    console.warn('Gustavo turn deferred',error instanceof Error?error.message:'integration_failed');
  }
}
