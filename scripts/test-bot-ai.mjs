import {
  classifyInterestWithAi,
  generateEc10SalesReplyWithAi,
  isAiLeadQualifiedForMeeting,
  selectEricAudioPathForAiReply,
} from "../apps/bot/dist/ai.js";

const classification = await classifyInterestWithAi(
  "Quero entender os planos e marcar uma reuniao amanha. Meu telefone e 31 99999-9999.",
);

if (classification !== "positive") {
  throw new Error(`Unexpected AI classification: ${classification}`);
}

const salesReply = await generateEc10SalesReplyWithAi({
  message: "Olá, sou pai de um atleta de 15 anos e queria saber sobre a Eurocamp.",
  mediaType: "text",
  serviceInterest: "eurocamp",
  history: [],
});

if (!salesReply?.reply || /sou (?:a |o )?assistente virtual/i.test(salesReply.reply)) {
  throw new Error("AI should continue qualification without repeating a virtual-assistant introduction.");
}
if (salesReply.serviceInterest !== "eurocamp" || salesReply.athleteAge !== 15) {
  throw new Error(`AI primary qualification failed: ${JSON.stringify(salesReply)}`);
}

const qualifiedReply = await generateEc10SalesReplyWithAi({
  message: "Sou o pai e responsável. Quero agendar a reunião com a equipe comercial.",
  mediaType: "text",
  serviceInterest: "eurocamp",
  history: [
    { direction: "inbound", body: "Tenho um atleta de 15 anos e quero conhecer a Eurocamp.", mediaType: "text" },
    { direction: "outbound", body: "Qual é o objetivo dele e onde vocês moram?", mediaType: "text" },
    { direction: "inbound", body: "Moramos em Santiago. Ele joga em equipe competitiva e busca avaliações na Europa. A família conhece o projeto e quer avançar.", mediaType: "text" },
  ],
});

if (!qualifiedReply || !isAiLeadQualifiedForMeeting(qualifiedReply)) {
  throw new Error(`AI did not release a fully qualified responsible for scheduling: ${JSON.stringify(qualifiedReply)}`);
}

const blockedMinor = {
  ...qualifiedReply,
  speakerRole: "atleta",
  guardianConfirmed: false,
  decisionMakerConfirmed: false,
};
if (isAiLeadQualifiedForMeeting(blockedMinor)) {
  throw new Error("A minor athlete without a responsible adult was incorrectly released for scheduling.");
}

const adultAthlete = {
  ...qualifiedReply,
  athleteAge: 20,
  serviceInterest: "plano_internacional",
  speakerRole: "atleta",
  guardianConfirmed: false,
  decisionMakerConfirmed: true,
};
if (!isAiLeadQualifiedForMeeting(adultAthlete)) {
  throw new Error("An adult athlete was incorrectly blocked from scheduling without a responsible adult.");
}

const selectedEricAudio = selectEricAudioPathForAiReply({
  ...salesReply,
  athleteAge: 15,
  serviceInterest: "eurocamp",
  handoffRequested: false,
  meetingRequested: false,
  qualificationStatus: "more_info",
  ericAudioRecommended: true,
});
if (selectedEricAudio !== "media/audio/ec10/eric-2026-09-14/04_14-19_apresentacao.ogg") {
  throw new Error(`Unexpected Eric audio selection: ${selectedEricAudio}`);
}

const blockedSchoolAudio = selectEricAudioPathForAiReply({
  ...salesReply,
  athleteAge: 35,
  serviceInterest: "academy_sudamerica",
  speakerRole: "gestor",
  ericAudioRecommended: true,
});
if (blockedSchoolAudio) {
  throw new Error(`Eric athlete audio was incorrectly selected for a school lead: ${blockedSchoolAudio}`);
}

console.log(JSON.stringify({
  aiModule: true,
  classification,
  primaryConversation: true,
  serviceInterest: salesReply.serviceInterest,
  athleteAge: salesReply.athleteAge,
  handoffRequested: salesReply.handoffRequested,
  qualificationStatus: salesReply.qualificationStatus,
  guardianConfirmed: salesReply.guardianConfirmed,
  qualifiedMeeting: true,
  selectedEricAudio,
  schoolAudioBlocked: true,
}));
