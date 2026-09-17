import assert from "node:assert/strict";
import {
  buildMeetingDateOptions,
  buildMeetingTimeOptions,
  buildScheduleFromOptions,
  extractAthleteAge,
  getEc10LeadPlan,
  isAgeQuestionDetour,
  isAudioSequenceInProgressMetadata,
  isExplicitStopRequest,
  isNegativeBotInterest,
  isGuardianConfirmation,
  isGuardianDenial,
  isPositiveInterest,
  isStaleFoundationReplyAfterStageAdvance,
  isYesNoPollReply,
  parseEc10MeetingSchedule,
  parseFoundationStatus,
  shouldAskFoundationStatus,
  parseMeetingDateChoice,
  parseMeetingTimeChoice,
  shouldSendLeadPageMessage,
  wasPromptSentRecently
} from "../apps/bot/dist/ec10-flow.js";
import {selectBookingContactName} from "../apps/bot/dist/booking-contact.js";

const now = new Date("2026-06-17T12:00:00-03:00");
const dateOptions = buildMeetingDateOptions(now);
const timeOptions = buildMeetingTimeOptions();
const results = [];

check("guardian gate recognizes only responsible adults", () => {
  assert.equal(isGuardianConfirmation("sou a mae"), true);
  assert.equal(isGuardianConfirmation("sim, sou o responsavel legal"), true);
  assert.equal(isGuardianDenial("sou o atleta"), true);
  assert.equal(isGuardianConfirmation("sou o atleta"), false);
});

check("minor booking keeps responsible and athlete identities separate", () => {
  assert.equal(selectBookingContactName({metadata:{leadName:'Marcelo Ramos',athleteName:'Marcelo Ramos',responsibleName:'Bruno'},minor:true,responsibleRole:true}),null);
  assert.equal(selectBookingContactName({metadata:{leadName:'Marcelo Ramos',athleteName:'Marcelo Ramos',responsibleName:'Bruno Silva'},minor:true,responsibleRole:true}),'Bruno Silva');
  assert.equal(selectBookingContactName({metadata:{leadName:'Bruno Silva',athleteName:'Marcelo Ramos'},minor:true,responsibleRole:true}),'Bruno Silva');
});

