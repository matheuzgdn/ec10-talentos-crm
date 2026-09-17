import assert from "node:assert/strict";
import {
  buildMeetingDateOptions,
  buildMeetingDatePollOptions,
  buildMeetingConfirmationMessage,
  buildMeetingPresencePollBody,
  buildMeetingTimeOptions,
  classifyMeetingPresenceChoice,
  extractAthleteAge,
  getEc10LeadPlan,
  isAgeQuestionDetour,
  isAudioSequenceInProgressMetadata,
  isNegativeBotInterest,
  isGuardianConfirmation,
  isGuardianDenial,
  isPositiveInterest,
  isStaleFoundationReplyAfterStageAdvance,
  isUnknownFoundationStatus,
  isYesNoPollReply,
  meetingDatePollQuestion,
  parseFoundationStatus,
  shouldAskFoundationStatus,
  parseMeetingDateChoice,
  parseMeetingTimeChoice,
  shouldSendLeadPageMessage,
  wasPromptSentRecently
} from "../apps/bot/dist/ec10-flow.js";

const careerPlanUrl = "https://ec10talentos.com/instagram";

function runCase(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

function assertEvery(label, values, predicate) {
  const failures = values.filter((value) => !predicate(value));
  assert.deepEqual(failures, [], label);
}

function simulateStageDecision(stage, body, context = {}) {
  if (isAudioSequenceInProgressMetadata(context.metadata ?? null, context.now ?? new Date("2026-06-17T13:15:00-03:00"))) {
    return "ignore_during_audio_sequence";
  }

  if (stage === "awaiting_age") {
    return extractAthleteAge(body) ? "age_captured" : "retry_age";
  }

  if (stage === "awaiting_foundation_status") {
    return parseFoundationStatus(body) ? "foundation_captured" : "retry_foundation";
  }

  if (stage === "awaiting_interest") {
    if (isStaleFoundationReplyAfterStageAdvance(context.metadata, body)) return "suppress_stale_foundation_reply";
    if (isNegativeBotInterest(body)) return "decline_revela_follow_up";
    if (isPositiveInterest(body)) return "ask_meeting_date";
    return "retry_interest_poll";
  }

  if (stage === "awaiting_meeting_date") {
    const parsed = parseMeetingDateChoice(body, context.dateOptions, context.now);
    if (!parsed.ok) return isNegativeBotInterest(body) ? "decline_revela_follow_up" : "retry_meeting_date";
    return parsed.none ? "ask_custom_date" : "ask_meeting_time";
  }

  if (stage === "awaiting_meeting_time") {
    const parsed = parseMeetingTimeChoice(body, context.timeOptions);
    if (!parsed.ok) return isNegativeBotInterest(body) ? "decline_revela_follow_up" : "retry_meeting_time";
    return parsed.none ? "ask_custom_time" : "confirm_meeting";
  }

  return "unhandled";
}

runCase("extrai idade numerica, zero a esquerda e por extenso", () => {
  assert.equal(extractAthleteAge("08 anos"), 8);
  assert.equal(extractAthleteAge("meu filho tem oito anos"), 8);
  assert.equal(extractAthleteAge("ele tem dezesseis"), 16);
  assert.equal(extractAthleteAge("atleta de vinte e tres anos"), 23);
  assert.equal(extractAthleteAge("sub-17"), 17);
  assert.equal(extractAthleteAge("meu atleta tem 15 anos completos"), 15);
  assert.equal(extractAthleteAge("ele fez dezoito agora"), 18);
  assert.equal(extractAthleteAge("sem idade aqui"), null);
  assert.equal(extractAthleteAge("ola, queria saber mais"), null);
  assert.equal(extractAthleteAge("beleza pode mandar"), null);
  assert.equal(extractAthleteAge("qual valor?"), null);
});

runCase("confirma responsavel legal sem aceitar atleta ou terceiros", () => {
  assert.equal(isGuardianConfirmation("1. Sim, sou responsavel"), true);
  assert.equal(isGuardianConfirmation("Sou a mae do atleta"), true);
  assert.equal(isGuardianConfirmation("Sou o pai"), true);
  assert.equal(isGuardianDenial("2. Nao"), true);
  assert.equal(isGuardianDenial("Sou o atleta"), true);
  assert.equal(isGuardianConfirmation("Sou o atleta"), false);
});

runCase("classifica base ou escolinha com erros e frases naturais", () => {
  assert.equal(parseFoundationStatus("1"), "base");
  assert.equal(parseFoundationStatus("joga na base"), "base");
  assert.equal(parseFoundationStatus("esta no clube sub 12"), "base");
  assert.equal(parseFoundationStatus("nao e escolinha, esta na base"), "base");
  assert.equal(parseFoundationStatus("2"), "escolinha");
  assert.equal(parseFoundationStatus("escolhinha"), "escolinha");
  assert.equal(parseFoundationStatus("escolinha do clube"), "escolinha");
  assert.equal(parseFoundationStatus("nao esta na base"), "escolinha");
  assert.equal(parseFoundationStatus("sem clube, so treina"), "escolinha");
  assert.equal(parseFoundationStatus("projeto social"), "escolinha");
  assert.equal(parseFoundationStatus("escola de futebol"), "escolinha");
  assert.equal(parseFoundationStatus("treina em academia"), "escolinha");
  assert.equal(parseFoundationStatus("joga campeonato federado"), "base");
  assert.equal(parseFoundationStatus("time sub 15"), "base");
  assert.equal(parseFoundationStatus("nao sei ainda"), null);
  assert.equal(parseFoundationStatus("clube federado"), "base");
  assert.equal(parseFoundationStatus("escolinha ou projeto"), "escolinha");
  assert.equal(shouldAskFoundationStatus(15), true);
  assert.equal(shouldAskFoundationStatus(16), false);
  assert.equal(isUnknownFoundationStatus('Não sei'), true);
});

runCase("entende interesse positivo e negativo sem encerrar duvida ambigua", () => {
  const positive = [
    "sim",
    "1. Sim",
    "1) Sim",
    "opcao 1 sim",
    "ok",
    "pode ser",
    "pode mandar",
    "beleza",
    "manda ai",
    "bora marcar",
    "claro",
    "quero saber mais",
    "como funciona?",
    "me explica melhor",
    "qual valor?",
    "quanto custa?",
    "vamos marcar"
  ];
  const negative = [
    "2",
    "2. Nao",
    "2) Nao",
    "opcao 2 nao",
    "agora nao",
    "nao agora",
    "depois",
    "vou pensar",
    "vou ver depois",
    "me chama depois",
    "sem tempo",
    "nao quero reuniao",
    "nao precisa marcar reuniao agora",
    "cancelar"
  ];
  const ambiguous = ["nao sei", "talvez", "depende", "entendi", "recebi", "obrigado"];

  assertEvery("positive interest", positive, isPositiveInterest);
  assertEvery("negative interest", negative, isNegativeBotInterest);
  assertEvery("ambiguous is not positive", ambiguous, (value) => !isPositiveInterest(value));
  assertEvery("ambiguous is not negative", ambiguous, (value) => !isNegativeBotInterest(value));
  assertEvery("yes/no poll replies", ["Sim", "1. Sim", "2. Nao", "opcao 1 sim"], isYesNoPollReply);
  assertEvery("not yes/no poll replies", ["1", "2", "2. ter, 30/06", "3. 10h-11h"], (value) => !isYesNoPollReply(value));
});

runCase("monta planos e audios preservando URL apenas para atribuicao", () => {
  const career = getEc10LeadPlan(10, { now: new Date("2026-09-15T12:00:00-03:00") });
  const careerAfterPromotion = getEc10LeadPlan(10, { now: new Date("2026-09-21T12:00:00-03:00") });
  const eurocamp = getEc10LeadPlan(15);
  const international = getEc10LeadPlan(22);

  assert.equal(career?.leadPageUrl, careerPlanUrl);
  assert.match(eurocamp?.leadPageUrl ?? "", /eurocamp\/14-19/);
  assert.match(international?.leadPageUrl ?? "", /eurocamp\/19-25/);
  assert.equal(career?.audioItems.length, 3);
  assert.equal(careerAfterPromotion?.audioItems.length, 2);
  assert.equal(eurocamp?.audioItems.length, 2);
  assert.equal(international?.audioItems.length, 1);
  assert.equal(shouldSendLeadPageMessage(career), false);
  assert.equal(shouldSendLeadPageMessage(eurocamp), false);
  assert.equal(shouldSendLeadPageMessage(international), false);
});

runCase("preserva atribuicao do fluxo Revela sem reenviar pagina", () => {
  const revela = getEc10LeadPlan(15, { flowKind: "revela_13_plus" });
  assert.equal(revela?.leadPageUrl, "https://www.revelatalentos.com.br/?idade=15&origem=whatsapp");
  assert.equal(revela?.audioItems.length, 2);
  assert.equal(shouldSendLeadPageMessage(revela), false);
});

runCase("interpreta escolhas de data e horario de reuniao", () => {
  const now = new Date("2026-06-17T12:00:00-03:00");
  const dates = buildMeetingDateOptions(now);
  const datePollOptions = buildMeetingDatePollOptions(dates);
  const times = buildMeetingTimeOptions();
  const firstDate = parseMeetingDateChoice("1", dates, now);
  const firstPollDate = parseMeetingDateChoice(`1. ${dates[0].label}`, dates, now);
  const noDate = parseMeetingDateChoice(`${dates.length + 1}. Nao posso em nenhuma dessas datas`, dates, now);
  const secondDate = parseMeetingDateChoice("2", dates, now);
  const customDate = parseMeetingDateChoice("25/06", dates, now);
  const tomorrow = parseMeetingDateChoice("amanha", dates, now);
  const nextWeekday = parseMeetingDateChoice("segunda", dates, now);
  const nextFriday = parseMeetingDateChoice("sexta feira", dates, now);
  const firstTime = parseMeetingTimeChoice("1", times);
  const secondTime = parseMeetingTimeChoice("2", times);
  const thirdPollTime = parseMeetingTimeChoice(`3. ${times[2].label}`, times);
  const noTime = parseMeetingTimeChoice(`${times.length + 1}. Nao posso em nenhum desses horarios`, times);
  const customTime = parseMeetingTimeChoice("14h", times);
  const bareNine = parseMeetingTimeChoice("9", times);
  const bareFourteen = parseMeetingTimeChoice("14", times);
  const writtenNoon = parseMeetingTimeChoice("meio dia", times);
  const writtenAfternoon = parseMeetingTimeChoice("duas da tarde", times);

  assert.equal(meetingDatePollQuestion, "Vamos marcar uma reuniao. Primeiro escolha a melhor data:");
  assert.equal(datePollOptions.length, dates.length + 1);
  assert.deepEqual(datePollOptions.slice(0, dates.length), dates.map((date) => `${date.index}. ${date.label}`));
  assert.equal(parseMeetingDateChoice(datePollOptions[0], dates, now).ok, true);
  assert.equal(parseMeetingDateChoice(datePollOptions.at(-1), dates, now).none, true);
  assert.equal(firstDate.ok, true);
  assert.equal(firstPollDate.ok, true);
  assert.equal(noDate.ok, true);
  assert.equal(noDate.none, true);
  assert.equal(secondDate.ok, true);
  assert.equal(secondDate.option.index, 2);
  assert.equal(customDate.ok, true);
  assert.equal(tomorrow.ok, true);
  assert.equal(nextWeekday.ok, true);
  assert.equal(nextFriday.ok, true);
  assert.equal(firstTime.ok, true);
  assert.equal(secondTime.ok, true);
  assert.equal(secondTime.option.index, 2);
  assert.equal(thirdPollTime.ok, true);
  assert.equal(noTime.ok, true);
  assert.equal(noTime.none, true);
  assert.equal(customTime.ok, true);
  assert.equal(bareNine.ok, true);
  assert.equal(bareNine.option.hour, 9);
  assert.equal(bareFourteen.ok, true);
  assert.equal(bareFourteen.option.hour, 14);
  assert.equal(writtenNoon.ok, true);
  assert.equal(writtenNoon.option.hour, 12);
  assert.equal(writtenAfternoon.ok, true);
  assert.equal(writtenAfternoon.option.hour, 14);
});

runCase("confirma reuniao sem expor link do Meet antes da hora", () => {
  const message = buildMeetingConfirmationMessage(
    {
      startsAt: "2026-06-18T13:00:00.000Z",
      endsAt: "2026-06-18T14:00:00.000Z",
      dateLabel: "quinta-feira, 18/06",
      timeLabel: "10:00 as 11:00",
      timezone: "America/Sao_Paulo"
    },
    "https://meet.google.com/qdw-ipwb-ymx",
    true,
    "Sandro"
  );

  assert.match(message, /10 minutos antes/);
  assert.doesNotMatch(message, /meet\.google\.com/);
  assert.doesNotMatch(message, /Link do Google Meet/);
});

runCase("interpreta enquete de presenca da reuniao", () => {
  const pollBody = buildMeetingPresencePollBody();
  assert.match(pollBody, /CONFIRMO MINHA PRESENÇA/);
  assert.match(pollBody, /QUERO REAGENDAR/);
  assert.match(pollBody, /NÃO PODEREI PARTICIPAR/);
  assert.equal(classifyMeetingPresenceChoice("1. CONFIRMO MINHA PRESENÇA"), "confirm");
  assert.equal(classifyMeetingPresenceChoice("ok"), "confirm");
  assert.equal(classifyMeetingPresenceChoice("2. QUERO REAGENDAR"), "reschedule");
  assert.equal(classifyMeetingPresenceChoice("quero remarcar"), "reschedule");
  assert.equal(classifyMeetingPresenceChoice("3. NÃO PODEREI PARTICIPAR"), "cannot_attend");
  assert.equal(classifyMeetingPresenceChoice("nao posso participar"), "cannot_attend");
  assert.equal(classifyMeetingPresenceChoice("nao vou ter por agora a questao do investimento"), null);
  assert.equal(classifyMeetingPresenceChoice("qual o link?"), null);
});

runCase("blinda mensagens fora do roteiro durante envio de audios", () => {
  const now = new Date("2026-06-17T13:15:00-03:00");
  const freshMetadata = {
    audioSequenceInProgress: true,
    audioSequenceStartedAt: new Date(now.getTime() - 60_000).toISOString()
  };
  const staleMetadata = {
    audioSequenceInProgress: true,
    audioSequenceStartedAt: new Date(now.getTime() - 11 * 60_000).toISOString()
  };

  assert.equal(isAudioSequenceInProgressMetadata(freshMetadata, now), true);
  assert.equal(isAudioSequenceInProgressMetadata(staleMetadata, now), false);
  assert.equal(isAudioSequenceInProgressMetadata({ audioSequenceInProgress: false }, now), false);
});

runCase("evita repetir avisos quando o lead manda varias mensagens", () => {
  const now = new Date("2026-06-17T13:18:00-03:00");
  const promptKeys = [
    "invalidAgePromptedAt",
    "invalidInterestPromptedAt",
    "invalidFoundationPromptedAt",
    "invalidMeetingDatePromptedAt",
    "invalidMeetingTimePromptedAt"
  ];

  for (const key of promptKeys) {
    const recent = { [key]: new Date(now.getTime() - 30_000).toISOString() };
    const old = { [key]: new Date(now.getTime() - 3 * 60_000).toISOString() };
    assert.equal(wasPromptSentRecently(recent, key, now), true, key);
    assert.equal(wasPromptSentRecently(old, key, now), false, key);
    assert.equal(wasPromptSentRecently({}, key, now), false, key);
  }
});

runCase("simula desvios comuns de quem nao segue o bot", () => {
  const now = new Date("2026-06-17T12:00:00-03:00");
  const dates = buildMeetingDateOptions(now);
  const times = buildMeetingTimeOptions();

  const noAgeNoise = [
    "ola",
    "queria saber mais",
    "como funciona",
    "manda audio",
    "pode mandar",
    "entendi",
    "qual o valor",
    "tem vaga?",
    "sou responsavel",
    "ele joga bola"
  ];
  assertEvery("noise without age", noAgeNoise, (value) => extractAthleteAge(value) === null);
  assertEvery("age detour should be answered", [
    "quero saber mais",
    "gostaria de saber mais",
    "como funciona",
    "qual o valor",
    "tem vaga?",
    "nao sei usar isso"
  ], isAgeQuestionDetour);

  const validAges = ["15 anos", "meu filho tem quinze", "atleta sub 17", "ele tem 08", "tenho 18 completos"];
  assertEvery("valid age phrases", validAges, (value) => typeof extractAthleteAge(value) === "number");

  const declinedMeeting = ["depois eu vejo", "nao precisa marcar reuniao agora", "vou pensar", "me chama depois"];
  assertEvery("declined meeting phrases", declinedMeeting, isNegativeBotInterest);

  assert.equal(parseFoundationStatus("ele nao esta na base, so treina"), "escolinha");
  assert.equal(parseMeetingDateChoice("sabado", dates, now).ok, false);
  assert.equal(parseMeetingDateChoice("domingo", dates, now).ok, false);
  assert.equal(parseMeetingDateChoice("04/07", dates, now).ok, false);
  assert.equal(parseMeetingDateChoice("03/07", dates, now).option.isoDate, "2026-07-03");
  assert.equal(parseMeetingDateChoice("nenhuma dessas datas", dates, now).none, true);
  assert.equal(parseMeetingDateChoice("outra data", dates, now).none, true);
  assert.equal(parseMeetingTimeChoice("12:00", times).option.hour, 12);
  assert.equal(parseMeetingTimeChoice("22h", times).ok, false);
  assert.equal(parseMeetingTimeChoice("7h", times).ok, false);
  assert.equal(parseMeetingTimeChoice("nenhum desses horarios", times).none, true);
  assert.equal(parseMeetingTimeChoice("outro horario", times).none, true);
});

runCase("simula decisoes por etapa quando o lead foge do roteiro", () => {
  const now = new Date("2026-06-17T12:00:00-03:00");
  const dateOptions = buildMeetingDateOptions(now);
  const timeOptions = buildMeetingTimeOptions();
  const context = { now, dateOptions, timeOptions };

  assert.equal(simulateStageDecision("awaiting_age", "queria saber mais", context), "retry_age");
  assert.equal(simulateStageDecision("awaiting_age", "15 anos", context), "age_captured");
  assert.equal(simulateStageDecision("awaiting_foundation_status", "clube federado", context), "foundation_captured");
  assert.equal(simulateStageDecision("awaiting_foundation_status", "nao sei", context), "retry_foundation");

  const duringAudioContext = {
    ...context,
    metadata: {
      audioSequenceInProgress: true,
      audioSequenceStartedAt: new Date(now.getTime() - 30_000).toISOString()
    }
  };
  assert.equal(simulateStageDecision("awaiting_interest", "beleza", duringAudioContext), "ignore_during_audio_sequence");
  assert.equal(simulateStageDecision("awaiting_interest", "1. Sim", context), "ask_meeting_date");
  assert.equal(simulateStageDecision("awaiting_interest", "2. Nao", context), "decline_revela_follow_up");
  assert.equal(simulateStageDecision("awaiting_interest", "Estou em escolinha", {
    ...context,
    metadata: { foundationStatus: "escolinha" }
  }), "suppress_stale_foundation_reply");
  assert.equal(simulateStageDecision("awaiting_interest", "base de clube", {
    ...context,
    metadata: { foundationStatus: "base" }
  }), "suppress_stale_foundation_reply");
  assert.equal(simulateStageDecision("awaiting_interest", "pode mandar", context), "ask_meeting_date");
  assert.equal(simulateStageDecision("awaiting_interest", "entendi como funciona?", context), "ask_meeting_date");
  assert.equal(simulateStageDecision("awaiting_interest", "nao quero reuniao", context), "decline_revela_follow_up");
  assert.equal(simulateStageDecision("awaiting_interest", "talvez", context), "retry_interest_poll");

  assert.equal(simulateStageDecision("awaiting_meeting_date", "amanha", context), "ask_meeting_time");
  assert.equal(simulateStageDecision("awaiting_meeting_date", "2", context), "ask_meeting_time");
  assert.equal(simulateStageDecision("awaiting_meeting_date", "segunda", context), "ask_meeting_time");
  assert.equal(simulateStageDecision("awaiting_meeting_date", "nenhuma dessas datas", context), "ask_custom_date");
  assert.equal(simulateStageDecision("awaiting_meeting_date", "vou pensar", context), "decline_revela_follow_up");
  assert.equal(simulateStageDecision("awaiting_meeting_date", "sabado", context), "retry_meeting_date");

  assert.equal(simulateStageDecision("awaiting_meeting_time", "9", context), "confirm_meeting");
  assert.equal(simulateStageDecision("awaiting_meeting_time", "2", context), "confirm_meeting");
  assert.equal(parseMeetingTimeChoice("9", timeOptions).option.hour, 9);
  assert.equal(parseMeetingTimeChoice("opcao 9", timeOptions).option.hour, 16);
  assert.equal(simulateStageDecision("awaiting_meeting_time", "duas da tarde", context), "confirm_meeting");
  assert.equal(simulateStageDecision("awaiting_meeting_time", "nenhum desses horarios", context), "ask_custom_time");
  assert.equal(wasPromptSentRecently(
    { customMeetingTimePromptedAt: new Date(now.getTime() - 30 * 60_000).toISOString() },
    "customMeetingTimePromptedAt",
    now,
    12 * 60 * 60 * 1000
  ), true);
  assert.equal(wasPromptSentRecently(
    { customMeetingTimePromptedAt: new Date(now.getTime() - 13 * 60 * 60_000).toISOString() },
    "customMeetingTimePromptedAt",
    now,
    12 * 60 * 60 * 1000
  ), false);
  assert.equal(simulateStageDecision("awaiting_meeting_time", "22h", context), "retry_meeting_time");
});

console.log("Bot flow simulations completed.");
