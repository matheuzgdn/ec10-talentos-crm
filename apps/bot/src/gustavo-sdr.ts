import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { normalizeGeminiMessage, resolveSafeReply, selectGustavoKnowledgeAction, formatBookingReply, factsFromInbound, recoverQualification } from './gemini-adapter.js';
import { appendClientTags, cancelQueuedFollowUpMessages, createBotBookingLink, fetchRecentClientMessages,
  getBotConversationState, getClientAutomationStateById, recordTrafficEvent, saveBotConversationState,
  updateClientAiProfile, type BotConversationState, type ClientAutomationState } from './store.js';

export const GUSTAVO_VERSION = 'gustavo-20260917-resilience-v4';
export function providerRetryDelayMs(message:string) {
  const duration=message.match(/try again in\s+([\d.hms\s]+)/i)?.[1]||'';
  let milliseconds=0;
  for(const match of duration.matchAll(/([\d.]+)\s*(h|m|s)/g))milliseconds+=Number(match[1])*({h:3600000,m:60000,s:1000}[match[2] as 'h'|'m'|'s']);
  return Math.max(30000,(milliseconds||60000)+5000);
}
type GustavoState = { pending?:boolean; dueAt?:string; startedAt?:string; contentStartedAt?:number; batchStartedAt?:number;
  chatId?:string; pendingText?:string; name?:string; responsibleName?:string; athleteName?:string; role?:string; athleteAge?:number; club?:string;
  guardianConfirmed?:boolean; contactAdult?:boolean; guardianEvidenceAt?:string; handoff?:boolean; disqualified?:boolean;
  bookingUrl?:string; bookingParticipantName?:string; bookingId?:string; offeredSlots?:Slot[]; offeredDays?:OfferedDay[]; selectedDay?:string;
  schedulePhase?:'awaiting_full_name'|'awaiting_day'|'awaiting_time'; offeredAt?:string; lastProcessedAt?:string; retryCount?:number;
  lastError?:string; lastErrorAt?:string; deliveryRetryCount?:number };
