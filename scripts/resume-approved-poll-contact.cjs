// One-time recovery authorized by the contact owner. Does not create a WhatsApp vote.
const fs=require('node:fs');
const puppeteer=require('puppeteer');
(async()=>{
  const port=fs.readFileSync('/home/opc/cliente-whatsapp-crm/whatsapp-session/session/DevToolsActivePort','utf8').split('\n')[0];
  const browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${port}`});
  try {
    const page=(await browser.pages()).find(p=>p.url().includes('web.whatsapp.com'));
    const result=await page.evaluate(async()=>{
      if(window.require('WAWebSocketModel').Socket.state!=='CONNECTED')throw new Error('WhatsApp is not connected');
      const id='true_139131841687598@lid_3EB0582933FAF1A7942DC1';
      const msg=window.require('WAWebCollections').Msg.get(id);
      if(!msg)throw new Error('Original poll is not loaded');
      const option=msg.pollOptions.find(p=>p.name==='Escolinha ou projeto');
      if(!option)throw new Error('Expected poll option does not match');
      await window.onPollVoteEvent([{sender:'139131841687598@lid',parentMsgKey:id,
        selectedOptionLocalIds:[option.localId],parentMessage:window.WWebJS.getMessageModel(msg),
        ec10RecoverySource:'approved_contact_recovery'}]);
      return {submitted:true,source:'user_approved_screenshot_answer',option:option.name};
    });
    console.log(JSON.stringify(result));
  }finally{browser.disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
