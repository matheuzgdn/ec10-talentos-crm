import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://ec10talentos.com/agendar',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>document.querySelector('iframe')||document.body.innerText.includes('Agende')||document.body.innerText.includes('reunião'),{},{timeout:15000}).catch(()=>{});
 console.log(JSON.stringify({url:page.url(),title:await page.title(),frames:page.frames().map(f=>f.url()),bodyExcerpt:(await page.locator('body').innerText()).slice(0,450),errors}));
} finally {await browser.close();}