type Slot = { id:string; startsAt:string; endsAt:string; sellerName:string };
type OfferedDay = { date:string; label:string };
type ChatMessage = {role:string; content?:string|null; [key:string]:unknown};
const bookingApi = 'https://cliente-whatsapp-crm.vercel.app/api/booking';
const agendaDefault = 'https://cliente-whatsapp-crm.vercel.app/agendar?servico=plano_carreira';
const cleanPersonName=(value:unknown) => typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,120):'';
const hasFullName=(value:unknown) => cleanPersonName(value).split(/\s+/).filter(Boolean).length>=2;
const samePersonName=(left:unknown,right:unknown) => {
  const normalized=(value:unknown)=>cleanPersonName(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return !!normalized(left)&&normalized(left)===normalized(right);
};
export function namesFromRelationship(text:string) {
  const clean=text.replace(/\s+/g,' ').trim();
  const person=(value:unknown) => {
    const candidate=cleanPersonName(value).replace(/^(?:o|a)\s+/i,'');
    if(!candidate||!/^[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}$/u.test(candidate))return undefined;
    if(/\b(?:pai|mae|responsavel|filho|filha|atleta|estou|procurando|quero|tenho)\b/i.test(candidate))return undefined;
    return candidate;
  };
  const responsiblePatterns=[
    /\bmeu\s+nome\s+[ée]\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}?)(?=\s*(?:,|\.|$)|\s+(?:e\s+)?(?:meu|minha)\s+(?:filho|filha|atleta)\b)/iu,
    /\bme\s+chamo\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}?)(?=\s*(?:,|\.|$)|\s+(?:e\s+)?(?:meu|minha)\s+(?:filho|filha|atleta)\b)/iu,
    /\b(?:eu\s+)?sou\s+(?!o\s+pai|a\s+m[aã]e|respons[aá]vel)([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}?)(?=\s+(?:e\s+)?(?:meu|minha)\s+(?:filho|filha|atleta)\b|\s*,|\s*\.|$)/iu,
  ];
  const athletePatterns=[
    /\b(?:meu|minha)\s+(?:filho|filha|atleta)\s*(?:,\s*)?(?:se\s+chama\s+|[ée]\s+|o\s+|a\s+)?([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}?)(?=\s+(?:tem|joga|treina|est[aá]|e\s+tem)\b|\s*(?:,|\.|$))/iu,
    /\b(?:filho|filha|atleta)\s+(?:chamado|chamada)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}?)(?=\s*(?:,|\.|$))/iu,
  ];
  const familyContext=/\b(?:meu|minha)\s+(?:filho|filha|atleta)\b|\b(?:sou|eu\s+sou)\s+(?:(?:o|a)\s+)?(?:pai|m[aã]e|respons[aá]vel)\b/iu.test(clean);
  const responsibleName=familyContext?responsiblePatterns.map(pattern=>person(clean.match(pattern)?.[1])).find(Boolean):undefined;
  const athleteName=athletePatterns.map(pattern=>person(clean.match(pattern)?.[1])).find(Boolean);
  return {responsibleName,athleteName};
}
export function contactNameFromSelfIntroduction(text:string) {
  const clean=text.replace(/\s+/g,' ').trim();
  const match=clean.match(/\b(?:meu\s+nome\s+[ée]|me\s+chamo|(?:eu\s+)?sou)\s+(?!o\s+pai\b|a\s+m[aã]e\b|respons[aá]vel\b)([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}?)(?=\s*(?:,|\.|$)|\s+e\s+(?:enviei|meu|minha)\b)/iu)?.[1];
  const candidate=cleanPersonName(match);
  return candidate&&/^[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,5}$/u.test(candidate)?candidate:undefined;
}
export function minorGuardianConfirmed(state:GustavoState) {
  const minor=Number.isInteger(state.athleteAge)&&Number(state.athleteAge)<18;
  if(!minor)return true;
  return state.role==='responsavel'&&state.guardianConfirmed===true&&state.contactAdult===true&&Boolean(state.guardianEvidenceAt);
}
export function minorGuardianReady(state:GustavoState) {
  return minorGuardianConfirmed(state)&&hasFullName(state.responsibleName)&&!samePersonName(state.responsibleName,state.athleteName);
}
export function bookingParticipantName(state:GustavoState) {
  const minor=Number.isInteger(state.athleteAge)&&Number(state.athleteAge)<18;
  if(minor)return minorGuardianReady(state)?cleanPersonName(state.responsibleName):undefined;
  if(state.role==='responsavel')return hasFullName(state.responsibleName||state.name)?cleanPersonName(state.responsibleName||state.name):undefined;
  return hasFullName(state.athleteName||state.name)?cleanPersonName(state.athleteName||state.name):undefined;
}
export function reconcileGustavoIdentity(input:GustavoState):GustavoState {
  const state={...input};
  const legacy=cleanPersonName(state.name);
  if(state.role==='responsavel'&&!state.responsibleName&&legacy)state.responsibleName=legacy;
  if(state.role==='atleta'&&!state.athleteName&&legacy)state.athleteName=legacy;
  if(!state.name)state.name=state.role==='responsavel'?state.responsibleName:state.role==='atleta'?state.athleteName:undefined;
  if(state.responsibleName&&state.athleteName&&samePersonName(state.responsibleName,state.athleteName)) {
    if(state.role==='responsavel')state.athleteName=undefined;
    else if(state.role==='atleta')state.responsibleName=undefined;
  }
  return state;
}
export const isGustavoEnabled = () => config.EC10_SDR_ENGINE === 'gustavo' && config.BOT_INSTANCE_ID === 'main';
export function appendConfirmedMeetingLink(body:string|null,url:string|null,confirmed:boolean) {
  if(!body||!url||!confirmed||!/^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(url)||! /Sua reuni[aã]o EC10[\s\S]{0,120}confirmada/i.test(body)||body.includes(url))return body;
  return `${body}\n\nLink para entrar na reunião: ${url}`;
}
export function greetingOnly(text:string) {
  return /^(?:(?:oi|ola|opa|e ai|bom dia|boa tarde|boa noite|tudo bem|tudo bom|como vai|bom dia tudo bem|boa tarde tudo bem|boa noite tudo bem)[\s!?.,]*)+$/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim());
}
export function shortAffirmative(text:string) {
  return /^(?:s|ss|sim|sim\s+sim|pode|pode\s+sim|quero|claro|com\s+certeza|vamos|bora|ok|okay|blz|beleza|fechado)$/i
    .test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/g,' ').trim());
}
export function shortAffirmativeContext(text:string,lastAssistantReply:string) {
  if(!shortAffirmative(text))return null;
  if(/\b(?:pai|m[aã]e|respons[aá]vel adulto|respons[aá]vel por (?:ele|ela))\b/i.test(lastAssistantReply))return 'guardian_confirmed';
  if(/\b(?:posso|quer|te envio|enviar)\b[\s\S]{0,60}\blink\b|\blink\b[\s\S]{0,60}\b(?:dia|hor[aá]rio)\b/i.test(lastAssistantReply))return 'booking_link';
  return 'affirmative';
}
export function nextGustavoBatch(previous:GustavoState,text:string,now:number) {
  const batchStartedAt=previous.pending?previous.batchStartedAt||now:now;
  const contentStartedAt=previous.pending?previous.contentStartedAt:undefined;
  const content=contentStartedAt || (!greetingOnly(text)?now:undefined);
  return {...previous,pending:true,batchStartedAt,contentStartedAt:content,
    pendingText:previous.pending?[previous.pendingText,text].filter(Boolean).join('\n'):text,
    dueAt:new Date(now+800).toISOString()};
}
const readState=(state:BotConversationState|null):GustavoState => reconcileGustavoIdentity((state?.metadata?.gustavo||{}) as GustavoState);
async function persist(client:ClientAutomationState,state:BotConversationState|null,patch:GustavoState) {
  const gustavo=reconcileGustavoIdentity({...readState(state),...patch});
  const participant=bookingParticipantName(gustavo);
  const metadata={...state?.metadata,gustavo,sdrActiveEngine:'gustavo',audioSequenceInProgress:false,
    ...(gustavo.responsibleName?{responsibleName:gustavo.responsibleName}:{}),
    ...(gustavo.athleteName?{athleteName:gustavo.athleteName}:{}),
    ...(participant?{bookingContactName:participant}:{})};
  const saved=await saveBotConversationState({clientId:client.id,phone:client.phone,stage:state?.stage||'awaiting_interest',
    roleAnswer:gustavo.role==='responsavel'?'responsavel':gustavo.role==='atleta'?'atleta':state?.role_answer,
    athleteAge:gustavo.athleteAge||state?.athlete_age,ageGroup:state?.age_group,
    serviceInterest:state?.service_interest||client.service_interest,leadPageUrl:state?.lead_page_url,
    completedAt:state?.completed_at,metadata});
  return saved;
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
  const inboundNames=namesFromRelationship(text||'');
  const contactName=contactNameFromSelfIntroduction(text||'');
  const inboundFacts=factsFromInbound(text||'');
  const guardianEvidence=inboundFacts.role==='responsavel'&&inboundFacts.guardianConfirmed===true&&inboundFacts.contactAdult===true;
  await persist(client,state,{...nextGustavoBatch(previous,text||'[Mensagem sem texto disponível]',now),
    startedAt:previous.startedAt||new Date(now).toISOString(),chatId,
    athleteAge:previous.athleteAge||state?.athlete_age||client.athlete_age||undefined,
    role:inboundNames.responsibleName?'responsavel':previous.role||state?.role_answer||undefined,
    name:previous.name||contactName||String(state?.metadata?.bookingContactName||''),
    responsibleName:inboundNames.responsibleName||previous.responsibleName||String(state?.metadata?.responsibleName||''),
    athleteName:inboundNames.athleteName||previous.athleteName||String(state?.metadata?.athleteName||''),
    ...inboundFacts,
    ...(guardianEvidence?{guardianEvidenceAt:new Date(now).toISOString()}:{})});
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
  const handbookFiles=[
    '01-empresa/empresa.md','02-produtos/catalogo.md','03-atendimento/fluxo.md','04-memoria/identidades.md',
    '05-agendamento/regras.md','06-qualidade/checklist.md','07-seguranca/limites.md'
  ];
  const handbook=await Promise.all(handbookFiles.map(file=>fs.readFile(path.join(path.resolve(config.GUSTAVO_SKILL_DIR),'handbook',file),'utf8').catch(()=>'')));
  const siteKnowledge=[await fs.readFile(path.join(path.resolve(config.GUSTAVO_SKILL_DIR),'ec10-site-knowledge.md'),'utf8').catch(()=>''),...handbook].filter(Boolean).join('\n\n---\n\n');
  return `Você é Gustavo, representante comercial da EC10 Talentos no WhatsApp. Fale em português brasileiro, informal, natural e respeitoso. Sem emoji, sem travessão e no máximo uma pergunta por mensagem. Nunca diga "entendi" de forma automática, nunca faça interrogatório e nunca repita fatos já informados. Leia mensagens agrupadas e responda primeiro a dúvida do lead antes de voltar ao próximo passo.

Objetivo: qualificar pais ou responsáveis por atletas de 9 a 18 anos para uma reunião do Plano de Carreira. O produto reúne assessoria esportiva, mentoria coletiva com Eric Cena e marketing esportivo para desenvolver atleta e família. Faça no máximo duas perguntas de qualificação: idade e se joga em clube. Se menor, reunião e decisão financeira são sempre com responsável adulto. Se a pessoa disser ser mãe, pai ou responsável, isso confirma o papel de responsável. Peça o nome completo do adulto que participará da reunião antes do agendamento.

Identidade: responsibleName é o nome da pessoa adulta que conversa e participará da reunião; athleteName é o nome do filho ou atleta. Nunca troque os dois. Em "sou Bruno e meu filho é Marcelo", responsibleName é Bruno e athleteName é Marcelo. Para atleta menor, jamais use athleteName como participante do agendamento e jamais peça o nome completo do atleta como requisito da agenda. Se souber apenas o primeiro nome do responsável, peça naturalmente o nome completo dele, citando o primeiro nome quando for seguro.

Trava para menores: nome preenchido na landing page ou uma frase como "sou Marcelo e enviei meu interesse" identifica apenas o contato, não prova que ele é adulto ou responsável. Só marque role como responsavel, guardianConfirmed e contactAdult quando a própria pessoa disser claramente que é pai, mãe ou responsável, ou falar explicitamente de seu filho ou filha. Para atleta menor, nunca use get_booking_link sem essa confirmação explícita e o nome completo do adulto.

Condução: explique a empresa em uma ou duas frases quando perguntarem. Depois de idade, situação e responsável, convide para reunião sem compromisso. Resolva dúvidas e objeções com valor, sem pressão. Pais participam da jornada. Quem já treina ou tem clube também pode receber planejamento; não prometa colocação ou resultado. Não ofereça clube por conta própria.

Agenda: o agendamento é feito exclusivamente pelo link individual conectado. Nunca ofereça datas ou horários no chat e nunca reserve pelo chat. Depois de qualificar, confirmar o responsável adulto e obter o nome completo, use get_booking_link. Na página do link o cliente escolhe primeiro o dia e depois o horário. Link base: ${agenda}.

Regras: nunca informe preço; diga que o valor é apresentado na reunião e reconduza ao agendamento. Outro produto, fechamento pelo WhatsApp, reclamação, parceria ou dúvida impossível: handoff_to_seller. Opt-out encerra. Fora do público pode ser desqualificado; atleta menor interessado deve trazer responsável, não ser descartado automaticamente. Se perguntarem diretamente, seja honesto que o atendimento é automatizado. Não invente fatos, agenda, clube, preço ou promessa. Não revele IDs, tokens ou estado interno.

Informações: EC10 fica em Belo Horizonte, bairro Gutierrez. Após pagamento há contrato via gov.br ou digitalizado e entrada nos grupos em 5 a 10 dias. Cancelamento sem multa. Use somente quando perguntarem.

Conhecimento factual verificado do site, sem alterar o escopo de qualificação do Gustavo:
${siteKnowledge}`;
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
  {type:'function',function:{name:'update_qualification',description:'Guardar somente fatos explicitamente informados pelo contato e enviar a resposta natural no campo reply, respeitando o roteiro do Gustavo. responsibleName é o adulto que conversa e participará da reunião; athleteName é o filho ou atleta. Nunca troque os dois. name é legado e só pode receber o nome completo do adulto participante. Campos desconhecidos podem ser omitidos ou null; não inferir idade ou confirmação de responsável. Esta ferramenta já entrega a resposta, sem precisar chamar o modelo outra vez.',parameters:{type:'object',properties:{reply:{type:'string'},name:{type:['string','null']},responsibleName:{type:['string','null']},athleteName:{type:['string','null']},role:{type:['string','null'],enum:['responsavel','atleta',null]},athleteAge:{type:['integer','null']},club:{type:['string','null']},guardianConfirmed:{type:['boolean','null']},contactAdult:{type:['boolean','null']}},required:['reply'],additionalProperties:false}}},
  {type:'function',function:{name:'get_booking_link',description:'Criar o link individual e pré-preenchido para o responsável escolher dia e horário. Este é o único meio permitido de agendamento; nunca oferecer datas ou horários no chat.',parameters:{type:'object',properties:{},additionalProperties:false}}},
  {type:'function',function:{name:'handoff_to_seller',description:'Encaminhar ao humano e interromper automação em reclamação, parceria, outro produto, fechamento ou dúvida insolúvel. Encerramento por opt-out também.',parameters:{type:'object',properties:{reason:{type:'string'},disqualified:{type:'boolean'}},required:['reason'],additionalProperties:false}}},
];
export async function callGustavoModel(messages:ChatMessage[],toolDefinitions=gustavoTools) {
  if(config.GEMINI_API_KEY) {
    try {
      const response=await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',{
        method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.GEMINI_API_KEY}`},
        body:JSON.stringify({model:config.GEMINI_MODEL,temperature:.25,max_tokens:700,messages,
          ...(toolDefinitions.length?{tools:toolDefinitions,tool_choice:'required',parallel_tool_calls:false}:{})}),
        signal:AbortSignal.timeout(Math.max(config.GROQ_REQUEST_TIMEOUT_MS,30000)),
      });
      if(response.ok) {
        const result=await response.json() as any;
        if(!result.choices?.[0]?.message)throw new Error('gemini_empty');
        return result.choices[0].message;
      }
      console.warn('Gustavo Gemini primary unavailable; trying Groq fallback',JSON.stringify({model:config.GEMINI_MODEL,status:response.status}));
    } catch(error) {
      console.warn('Gustavo Gemini primary failed; trying Groq fallback',error instanceof Error?error.message:'integration_failed');
    }
  }
  if(!config.GROQ_API_KEY)throw new Error('ai_provider_unavailable');
  const models=[...new Set([config.GROQ_MODEL,'openai/gpt-oss-20b'])];
  for(const [index,model] of models.entries()) {
    const response=await fetch(`${config.GROQ_API_BASE_URL}/chat/completions`,{
      method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.GROQ_API_KEY}`},
      body:JSON.stringify({model,temperature:.25,max_tokens:700,messages,
        ...(toolDefinitions.length?{tools:toolDefinitions,tool_choice:'auto',parallel_tool_calls:false}:{})}),
      signal:AbortSignal.timeout(Math.max(config.GROQ_REQUEST_TIMEOUT_MS,30000)),
    });
    if(!response.ok) {
      const failure=await response.json().catch(()=>({})) as any;
      const message=String(failure.error?.message||'').replace(/gsk_[A-Za-z0-9]+/g,'[redacted]').slice(0,500);
      if(response.status===429&&index<models.length-1) {
        console.warn('Gustavo primary model rate-limited; trying fallback',JSON.stringify({primary:model,fallback:models[index+1]}));
        continue;
      }
      throw new Error(`groq_${response.status}: ${message}`);
    }
    const result=await response.json() as any;
    if(!result.choices?.[0]?.message)throw new Error('groq_empty');
    return result.choices[0].message;
  }
  throw new Error('groq_unavailable');
}
export function normalizeGustavoToolMessage(message:any) {
  const normalized:any=normalizeGeminiMessage(message);
  if(normalized.kind==='blocked')throw new Error(normalized.reason);
  if(normalized.kind==='text')return {...message,content:normalized.reply};
  return {...message,content:null,tool_calls:[{id:`gemini_guard_${Date.now()}`,type:'function',function:{name:normalized.toolName,arguments:JSON.stringify(normalized.args)}}]};
}
export async function callGustavoValidatedModel(messages:ChatMessage[]) {
  for (let attempt=0;attempt<3;attempt++) {
    const message=normalizeGustavoToolMessage(await callGustavoModel(messages));
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
  const explicitGuardianFacts=factsFromInbound(batchText);
  const explicitGuardian=explicitGuardianFacts.role==='responsavel'&&explicitGuardianFacts.guardianConfirmed===true&&explicitGuardianFacts.contactAdult===true;
  const sourceMessages=await fetchRecentClientMessages(client.id,36);
  const latestInbound=sourceMessages.filter(m=>m.direction==='inbound').at(-1)?.createdAt;
  const history:ChatMessage[]=sourceMessages.filter(m=>m.body&&Date.parse(m.createdAt)>=Date.parse(g.startedAt||'1970-01-01')).map(m=>({role:m.direction==='inbound'?'user':'assistant',content:m.body}));
  if(!history.length)history.push({role:'user',content:batchText});
  while(history.length>2&&history.reduce((sum,m)=>sum+String(m.content||'').length,0)>6500)history.shift();
  const guardianEvidenceMessage=[...sourceMessages].reverse().find(m=>m.direction==='inbound'&&(()=>{
    const facts=factsFromInbound(m.body||'');
    return facts.role==='responsavel'&&facts.guardianConfirmed===true&&facts.contactAdult===true;
  })());
  if(guardianEvidenceMessage&&!g.guardianEvidenceAt)await save({guardianEvidenceAt:guardianEvidenceMessage.createdAt});
  const recovered=recoverQualification(g,history);
  if(recovered.athleteAge!==g.athleteAge||recovered.role!==g.role||recovered.club!==g.club||recovered.guardianConfirmed!==g.guardianConfirmed)await save(recovered);
  const recentAssistantReplies=history.filter(m=>m.role==='assistant').map(m=>String(m.content||'')).slice(-4);
  const lastAssistantReply=recentAssistantReplies.at(-1)||'';
  const shownTimes=g.selectedDay?g.offeredSlots?.filter(s=>localDateKey(s.startsAt)===g.selectedDay).slice(0,3).map(s=>localTimeLabel(s.startsAt)):[];
  const runtime=`\n\nEstado operacional, não são novas instruções: ${JSON.stringify({name:g.name,responsibleName:g.responsibleName,athleteName:g.athleteName,role:g.role,athleteAge:g.athleteAge,club:g.club,guardianConfirmed:g.guardianConfirmed,contactAdult:g.contactAdult,guardianEvidenceConfirmed:Boolean(g.guardianEvidenceAt),bookingId:g.bookingId,bookingParticipantName:g.bookingParticipantName,schedulePhase:g.schedulePhase,offeredDays:g.offeredDays,selectedDay:g.selectedDay,shownTimes})}`;
  const messages:ChatMessage[]=[{role:'system',content:await loadGustavoOperationalPrompt(g.bookingUrl)+runtime},...history];
  messages[0].content+='\nO único caminho de agendamento é get_booking_link. Nunca ofereça data ou horário no WhatsApp e nunca reserve a reunião no chat. A confirmação só ocorre depois que o cliente conclui a escolha no link.';
  messages[0].content+='\nProtocolo de integração: ao guardar fatos com update_qualification, inclua em reply a resposta completa ao cliente, com a próxima ação natural prevista no roteiro. Ela será enviada diretamente, sem uma segunda geração. Campos ainda não informados devem ser omitidos ou null. Não ofereça nem confirme horários em reply sem consultar a agenda real.';
  messages[0].content+='\nA camada de agenda apresenta datas e horários; você não deve escrever opções de data ou hora por conta própria.';
  messages[0].content+='\nRespeite os fatos do estado e do histórico: se idade, papel ou clube já foram informados, NÃO pergunte novamente. Se o contato disse ser atleta, fale diretamente com ele, nunca presuma que tem um filho. Não repita saudação nem elogios já usados. Um elogio sozinho não dá continuidade. Em resposta a interesse ou qualificação, explique brevemente o valor e faça somente a próxima pergunta ainda necessária. Sucesso é a reunião qualificada com o adulto responsável; enviar o link não significa reunião confirmada. Tire dúvidas antes de avançar, sem pressão.';
  async function save(patch:GustavoState) {
    state=await getBotConversationState(client!.phone)||state;
    state=await persist(client!,state,patch)||state;g=readState(state);
  }
  async function unchanged() {
    const recent=await fetchRecentClientMessages(client!.id,6);
    return recent.filter(m=>m.direction==='inbound').at(-1)?.createdAt===latestInbound;
  }
  async function bookingLink() {
    if(g.athleteAge&&g.athleteAge<18&&!minorGuardianConfirmed(g))throw new Error('adult_guardian_required');
    const participantName=bookingParticipantName(g);
    if(!participantName)throw new Error('participant_full_name_required');
    const url=await createBotBookingLink({clientId:client!.id,service:'plano_carreira',name:participantName,
      role:g.role==='responsavel'?'responsavel':'atleta',
      existingUrl:samePersonName(g.bookingParticipantName,participantName)?g.bookingUrl:undefined});
    await save({bookingUrl:url,bookingParticipantName:participantName});return url;
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
    const knowledgeAction=selectGustavoKnowledgeAction(batchText);
    if(knowledgeAction) {
      const sent=await finish(knowledgeAction.reply,knowledgeAction.kind==='handoff'?{handoff:true}:{});
      if(sent&&knowledgeAction.kind==='handoff') {
        await updateClientAiProfile({clientId:client!.id,handoffRequested:true,qualificationReason:`Gustavo: interesse em ${knowledgeAction.product}, atendimento humano.`});
        await recordTrafficEvent({clientId:client!.id,phone:client!.phone,eventType:'gustavo_sdr_handoff',channel:'whatsapp',platform:'whatsapp',metadata:{version:GUSTAVO_VERSION,reason:`Outro produto: ${knowledgeAction.product}`}});
      }
      return;
    }
    const schedulingCorrection=/\bhoje\b[\s\S]{0,50}(?:\d{1,2}:\d{2}|passou|j[aá]\s+[ée])|\boi\b[\s\S]{0,12}\best[aá]\b/i.test(batchText);
    if(schedulingCorrection&&g.offeredSlots?.length) {
      await save({schedulePhase:minorGuardianConfirmed(g)?'awaiting_full_name':undefined,offeredSlots:undefined,offeredDays:undefined,selectedDay:undefined,offeredAt:undefined});
      await finish(minorGuardianConfirmed(g)
        ? 'Você tem razão. Aqueles horários estavam errados, desculpa pela confusão. O agendamento é feito somente pelo link, onde você escolhe primeiro o dia e depois o horário disponível. Me passa seu nome completo para eu deixar o link preenchido certinho?'
        : 'Você tem razão. Aqueles horários estavam errados, desculpa pela confusão. Como o atleta é menor, antes do link preciso confirmar: você é o pai, a mãe ou o responsável adulto por ele?');
      return;
    }
    const affirmativeContext=shortAffirmativeContext(batchText,lastAssistantReply);
    if(affirmativeContext==='guardian_confirmed') {
      await save({role:'responsavel',guardianConfirmed:true,contactAdult:true,guardianEvidenceAt:latestInbound||new Date().toISOString()});
      const participantName=bookingParticipantName(g);
      if(!participantName) {
        await save({schedulePhase:'awaiting_full_name'});
        await finish('Fechado. Me passa seu nome completo para eu deixar o agendamento no nome do responsável?');
        return;
      }
      const url=await bookingLink();
      await finish(formatBookingReply(participantName,url),{schedulePhase:undefined});
      return;
    }
    if(affirmativeContext==='booking_link') {
      if(g.athleteAge&&g.athleteAge<18&&!minorGuardianConfirmed(g)) {
        await finish('Como o atleta é menor, antes do link preciso confirmar: você é o pai, a mãe ou o responsável adulto por ele?');
        return;
      }
      const participantName=bookingParticipantName(g);
      if(!participantName) {
        await save({schedulePhase:'awaiting_full_name'});
        await finish('Me passa seu nome completo para eu deixar o link preenchido certinho?');
        return;
      }
      const url=await bookingLink();
      await finish(formatBookingReply(participantName,url),{schedulePhase:undefined});
      return;
    }
    if(g.schedulePhase==='awaiting_full_name') {
      if(g.athleteAge&&g.athleteAge<18&&!minorGuardianConfirmed(g)) {
        await save({schedulePhase:undefined});
        await finish('Como o atleta é menor, antes do agendamento preciso confirmar: você é o pai, a mãe ou o responsável adulto por ele?');
        return;
      }
      const suppliedName=extractFullName(batchText);
      if(suppliedName) {
        const identity=g.role==='atleta'&&!(g.athleteAge&&g.athleteAge<18)
          ? {name:suppliedName,athleteName:suppliedName}
          : {name:suppliedName,responsibleName:suppliedName,role:'responsavel',contactAdult:true,guardianConfirmed:true};
        await save(identity);
      }
      const participantName=bookingParticipantName(g);
      if(participantName) {
        const url=await bookingLink();
        await finish(formatBookingReply(participantName,url),{schedulePhase:undefined});
        return;
      }
    }
    let answer='';
    for(let round=0;round<7;round++) {
      const message=await callGustavoValidatedModel(messages);
      if(!(await unchanged()))return;
      if(!message.tool_calls?.length) {
        const guarded=(resolveSafeReply as any)({message,state:g,recentAssistantReplies,latestInbound:batchText});
        if(!guarded.ok)throw new Error(`unsafe_reply:${guarded.issues.join(',')}`);
        await save({ ...factsFromInbound(batchText) });
        answer=String(guarded.reply||'').trim();break;
      }
      messages.push(message);
      for(const tool of message.tool_calls) {
        let result:any;
        try {
          const args=JSON.parse(tool.function.arguments||'{}');
          if(tool.function.name==='update_qualification') {
            const guarded=(resolveSafeReply as any)({message:{tool_calls:[tool]},state:g,recentAssistantReplies,latestInbound:batchText});
            if(!guarded.ok)throw new Error(`unsafe_reply:${guarded.issues.join(',')}`);
            const safeArgs=guarded.toolArgs||args;
            const patch:GustavoState={};
            const safeState=guarded.state||safeArgs;
            if(typeof safeState.responsibleName==='string') {
              const candidate=cleanPersonName(safeState.responsibleName);
              if(!(g.athleteAge&&g.athleteAge<18)||explicitGuardian||minorGuardianConfirmed(g))patch.responsibleName=candidate;
              else if(!patch.name)patch.name=candidate;
            }
            if(typeof safeState.athleteName==='string')patch.athleteName=cleanPersonName(safeState.athleteName);
            if(typeof safeState.name==='string') {
              patch.name=cleanPersonName(safeState.name);
              if(safeState.role==='responsavel'||g.role==='responsavel')patch.responsibleName=patch.name;
              else if(safeState.role==='atleta'||g.role==='atleta')patch.athleteName=patch.name;
            }
            if(safeState.role==='atleta'||(safeState.role==='responsavel'&&(explicitGuardian||minorGuardianConfirmed(g))))patch.role=safeState.role;
            if(Number.isInteger(safeState.athleteAge)&&safeState.athleteAge>0&&safeState.athleteAge<=100)patch.athleteAge=safeState.athleteAge;
            if(typeof safeState.club==='string')patch.club=safeState.club.slice(0,180);
            if(safeState.guardianConfirmed===true&&(explicitGuardian||minorGuardianConfirmed(g)))patch.guardianConfirmed=true;
            if(safeState.contactAdult===true&&(explicitGuardian||minorGuardianConfirmed(g)))patch.contactAdult=true;
            if(safeState.role==='responsavel'&&explicitGuardian) {patch.role='responsavel';patch.contactAdult=true;patch.guardianConfirmed=true;patch.guardianEvidenceAt=new Date().toISOString();}
            await save(patch);result={ok:true,state:patch};
            answer=String(guarded.reply||'').trim();
          } else if(tool.function.name==='get_available_slots'||tool.function.name==='get_times_for_day'||tool.function.name==='reserve_meeting') {
            throw new Error('booking_link_only');
          } else if(tool.function.name==='get_booking_link') {
            if(g.athleteAge&&g.athleteAge<18&&!minorGuardianConfirmed(g)) {
              answer='Como o atleta é menor, antes do agendamento preciso confirmar: você é o pai, a mãe ou o responsável adulto por ele?';result={ok:false,error:'adult_guardian_required'};
            } else if(!bookingParticipantName(g)) {
              await save({schedulePhase:'awaiting_full_name'});
              const firstName=cleanPersonName(g.responsibleName).split(' ')[0];
              answer=firstName?`${firstName}, qual é seu sobrenome para eu completar o agendamento?`:'Me passa seu nome completo para eu deixar a reunião no nome do responsável?';result={ok:false,error:'participant_full_name_required'};
            } else {
              const participantName=bookingParticipantName(g)!;
              const url=await bookingLink();answer=formatBookingReply(participantName,url);result={ok:true,bookingUrl:url};
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
    const finalGuard=(resolveSafeReply as any)({message:{content:answer},state:g,recentAssistantReplies,latestInbound:batchText});
    if(!finalGuard.ok)throw new Error(`unsafe_reply:${finalGuard.issues.join(',')}`);
    answer=String(finalGuard.reply||'').trim();
    if(!(await unchanged()))return;
    if((answer.replace(/https?:\/\/\S+/gi,'').match(/\?/g)||[]).length>1)throw new Error('one_question_rule_violation');
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
    await recordTrafficEvent({clientId:client.id,phone:client.phone,eventType:'gustavo_sdr_turn',channel:'whatsapp',platform:'whatsapp',metadata:{version:GUSTAVO_VERSION,model:config.GEMINI_API_KEY?config.GEMINI_MODEL:config.GROQ_MODEL,bookingConfirmed:!!g.bookingId,handoff:!!g.handoff}});
  } catch(error) {
    const errorMessage=error instanceof Error?error.message:'integration_failed';
    if(errorMessage==='outbound_deferred') {
      const deliveryRetry=(g.deliveryRetryCount||0)+1;
      const delay=Math.min(300000,15000*Math.pow(2,Math.min(deliveryRetry-1,4)));
      await save({deliveryRetryCount:deliveryRetry,lastError:errorMessage,lastErrorAt:new Date().toISOString(),
        dueAt:new Date(Date.now()+delay).toISOString(),pending:true});
      console.warn('Gustavo delivery deferred',JSON.stringify({retry:deliveryRetry,retryInSeconds:Math.ceil(delay/1000)}));
      return;
    }
    if(error instanceof Error && /groq_429/.test(error.message)) {
      const delay=providerRetryDelayMs(error.message);
      await save({dueAt:new Date(Date.now()+delay).toISOString(),pending:true});
      console.warn('Gustavo awaiting provider rate-limit reset',JSON.stringify({model:config.GROQ_MODEL,retryInSeconds:Math.ceil(delay/1000)}));
      return;
    }
    try {
      let fallback='';
      if(!g.athleteAge)fallback='Pra eu te orientar pelo caminho certo, quantos anos o atleta tem?';
      else if(g.athleteAge<18&&!minorGuardianConfirmed(g))fallback='Como o atleta é menor, preciso seguir com um adulto responsável. Você é o pai, a mãe ou o responsável por ele?';
      else if(!g.club)fallback=g.role==='atleta'?'Você joga em algum clube hoje ou está sem clube?':'Ele joga em algum clube hoje ou está sem clube?';
      else if(!bookingParticipantName(g)) {
        await save({schedulePhase:'awaiting_full_name'});
        fallback='Me passa seu nome completo para eu deixar o agendamento preenchido certinho?';
      } else {
        const participantName=bookingParticipantName(g)!;
        const url=await bookingLink();
        fallback=formatBookingReply(participantName,url);
      }
      await finish(fallback,{lastError:errorMessage,lastErrorAt:new Date().toISOString(),retryCount:0});
      await recordTrafficEvent({clientId:client.id,phone:client.phone,eventType:'gustavo_sdr_fallback',channel:'whatsapp',platform:'whatsapp',metadata:{version:GUSTAVO_VERSION,reason:errorMessage.slice(0,80)}});
      return;
    } catch(fallbackError) {
      if(fallbackError instanceof Error&&fallbackError.message==='outbound_deferred') {
        await save({lastError:'outbound_deferred',lastErrorAt:new Date().toISOString(),dueAt:new Date(Date.now()+30000).toISOString(),pending:true});
        console.warn('Gustavo fallback delivery deferred');
        return;
      }
    }
    const retry=(g.retryCount||0)+1;
    await save({retryCount:retry,lastError:errorMessage,lastErrorAt:new Date().toISOString(),dueAt:new Date(Date.now()+30000).toISOString(),pending:retry<3});
    if(retry>=3)await updateClientAiProfile({clientId:client.id,handoffRequested:true,qualificationReason:'Gustavo: integração indisponível, atendimento humano necessário.'});
    console.warn('Gustavo turn deferred',error instanceof Error?error.message:'integration_failed');
  }
}