function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function isConsultativeDetour(body) {
  const text = String(body ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(como funciona|explica|detalhes|saber mais|qual valor|quanto custa|preco|investimento|vou pensar|me chama depois|nao quero reuniao)\b/.test(text);
}

function decision(stage, body, context = {}) {
  if (isAudioSequenceInProgressMetadata(context.metadata ?? null, context.now ?? now)) {
    return "ignore_during_audio_sequence";
  }
  if (stage === "awaiting_age") return extractAthleteAge(body) ? "age_captured" : "retry_age";
  if (stage === "awaiting_foundation_status") return parseFoundationStatus(body) ? "foundation_captured" : "retry_foundation";
  if (stage === "awaiting_interest") {
    if (isStaleFoundationReplyAfterStageAdvance(context.metadata, body)) return "suppress_stale_foundation_reply";
    if (isExplicitStopRequest(body)) return "decline_revela_follow_up";
    if (!isConsultativeDetour(body) && isPositiveInterest(body)) return "ask_meeting_date";
    return "retry_interest_poll";
  }
  if (stage === "awaiting_meeting_date") {
    const parsed = parseMeetingDateChoice(body, context.dateOptions ?? dateOptions, context.now ?? now);
    if (!parsed.ok) return isExplicitStopRequest(body) ? "decline_revela_follow_up" : "retry_meeting_date";
    return parsed.none ? "ask_custom_date" : "ask_meeting_time";
  }
  if (stage === "awaiting_meeting_time") {
    const parsed = parseMeetingTimeChoice(body, context.timeOptions ?? timeOptions);
    if (!parsed.ok) return isExplicitStopRequest(body) ? "decline_revela_follow_up" : "retry_meeting_time";
    return parsed.none ? "ask_custom_time" : "confirm_meeting";
  }
  return "unhandled";
}

function simulateInitialBurst(messages, stepMs = 10_000) {
  let state = null;
  const actions = [];

  for (const [index, body] of messages.entries()) {
    const messageNow = new Date(now.getTime() + index * stepMs);
    if (!state) {
      const age = extractAthleteAge(body);
      if (age) {
        actions.push("age_captured_first_message");
        state = { stage: "age_captured", metadata: {} };
      } else {
        actions.push("ask_age");
        state = {
          stage: "awaiting_age",
          metadata: {
            ageQuestionAskedAt: messageNow.toISOString()
          }
        };
      }
      continue;
    }

    if (state.stage === "awaiting_age") {
      const age = extractAthleteAge(body);
      if (age) {
        actions.push("age_captured");
        state = { stage: "age_captured", metadata: state.metadata };
        continue;
      }

      if (
        wasPromptSentRecently(state.metadata, "ageQuestionAskedAt", messageNow)
        || wasPromptSentRecently(state.metadata, "invalidAgePromptedAt", messageNow)
      ) {
        if (
          isAgeQuestionDetour(body)
          && !wasPromptSentRecently(state.metadata, "ageClarificationPromptedAt", messageNow)
        ) {
          actions.push("clarify_age_detour");
          state.metadata = {
            ...state.metadata,
            ageClarificationPromptedAt: messageNow.toISOString()
          };
          continue;
        }

        actions.push("suppress_age_retry");
        continue;
      }

      actions.push("retry_age");
      state.metadata = {
        ...state.metadata,
        invalidAgePromptedAt: messageNow.toISOString()
      };
      continue;
    }

    actions.push("ignored_after_capture");
  }

  return actions;
}

function expectedPlan(age, options = {}) {
  const plan = getEc10LeadPlan(age, options);
  if (age < 8) return null;
  if (options.flowKind === "revela_13_plus" && age >= 13) return "revela_13_plus";
  if (age <= 13) return "career_8_13";
  if (age <= 19) return "eurocamp_14_19";
  if (age <= 25) return "international_20_25";
  return "international_26_plus";
}

for (let age = 0; age <= 35; age += 1) {
  check(`age plan default ${age}`, () => {
    const options = {};
    assert.equal(getEc10LeadPlan(age, options)?.flowKind ?? null, expectedPlan(age, options));
  });

  check(`age plan ignores legacy foundation status ${age}`, () => {
    const options = { foundationStatus: "escolinha" };
    assert.equal(getEc10LeadPlan(age, options)?.flowKind ?? null, expectedPlan(age, options));
  });

  check(`age plan revela ${age}`, () => {
    const options = { flowKind: "revela_13_plus" };
    assert.equal(getEc10LeadPlan(age, options)?.flowKind ?? null, expectedPlan(age, options));
  });
}

const ageCases = [
  ["8 anos", 8],
  ["08 anos", 8],
  ["meu filho tem oito anos", 8],
  ["ele tem nove", 9],
  ["atleta sub 10", 10],
  ["sub-11", 11],
  ["categoria sub 12", 12],
  ["idade 13", 13],
  ["fez quatorze", 14],
  ["quinze anos", 15],
  ["16 anos completos", 16],
  ["dezessete", 17],
  ["dezoito", 18],
  ["nascido em 2010", 16],
  ["nasceu em 2011", 15],
  ["ano 2012", 14],
  ["2013", 13],
  ["tenho 1 filho de 15 anos", 15],
  ["tenho 2 atletas, um de 13 anos", 13],
  ["camisa 10 e idade 15", 15],
  ["ele usa camisa 10 e tem 16 anos", 16],
  ["valor 299, idade 14", 14],
  ["camisa 10", null],
  ["nota 10", null],
  ["R$ 10", null],
  ["10 reais", null],
  ["tenho 1 filho", null],
  ["tenho 2 atletas", null],
  ["299 reais", null],
  ["telefone 31999999999", null],
  ["quero saber mais", null],
  ["como funciona", null],
  ["manda audio", null],
  ["pode mandar", null]
];

for (const [input, expected] of ageCases) {
  check(`extract age: ${input}`, () => assert.equal(extractAthleteAge(input), expected));
}

const writtenAgeCases = [
  ["vinte", 20],
  ["vinte e um", 21],
  ["vinte e dois", 22],
  ["vinte e tres", 23],
  ["vinte e quatro", 24],
  ["vinte e cinco", 25],
  ["vinte e seis", 26],
  ["vinte e sete", 27],
  ["vinte e oito", 28],
  ["vinte e nove", 29],
  ["trinta", 30],
  ["trinta e um", 31],
  ["trinta e dois", 32],
  ["trinta e tres", 33],
  ["trinta e quatro", 34],
  ["trinta e cinco", 35],
  ["trinta e seis", 36],
  ["trinta e sete", 37],
  ["trinta e oito", 38],
  ["trinta e nove", 39],
  ["quarenta", 40],
  ["dezasseis", 16],
  ["dezassete", 17]
];

for (const [input, expected] of writtenAgeCases) {
  check(`written age: ${input}`, () => assert.equal(extractAthleteAge(input), expected));
}

const foundationCases = [
  ["base", "base"],
  ["clube", "base"],
  ["joga no time", "base"],
  ["joga em campeonato federado", "base"],
  ["categoria sub 15", "base"],
  ["joga pela equipe do clube", "base"],
  ["escolinha", "escolinha"],
  ["escolhinha", "escolinha"],
  ["escola de futebol", "escolinha"],
  ["projeto social", "escolinha"],
  ["academia de futebol", "escolinha"],
  ["so treina", "escolinha"],
  ["sem clube", "escolinha"],
  ["nao esta na base", "escolinha"],
  ["nao joga em clube ainda", "escolinha"],
  ["nao sei", null],
  ["talvez", null],
  ["ele joga futebol", null]
];

for (const [input, expected] of foundationCases) {
  check(`foundation: ${input}`, () => assert.equal(parseFoundationStatus(input), expected));
}

const positiveInterest = [
  "sim",
  "1. Sim",
  "1) Sim",
  "opcao 1 sim",
  "s",
  "ok",
  "claro",
  "fechado",
  "beleza",
  "blz",
  "pode mandar",
  "manda ai",
  "quero",
  "quero sim",
  "tenho interesse",
  "saber mais",
  "como funciona",
  "me explica",
  "explica melhor",
  "qual valor",
  "quanto custa",
  "pode ser",
  "vamos marcar",
  "bora",
  "combinado"
];

const negativeInterest = [
  "nao",
  "n",
  "2",
  "2. Nao",
  "2) Nao",
  "opcao 2 nao",
  "agora nao",
  "nao agora",
  "depois",
  "mais tarde",
  "vou pensar",
  "vou ver",
  "vou ver depois",
  "me chama depois",
  "sem tempo",
  "nao quero",
  "nao tenho interesse",
  "sem interesse",
  "nao quero reuniao",
  "nao precisa reuniao",
  "nao precisa marcar",
  "nao consigo marcar",
  "cancelar",
  "parar"
];

const ambiguousInterest = [
  "nao sei",
  "talvez",
  "depende",
  "entendi",
  "recebi",
  "obrigado",
  "legal",
  "hum",
  "certo",
  "vou falar com ele"
];

for (const input of positiveInterest) {
  check(`positive interest: ${input}`, () => assert.equal(isPositiveInterest(input), true));
  check(`positive not negative: ${input}`, () => assert.equal(isNegativeBotInterest(input), false));
}

for (const input of negativeInterest) {
  check(`negative interest: ${input}`, () => assert.equal(isNegativeBotInterest(input), true));
  check(`negative not positive: ${input}`, () => assert.equal(isPositiveInterest(input), false));
}

for (const input of ambiguousInterest) {
  check(`ambiguous not positive: ${input}`, () => assert.equal(isPositiveInterest(input), false));
  check(`ambiguous not negative: ${input}`, () => assert.equal(isNegativeBotInterest(input), false));
}

for (const input of ["Sim", "1. Sim", "2. Nao", "opcao 1 sim"]) {
  check(`yes/no poll reply: ${input}`, () => assert.equal(isYesNoPollReply(input), true));
}

for (const input of ["1", "2", `2. ${dateOptions[1].label}`, `3. ${timeOptions[2].label}`]) {
  check(`not yes/no poll reply: ${input}`, () => assert.equal(isYesNoPollReply(input), false));
}

const dateCases = [
  ["1", "ask_meeting_time"],
  ["2", "ask_meeting_time"],
  [`1. ${dateOptions[0].label}`, "ask_meeting_time"],
  ["amanha", "ask_meeting_time"],
  ["depois de amanha", "ask_meeting_time"],
  ["segunda", "ask_meeting_time"],
  ["terca", "ask_meeting_time"],
  ["terça", "ask_meeting_time"],
  ["quarta", "ask_meeting_time"],
  ["quinta", "ask_meeting_time"],
  ["sexta", "ask_meeting_time"],
  ["25/06", "ask_meeting_time"],
  ["25-06", "ask_meeting_time"],
  ["03/07", "ask_meeting_time"],
  ["04/07", "retry_meeting_date"],
  ["nenhuma dessas", "ask_custom_date"],
  ["outra data", "ask_custom_date"],
  ["nao posso nessas datas", "ask_custom_date"],
  ["sabado", "retry_meeting_date"],
  ["sábado", "retry_meeting_date"],
  ["domingo", "retry_meeting_date"],
  ["ontem", "retry_meeting_date"],
  ["qualquer dia", "retry_meeting_date"]
];

for (const [input, expected] of dateCases) {
  check(`date decision: ${input}`, () => assert.equal(decision("awaiting_meeting_date", input), expected));
}

const timeCases = [
  ["1", "confirm_meeting"],
  ["2", "confirm_meeting"],
  ["opcao 1", "confirm_meeting"],
  [`3. ${timeOptions[2].label}`, "confirm_meeting"],
  ["8", "confirm_meeting"],
  ["9", "confirm_meeting"],
  ["14", "confirm_meeting"],
  ["18", "confirm_meeting"],
  ["8h", "confirm_meeting"],
  ["09h", "confirm_meeting"],
  ["10:00", "confirm_meeting"],
  ["12:00", "confirm_meeting"],
  ["14 horas", "confirm_meeting"],
  ["meio dia", "confirm_meeting"],
  ["duas da tarde", "confirm_meeting"],
  ["seis da tarde", "confirm_meeting"],
  ["nenhum desses", "ask_custom_time"],
  ["outro horario", "ask_custom_time"],
  ["nao posso nesses horarios", "ask_custom_time"],
  ["7", "confirm_meeting"],
  ["7h", "retry_meeting_time"],
  ["19", "retry_meeting_time"],
  ["22h", "retry_meeting_time"],
  ["14h30", "retry_meeting_time"],
  ["qualquer hora", "retry_meeting_time"]
];

for (const [input, expected] of timeCases) {
  check(`time decision: ${input}`, () => assert.equal(decision("awaiting_meeting_time", input), expected));
}

const stageCases = [
  ["awaiting_age", "15 anos", "age_captured"],
  ["awaiting_age", "quero saber mais", "retry_age"],
  ["awaiting_age", "nascido em 2011", "age_captured"],
  ["awaiting_foundation_status", "clube federado", "foundation_captured"],
  ["awaiting_foundation_status", "projeto social", "foundation_captured"],
  ["awaiting_foundation_status", "nao sei", "retry_foundation"],
  ["awaiting_interest", "1. Sim", "ask_meeting_date"],
  ["awaiting_interest", "2. Nao", "decline_revela_follow_up"],
  ["awaiting_interest", "Estou em escolinha", "suppress_stale_foundation_reply", { metadata: { foundationStatus: "escolinha" } }],
  ["awaiting_interest", "base de clube", "suppress_stale_foundation_reply", { metadata: { foundationStatus: "base" } }],
  ["awaiting_interest", "pode mandar", "ask_meeting_date"],
  ["awaiting_interest", "qual valor", "retry_interest_poll"],
  ["awaiting_interest", "me chama depois", "retry_interest_poll"],
  ["awaiting_interest", "talvez", "retry_interest_poll"],
  ["awaiting_meeting_date", "vou pensar", "retry_meeting_date"],
  ["awaiting_meeting_date", "amanha", "ask_meeting_time"],
  ["awaiting_meeting_time", "nao quero reuniao", "retry_meeting_time"],
  ["awaiting_meeting_time", "9", "confirm_meeting"]
];

for (const [stage, input, expected, context] of stageCases) {
  check(`stage ${stage}: ${input}`, () => assert.equal(decision(stage, input, context), expected));
}

check("audio sequence lock fresh", () => {
  assert.equal(decision("awaiting_interest", "pode mandar", {
    metadata: {
      audioSequenceInProgress: true,
      audioSequenceStartedAt: new Date(now.getTime() - 30_000).toISOString()
    }
  }), "ignore_during_audio_sequence");
});

check("audio sequence lock stale", () => {
  assert.equal(decision("awaiting_interest", "pode mandar", {
    metadata: {
      audioSequenceInProgress: true,
      audioSequenceStartedAt: new Date(now.getTime() - 11 * 60_000).toISOString()
    }
  }), "ask_meeting_date");
});

for (const key of [
  "invalidAgePromptedAt",
  "invalidInterestPromptedAt",
  "invalidFoundationPromptedAt",
  "invalidMeetingDatePromptedAt",
  "invalidMeetingTimePromptedAt",
  "customMeetingTimePromptedAt"
]) {
  check(`prompt throttle recent ${key}`, () => {
    assert.equal(wasPromptSentRecently({ [key]: new Date(now.getTime() - 30_000).toISOString() }, key, now), true);
  });
  check(`prompt throttle expired ${key}`, () => {
    assert.equal(wasPromptSentRecently({ [key]: new Date(now.getTime() - 3 * 60_000).toISOString() }, key, now), false);
  });
}

check("custom meeting time prompt throttle uses long ttl", () => {
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
});

for (const age of [10, 12, 13, 15, 17, 18, 25]) {
  check(`link rules ${age}`, () => {
    const plan = getEc10LeadPlan(age);
    assert.equal(shouldSendLeadPageMessage(plan), false);
  });
}

check("revela attribution URL is not sent by bot", () => {
  const plan = getEc10LeadPlan(15, { flowKind: "revela_13_plus" });
  assert.equal(shouldSendLeadPageMessage(plan), false);
});

check("meeting schedule natural phrase", () => {
  const parsed = parseEc10MeetingSchedule("amanha as 14h", now);
  assert.equal(parsed.ok, true);
});

check("meeting schedule weekend rejected", () => {
  const parsed = parseEc10MeetingSchedule("sabado as 14h", now);
  assert.equal(parsed.ok, false);
});

check("meeting schedule past today rejected", () => {
  const parsed = parseEc10MeetingSchedule("hoje as 8h", now);
  assert.equal(parsed.ok, false);
});

check("build schedule from selected option", () => {
  const date = dateOptions[0];
  const time = timeOptions[4];
  assert.equal(buildScheduleFromOptions(date, time, now).ok, true);
});

const burstCases = [
  {
    name: "oi depois gostaria de saber mais",
    messages: ["oi", "gostaria de saber mais"],
    expected: ["ask_age", "clarify_age_detour"]
  },
  {
    name: "print opa depois quero saber mais",
    messages: ["opa tudo bem?", "quero saber mais"],
    expected: ["ask_age", "clarify_age_detour"]
  },
  {
    name: "pessoa sem conhecimento manda varias mensagens",
    messages: ["oi", "gostaria de saber mais", "como funciona", "nao sei mexer", "pode me explicar"],
    expected: ["ask_age", "clarify_age_detour", "suppress_age_retry", "suppress_age_retry", "suppress_age_retry"]
  },
  {
    name: "atleta muito novo sem pratica",
    messages: ["oi eu sou atleta", "nao sei usar isso", "minha mae que falou", "tenho 13 anos"],
    expected: ["ask_age", "clarify_age_detour", "suppress_age_retry", "age_captured"]
  },
  {
    name: "pessoa com pouca condicao",
    messages: ["oi", "sou pobre", "nao tenho dinheiro", "mas queria saber", "meu filho tem 15 anos"],
    expected: ["ask_age", "clarify_age_detour", "suppress_age_retry", "suppress_age_retry", "age_captured"]
  },
  {
    name: "primeira mensagem ja vem com idade",
    messages: ["oi, meu filho tem 15 anos"],
    expected: ["age_captured_first_message"]
  },
  {
    name: "primeira mensagem revela com idade",
    messages: ["quero revela talentos, meu filho tem 15 anos"],
    expected: ["age_captured_first_message"]
  },
  {
    name: "muitas mensagens antes da idade",
    messages: ["boa tarde", "tem vaga", "quanto custa", "e para futebol", "ele joga muito", "15 anos"],
    expected: ["ask_age", "clarify_age_detour", "suppress_age_retry", "suppress_age_retry", "suppress_age_retry", "age_captured"]
  }
];

for (const item of burstCases) {
  check(`initial burst: ${item.name}`, () => {
    assert.deepEqual(simulateInitialBurst(item.messages), item.expected);
  });
}

check("initial burst prompts again after throttle expires", () => {
  assert.deepEqual(
    simulateInitialBurst(["oi", "gostaria de saber mais"], 3 * 60_000),
    ["ask_age", "retry_age"]
  );
});

check("financial objection keeps consultative conversation active", () => {
  assert.equal(decision("awaiting_interest", "nao tenho dinheiro"), "retry_interest_poll");
  assert.equal(decision("awaiting_meeting_date", "muito caro"), "retry_meeting_date");
  assert.equal(decision("awaiting_meeting_time", "nao consigo pagar"), "retry_meeting_time");
});

check("only an explicit stop closes the commercial flow", () => {
  assert.equal(decision("awaiting_interest", "nao tenho interesse"), "decline_revela_follow_up");
  assert.equal(decision("awaiting_meeting_date", "remova meu numero"), "decline_revela_follow_up");
  assert.equal(decision("awaiting_meeting_time", "cancelar"), "decline_revela_follow_up");
});

const failures = results.filter((result) => !result.ok);
const total = results.length;
console.log(`Adversarial bot checks: ${total}, failures: ${failures.length}`);
if (failures.length) {
  for (const failure of failures) {
    console.error(`fail - ${failure.name}: ${failure.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("All adversarial bot checks passed.");
}
