import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eligibleSdrOffers,menuChoice,decideEc10Sdr,sdrSafeAnswer,sanitizeSdrAiAnswer,explicitSdrBooking,SDR_VERSION} from '../apps/bot/dist/sdr-flow.js';
let checks=0;const check=v=>{assert.ok(v);checks++;};
for(const age of [8,13,14,17,18,19,20,25,26,40]) {
  const offers=eligibleSdrOffers(age);check(offers[0].id==='career');
  check(offers.some(o=>o.id==='kids')===(age<=13));
  check(offers.some(o=>o.id==='camp')===(age>=14&&age<=19));
  check(offers.some(o=>o.id==='international')===(age>=20&&age<=25));
  for(let i=0;i<offers.length;i++) {
    const chosen=decideEc10Sdr({age,step:'service',body:String(i+1)});
    check(chosen.offer.id===offers[i].id);check(chosen.step==='next');check(!chosen.book);check(!chosen.stop);
    if(age>=18)check(!/04_14-19|05_14-19|eurocamp/i.test(chosen.audio||''));
    if(chosen.audio)check(fs.existsSync(chosen.audio));
    const question=decideEc10Sdr({age,step:'next',offerId:chosen.offer.id,body:'2'});
    check(question.step==='question'&&!question.stop&&!question.book);
    const price=decideEc10Sdr({age,step:'question',offerId:chosen.offer.id,body:'quanto custa?'});
    check(price.answer&&!price.book&&price.menu.options.length===3);
    const meeting=decideEc10Sdr({age,step:'next',offerId:chosen.offer.id,body:'1'});
    check(meeting.book&&meeting.step==='booking');
    const back=decideEc10Sdr({age,step:'next',offerId:chosen.offer.id,body:'3'});
    check(back.step==='service'&&!back.offer&&!back.stop);
    const stop=decideEc10Sdr({age,step:'next',offerId:chosen.offer.id,body:'Pare de me enviar mensagens'});check(stop.stop);
    const human=decideEc10Sdr({age,step:'question',offerId:chosen.offer.id,body:'quero falar com um atendente'});check(human.handoff);
  }
  const help=decideEc10Sdr({age,step:'service',body:offers.length===2?'3':'2'});check(help.step==='help'&&!help.stop);
  const recommended=decideEc10Sdr({age,step:'help',body:'2'});check(recommended.step==='service'&&!recommended.book&&!recommended.stop);
  const unavailable=decideEc10Sdr({age,step:'service',body:'99'});check(unavailable.answer&&!unavailable.offer);
}
for(const age of [0,7,100,NaN,8.5])check(eligibleSdrOffers(age).length===0);
check(menuChoice('2. Eurokids / Sudakids',['Plano de Carreira','Eurokids / Sudakids'])===1);
check(menuChoice('1\n2',['a','b'])===null);
for(const text of ['quanto custa para agendar?','como agendar?','não quero agendar','quero saber mais','tenho uma dúvida antes de agendar','depois vou agendar','sim'])check(!explicitSdrBooking(text));
for(const text of ['quero agendar','agendar reunião','ver horários'])check(explicitSdrBooking(text));
check(!decideEc10Sdr({age:14,step:'service',body:'plano internacional'}).offer);
check(!decideEc10Sdr({age:22,step:'next',offerId:'kids',body:'1'}).book);
for(const text of ['R$399','€2500','https://teste.com','Qual dia?','garantimos aprovação','vou agendar para você','agendamento confirmado'])check(sanitizeSdrAiAnswer(text)===null);
check(sanitizeSdrAiAnswer('O acompanhamento ajuda na preparação do atleta.')!==null);
check(!/entendi|perfeito/i.test(sdrSafeAnswer(14,eligibleSdrOffers(14)[0],'quanto custa?')));
const source=fs.readFileSync('apps/bot/src/index.ts','utf8');
check(source.includes('ensureGuardianBeforeMeeting({client,chatId,clientId,phone,state:next})'));
check(source.includes('sdr_turn:${sdrTurn.turn}'));
check(source.includes("cancelQueuedFollowUpMessages(clientId,'SDR: lead aceitou agendar.')"));
console.log(JSON.stringify({checks,result:'passed',version:SDR_VERSION,externalMessagesSent:0,paidAiCalls:0}));
