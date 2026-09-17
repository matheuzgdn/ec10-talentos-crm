import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Download, AlertTriangle, Sparkles } from 'lucide-react';
import './bh-prime.css';

type Crm = {contacts:number;qualified:number;scheduled:number;attended:number;proposed:number;closed_status:number};
type Ad = {
  id:string;name:string;status:string;effectiveStatus:string;spend:number;impressions:number;clicks:number;
  metaLeads:number;landingPageViews:number;ctr:number|null;cpl:number|null;cpql:number|null;crm:Crm|null;
  decision:string;rationale:string;destination:string|null;nextTest:string;currentText:string|null;
};
type Campaign = {
  id:string;label:string;status:string;effectiveStatus:string;authorizedBudget:number;configuredBudget:number;
  spend:number;remaining:number;spentPercent:number;elapsedPercent:number|null;start:string|null;end:string|null;
  metaLeads:number;crm:Crm|null;cpql:number|null;ads:Ad[];
};
type Manager = {
  collectedAt:string;currency:string;timezone:string;account:{name:string;remainingSpendCap:number|null};
  total:{authorized:number;configured:number;spend:number;remaining:number};crmStatus:string;crmReason:string|null;
  alerts:{severity:string;message:string}[];campaigns:Campaign[];measurement:string;policy:string;
};
const money=(v:number|null|undefined)=>v===null||v===undefined?'—':v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v:string|null)=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const count=(v:number|null|undefined)=>v===null||v===undefined?'—':v.toLocaleString('pt-BR');

