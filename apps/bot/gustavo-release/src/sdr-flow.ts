import type { ServiceInterest } from '@crm/shared';

export const SDR_VERSION = 'age_service_eric_2026_09_16';
export type SdrStep = 'service' | 'help' | 'next' | 'question' | 'booking';
export type SdrOfferId = 'career' | 'kids' | 'camp' | 'international';
export type SdrOffer = { id:SdrOfferId; name:string; service:ServiceInterest; summary:string; audioPath:string|null };
const audioRoot='media/audio/ec10/sdr-2026-09-16';
const offers:Record<SdrOfferId,SdrOffer> = {
  career:{id:'career',name:'Plano de Carreira',service:'plano_carreira',summary:'Acompanhamento para evoluir no futebol: mentoria, planejamento, marketing esportivo e orientação para buscar avaliações adequadas ao perfil. Viagens e camps são serviços separados.',audioPath:'media/audio/ec10/eric-2026-09-14/02_8-13_plano-de-carreira.ogg'},
  kids:{id:'kids',name:'Eurokids / Sudakids',service:'eurocamp',summary:'Experiência internacional para atletas de 8 a 13 anos, com participação do responsável. A equipe explica destinos, avaliações e o pacote adequado à família.',audioPath:`${audioRoot}/eurokids_eric.ogg`},
  camp:{id:'camp',name:'Eurocamp',service:'eurocamp',summary:'Preparação e experiência de jogos e avaliações internacionais para atletas de 14 a 19 anos. O formato e as condições são apresentados conforme o perfil.',audioPath:'media/audio/ec10/eric-2026-09-14/04_14-19_apresentacao.ogg'},
  international:{id:'international',name:'Plano Internacional',service:'plano_internacional',summary:'Pacote individual e exclusivo para atletas de 20 a 25 anos, com direcionamento a clubes para avaliação internacional. A equipe analisa o perfil e explica preparação, suporte e condições do pacote.',audioPath:`${audioRoot}/internacional_eric.ogg`},
};
export function eligibleSdrOffers(age:number):SdrOffer[] {
  if(!Number.isInteger(age)||age<8||age>99)return [];
  const ids:SdrOfferId[]=age<=13?['career','kids']:age<=19?['career','camp']:age<=25?['career','international']:['career'];
  return ids.map(id=>({...offers[id],audioPath:id==='camp'&&age>=18?null:offers[id].audioPath}));
}
export function sdrOffer(age:number,id:unknown) {return eligibleSdrOffers(age).find(o=>o.id===id)??null;}
const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function sdrGreeting(body:string|null|undefined) {
  const text=clean(body||'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  if(!text||! /^(?:(?:oi|ola|opa|e ai|eai|bom dia|boa tarde|boa noite|tudo bem|td bem|tudo certo|tudo bom|como vai|como voce esta|como vc esta|e voce|e vc|bem|por ai|com voce|com vc)\s*)+$/.test(text))return null;
  const greeting=/boa tarde/.test(text)?'Boa tarde!':/boa noite/.test(text)?'Boa noite!':/bom dia/.test(text)?'Bom dia!':'Oi!';
  return `${greeting} Tudo bem por aqui 😊`;
}
export function menuChoice(body:string|null|undefined,options:string[]) {
  const text=clean(body||'');
  const number=text.match(/^(?:opcao\s*)?0?(\d+)[.!]?$/);
  if(number){const index=Number(number[1])-1;return index>=0&&index<options.length?index:null;}
  const label=text.replace(/^\d+[.\s-]+/,'');
  const index=options.findIndex(o=>clean(o)===label);
  return index>=0?index:null;
}
export function explicitSdrBooking(body:string|null|undefined) {
  const t=clean(body||'');
  if(/\b(nao|sem|depois|mais tarde|antes|duvida|valor|preco|quanto|como|explica)\b/.test(t))return false;
  return /\b(agendar|agendamento|marcar (?:a |uma )?reuniao|ver (?:os )?horarios|escolher (?:o )?horario)\b/.test(t)||/^(pode marcar|vamos marcar)$/.test(t);
}
export function explicitSdrStop(body:string|null|undefined) {
  return /\b(parar|pare|nao me chame|nao mande mais|nao tenho interesse|sem interesse|remova meu numero|encerrar atendimento|cancelar atendimento)\b/.test(clean(body||''));
}
export function explicitSdrHuman(body:string|null|undefined) {
  return /\b(atendente|humano|falar com (?:alguem|uma pessoa|o vendedor|um vendedor|um consultor)|chame (?:o |um )?consultor)\b/.test(clean(body||''));
}
export function inferSdrOffer(age:number,body:string|null|undefined) {
  const t=clean(body||'');
  const found=eligibleSdrOffers(age).filter(o=>o.id==='career'?/\b(plano de carreira|carreira|acompanhamento|mentoria)\b/.test(t):o.id==='kids'?/\b(eurokids|sudakids)\b/.test(t):o.id==='camp'?/\b(eurocamp)\b/.test(t):/\b(plano internacional|pacote individual)\b/.test(t));
  return found.length===1?found[0]:null;
}
export const sdrNextOptions=['Agendar reunião','Tirar uma dúvida','Escolher outro serviço'];
export function sdrServiceMenu(age:number,sourceName?:string) {
  const list=eligibleSdrOffers(age);
  return {question:`Para um atleta de ${age} anos, qual caminho você quer conhecer?`,options:[...list.map(o=>o.name),'Me ajude a escolher'],
    explanation:[sourceName?`Seu interesse do cadastro foi mantido: ${sourceName}. Você pode escolher aqui o que quer conhecer agora.`:null,...list.map(o=>`${o.name}: ${o.summary}`)].filter(Boolean).join('\n\n')};
}
export type SdrDecision={step:SdrStep;offer:SdrOffer|null;reply?:string;menu?:{question:string;options:string[]};audio?:string|null;book?:boolean;answer?:boolean;handoff?:boolean;stop?:boolean};
export function decideEc10Sdr(input:{age:number;step:SdrStep;offerId?:unknown;body:string|null}) : SdrDecision {
  const {age,step,body}=input;
  const offer=sdrOffer(age,input.offerId);
  const base={step,offer};
  if(explicitSdrStop(body))return {...base,stop:true};
  if(explicitSdrHuman(body))return {...base,handoff:true};
  const greeting=sdrGreeting(body);
  if(greeting) {
    if(step==='question'&&offer)return {...base,reply:`${greeting} Qual é a sua dúvida sobre o ${offer.name}?`};
    const menu=step==='service'?sdrServiceMenu(age):step==='help'
      ?{question:'Qual é o principal objetivo do atleta?',options:['Evoluir com acompanhamento','Conhecer uma experiência internacional']}
      :{question:'Como você prefere continuar?',options:sdrNextOptions};
    return {...base,reply:greeting,menu:{question:menu.question,options:menu.options}};
  }
  if(step==='service') {
    const menu=sdrServiceMenu(age);
    const choice=menuChoice(body,menu.options);
    if(choice===menu.options.length-1||/\b(nao sei|ajud|indecis|qual (?:o )?melhor)\b/.test(clean(body||''))) {
      return {step:'help',offer:null,reply:'Vamos escolher pelo objetivo do atleta.',menu:{question:'Qual é o principal objetivo do atleta?',options:['Evoluir com acompanhamento','Conhecer uma experiência internacional']}};
    }
    const selected=choice!==null?eligibleSdrOffers(age)[choice]:inferSdrOffer(age,body);
    if(!selected)return {...base,answer:true,menu:{question:menu.question,options:menu.options}};
    return {step:'next',offer:selected,reply:`${selected.name}: ${selected.summary}\n\nA EC10 é uma consultoria de desenvolvimento de carreira no futebol. Avaliação não garante aprovação, contrato ou vaga.${selected.audioPath?' Vou enviar a explicação do Eric para você conhecer melhor.':' Vou te orientar por texto neste perfil.'}`,audio:selected.audioPath,menu:{question:'Como você prefere continuar?',options:sdrNextOptions}};
  }
  if(step==='help') {
    const options=['Evoluir com acompanhamento','Conhecer uma experiência internacional'];
    const choice=menuChoice(body,options);
    const t=clean(body||'');
    const experience=choice===1||/\b(internacional|exterior|europa|viagem|intercambio)\b/.test(t);
    const career=choice===0||/\b(evoluir|acompanhamento|mentoria|carreira|planejamento)\b/.test(t);
    if(!experience&&!career)return {...base,answer:true,menu:{question:'Qual é o principal objetivo do atleta?',options}};
    const suggested=experience?eligibleSdrOffers(age).find(o=>o.id!=='career'):sdrOffer(age,'career');
    const menu=sdrServiceMenu(age);
    return {step:'service',offer:null,reply:suggested?`Pelo que você procura, vale conhecer o ${suggested.name}. ${suggested.summary}\n\nSelecione esse serviço abaixo ou escolha outro caminho.`:'Para essa idade, a experiência internacional precisa de análise individual do consultor. Você pode conhecer o Plano de Carreira ou escrever “atendente” para pedir essa análise.',menu:{question:menu.question,options:menu.options}};
  }
  if(!offer)return {step:'service',offer:null,menu:sdrServiceMenu(age)};
  const choice=step==='next'?menuChoice(body,sdrNextOptions):null;
  if(choice===2||/^(voltar|menu|outro servico|trocar servico|escolher outro servico)$/.test(clean(body||'')))return {step:'service',offer:null,menu:sdrServiceMenu(age)};
  if(choice===0||explicitSdrBooking(body))return {...base,step:'booking',book:true};
  if(choice===1)return {...base,step:'question',reply:`Qual é sua dúvida sobre o ${offer.name}? Pode escrever ou enviar um áudio.`};
  return {...base,step:'next',answer:true,menu:{question:'Qual é o próximo passo para você?',options:sdrNextOptions}};
}

export function sdrSafeAnswer(age:number,offer:SdrOffer|null,body:string|null) {
  const t=clean(body||'');
  if(/\b(ia|bot|robo|automatizado|assistente virtual)\b/.test(t))return 'Este atendimento é automatizado, com os áudios do Eric e apoio da equipe EC10. Se preferir, você pode pedir um atendente.';
  if(/\b(preco|valor|quanto|mensalidade|investimento|custa|desconto|parcela)\b/.test(t))return 'O investimento e os itens incluídos são apresentados pela equipe conforme o serviço e o pacote. Não vou te passar uma promoção ou um valor sem confirmação.';
  if(/\b(garant|aprov|contrato|salario|profissional)\b/.test(t))return 'A EC10 oferece orientação, preparação e experiências conforme o plano. Aprovação, contrato e decisão esportiva dependem do clube; não há garantia de resultado.';
  if(offer)return `${offer.name}: ${offer.summary}`;
  return `A EC10 orienta atletas e famílias no desenvolvimento de carreira no futebol. Para ${age} anos, escolha um dos caminhos apresentados; se estiver em dúvida, use “Me ajude a escolher”.`;
}
export function sanitizeSdrAiAnswer(value:unknown) {
  if(typeof value!=='string')return null;
  const text=value.replace(/\s+/g,' ').trim().replace(/^(?:entendi|perfeito)[.!,:]?\s*/i,'');
  if(!text||text.length>450||/[?]|https?:|www\.|R\$|US\$|[€$]|\b\d+(?:[.,]\d+)?\s*(?:reais|euros|dolares|%)|garantimos|aprovacao garantida|vou agendar|agendamento confirmado/i.test(text))return null;
  return text;
}
