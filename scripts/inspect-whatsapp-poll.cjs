const fs = require('node:fs');
const puppeteer = require('puppeteer');
(async () => {
  const port = fs.readFileSync('/home/opc/cliente-whatsapp-crm/whatsapp-session/session/DevToolsActivePort','utf8').split('\n')[0];
  const browser = await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`});
  try {
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('web.whatsapp.com'));
    const result = await page.evaluate(async id => {
      const key = window.require('WAWebMsgKey').fromString(id);
      const rows = await window.require('WAWebPollsVotesSchema').getTable().equals(['parentMsgKey'],key.toString());
      const msg = window.require('WAWebCollections').Msg.get(id);
      const table=window.require('WAWebPollsVotesSchema').getTable();
      const alternatives=await Promise.all([id,key._serialized,key.$1,key.toString()].filter(k=>typeof k==='string').map(async k=>({key:k,count:(await table.equals(['parentMsgKey'],k)).length})));
      const suffix=id.split('_').at(-1);
      const all=await table.all();
      const matched=all.filter(v=>JSON.stringify(v.parentMsgKey).includes(suffix));
      const updates=window.require('WAWebCollections').Msg.getModelsArray().filter(m=>String(m.from?._serialized||m.from).includes('139131841687598') && /poll/i.test(m.type)).map(m=>({type:m.type,id:m.id?._serialized,parent:m.pollUpdateParentKey,encVotePresent:!!m.encPollVote}));
      return {count:rows.length,pollOptions:msg?.pollOptions,matched, updates,snapshot:msg?.pollVotesSnapshot,allCount:all.length, votes:rows.map(v => ({sender:v.sender,senderTimestampMs:v.senderTimestampMs,selectedOptionLocalIds:Array.from(new Uint8Array(v.selectedOptionLocalIds)),parentMsgKey:v.parentMsgKey})),hookExposed:typeof window.onPollVoteEvent==='function',alternatives};
    },process.argv[2]);
    console.log(JSON.stringify(result));
  } finally {browser.disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
