import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SDR_VERSION,decideEc10Sdr,sdrServiceMenu,sdrOffer,eligibleSdrOffers} from '../apps/bot/dist/sdr-flow.js';
import {getEc10LeadPlan} from '../apps/bot/dist/ec10-flow.js';
const source=fs.readFileSync('apps/bot/dist/index.js','utf8');
const extract=name=>{const start=source.indexOf(`async function ${name}(`);const end=source.indexOf('\nasync function ',start+10);assert.ok(start>=0&&end>start);return source.slice(start,end);};
let state,checks=0;const sent=[],menus=[],audios=[],books=[],events=[],profiles=[];
const check=v=>{assert.ok(v);checks++;};
const context=vm.createContext({SDR_VERSION,decideEc10Sdr,sdrServiceMenu,sdrOffer,eligibleSdrOffers,getEc10LeadPlan,Date,console,
  persistEc10State:async p=>{state={...p.previous,stage:p.stage,athlete_age:p.athleteAge??p.previous.athlete_age,service_interest:p.serviceInterest??p.previous.service_interest,metadata:{...p.previous.metadata,...p.metadata}};return state;},
  updateClientAiProfile:async p=>profiles.push(p),appendClientTags:async()=>{},recordTrafficEvent:async e=>events.push(e),
  cancelQueuedFollowUpMessages:async()=>{},sendBotText:async(c,chat,id,text)=>{sent.push(text);return true;},sendBotPoll:async p=>{menus.push(p);return true;},
  sendBotAudio:async(c,chat,id,path)=>{audios.push(path);return true;},fetchRecentClientMessages:async()=>[],
  answerEc10SdrQuestion:async()=> 'Esse plano acompanha a evolução do atleta, sem garantir aprovação.',
  ensureGuardianBeforeMeeting:async p=>p.state.athlete_age>=18||p.state.metadata.guardianConfirmed===true,
  askMeetingDate:async(c,chat,id,phone,s)=>books.push({phone,state:s})});
vm.runInContext(`${extract('beginEc10Sdr')}\n${extract('handleEc10SdrTurn')}\nthis.begin=beginEc10Sdr;this.turn=handleEc10SdrTurn;`,context);
for(const age of [8,14,18,22,26]) {
  state={stage:'awaiting_age',athlete_age:age,service_interest:'plano_carreira',role_answer:age<18?'responsavel':'atleta',metadata:{leadName:'Pessoa de Teste',guardianConfirmed:age<18,campaignProductName:'Interesse original',untouched:'preserved'}};
  await context.begin({},'mock','mock-id','12025550100',state,age);
  check(state.metadata.sdrStep==='service');check(state.metadata.untouched==='preserved');check(menus.at(-1).options[0]==='Plano de Carreira');
  await context.turn({},'mock','mock-id','12025550100',state,'2');
  if(age>25){check(state.metadata.sdrStep==='help');continue;}
  check(state.metadata.sdrStep==='next');check(state.metadata.sdrOfferId===(age<=13?'kids':age<=19?'camp':'international'));
  const previousAudioCount=audios.length;
  await context.turn({},'mock','mock-id','12025550100',state,'2');check(state.metadata.sdrStep==='question');
  const previousBookings=books.length;
  await context.turn({},'mock','mock-id','12025550100',state,'quanto custa?');check(books.length===previousBookings);check(audios.length===previousAudioCount);check(menus.at(-1).options[0]==='Agendar reunião');
  await context.turn({},'mock','mock-id','12025550100',state,'1');check(books.length===previousBookings+1);check(books.at(-1).phone==='12025550100');
  check(state.metadata.untouched==='preserved');
}
state={stage:'awaiting_interest',athlete_age:14,metadata:{sdrStep:'next',sdrOfferId:'career',guardianConfirmed:false}};
const before=books.length;
await context.turn({},'mock','mock-id','12025550100',state,'1');check(books.length===before);
await context.turn({},'mock','mock-id','12025550100',state,'atendente');check(profiles.at(-1).handoffRequested);check(state.metadata.sdrPaused);
await context.turn({},'mock','mock-id','12025550100',{...state,metadata:{...state.metadata,sdrStep:'next'}},'pare de me enviar mensagens');check(state.stage==='completed');check(profiles.at(-1).automationPauseRequested);check(!profiles.at(-1).handoffRequested);
console.log(JSON.stringify({checks,result:'passed',runtimeHandlers:true,mockedTransport:true,actualBookings:0,messagesSentToWhatsApp:0}));
