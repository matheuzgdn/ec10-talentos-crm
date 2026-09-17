import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});let checks=0;
const check=v=>{assert.ok(v);checks++;};
try {
 for(const profile of [{age:11,service:'eurocamp',label:'Eurokids / Sudakids'},{age:32,service:'plano_carreira',label:'Plano de Carreira'}]) {
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const startsAt=new Date(Date.now()+86400000).toISOString();let submitted;
  await page.route('**/api/**',route=>{
   if(route.request().method()==='POST'){submitted=route.request().postDataJSON();return route.fulfill({json:{booking:{id:'mock',startsAt,endsAt:startsAt,sellerName:'Equipe de Teste',service:profile.service,programName:profile.label,accessToken:'mock',groupInviteUrl:null}}});}
   if(new URL(route.request().url()).searchParams.get('mode')==='prefill')return route.fulfill({json:{prefill:{name:'Maria Oliveira',phone:'12025550123',email:'qa@example.invalid',role:profile.age<18?'responsavel':'atleta',service:profile.service,athleteAge:profile.age}}});
   return route.fulfill({json:{slots:[{id:'mock',startsAt,endsAt:startsAt,sellerName:'Equipe de Teste'}],windowDays:7}});
  });
  await page.goto('http://127.0.0.1:5174/agendar?cadastro='+'Q'.repeat(43));
  await page.locator('.booking-date-grid button').first().waitFor();
  await page.locator('.booking-hero').getByText(profile.label,{exact:false}).waitFor();check(true);
  check(await page.locator('.booking-time-grid button').count()===0);
  await page.locator('.booking-date-grid button').first().click();await page.locator('.booking-time-grid button').first().click();
  const age=page.getByLabel('Idade do atleta',{exact:true});check(await age.inputValue()===String(profile.age));check(await age.evaluate(e=>e.readOnly));
  check(await age.evaluate(e=>e.validity.valid));
  if(profile.age<18)await page.getByLabel('Sou o responsável pelo atleta e participarei da reunião.',{exact:true}).check();
  await page.getByRole('button',{name:'Confirmar reunião',exact:true}).click();await page.getByText('ENCONTRO MARCADO',{exact:true}).waitFor();
  check(submitted.athleteAge===profile.age);check(submitted.service===profile.service);check(submitted.phone==='+12025550123');check(errors.length===0);
  await page.close();
 }
}finally{await browser.close();}
console.log(JSON.stringify({checks,result:'passed',kidsLabel:true,adultCareerAge:true,mockedApi:true,actualBookings:0,whatsappMessages:0}));
