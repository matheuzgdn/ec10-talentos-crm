import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out='C:/Users/Admin/Documents/CODEX/2026-09-15/abr/outputs';
const snapshot=JSON.parse(await fs.readFile(`${out}/EC10_BH_Prime_Gerenciador.json`,'utf8'));
const browser=await chromium.launch({headless:true});
const results=[];
for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height}});
 let fail=false,reads=0;
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(route.request().method()!=='GET')throw new Error('Teste não autoriza escrita.');
  if(url.pathname==='/api/me')return route.fulfill({json:{seller:{id:'qa-admin',name:'Administrador',email:'qa@example.com',role:'admin',active:true}}});
  if(url.pathname==='/api/traffic'&&url.searchParams.get('action')==='bh-prime'){
   reads++;return fail?route.fulfill({status:503,json:{error:'Teste de indisponibilidade'}}):route.fulfill({json:snapshot});
  }
  return route.fulfill({json:{clients:[],sellers:[],status:'ready'}});
 });
 await page.goto('http://127.0.0.1:5173/gerenciador-bh-prime');
 await page.locator('.bh-manager tbody tr').first().waitFor();
 if(await page.locator('.bh-manager tbody tr').count()!==6)throw new Error('Esperados seis criativos.');
 if(await page.locator('.bh-campaign').count()!==2)throw new Error('Esperadas duas campanhas.');
 if(await page.locator('.bh-budget-grid>div').count()!==4)throw new Error('Cartões de orçamento incompletos.');
 const unavailable=await page.locator('.bh-funnel').first().innerText();
 if(!unavailable.includes('—'))throw new Error('CRM indisponível apresentado como zero.');
 await page.locator('.bh-tests summary').first().click();
 await page.getByText('Variação preparada — não publicada').first().waitFor({state:'visible'});
 const bodyWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
 if(bodyWidth>width+1)throw new Error(`Transbordamento da página: ${bodyWidth}>${width}`);
 await page.screenshot({path:`${out}/EC10_Gerenciador_${name}.png`,fullPage:true});
 await page.locator('.bh-toolbar select').selectOption(snapshot.campaigns[1].id);
 if(await page.locator('.bh-manager tbody tr').count()!==3)throw new Error('Filtro de produto incorreto.');
 fail=true;
 await page.getByRole('button',{name:'Atualizar',exact:true}).click();
 await page.getByRole('alert').waitFor();
 if(!(await page.getByRole('alert').innerText()).includes('não estão atualizados'))throw new Error('Erro sem aviso de dados antigos.');
 results.push({name,rows:6,filterRows:3,reads,pageErrors:errors,crmUnavailableHonest:true,staleWarning:true});
 if(errors.length)throw new Error(errors.join(';'));
 await page.close();
}
await browser.close();
await fs.writeFile(`${out}/EC10_Gerenciador_UI_Test.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
