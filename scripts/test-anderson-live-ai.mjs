import assert from 'node:assert/strict';
import {generateEc10SalesReplyWithAi,isAiLeadQualifiedForMeeting} from '../apps/bot/dist/ai.js';
const scenarios=[
 {name:'adulto-internacional',input:{message:'Tenho 22 anos, sou o atleta e quero uma avaliação na Europa. Se fizer sentido consigo analisar o investimento com minha família.',mediaType:'text',history:[],serviceInterest:'plano_internacional',profile:null,campaignProduct:{id:'temporada',name:'Plano Internacional',service:'plano_internacional'},leadContext:{registered:true,leadName:'Teste Adulto',source:'ec10_campaign_lp',landingVariant:'plano-internacional',sourcePath:'/lp/plano-internacional/',purchaseStage:'consideracao'}}},
 {name:'responsavel-kids',input:{message:'Sou a mãe de um atleta de 12 anos. Ele treina em projeto e sonha em jogar fora, mas preciso entender como funciona antes de decidir.',mediaType:'text',history:[],serviceInterest:'eurocamp',profile:null,campaignProduct:{id:'kids',name:'Eurokids / Sudakids',service:'eurocamp'},leadContext:{registered:true,leadName:'Teste Responsável',source:'ec10_campaign_lp',landingVariant:'eurokids',sourcePath:'/lp/eurokids/',purchaseStage:'consideracao'}}},
 {name:'menor-sem-responsavel',input:{message:'Tenho 17 anos, sou o atleta e quero marcar a reunião sozinho agora.',mediaType:'text',history:[],serviceInterest:'eurocamp',profile:null,campaignProduct:{id:'juvenil',name:'Eurocamp',service:'eurocamp'},leadContext:{registered:true,leadName:'Teste Menor',source:'ec10_campaign_lp',landingVariant:'eurocamp',sourcePath:'/lp/eurocamp/',purchaseStage:'consideracao'}}}
];
const results=[];
for(const scenario of scenarios){
 const reply=await generateEc10SalesReplyWithAi(scenario.input);
 assert.ok(reply,scenario.name);assert.ok(reply.reply.length<=700);assert.ok((reply.reply.match(/\?/g)||[]).length<=1);
 assert.ok(!/https?:|R\$|US\$|€\s*\d/i.test(reply.reply));
 if(scenario.name==='adulto-internacional')assert.equal(reply.serviceInterest,'plano_internacional');
 if(scenario.name==='responsavel-kids')assert.equal(reply.serviceInterest,'eurocamp');
 if(scenario.name==='menor-sem-responsavel')assert.equal(isAiLeadQualifiedForMeeting(reply),false);
 results.push({name:scenario.name,reply:reply.reply,service:reply.serviceInterest,moment:reply.decisionReadiness,journey:reply.journeyStage,style:reply.conversationStyle,objection:reply.objectionCategory,qualifiedForMeeting:isAiLeadQualifiedForMeeting(reply)});
}
console.log(JSON.stringify({result:'passed',actualAiCalls:results.length,whatsappMessagesSent:0,results}));
