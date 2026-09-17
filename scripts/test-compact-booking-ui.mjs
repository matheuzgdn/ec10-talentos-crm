import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const bookingBaseUrl=process.env.BOOKING_BASE_URL||'http://127.0.0.1:5174';
let checks=0;const sizes=[];
const check=v=>{assert.ok(v);checks++;};
try {
  for(const width of [390,1440])for(const minor of [true,false]) {
    const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let submitted,confirmed=null;
    const service=minor?'eurocamp':'plano_internacional';
    const slots=Array.from({length:7},(_,d)=>[10,16].map(h=>({id:`qa-${d}-${h}`,startsAt:new Date(Date.UTC(2026,8,16+d,h+3)).toISOString(),endsAt:new Date(Date.UTC(2026,8,16+d,h+4)).toISOString(),sellerName:'Equipe QA'}))).flat();
    await page.route('**/api/**',route=>{
      const url=new URL(route.request().url());
      if(url.searchParams.get('mode')==='prefill')return route.fulfill({json:{prefill:{name:'Maria Oliveira',phone:'12025550123',email:'qa@example.invalid',role:minor?'responsavel':'atleta',service,athleteAge:minor?14:22},booking:confirmed}});
      if(route.request().method()==='POST'){submitted=route.request().postDataJSON();confirmed={id:'qa',...slots[3],service,accessToken:'qa',groupInviteUrl:null};return route.fulfill({json:{booking:confirmed}});}
      return route.fulfill({json:{slots:confirmed?[]:slots,booking:confirmed,windowDays:7}});
    });
    await page.goto(`${bookingBaseUrl}/agendar?servico=plano_carreira&cadastro=${'Q'.repeat(43)}`);
    await page.locator('.booking-date-grid button').first().waitFor();
    check(await page.locator('.booking-time-grid button').count()===0);
    check(await page.locator('.booking-service-tabs').count()===0);
    check(await page.locator('.booking-date-grid button').count()===7);
    await page.locator('.booking-date-grid button').nth(1).click();
    check(await page.locator('.booking-time-grid button').count()===2);
    await page.locator('.booking-time-grid button').first().click();
    await page.getByText('Dados preenchidos pelo atendimento.',{exact:false}).waitFor();
    check(await page.getByLabel(minor?'Nome do responsável':'Nome do participante',{exact:true}).inputValue()==='Maria Oliveira');
    check(await page.getByLabel('WhatsApp com DDD e país',{exact:true}).inputValue()==='+12025550123');
    check(await page.getByLabel('WhatsApp com DDD e país',{exact:true}).evaluate(e=>e.readOnly));
    check(await page.getByLabel('Idade do atleta',{exact:true}).inputValue()===(minor?'14':'22'));
    check(await page.locator('input[type=email]').count()===0);
    await page.getByRole('button',{name:'Alterar dia e horário',exact:true}).click();
    await page.locator('.booking-date-grid button').nth(2).click();
    check(await page.getByRole('button',{name:'Confirmar reunião',exact:true}).count()===0);
    await page.locator('.booking-time-grid button').first().click();
    await page.getByLabel('Link do vídeo do atleta (opcional)',{exact:true}).fill('https://www.youtube.com/watch?v=QAathlete');
    if(minor)await page.getByLabel('Sou o responsável pelo atleta e participarei da reunião.',{exact:true}).check();
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);sizes.push({width,minor,height});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    check(height<1200);
    if(minor)await page.screenshot({path:`C:/Users/Admin/Documents/CODEX/2026-09-15/abr/outputs/EC10_Agenda_Compacta_${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Confirmar reunião',exact:true}).click();
    await page.getByText('ENCONTRO MARCADO',{exact:true}).waitFor();
    check(await page.getByRole('link',{name:'Google Agenda',exact:true}).count()===1);
    check(await page.getByRole('link',{name:'iPhone / Apple Calendar',exact:true}).count()===1);
    check(await page.locator('.booking-group').count()===0);
    check(await page.getByText('Entrar no grupo',{exact:false}).count()===0);
    check(submitted.service===service);check(submitted.athleteAge===(minor?14:22));check(submitted.contactRole===(minor?'responsavel':'atleta'));check(submitted.athleteVideoUrl==='https://www.youtube.com/watch?v=QAathlete');
    await page.reload();await page.getByText('ENCONTRO MARCADO',{exact:true}).waitFor();
    check(await page.locator('.booking-date-grid button').count()===0);
    check(await page.getByRole('button',{name:'Confirmar reunião',exact:true}).count()===0);
    check(await page.getByRole('heading',{name:'Sua reunião está agendada',exact:true}).count()===1);
    check(errors.length===0);await page.close();
  }
}finally{await browser.close();}
console.log(JSON.stringify({checks,result:'passed',bookingBaseUrl,sizes,mockedApi:true,actualBookings:0,outboundMessages:0}));
