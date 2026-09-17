import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {normalizePollVote,pollVoteMessageId,serializeWhatsAppKey,readWhatsAppPollVotes} from '../apps/bot/dist/poll-votes.js';
const parent={id:{_serialized:'true_contact@lid_POLL1'},pollOptions:[{localId:0,name:'Clube federado'},{localId:1,name:'Escolinha ou projeto'}]};
let checks=0;
function check(name,fn){fn();checks++;console.log(`ok - ${name}`);}
check('string and object voter identifiers',()=>{
  assert.equal(serializeWhatsAppKey({_serialized:'123@lid'}),'123@lid');
  assert.equal(serializeWhatsAppKey({$1:'123@lid'}),'123@lid');
  assert.equal(serializeWhatsAppKey({user:'123',server:'lid'}),'123@lid');
});
check('raw stored vote selects the right option',()=>{
  const v=normalizePollVote({sender:{$1:'123@lid'},selectedOptionLocalIds:[1],parentMsgKey:parent.id},parent);
  assert.deepEqual(v.names,['Escolinha ou projeto']);assert.equal(v.voter,'123@lid');
});
check('event shape and local option identifier fallback',()=>{
  assert.deepEqual(normalizePollVote({voter:'123@lid',selectedOptions:[{localId:1}],parentMessage:parent}).names,['Escolinha ou projeto']);
});
check('deselection and unknown option never become an answer',()=>{
  assert.deepEqual(normalizePollVote({selectedOptionLocalIds:[]},parent).names,[]);
  assert.deepEqual(normalizePollVote({selectedOptionLocalIds:[8]},parent).names,[]);
});
check('event, recovery and changed old vote share one dedupe identity',()=>{
  const a=normalizePollVote({parentMessage:parent,voter:'123@lid',selectedOptions:[{name:'Clube federado'}]});
  const b=normalizePollVote({parentMessage:parent,voter:'123@lid',selectedOptionLocalIds:[1]});
  assert.equal(pollVoteMessageId(a,'55123'),pollVoteMessageId(b,'55123'));
  assert.notEqual(pollVoteMessageId(a,'55123'),pollVoteMessageId({...a,parentId:'OTHER'},'55123'));
});
const source=fs.readFileSync('node_modules/whatsapp-web.js/src/Client.js','utf8');
const marker=source.indexOf('/* EC10 resilient poll vote hook */');
const start=source.indexOf('window.WWebJS.injectToFunction(',marker);
const end=source.indexOf('\n            );',start)+'\n            );'.length;
let hook;let originalCalls=0;let emitted;
const context={window:{WWebJS:{injectToFunction:(_spec,fn)=>{hook=fn;},getMessageModel:m=>m},onPollVoteEvent:v=>{emitted=v;}},Msg:{get:()=>parent},console};
vm.runInNewContext(source.slice(start,end),context);
const result=await hook({},async()=>{originalCalls++;return 'persisted';},[{sender:{$1:'123@lid'},parentMsgKey:parent.id,selectedOptionLocalIds:[1]}]);
check('WhatsApp persists before vote decoding',()=>{assert.equal(originalCalls,1);assert.equal(result,'persisted');assert.equal(emitted[0].sender,'123@lid');});
context.window.WWebJS.getMessageModel=()=>{throw new Error('synthetic decode failure');};
const resilient=await hook({},async()=>{originalCalls++;return 'still persisted';},[{parentMsgKey:parent.id,selectedOptionLocalIds:[1]}]);
check('decode failure cannot block WhatsApp persistence',()=>{assert.equal(originalCalls,2);assert.equal(resilient,'still persisted');});
const votes=await readWhatsAppPollVotes({getMessageById:async()=>parent,pupPage:{evaluate:async()=>[{sender:'123@lid',parentMsgKey:parent.id._serialized,selectedOptionLocalIds:[1]}]}},parent.id._serialized);
check('recovery reads raw votes without fragile library constructor',()=>{assert.deepEqual(normalizePollVote(votes[0]).names,['Escolinha ou projeto']);});
const index=fs.readFileSync('apps/bot/src/index.ts','utf8');
check('live and recovery paths retain automation, pause and latest-poll guards',()=>{
  assert.ok(index.includes('!shouldRunWhatsAppAutomation(latest)'));
  assert.ok(index.includes('if (latest.bot_paused) return'));
  assert.ok(index.includes('p.whatsapp_message_id===normalized.parentId'));
  assert.ok(index.includes("handlePollVote(vote,'recovery')"));
});
console.log(JSON.stringify({passed:checks,persistentChanges:0}));
