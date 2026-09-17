import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sdrGreeting,SDR_VERSION,sdrOffer,eligibleSdrOffers,explicitSdrHuman,explicitSdrStop} from '../apps/bot/dist/sdr-flow.js';
import {ec10Messages,isRestartCommand} from '../apps/bot/dist/ec10-flow.js';
const source=fs.readFileSync('apps/bot/dist/index.js','utf8');
const extract=name=>{const start=source.indexOf(`async function ${name}(`);const end=source.indexOf('\nasync function ',start+10);assert.ok(start>=0&&end>start);return source.slice(start,end);};
let state,checks=0;const sent=[],answers=[];
const check=v=>{assert.ok(v);checks++;};
const context=vm.createContext({sdrGreeting,SDR_VERSION,sdrOffer,eligibleSdrOffers,explicitSdrHuman,explicitSdrStop,ec10Messages,isRestartCommand,
  asMetadataRecord:v=>v&&typeof v==='object'?v:{},getBotConversationState:async()=>state,
  sendBotText:async(c,chat,id,text)=>{sent.push(text);return true;},
  handleAndersonNaturalDiscoveryBeforeAge:async({state:current,body})=>{if(current?.stage!=='awaiting_age')return false;const greeting=sdrGreeting(body);if(!greeting)return false;sent.push('Boa tarde, João! Tudo certo por aqui 😄 E com você? Me conta, o que te trouxe até a EC10?');return true;},
  answerEc10SdrQuestion:async p=>{answers.push(p);return 'A equipe explica as condições do pacote na reunião.';},
  generateEc10SalesReplyWithAi:async()=>{throw new Error('Greeting must not request a generic AI response');},
  handleEc10Conversation:async()=>{sent.push('structured-entry');return true;},
});
vm.runInContext(`${extract('handleEc10AiConversation')}\n${extract('handleEc10ConversationInternal')}\nthis.ai=handleEc10AiConversation;this.flow=handleEc10ConversationInternal;`,context);
const client={id:'mock',phone:'12025550100',service_interest:'plano_internacional'};
for(const metadata of [{meeting:{bookingId:'test'}},{sdrVersion:SDR_VERSION,bookingId:'test',sdrOfferId:'international'}]){
 state={stage:'completed',athlete_age:22,service_interest:'plano_internacional',metadata};
 const before=JSON.stringify(state);
 await context.ai({},'mock',client,'Boa tarde tudo bem?');
 check(sent.at(-1).startsWith('Boa tarde!'));check(sent.at(-1).includes('reunião que você agendou'));
 check(!/entendi|plano internacional|qual.*idade|maior dificuldade/i.test(sent.at(-1)));
 check(JSON.stringify(state)===before);check(answers.length===0);
}
state={stage:'completed',athlete_age:22,service_interest:'plano_internacional',metadata:{meeting:{bookingId:'test'}}};
await context.ai({},'mock',client,'Quanto custa?');check(answers.at(-1).offer.id==='international');check(answers.at(-1).step==='booking');
state={stage:'awaiting_age',metadata:{}};
await context.flow({},'mock',client.id,client.phone,'Boa tarde tudo bem?');
check(sent.at(-1).startsWith('Boa tarde, João!'));check(sent.at(-1).includes('o que te trouxe até a EC10'));check(!/qual.*idade|internacional|entendi/i.test(sent.at(-1)));
state={stage:'awaiting_interest',metadata:{bookingContactPending:true}};
await context.flow({},'mock',client.id,client.phone,'Olá tudo bem?');check(sent.at(-1).includes('nome completo'));check(!/entendi|internacional/i.test(sent.at(-1)));
console.log(JSON.stringify({checks,result:'passed',legacyAndNewBookings:true,aiCalls:0,whatsappMessagesSent:0}));
