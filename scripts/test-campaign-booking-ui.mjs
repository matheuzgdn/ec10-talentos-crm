import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
let checks=0;
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let submitted=null;
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());
   if(u.searchParams.get('mode')==='prefill')return route.fulfill({json:{prefill:{name:'Cliente QA',phone:'12025550123',email:'qa@example.invalid',role:'atleta',service:'plano_internacional',athleteAge:22}}});
   if(route.request().method()==='POST'){
    submitted=route.request().postDataJSON();
    return route.fulfill({json:{booking:{id:'qa-only',startsAt:'2026-09-18T15:00:00Z',endsAt:'2026-09-18T16:00:00Z',sellerName:'Equipe QA',service:'plano_internacional',accessToken:'qa-only',groupInviteUrl:null}}});
   }
   return route.fulfill({json:{slots:[{id:'qa-only',startsAt:'2026-09-18T15:00:00Z',endsAt:'2026-09-18T16:00:00Z',sellerName:'Equipe QA'}]}});
  });
  await page.goto('http://127.0.0.1:5174/agendar?servico=plano_internacional&cadastro='+'Q'.repeat(43));
  await page.getByText('Seus dados do cadastro já estão preenchidos.',{exact:false}).waitFor();
  assert.equal(await page.getByLabel('Seu nome',{exact:true}).inputValue(),'Cliente QA');checks++;
  assert.equal(await page.getByLabel('WhatsApp com DDD',{exact:true}).inputValue(),'+12025550123');checks++;
  assert.equal(await page.getByLabel('E-mail do cadastro',{exact:true}).inputValue(),'qa@example.invalid');checks++;
  assert.equal(await page.getByLabel('Idade do atleta',{exact:true}).inputValue(),'22');checks++;
  assert.ok(await page.getByRole('button',{name:'Atleta maior de idade',exact:true}).evaluate(el=>el.classList.contains('active')));checks++;
  await page.locator('.booking-time-grid button').first().click();
  await page.getByRole('button',{name:'Confirmar reuniao',exact:false}).click();
  await page.getByText('ENCONTRO MARCADO',{exact:true}).waitFor();
  assert.equal(submitted.contactName,'Cliente QA');assert.equal(submitted.contactRole,'atleta');assert.equal(submitted.athleteAge,22);assert.equal(submitted.registrationToken,'Q'.repeat(43));checks+=4;
  assert.equal(errors.length,0);checks++;
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks++;
  await page.close();
 }
}finally{await browser.close();}
console.log(JSON.stringify({checks,result:'passed',mobileDesktop:true,mockedApi:true,persistentTestLeads:0,actualReservations:0}));