export function BhPrimeManager() {
  const [data,setData]=useState<Manager|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState('all');
  useEffect(()=>{
    const controller=new AbortController();
    let busy=false;
    const load=async()=>{
      if(busy)return;
      busy=true;setLoading(true);
      try {
        const response=await fetch('/api/traffic?action=bh-prime',{cache:'no-store',credentials:'include',signal:controller.signal});
        if(!response.ok)throw new Error(`Não foi possível consultar o gerenciador (${response.status}).`);
        setData(await response.json());setError(null);
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');}
      finally{busy=false;if(!controller.signal.aborted)setLoading(false);}
    };
    void load();
    const timer=window.setInterval(()=>{if(!document.hidden)void load();},300000);
    const refresh=()=>void load();
    window.addEventListener('bh-prime-refresh',refresh);
    return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('bh-prime-refresh',refresh);};
  },[]);
  const download=()=>{
    if(!data)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='EC10-BH-Prime-gerenciador.json';a.click();URL.revokeObjectURL(url);
  };
  const campaigns=data?.campaigns.filter(c=>selected==='all'||c.id===selected)||[];
  return <section className="bh-manager" aria-label="Gerenciador BH Prime">
    <header className="bh-header"><div><span className="bh-eyebrow"><ShieldCheck size={15}/> EC10 · PILOTO PROTEGIDO</span><h2>Gerenciador BH Prime</h2><p>Gastos e criativos do Plano de Carreira e Plano Internacional. Dados reais, sem somar etapas como se fossem clientes.</p></div>
      <div className="bh-actions"><button type="button" disabled={loading} onClick={()=>window.dispatchEvent(new Event('bh-prime-refresh'))}><RefreshCw size={16} className={loading?'spin':''}/> Atualizar</button><button type="button" disabled={!data} onClick={download}><Download size={16}/> Relatório</button></div>
    </header>
    {error?<p role="alert" className="bh-alert">{error} {data?'Os dados abaixo são da última leitura; não estão atualizados.':''}</p>:null}
    {!data?<p role="status">{loading?'Consultando gastos, anúncios e funil…':'Aguardando conexão.'}</p>:<>
      <div className="bh-budget-grid">
        <div><span>Teto total autorizado</span><strong>{money(data.total.authorized)}</strong><small>7 dias · sem aumento automático</small></div>
        <div><span>Consumido no piloto</span><strong>{money(data.total.spend)}</strong><small>Consulta direta na Meta</small></div>
        <div><span>Restante do piloto</span><strong>{money(data.total.remaining)}</strong><small>Não é o saldo financeiro da conta</small></div>
        <div><span>Limite compartilhado restante</span><strong>{money(data.account.remainingSpendCap)}</strong><small>Inclui outras campanhas da conta</small></div>
      </div>
      <div className="bh-toolbar"><label>Visualização <select value={selected} onChange={e=>setSelected(e.target.value)}><option value="all">Todos os produtos</option>{data.campaigns.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><small>Atualizado {date(data.collectedAt)} · Brasília · atualização a cada 5 min com painel aberto</small></div>
      {data.alerts.map((a,i)=><p className={`bh-alert ${a.severity}`} key={i}><AlertTriangle size={16}/>{a.message}</p>)}
      {campaigns.map(c=><article className="bh-campaign" key={c.id}>
        <div className="bh-campaign-title"><h3>{c.label}</h3><span className="bh-status">{c.effectiveStatus}</span><small>{date(c.start)} → {date(c.end)}</small></div>
        <div className="bh-progress"><div style={{width:`${Math.min(100,Math.max(0,c.spentPercent))}%`}}/></div>
        <p className="bh-caption">{money(c.spend)} de {money(c.authorizedBudget)} · {c.spentPercent.toFixed(1)}% consumido · tempo decorrido {c.elapsedPercent===null?'—':`${c.elapsedPercent.toFixed(1)}%`}</p>
        <div className="bh-funnel">
          <div><strong>{count(c.metaLeads)}</strong><span>Leads Meta</span></div>
          <div><strong>{count(c.crm?.contacts)}</strong><span>Contatos CRM</span></div>
          <div><strong>{count(c.crm?.qualified)}</strong><span>Qualificados</span></div>
          <div><strong>{count(c.crm?.scheduled)}</strong><span>Agendados</span></div>
          <div><strong>{count(c.crm?.attended)}</strong><span>Comparecimentos</span></div>
          <div><strong>{count(c.crm?.proposed)}</strong><span>Propostas</span></div>
          <div><strong>{money(c.cpql)}</strong><span>Custo por qualificado</span></div>
        </div>
        <div className="bh-table-wrap"><table><caption>Desempenho por criativo · {c.label}</caption><thead><tr><th>Criativo / entrega</th><th>Gasto</th><th>Impressões</th><th>CTR link</th><th>LPV</th><th>Lead Meta</th><th>Qualificados</th><th>CPQL</th><th>Decisão</th></tr></thead><tbody>{c.ads.map(ad=><tr key={ad.id}><td><strong>{ad.name}</strong><small>{ad.effectiveStatus}</small></td><td>{money(ad.spend)}</td><td>{count(ad.impressions)}</td><td>{ad.ctr===null?'—':`${ad.ctr.toFixed(2)}%`}</td><td>{count(ad.landingPageViews)}</td><td>{count(ad.metaLeads)}</td><td>{count(ad.crm?.qualified)}</td><td>{money(ad.cpql)}</td><td>{ad.decision}</td></tr>)}</tbody></table></div>
        <div className="bh-tests">{c.ads.map(ad=><details key={ad.id}><summary><Sparkles size={15}/> {ad.name} · diagnóstico e próximo teste</summary><p>{ad.rationale}</p><h4>Variação preparada — não publicada</h4><p>{ad.nextTest}</p><small>Alterar apenas o gancho primeiro. Preservar prova verdadeira, produto, faixa e destino. Não há vencedor validado só por CTR.</small>{ad.destination?<a href={ad.destination} target="_blank" rel="noreferrer">Conferir página de destino</a>:null}</details>)}</div>
      </article>)}
      <footer className="bh-footer"><p>{data.measurement}</p><p>{data.policy}</p><p>“—” significa indisponível, não zero. Status de fechamento não comprova pagamento. Não há promessa de conversão nem alteração automática de criativos.</p></footer>
    </>}
  </section>;
}
