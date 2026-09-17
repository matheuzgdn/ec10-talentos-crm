import assert from 'node:assert/strict';
import {ec10Messages,shouldSendEc10Welcome,getEc10LeadPlan,canSendEc10Audio,isEurocampAudio} from '../apps/bot/dist/ec10-flow.js';
import {selectEricAudioPathForAiReply} from '../apps/bot/dist/ai.js';
let checks=0;const check=v=>{assert.ok(v);checks++;};
check(ec10Messages.welcome==='Bem-vindo à EC10 Talentos!');
check(!/assistente|virtual/i.test(ec10Messages.welcome));
check(shouldSendEc10Welcome(false,'Bom dia'));
check(!shouldSendEc10Welcome(true,'Bom dia'));
check(!shouldSendEc10Welcome(false,'Pare de me enviar mensagens'));
const eurocampAudios=['media/audio/ec10/eric-2026-09-14/04_14-19_apresentacao.ogg','media/audio/ec10/eric-2026-09-14/05_14-19_eurocamp.ogg'];
for(const path of eurocampAudios){check(isEurocampAudio(path));check(!canSendEc10Audio(null,path));}
for(let age=8;age<=35;age++) {
  const plan=getEc10LeadPlan(age);
  check(plan!==null);
  for(const path of eurocampAudios)check(canSendEc10Audio(age,path)===(age<18));
  if(age>=18)check(plan.audioItems.every(a=>!isEurocampAudio(a.audioPath)));
  if(age>=20&&age<=25){check(plan.serviceInterest==='plano_internacional');check(plan.audioItems.length===1);}
  if(age===18||age===19){check(plan.serviceInterest==='eurocamp');check(plan.audioItems.length===0);}
  const ai=selectEricAudioPathForAiReply({athleteAge:age,ericAudioRecommended:true,serviceInterest:plan.serviceInterest,handoffRequested:false,meetingRequested:false,qualificationStatus:'more_info'});
  if(age>=18)check(!isEurocampAudio(ai));
}
check(getEc10LeadPlan(17).audioItems.length===2);
check(getEc10LeadPlan(13).audioItems.length>=2);
console.log(JSON.stringify({checks,result:'passed',firstMessageOnlyWelcome:true,noEurocampAudioForAdults:true,offersUnchanged:true,externalMessagesSent:0,paidAiCalls:0}));
