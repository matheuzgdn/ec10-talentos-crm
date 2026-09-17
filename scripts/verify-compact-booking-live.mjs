import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const results=[];
try{for(const service of ['plano_carreira','eurocamp','plano_internacional']) {
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`https://ec10talentos.com/agendar?servico=${service}`);
  await page.locator('.booking-date-grid button').first().waitFor({timeout:45000});
  assert.equal(await page.locator('.booking-time-grid button').count(),0);
  const days=await page.locator('.booking-date-grid button').count();assert.ok(days<=7);
  await page.locator('.booking-date-grid button').first().click();
  const times=await page.locator('.booking-time-grid button').count();assert.ok(times>0);
  await page.locator('.booking-time-grid button').first().click();
  assert.equal(await page.getByLabel('Link do vídeo do atleta (opcional)',{exact:true}).count(),1);
  assert.equal(await page.locator('.booking-date-grid').count(),0);
  assert.equal(await page.locator('.booking-service-tabs').count(),0);
  assert.equal(errors.length,0);
  results.push({service,days,times,sequential:true,optionalVideo:true,reservationSubmitted:false});await page.close();
}}finally{await browser.close();}
console.log(JSON.stringify({live:true,results}));
