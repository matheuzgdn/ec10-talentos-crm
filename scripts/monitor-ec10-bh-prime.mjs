import fs from 'node:fs/promises';
import { loadBhPrimeManager, BH_PRIME_CAMPAIGNS } from '../api/_bh-prime.ts';

const output='C:\\Users\\Admin\\Documents\\CODEX\\2026-09-15\\abr\\outputs\\EC10_BH_Prime_Gerenciador.json';
const report=await loadBhPrimeManager();
report.safetyActions=[];
const expired=report.campaigns.every(c=>c.end&&Date.now()>=Date.parse(c.end));
const overBudget=report.total.spend>=700 || report.total.configured>700 || report.campaigns.some(c=>c.configuredBudget>c.authorizedBudget);
if (process.argv.includes('--safety-pause')&&(expired||overBudget)) {
  for(const spec of BH_PRIME_CAMPAIGNS){
    const campaign=report.campaigns.find(c=>c.id===spec.id);
    if(campaign.status==='PAUSED')continue;
    const version=process.env.META_GRAPH_VERSION||process.env.META_GRAPH_API_VERSION||'v25.0';
    const token=process.env.META_SYSTEM_USER_ACCESS_TOKEN;
    const response=await fetch(`https://graph.facebook.com/${version}/${spec.id}`,{
      method:'POST',body:new URLSearchParams({access_token:token,status:'PAUSED'}),signal:AbortSignal.timeout(30000),
    });
    const p=await response.json();
    if(!response.ok||!p.success)throw new Error('Pausa de seguranca nao confirmada; verificar imediatamente.');
    const url=new URL(`https://graph.facebook.com/${version}/${spec.id}`);
    url.searchParams.set('access_token',token);url.searchParams.set('fields','id,status,effective_status');
    const verify=await fetch(url).then(r=>r.json());
    if(verify.status!=='PAUSED')throw new Error('Releitura da pausa falhou.');
    report.safetyActions.push(verify);
  }
}
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({collectedAt:report.collectedAt,total:report.total,crmStatus:report.crmStatus,alerts:report.alerts,campaigns:report.campaigns.map(c=>({id:c.id,label:c.label,status:c.status,effectiveStatus:c.effectiveStatus,start:c.start,end:c.end,spend:c.spend,metaLeads:c.metaLeads,crm:c.crm,ads:c.ads.map(a=>({id:a.id,effectiveStatus:a.effectiveStatus,spend:a.spend,decision:a.decision}))})),safetyActions:report.safetyActions,output},null,2));
