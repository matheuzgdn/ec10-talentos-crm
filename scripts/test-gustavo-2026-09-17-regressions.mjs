import assert from "node:assert/strict";
import fs from "node:fs";
import { isAiLeadQualifiedForMeeting, selectEricAudioPathForAiReply } from "../apps/bot/dist/ai.js";
import { selectBookingContactName } from "../apps/bot/dist/booking-contact.js";
import { learningPrompt, singleQuestionReply } from "../apps/bot/dist/ec10-learning.mjs";

const baseQualified = {
  reply: "Podemos organizar a reunião.",
  responsibleName: "",
  athleteName: "Pedro Ramos",
  intent: "meeting",
  serviceInterest: "plano_carreira",
  athleteAge: 14,
  leadTemperature: "quente",
  handoffRequested: false,
  speakerRole: "responsavel",
  guardianConfirmed: true,
  qualificationStatus: "qualified",
  qualificationReason: "perfil compatível",
  meetingRequested: true,
  objectiveConfirmed: true,
  decisionMakerConfirmed: true,
  ericAudioRecommended: false,
  mainPain: "falta de direção",
  mainDifficulty: "planejamento",
  primaryObjective: "carreira",
  currentSituation: "treina",
  urgency: "media",
  decisionReadiness: "decisao",
  investmentReadiness: "aberto_se_fizer_sentido",
  journeyStage: "desenvolvimento",
  conversationStyle: "pratico",
  objectionCategory: "nenhuma",
  recommendedNextStep: "reunião",
};

assert.equal(isAiLeadQualifiedForMeeting(baseQualified), false, "menor não pode agendar sem nome completo do responsável");
assert.equal(isAiLeadQualifiedForMeeting({...baseQualified, responsibleName:"Bruno Ramos"}), true);
assert.equal(isAiLeadQualifiedForMeeting({...baseQualified, athleteAge:18, speakerRole:"atleta", guardianConfirmed:false}), true, "adulto não exige responsável");
const careerAudioReply={...baseQualified,athleteAge:12,meetingRequested:false,qualificationStatus:"more_info",ericAudioRecommended:true};
const firstCareerAudio=selectEricAudioPathForAiReply(careerAudioReply,[]);
assert.match(firstCareerAudio,/01_8-13_apresentacao/);
assert.match(selectEricAudioPathForAiReply(careerAudioReply,[firstCareerAudio]),/02_8-13_plano-de-carreira/);
assert.equal(selectEricAudioPathForAiReply(careerAudioReply,[firstCareerAudio,"media/audio/ec10/eric-2026-09-14/02_8-13_plano-de-carreira.ogg"]),null);

assert.equal(selectBookingContactName({
  metadata:{leadName:"Marcelo Ramos", athleteName:"Marcelo Ramos"},
  minor:true,
  responsibleRole:false,
}), null, "nome do atleta não pode virar responsável");
assert.equal(selectBookingContactName({
  metadata:{leadName:"Bruno Ramos", athleteName:"Marcelo Ramos"},
  minor:true,
  responsibleRole:true,
}), "Bruno Ramos");
assert.equal(selectBookingContactName({
  metadata:{athleteName:"João da Silva"},
  minor:false,
  responsibleRole:false,
}), "João da Silva", "atleta adulto deve poder usar o próprio nome completo na agenda");

const filteredKnownAge = singleQuestionReply(
  "A EC10 organiza a carreira do atleta. Qual é a idade dele?",
  {age:15,role:"responsavel"},
);
assert.equal(filteredKnownAge, "A EC10 organiza a carreira do atleta.");
assert.notEqual(filteredKnownAge, "A EC10 começa pelo planejamento da carreira, respeitando o momento do atleta e da família.");
const filteredLearning = learningPrompt({examples:[{
  stage:"awaiting_interest",
  athlete_age:14,
  speaker_role:"responsavel",
  user_message:"Quero saber mais",
  assistant_response:"A EC10 começa pelo planejamento da carreira, respeitando o momento do atleta e da família.",
  corrected_response:null,
  rating:"approved",
}],materials:[]},{stage:"awaiting_interest",age:14,role:"responsavel"});
assert.doesNotMatch(filteredLearning,/A EC10 começa pelo planejamento da carreira/);

const indexSource=fs.readFileSync("apps/bot/src/index.ts","utf8");
const storeSource=fs.readFileSync("apps/bot/src/store.ts","utf8");
const aiSource=fs.readFileSync("apps/bot/src/ai.ts","utf8");
assert.match(indexSource,/guardianIdentityPreviouslyContradicted/);
assert.match(indexSource,/awaiting_booking_completion/);
assert.match(indexSource,/bookingMessageIntent/);
assert.match(indexSource,/sanitizeBotOutboundBody/);
assert.match(indexSource,/cliente-whatsapp-crm\\\.vercel\\\.app/);
assert.match(storeSource,/mimeType\.split\(";", 1\)/);
assert.match(aiSource,/Sou o atendimento virtual Gustavo da EC10/);
assert.match(aiSource,/Não consigo validar o conteúdo dele por aqui/);
assert.doesNotMatch(aiSource,/Você é Anderson, consultor virtual/);

console.log(JSON.stringify({passed:21,total:21,noWhatsAppSent:true,source:"conversas-2026-09-17"},null,2));
