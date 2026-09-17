import type { ServiceInterest } from "@crm/shared";

export type Ec10AgeGroup = "8-13" | "14-19" | "20-25" | "26-plus";
export type Ec10FlowKind =
  | "career_8_13"
  | "eurocamp_14_19"
  | "international_20_25"
  | "international_26_plus"
  | "revela_13_plus"
  | "foundation_8_12"
  | "career_13_17"
  | "adult_18_plus";
export type Ec10FoundationStatus = "base" | "escolinha";
export type Ec10ConversationStage =
  | "awaiting_interest"
  | "awaiting_role"
  | "awaiting_age"
  | "awaiting_foundation_status"
  | "awaiting_guardian_confirmation"
  | "awaiting_meeting_date"
  | "awaiting_meeting_time"
  | "completed";

export type Ec10AudioItem = {
  label: string;
  audioPath: string;
  durationSeconds: number;
};

export type Ec10LeadPlan = {
  ageGroup: Ec10AgeGroup;
  flowKind: Ec10FlowKind;
  serviceInterest: ServiceInterest;
  audioItems: Ec10AudioItem[];
  leadPageUrl: string;
  leadPageSection: string;
  leadScore: number;
};

export type Ec10MeetingSchedule = {
  startsAt: string;
  endsAt: string;
  dateLabel: string;
  timeLabel: string;
  timezone: "America/Sao_Paulo";
};

export type Ec10MeetingDateOption = {
  index: number;
  isoDate: string;
  label: string;
};

export type Ec10MeetingTimeOption = {
  index: number;
  hour: number;
  minute?: number;
  label: string;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export const ec10Messages = {
  welcome: "Bem-vindo à EC10 Talentos!",
  roleQuestion: "Qual é a idade do atleta?",
  ageQuestion: "Qual é a idade do atleta?",
  revelaAgeQuestion: "Qual a idade do seu filho?",
  foundationStatusQuestion: "Pra entender o momento do atleta: ele joga em clube federado ou treina em escolinha/projeto?\n1. Clube federado\n2. Escolinha ou projeto",
  invalidFoundationStatus: "Me conta so essa parte: ele joga em clube federado ou esta em escolinha/projeto? Pode responder 1 ou 2.",
  interestQuestion: "Voce tem interesse em saber mais e marcar uma reuniao?\n1. Sim\n2. Nao",
  invalidInterest: "Nao consegui identificar. Me responde com 1 para Sim ou 2 para Nao.",
  guardianQuestion: "Antes de abrir a agenda: estou falando com o pai, a mae ou o responsavel legal do atleta?\n1. Sim, sou responsavel\n2. Nao",
  invalidGuardian: "Para continuar, me confirme: voce e o pai, a mae ou o responsavel legal do atleta? Responda 1 para Sim ou 2 para Nao.",
  guardianRequired: "Como o atleta e menor de 18 anos, a reuniao precisa ser agendada pelo pai, pela mae ou pelo responsavel legal. Peca para o responsavel continuar esta conversa por aqui.",
  audioRoleFallback: "Recebi seu audio. Para eu continuar certinho, me manda a idade do atleta em numero por texto. Exemplo: 12.",
  audioAgeFallback: "Recebi seu audio. Para eu te direcionar pelo caminho certo, me manda a idade do atleta em numero por texto. Exemplo: 12.",
  audioFoundationFallback: "Recebi seu audio. Pra eu registrar direitinho, me responde por texto: 1 para clube federado ou 2 para escolinha/projeto.",
  invalidAge: "Me manda somente a idade do atleta em numero, por exemplo: 12.",
  underMinimumAge: "Atendemos atletas a partir de 8 anos. Me confirma se ele ja tem 8 anos ou mais?",
  meetingQuestion: "Vamos marcar uma reuniao? Qual seria o melhor dia e horario para voce? Atendemos de segunda a sexta, com inicio entre 8h e 18h, e cada reuniao dura em torno de 1 hora. Exemplo: amanha as 14h ou 18/06 as 10h.",
  invalidMeetingDate: "Nao consegui identificar a data. Responda com o numero de uma das opcoes ou me envie uma data no formato DD/MM. Exemplo: 18/06.",
  invalidMeetingTimeOption: "Nao consegui identificar o horario. Responda com o numero de uma das opcoes ou me envie um horario entre 8h e 18h. Exemplo: 14h.",
  customMeetingDateQuestion: "Sem problema. Me envie uma data que funcione para voce no formato DD/MM. Exemplo: 23/06.",
  customMeetingTimeQuestion: "Sem problema. Me envie o melhor horario para essa data. Pode ser entre 8h e 18h. Exemplo: 14h.",
  invalidMeetingTime: "Nao consegui confirmar esse horario. Me manda o dia e horario comercial para a reuniao. Exemplo: amanha as 14h ou 18/06 as 10h.",
  outsideBusinessHours: "Esse horario fica fora da agenda comercial. Me envia um horario de segunda a sexta, com inicio entre 8h e 18h.",
  finishedWithoutInterest: "Tudo bem. Se quiser retomar depois, e so mandar uma mensagem por aqui."
} as const;

export function shouldSendEc10Welcome(hasOutboundMessage:boolean,body:string|null|undefined) {
  return !hasOutboundMessage&&!isExplicitStopRequest(body);
}

export function isEurocampAudio(audioPath:string|null|undefined) {
  return /(?:04_14-19_apresentacao|05_14-19_eurocamp|eurocamp)/i.test(audioPath||'');
}

export function canSendEc10Audio(age:number|null|undefined,audioPath:string|null|undefined) {
  return !isEurocampAudio(audioPath)||(typeof age==='number'&&age>=8&&age<18);
}

const saoPauloTimezone = "America/Sao_Paulo" as const;
const saoPauloUtcOffsetHours = 3;
const businessStartHour = 8;
const latestMeetingStartHour = 18;
const meetingDurationMinutes = 60;
const meetingOptionsWindowDays = 14;
const careerPlanUrl = "https://ec10talentos.com/instagram";
const writtenMeetingHours: Array<[RegExp, number]> = [
  [/\b(meio\s*-?\s*dia|doze)\b/, 12],
  [/\b(uma|1)\s+da\s+tarde\b/, 13],
  [/\b(duas|2)\s+da\s+tarde\b/, 14],
  [/\b(tres|3)\s+da\s+tarde\b/, 15],
  [/\b(quatro|4)\s+da\s+tarde\b/, 16],
  [/\b(cinco|5)\s+da\s+tarde\b/, 17],
  [/\b(seis|6)\s+da\s+(tarde|noite)\b/, 18],
  [/\boito(\s+horas?)?\b/, 8],
  [/\bnove(\s+horas?)?\b/, 9],
  [/\bdez(\s+horas?)?\b/, 10],
  [/\bonze(\s+horas?)?\b/, 11],
  [/\btreze(\s+horas?)?\b/, 13],
  [/\b(catorze|quatorze)(\s+horas?)?\b/, 14],
  [/\bquinze(\s+horas?)?\b/, 15],
  [/\bdezesseis(\s+horas?)?\b/, 16],
  [/\bdezessete(\s+horas?)?\b/, 17],
  [/\bdezoito(\s+horas?)?\b/, 18]
];
const writtenAges: Array<[RegExp, number]> = [
  [/\bvinte\s+e\s+um\b/, 21],
  [/\bvinte\s+e\s+dois\b/, 22],
  [/\bvinte\s+e\s+tres\b/, 23],
  [/\bvinte\s+e\s+quatro\b/, 24],
  [/\bvinte\s+e\s+cinco\b/, 25],
  [/\bvinte\s+e\s+seis\b/, 26],
  [/\bvinte\s+e\s+sete\b/, 27],
  [/\bvinte\s+e\s+oito\b/, 28],
  [/\bvinte\s+e\s+nove\b/, 29],
  [/\bvinte\b/, 20],
  [/\btrinta\s+e\s+um\b/, 31],
  [/\btrinta\s+e\s+dois\b/, 32],
  [/\btrinta\s+e\s+tres\b/, 33],
  [/\btrinta\s+e\s+quatro\b/, 34],
  [/\btrinta\s+e\s+cinco\b/, 35],
  [/\btrinta\s+e\s+seis\b/, 36],
  [/\btrinta\s+e\s+sete\b/, 37],
  [/\btrinta\s+e\s+oito\b/, 38],
  [/\btrinta\s+e\s+nove\b/, 39],
  [/\btrinta\b/, 30],
  [/\bquarenta\b/, 40],
  [/\b(um|uma)\b/, 1],
  [/\b(dois|duas)\b/, 2],
  [/\btres\b/, 3],
  [/\bquatro\b/, 4],
  [/\bcinco\b/, 5],
  [/\bseis\b/, 6],
  [/\bsete\b/, 7],
  [/\boito\b/, 8],
  [/\bnove\b/, 9],
  [/\bdez\b/, 10],
  [/\bonze\b/, 11],
  [/\bdoze\b/, 12],
  [/\btreze\b/, 13],
  [/\b(catorze|quatorze)\b/, 14],
  [/\bquinze\b/, 15],
  [/\b(dezesseis|dezaseis|dezasseis)\b/, 16],
  [/\b(dezessete|dezasete|dezassete)\b/, 17],
  [/\bdezoito\b/, 18],
  [/\b(dezenove|dezanove)\b/, 19]
];

export function extractAthleteAge(input: string | null | undefined) {
  const text = normalizeText(input);
  const birthYear = extractBirthYear(text);
  if (birthYear) return birthYear;

  let bestCandidate: { age: number; score: number; index: number } | null = null;
  for (const match of text.matchAll(/\b0?([1-9]\d?)\b/g)) {
    const index = match.index ?? 0;
    if (isNonAgeNumberContext(text, index, match[0])) continue;
    const age = Number.parseInt(match[1], 10);
    if (!Number.isFinite(age)) continue;

    const candidate = { age, score: scoreAgeNumberContext(text, index, match[0]), index };
    if (
      !bestCandidate
      || candidate.score > bestCandidate.score
      || (candidate.score === bestCandidate.score && candidate.index < bestCandidate.index)
    ) {
      bestCandidate = candidate;
    }
  }
  if (bestCandidate) return bestCandidate.age;

  const written = writtenAges.find(([pattern]) => pattern.test(text));
  return written?.[1] ?? null;
}

export function isRestartCommand(input: string | null | undefined) {
  const text = normalizeText(input);
  return [
    "recomecar",
    "reiniciar",
    "comecar de novo",
    "inicio",
    "voltar ao inicio"
  ].some((command) => text.includes(command));
}

export function isNegativeInterest(input: string | null | undefined) {
  const text = normalizeText(input);
  const choiceText = stripLeadingChoiceNumber(text);
  if (choiceText !== text && choiceText && isNegativeInterest(choiceText)) return true;
  if (/\bdepois\s+de\s+amanha\b/.test(text)) return false;
  if (/\bdepois\s+d[ao]s?\s+([01]?\d|2[0-3]|oito|nove|dez|onze|doze|meio\s*-?\s*dia|duas|tres|quatro|cinco|seis)\b/.test(text)) return false;
  return /^(2|02|nao|n)$/.test(text)
    || /\b(nao quero|nao tenho interesse|sem interesse|agora nao|nao agora|depois|mais tarde|parar|cancelar|nao quero reuniao|nao quero marcar|nao precisa reuniao|nao precisa marcar|sem reuniao|sem tempo|vou pensar|vou ver|deixa para depois|deixa pra depois|me chama depois|agora nao consigo|nao consigo marcar|sem dinheiro|nao tenho dinheiro|nao tenho condicoes|nao tenho condição|muito caro|caro demais|nao consigo pagar|sem condicoes|sem condição)\b/.test(text);
}

export function isExplicitStopRequest(input: string | null | undefined) {
  const text = normalizeText(input);
  const choiceText = stripLeadingChoiceNumber(text);
  if (choiceText !== text && choiceText && isExplicitStopRequest(choiceText)) return true;
  return /^(2|02|nao|n)$/.test(text)
    || /\b(nao tenho interesse|sem interesse|parar|cancele|cancelar|encerre|encerrar|nao me chame|nao mande mais|pare de (?:mandar|(?:me )?enviar)|remova meu numero|apague meu numero)\b/.test(text);
}

export function isPositiveInterest(input: string | null | undefined) {
  if (isNegativeInterest(input)) return false;
  const text = normalizeText(input);
  const choiceText = stripLeadingChoiceNumber(text);
  if (choiceText !== text && choiceText && isPositiveInterest(choiceText)) return true;
  return /^(1|01|sim|s|ok|okay|claro|positivo|fechado|beleza|blz)$/.test(text)
    || /(^|\b)(quero|quero sim|tenho interesse|interesse|saber mais|como funciona|me explica|explica melhor|qual valor|quanto custa|agendar|reuniao|marcar|pode ser|pode mandar|manda|manda ai|mande|vamos|bora|combinado)(\b|$)/.test(text);
}

export function isAgeQuestionDetour(input: string | null | undefined) {
  const text = normalizeText(input);
  if (!text || extractAthleteAge(text)) return false;
  return /^(oi|ola|opa|bom dia|boa tarde|boa noite|tudo bem|td bem|eai|e ai)[!?., ]*$/.test(text)
    || /\b(quero|queria|gostaria|preciso|posso|pode|manda|mande|me manda|me envia|me explica|explica|saber mais|mais informacoes|como funciona|qual valor|qual o valor|valor|quanto custa|tem vaga|atendimento|futebol|avaliacao|teste|peneira|plano|carreira|nao sei|nao sei mexer|nao sei usar|me ajuda|ajuda|nao entendi|sou pobre|sem dinheiro|nao tenho dinheiro|nao tenho condicoes|nao tenho condicao)\b/.test(text);
}

export function isNegativeBotInterest(input: string | null | undefined) {
  const text = normalizeText(input);
  return text === "2" || isNegativeInterest(input);
}

export function isYesNoPollReply(input: string | null | undefined) {
  const text = normalizeText(input);
  if (!text) return false;
  const choiceText = stripLeadingChoiceNumber(text);
  if (/^(sim|s|nao|n)$/.test(text)) return true;
  return choiceText !== text && /^(sim|s|nao|n)$/.test(choiceText);
}

export function isGuardianDenial(input: string | null | undefined) {
  const text = normalizeText(input);
  const choiceText = stripLeadingChoiceNumber(text);
  if (choiceText !== text && choiceText && isGuardianDenial(choiceText)) return true;
  return /^(2|02|nao|n)$/.test(text)
    || /\b(nao sou|nao e|nao,|sou o atleta|sou atleta|sou irmao|sou irma|sou amigo|sou amiga|sou treinador|sou tecnica|sou tecnico|sou agente|sou empresario)\b/.test(text);
}

export function isGuardianConfirmation(input: string | null | undefined) {
  if (isGuardianDenial(input)) return false;
  const text = normalizeText(input);
  const choiceText = stripLeadingChoiceNumber(text);
  if (choiceText !== text && choiceText && isGuardianConfirmation(choiceText)) return true;
  return /^(1|01|sim|s)$/.test(text)
    || /\b(sou responsavel|sou o responsavel|sou a responsavel|responsavel legal|sou pai|sou o pai|sou mae|sou a mae|pai do atleta|mae do atleta|responsavel pelo atleta)\b/.test(text);
}

export function isRevelaTalentosEntry(input: string | null | undefined) {
  const text = normalizeText(input);
  return [
    "revela",
    "revela talentos",
    "plataforma gratuita",
    "plataforma revela",
    "acesso revela"
  ].some((trigger) => text.includes(trigger));
}

export function isAudioSequenceInProgressMetadata(
  metadata: Record<string, unknown> | null | undefined,
  now = new Date(),
  timeoutMs = 10 * 60 * 1000
) {
  if (!metadata || metadata.audioSequenceInProgress !== true) return false;
  const startedAt = typeof metadata.audioSequenceStartedAt === "string"
    ? Date.parse(metadata.audioSequenceStartedAt)
    : null;
  if (!startedAt || Number.isNaN(startedAt)) return true;
  return now.getTime() - startedAt < timeoutMs;
}

export function wasPromptSentRecently(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  now = new Date(),
  ttlMs = 2 * 60 * 1000
) {
  const rawValue = metadata?.[key];
  if (typeof rawValue !== "string") return false;
  const sentAt = Date.parse(rawValue);
  if (!sentAt || Number.isNaN(sentAt)) return false;
  return now.getTime() - sentAt < ttlMs;
}

export function isStaleFoundationReplyAfterStageAdvance(
  metadata: Record<string, unknown> | null | undefined,
  body: string | null | undefined
) {
  return Boolean(metadata?.foundationStatus && parseFoundationStatus(body));
}

export function parseFoundationStatus(input: string | null | undefined): Ec10FoundationStatus | null {
  const text = normalizeText(input);
  if (!text) return null;

  if (/^(1|01|um|primeiro|primeira)$/.test(text) || /\b(opcao|numero)\s*(1|um)\b/.test(text)) return "base";
  if (/^(2|02|dois|segundo|segunda)$/.test(text) || /\b(opcao|numero)\s*(2|dois)\b/.test(text)) return "escolinha";

  const negativeBase = /\b(nao|n|nem|nunca)\s+(joga|esta|ta|fica|treina|participa|faz)?\s*(na|no|em|de)?\s*(base|clube|club|time|equipe|federado|federacao|campeonato)\b/.test(text)
    || /\b(ainda nao|sem clube|sem time|fora de clube|fora da base|nao joga|nao esta|nao ta)\b/.test(text);
  const negativeSchool = /\b(nao|n|nem|sem|nunca)\s+(e|esta|ta|fica|treina|participa|faz)?\s*(na|no|em|de)?\s*(escolh?inha|escola de futebol|escola|academia|projeto|aula|treino|treinamento)\b/.test(text);

  const schoolSignals = [
    /\b(escolh?inha|escolinha de futebol|escola de futebol|academia|projeto|projetinho)\b/,
    /\b(aula|aulas|treino|treinos|treinamento|treina|so treina|apenas treina)\b/,
    /\b(nao joga|nao esta|nao ta|ainda nao|sem clube|sem time|fora de clube|fora da base)\b/
  ];
  const baseSignals = [
    /\b(base|categoria de base|clube|club|time|equipe|federado|federacao|campeonato|competicao|competitivo)\b/,
    /\b(sub\s*-?\s?(7|8|9|10|11|12|13|14|15|16|17|20|23))\b/
  ];

  const hasSchoolSignal = schoolSignals.some((pattern) => pattern.test(text));
  const hasBaseSignal = baseSignals.some((pattern) => pattern.test(text));
  const strongSchoolSignal = /\b(escolh?inha|escola de futebol|academia|projeto|projetinho)\b/.test(text);
  const strongBaseSignal = /\b(joga|esta|ta|treina)\s+(na|no|em)\s+(base|clube|club|time|equipe)\b/.test(text)
    || /\b(categoria de base|federado|federacao|sub\s*-?\s?(7|8|9|10|11|12|13|14|15|16|17|20|23))\b/.test(text);

  if (negativeBase && hasSchoolSignal) return "escolinha";
  if (negativeBase && !hasBaseSignal) return "escolinha";
  if (negativeSchool && hasBaseSignal) return "base";
  if (hasSchoolSignal && !hasBaseSignal) return "escolinha";
  if (hasBaseSignal && !hasSchoolSignal) return "base";
  if (hasSchoolSignal && hasBaseSignal) {
    if (negativeBase) return "escolinha";
    if (negativeSchool) return "base";
    if (strongBaseSignal && !strongSchoolSignal) return "base";
    if (strongSchoolSignal) return "escolinha";
    return "base";
  }

  return null;
}

export function shouldAskFoundationStatus(age: number) {
  return age >= 8 && age < 16;
}

export function isUnknownFoundationStatus(input: string | null | undefined) {
  const text = normalizeText(input);
  return /^(nao sei|ainda nao sei|nao tenho certeza|nao sei dizer|nao tenho essa informacao|sem certeza)$/.test(text);
}

export function getEc10LeadPlan(
  age: number,
  options: { flowKind?: Ec10FlowKind; foundationStatus?: Ec10FoundationStatus; now?: Date } = {}
): Ec10LeadPlan | null {
  if (age < 8) return null;

  if (options.flowKind === "revela_13_plus" && age >= 13) {
    return {
      ageGroup: age <= 13 ? "8-13" : age <= 19 ? "14-19" : age <= 25 ? "20-25" : "26-plus",
      flowKind: "revela_13_plus",
      serviceInterest: "plano_carreira",
      audioItems: [
        { label: "revela-13-plus-1", audioPath: "media/audio/bot-principal/revela-13-plus/01_revela_1m15.ogg", durationSeconds: 75 },
        { label: "revela-13-plus-2", audioPath: "media/audio/bot-principal/revela-13-plus/02_revela_1m08.ogg", durationSeconds: 68 }
      ],
      leadPageUrl: buildLeadPageUrl("https://www.revelatalentos.com.br/", age, ""),
      leadPageSection: "Plataforma gratuita Revela Talentos",
      leadScore: 78
    };
  }

  if (age <= 13) {
    const promotionCutoff = Date.parse("2026-09-21T03:00:00.000Z");
    const promotionActive = (options.now ?? new Date()).getTime() < promotionCutoff;
    return {
      ageGroup: "8-13",
      flowKind: "career_8_13",
      serviceInterest: "plano_carreira",
      audioItems: [
        { label: "8-13-apresentacao-eric", audioPath: "media/audio/ec10/eric-2026-09-14/01_8-13_apresentacao.ogg", durationSeconds: 42 },
        { label: "8-13-plano-de-carreira", audioPath: "media/audio/ec10/eric-2026-09-14/02_8-13_plano-de-carreira.ogg", durationSeconds: 97 },
        ...(promotionActive ? [
          { label: "8-13-reuniao-promocao-semanal", audioPath: "media/audio/ec10/eric-2026-09-14/03_8-13_reuniao-promocao-semanal.ogg", durationSeconds: 36 }
        ] : [])
      ],
      leadPageUrl: careerPlanUrl,
      leadPageSection: "Plano de Carreira EC10 - R$ 399/mes",
      leadScore: 80
    };
  }

  if (age <= 19) {
    return {
      ageGroup: "14-19",
      flowKind: "eurocamp_14_19",
      serviceInterest: "eurocamp",
      audioItems: age<18 ? [
        { label: "14-19-apresentacao-eric", audioPath: "media/audio/ec10/eric-2026-09-14/04_14-19_apresentacao.ogg", durationSeconds: 67 },
        { label: "14-19-eurocamp", audioPath: "media/audio/ec10/eric-2026-09-14/05_14-19_eurocamp.ogg", durationSeconds: 86 }
      ] : [],
      leadPageUrl: buildLeadPageUrl("https://ec10talentos.com/eurocamp/14-19/", age, ""),
      leadPageSection: "Eurocamp EC10 - 14 a 19 anos",
      leadScore: 85
    };
  }

  if (age <= 25) {
    return {
      ageGroup: "20-25",
      flowKind: "international_20_25",
      serviceInterest: "plano_internacional",
      audioItems: [
        { label: "20-25-plano-internacional", audioPath: "media/audio/ec10/eric-2026-09-14/06_20-25_plano-internacional.ogg", durationSeconds: 80 }
      ],
      leadPageUrl: buildLeadPageUrl("https://ec10talentos.com/eurocamp/19-25/", age, ""),
      leadPageSection: "Plano Internacional EC10 - 20 a 25 anos",
      leadScore: 88
    };
  }

  return {
    ageGroup: "26-plus",
    flowKind: "international_26_plus",
    serviceInterest: "plano_internacional",
    audioItems: [],
    leadPageUrl: "",
    leadPageSection: "Analise individual EC10 para atletas acima de 25 anos",
    leadScore: 60
  };
}

export function shouldSendLeadPageMessage(_plan: Ec10LeadPlan) {
  // As páginas comerciais já fazem a captura e transferem o contexto ao WhatsApp.
  // A URL permanece no estado apenas para atribuição; o bot não deve reenviá-la.
  return false;
}

function isCareerMeetingService(serviceInterest: ServiceInterest | null | undefined) {
  return serviceInterest === "plano_carreira";
}

function isInternationalMeetingService(serviceInterest: ServiceInterest | null | undefined) {
  return serviceInterest === "plano_internacional" || serviceInterest === "ambos";
}

function buildDateOptionsForWeekdays(
  weekdays: number[],
  now = new Date(),
  maxOptions = 11,
  windowDays = meetingOptionsWindowDays
): Ec10MeetingDateOption[] {
  const today = getSaoPauloParts(now);
  const allowedWeekdays = new Set(weekdays);
  const options: Ec10MeetingDateOption[] = [];

  for (let offset = 1; offset <= windowDays && options.length < maxOptions; offset += 1) {
    const date = addLocalDays(today, offset);
    const weekday = getLocalWeekday(date.year, date.month, date.day);
    if (!allowedWeekdays.has(weekday)) continue;
    options.push({
      index: options.length + 1,
      isoDate: toIsoLocalDate(date.year, date.month, date.day),
      label: formatDateOptionLabel(date.year, date.month, date.day)
    });
  }

  return options;
}

export function buildMeetingDateOptions(
  now = new Date(),
  count = 5,
  serviceInterest?: ServiceInterest | null
): Ec10MeetingDateOption[] {
  if (isCareerMeetingService(serviceInterest)) {
    return buildDateOptionsForWeekdays([2, 4], now, 4);
  }

  if (isInternationalMeetingService(serviceInterest)) {
    return buildDateOptionsForWeekdays([1, 2, 3, 4, 5, 6], now, 11);
  }

  const today = getSaoPauloParts(now);
  const options: Ec10MeetingDateOption[] = [];
  let offset = 1;

  while (options.length < count && offset < 30) {
    const date = addLocalDays(today, offset);
    const weekday = getLocalWeekday(date.year, date.month, date.day);
    if (weekday !== 0 && weekday !== 6) {
      options.push({
        index: options.length + 1,
        isoDate: toIsoLocalDate(date.year, date.month, date.day),
        label: formatDateOptionLabel(date.year, date.month, date.day)
      });
    }
    offset += 1;
  }

  return options;
}

export function buildMeetingDateQuestion(options: Ec10MeetingDateOption[]) {
  return [
    "Vamos marcar uma reuniao. Primeiro escolha a melhor data:",
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Nao posso em nenhuma dessas datas`
  ].join("\n");
}

export const meetingDatePollQuestion = "Vamos marcar uma reuniao. Primeiro escolha a melhor data:";

export const meetingPresencePollQuestion = "Voce confirma sua presenca na reuniao EC10?";
export const meetingPresencePollOptions = [
  "CONFIRMO MINHA PRESENÇA",
  "QUERO REAGENDAR",
  "NÃO PODEREI PARTICIPAR"
];

export type MeetingPresenceChoice = "confirm" | "reschedule" | "cannot_attend";

export function classifyMeetingPresenceChoice(input: string | null | undefined): MeetingPresenceChoice | null {
  const text = normalizeText(stripLeadingChoiceNumber(input ?? ""));
  if (!text) return null;

  if (
    /\b(confirmo|confirmado|confirmada|presenca confirmada|vou participar|estarei presente|ok|okay|sim)\b/.test(text)
    && !/\b(nao|n)\b/.test(text)
  ) {
    return "confirm";
  }

  if (/\b(reagendar|remarcar|trocar horario|mudar horario|outro horario|outra data)\b/.test(text)) {
    return "reschedule";
  }

  if (
    /\b(nao poderei participar|nao vou participar|nao posso participar|nao consigo participar)\b/.test(text)
    || /\bnao (poderei|posso|vou conseguir|consigo) (ir|comparecer|entrar|estar|participar)(?:\b| .*reuniao| .*meet| .*chamada)/.test(text)
    || /\b(vou faltar|preciso cancelar|cancelar a reuniao|cancela a reuniao|cancelar o meet|cancela o meet|nao poderei ir|nao poderei comparecer)\b/.test(text)
  ) {
    return "cannot_attend";
  }

  return null;
}

export function buildMeetingPresencePollBody() {
  return [
    meetingPresencePollQuestion,
    ...meetingPresencePollOptions.map((option, index) => `${index + 1}. ${option}`)
  ].join("\n");
}

export function buildMeetingDatePollOptions(options: Ec10MeetingDateOption[]) {
  return [
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Nao posso em nenhuma dessas datas`
  ];
}

export function buildMeetingTimePollOptions(options: Ec10MeetingTimeOption[]) {
  return [
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Nao posso em nenhum desses horarios`
  ];
}

export function parseMeetingDateChoice(input: string | null | undefined, options: Ec10MeetingDateOption[], now = new Date()) {
  const text = normalizeText(input);
  const today = getSaoPauloParts(now);

  if (hasExplicitMeetingDateExpression(text)) {
    const customDate = extractCustomDate(text, today) ?? extractMeetingDate(text, today, { hour: latestMeetingStartHour, minute: 0 });
    if (!customDate) {
      return { ok: false as const, reason: "invalid_date", message: ec10Messages.invalidMeetingDate };
    }

    const weekday = getLocalWeekday(customDate.year, customDate.month, customDate.day);
    if (weekday === 0 || weekday === 6) {
      return { ok: false as const, reason: "weekend", message: ec10Messages.outsideBusinessHours };
    }

    const candidate = localToUtcDate(customDate.year, customDate.month, customDate.day, latestMeetingStartHour, 0);
    if (candidate.getTime() <= now.getTime()) {
      return { ok: false as const, reason: "past_date", message: ec10Messages.invalidMeetingDate };
    }

    return {
      ok: true as const,
      none: false as const,
      option: {
        index: 0,
        isoDate: toIsoLocalDate(customDate.year, customDate.month, customDate.day),
        label: formatDateOptionLabel(customDate.year, customDate.month, customDate.day)
      }
    };
  }

  const selectedNumber = extractChoiceNumber(text);
  if (selectedNumber === options.length + 1 || /\b(nao posso|nenhuma dessas|outra data)\b/.test(text)) {
    return { ok: true as const, none: true as const };
  }

  const option = selectedNumber ? options.find((item) => item.index === selectedNumber) : null;
  if (option) return { ok: true as const, none: false as const, option };

  const customDate = extractCustomDate(text, today) ?? extractMeetingDate(text, today, { hour: latestMeetingStartHour, minute: 0 });
  if (!customDate) {
    return { ok: false as const, reason: "invalid_date", message: ec10Messages.invalidMeetingDate };
  }

  const weekday = getLocalWeekday(customDate.year, customDate.month, customDate.day);
  if (weekday === 0 || weekday === 6) {
    return { ok: false as const, reason: "weekend", message: ec10Messages.outsideBusinessHours };
  }

  const candidate = localToUtcDate(customDate.year, customDate.month, customDate.day, latestMeetingStartHour, 0);
  if (candidate.getTime() <= now.getTime()) {
    return { ok: false as const, reason: "past_date", message: ec10Messages.invalidMeetingDate };
  }

  return {
    ok: true as const,
    none: false as const,
    option: {
      index: 0,
      isoDate: toIsoLocalDate(customDate.year, customDate.month, customDate.day),
      label: formatDateOptionLabel(customDate.year, customDate.month, customDate.day)
    }
  };
}

function buildTimeRangeOptions(startHour: number, endHourExclusive: number) {
  const options: Ec10MeetingTimeOption[] = [];
  for (let hour = startHour; hour < endHourExclusive; hour += 1) {
    options.push({
      index: options.length + 1,
      hour,
      label: `${formatHour(hour)}-${formatHour(hour + 1)}`
    });
  }
  return options;
}

function buildInternationalMeetingTimeOptions(dateOption?: Ec10MeetingDateOption | null): Ec10MeetingTimeOption[] {
  if (!dateOption?.isoDate) return buildTimeRangeOptions(8, 17);
  const { year, month, day } = parseIsoLocalDate(dateOption.isoDate);
  const weekday = getLocalWeekday(year, month, day);
  const hours = new Set<number>();
  const addRange = (startHour: number, endHourExclusive: number) => {
    for (let hour = startHour; hour < endHourExclusive; hour += 1) hours.add(hour);
  };

  // Pablo: seg/ter/qui 8-16, qua/sex 8-14, sab 8-12.
  if (weekday === 1 || weekday === 2 || weekday === 4) addRange(8, 16);
  if (weekday === 3 || weekday === 5) addRange(8, 14);
  if (weekday === 6) addRange(8, 12);

  // Igor: ter/qua/qui/sex 10-17.
  if (weekday >= 2 && weekday <= 5) addRange(10, 17);

  return [...hours]
    .sort((left, right) => left - right)
    .map((hour, index) => ({
      index: index + 1,
      hour,
      label: `${formatHour(hour)}-${formatHour(hour + 1)}`
    }));
}

export function buildMeetingTimeOptions(
  dateOption?: Ec10MeetingDateOption | null,
  serviceInterest?: ServiceInterest | null
): Ec10MeetingTimeOption[] {
  if (isCareerMeetingService(serviceInterest)) {
    return [{ index: 1, hour: 20, label: "20h-21h" }];
  }

  if (isInternationalMeetingService(serviceInterest)) {
    return buildInternationalMeetingTimeOptions(dateOption);
  }

  return buildTimeRangeOptions(businessStartHour, latestMeetingStartHour + 1);
}

export function filterAvailableMeetingTimeOptions(options: Ec10MeetingTimeOption[], bookedStarts: string[]) {
  const bookedHours = new Set(
    bookedStarts
      .map((startsAt) => getSaoPauloParts(new Date(startsAt)))
      .filter((parts) => Number.isFinite(parts.hour) && parts.minute === 0)
      .map((parts) => parts.hour)
  );
  return options
    .filter((option) => !bookedHours.has(option.hour))
    .map((option, index) => ({ ...option, index: index + 1 }));
}

export function buildMeetingTimeQuestion(dateOption: Ec10MeetingDateOption, options: Ec10MeetingTimeOption[]) {
  return [
    `Perfeito. Para ${dateOption.label}, escolha o melhor horario:`,
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Nao posso em nenhum desses horarios`
  ].join("\n");
}

export function parseMeetingTimeChoice(input: string | null | undefined, options: Ec10MeetingTimeOption[]) {
  const text = normalizeText(input);
  if (hasExplicitMeetingTimeExpression(text)) {
    const time = extractMeetingTime(text);
    if (!time || !isBusinessMeetingStart(time.hour, time.minute)) {
      return { ok: false as const, reason: "invalid_time", message: ec10Messages.invalidMeetingTimeOption };
    }

    return buildCustomTimeChoice(time.hour, time.minute);
  }

  const directTime = extractBareMeetingTime(text);
  if (directTime) {
    const shouldTreatAsOption = directTime.hour < businessStartHour && directTime.hour <= options.length && /^(?:0?[1-9])$/.test(text);
    if (!isBusinessMeetingStart(directTime.hour, directTime.minute) && !shouldTreatAsOption) {
      return { ok: false as const, reason: "invalid_time", message: ec10Messages.invalidMeetingTimeOption };
    }
    if (!shouldTreatAsOption) {
      return buildCustomTimeChoice(directTime.hour, directTime.minute);
    }
  }

  const selectedNumber = extractChoiceNumber(text);
  if (selectedNumber === options.length + 1 || /\b(nao posso|nenhum desses|outro horario)\b/.test(text)) {
    return { ok: true as const, none: true as const };
  }

  const option = selectedNumber ? options.find((item) => item.index === selectedNumber) : null;
  if (option) return { ok: true as const, none: false as const, option };

  const time = extractMeetingTime(text);
  if (!time || !isBusinessMeetingStart(time.hour, time.minute)) {
    return { ok: false as const, reason: "invalid_time", message: ec10Messages.invalidMeetingTimeOption };
  }

  return buildCustomTimeChoice(time.hour, time.minute);
}

export function buildScheduleFromOptions(dateOption: Ec10MeetingDateOption, timeOption: Ec10MeetingTimeOption & { minute?: number }, now = new Date()) {
  const dateParts = parseIsoLocalDate(dateOption.isoDate);
  const minute = timeOption.minute ?? 0;
  const startsAtDate = localToUtcDate(dateParts.year, dateParts.month, dateParts.day, timeOption.hour, minute);
  if (startsAtDate.getTime() <= now.getTime()) {
    return { ok: false as const, reason: "past_time", message: ec10Messages.invalidMeetingTimeOption };
  }

  const endsAtDate = new Date(startsAtDate.getTime() + meetingDurationMinutes * 60 * 1000);
  return {
    ok: true as const,
    schedule: {
      startsAt: startsAtDate.toISOString(),
      endsAt: endsAtDate.toISOString(),
      dateLabel: formatDateLabel(startsAtDate),
      timeLabel: `${formatTimeLabel(startsAtDate)} as ${formatTimeLabel(endsAtDate)}`,
      timezone: saoPauloTimezone
    }
  };
}

export function parseEc10MeetingSchedule(input: string | null | undefined, now = new Date()) {
  const text = normalizeText(input);
  const time = extractMeetingTime(text);
  if (!time) {
    return { ok: false as const, reason: "missing_time", message: ec10Messages.invalidMeetingTime };
  }

  const today = getSaoPauloParts(now);
  const dateParts = extractMeetingDate(text, today, time) ?? pickDefaultMeetingDate(today, time, now);
  const weekday = getLocalWeekday(dateParts.year, dateParts.month, dateParts.day);
  if (weekday === 0 || weekday === 6) {
    return { ok: false as const, reason: "weekend", message: ec10Messages.outsideBusinessHours };
  }

  if (!isBusinessMeetingStart(time.hour, time.minute)) {
    return { ok: false as const, reason: "outside_business_hours", message: ec10Messages.outsideBusinessHours };
  }

  const startsAtDate = localToUtcDate(dateParts.year, dateParts.month, dateParts.day, time.hour, time.minute);
  if (startsAtDate.getTime() <= now.getTime()) {
    return { ok: false as const, reason: "past_time", message: ec10Messages.invalidMeetingTime };
  }

  const endsAtDate = new Date(startsAtDate.getTime() + meetingDurationMinutes * 60 * 1000);
  return {
    ok: true as const,
    schedule: {
      startsAt: startsAtDate.toISOString(),
      endsAt: endsAtDate.toISOString(),
      dateLabel: formatDateLabel(startsAtDate),
      timeLabel: `${formatTimeLabel(startsAtDate)} as ${formatTimeLabel(endsAtDate)}`,
      timezone: saoPauloTimezone
    }
  };
}

export function buildMeetingConfirmationMessage(
  schedule: Ec10MeetingSchedule,
  _meetUrl: string | null,
  sellerNotified = true,
  sellerName = "Igor Jardins"
) {
  const linkLine = "Voce nao precisa entrar no Meet agora. O link da sala sera enviado por aqui 10 minutos antes do horario marcado.";
  const sellerLine = sellerNotified
    ? `O ${sellerName} recebeu a data e o horario pelo WhatsApp.`
    : `A reuniao ficou registrada, mas o aviso para o ${sellerName} precisa ser reenviado pelo painel.`;

  return [
    `Reuniao marcada para ${schedule.dateLabel}, das ${schedule.timeLabel}.`,
    linkLine,
    sellerLine
  ].join("\n");
}

export function buildSellerMeetingMessage(input: {
  leadPhone: string;
  leadName?: string | null;
  flowLabel?: string | null;
  roleAnswer?: string | null;
  athleteAge?: number | null;
  serviceInterest?: ServiceInterest | null;
  leadPageUrl?: string | null;
  schedule: Ec10MeetingSchedule;
  meetUrl: string | null;
}) {
  return [
    input.flowLabel ? `Novo agendamento - ${input.flowLabel}` : "Novo agendamento EC10 Talentos",
    input.leadName ? `Nome: ${input.leadName}` : null,
    `Lead: +${input.leadPhone}`,
    input.roleAnswer ? `Perfil: ${input.roleAnswer}` : null,
    input.athleteAge ? `Idade do atleta: ${input.athleteAge}` : null,
    input.serviceInterest ? `Servico: ${input.serviceInterest}` : null,
    input.leadPageUrl ? "Origem da página registrada no CRM" : null,
    `Reuniao: ${input.schedule.dateLabel}, das ${input.schedule.timeLabel}`,
    input.meetUrl ? `Google Meet: ${input.meetUrl}` : "Google Meet: link pendente de configuracao no CRM"
  ].filter(Boolean).join("\n");
}

function buildLeadPageUrl(baseUrl: string, age: number, section: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("idade", String(age));
  url.searchParams.set("origem", "whatsapp");
  if (section) url.hash = section;
  return url.toString();
}

function extractBirthYear(text: string) {
  const explicit = text.match(/\b(?:nascid[oa]\s+em|nasceu\s+em|ano\s+de\s+nascimento|ano)\s+(19\d{2}|20\d{2})\b/);
  const bare = text.match(/^\s*(19\d{2}|20\d{2})\s*$/);
  const year = explicit?.[1] ?? bare?.[1];
  if (!year) return null;

  const birthYear = Number.parseInt(year, 10);
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;
  return age >= 1 && age <= 40 ? age : null;
}

function isNonAgeNumberContext(text: string, index: number, value: string) {
  const before = text.slice(Math.max(0, index - 24), index).trim();
  const after = text.slice(index + value.length, index + value.length + 18).trim();

  if (/(camisa|numero da camisa|nota|valor|preco|preço|r\$|rs|telefone|celular|whatsapp|zap|opcao|opção|numero)$/.test(before)) return true;
  if (/^(reais|real|rs|r\$|anos? de contrato|parcelas?|vezes|filh[oa]s?|atletas?)\b/.test(after)) return true;
  if (/\b(r\$|rs)\s*$/.test(before)) return true;
  return false;
}

function scoreAgeNumberContext(text: string, index: number, value: string) {
  const before = text.slice(Math.max(0, index - 32), index).trim();
  const after = text.slice(index + value.length, index + value.length + 24).trim();
  let score = 0;

  if (/^(anos?|anos? completos?)\b/.test(after)) score += 12;
  if (/(idade|idade do atleta|tem|fez|com|de|atleta de|filh[oa] de|sub\s*-?)\s*$/.test(before)) score += 8;
  if (/(camisa|nota|valor|telefone|celular|whatsapp|zap|opcao|opção)\s*$/.test(before)) score -= 20;
  if (/^(reais|real|filh[oa]s?|atletas?)\b/.test(after)) score -= 20;
  if (Number.parseInt(value, 10) >= 8 && Number.parseInt(value, 10) <= 30) score += 1;
  return score;
}

function buildCustomTimeChoice(hour: number, minute: number) {
  return {
    ok: true as const,
    none: false as const,
    option: {
      index: 0,
      hour,
      label: `${formatTime(hour, minute)}-${formatTime(hour + 1, minute)}`,
      minute
    }
  };
}

function extractMeetingTime(text: string) {
  const written = writtenMeetingHours.find(([pattern]) => pattern.test(text));
  if (written) {
    return { hour: written[1], minute: 0 };
  }

  const match = text.match(/\b([01]?\d|2[0-3])\s*(?:h|:|horas?)\s*([0-5]\d)?\b/);
  if (!match) {
    return extractBareMeetingTime(text);
  }
  return {
    hour: Number.parseInt(match[1], 10),
    minute: match[2] ? Number.parseInt(match[2], 10) : 0
  };
}

function extractBareMeetingTime(text: string) {
  const bareHour = text.match(/^(?:as\s+)?([01]?\d|2[0-3])$/);
  if (!bareHour) return null;
  return {
    hour: Number.parseInt(bareHour[1], 10),
    minute: 0
  };
}

function extractChoiceNumber(text: string) {
  const match = text.match(/(?:^|\b)(?:opcao\s*)?(\d{1,2})(?:\b|$)/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function stripLeadingChoiceNumber(text: string) {
  return text.replace(/^(?:opcao\s*)?0?\d{1,2}\s*[\).:-]?\s*/, "").trim();
}

function hasExplicitMeetingDateExpression(text: string) {
  return /\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/.test(text)
    || /\b(depois de amanha|amanha|hoje|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/.test(text);
}

function hasExplicitMeetingTimeExpression(text: string) {
  return writtenMeetingHours.some(([pattern]) => pattern.test(text))
    || /\b([01]?\d|2[0-3])\s*(?:h|:|horas?)\s*([0-5]\d)?\b/.test(text);
}

function extractCustomDate(text: string, today: LocalDateParts) {
  const numeric = text.match(/\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/);
  if (!numeric) return null;

  const day = Number.parseInt(numeric[1], 10);
  const month = Number.parseInt(numeric[2], 10);
  let year = numeric[3] ? Number.parseInt(numeric[3], 10) : today.year;
  if (year < 100) year += 2000;
  if (!isValidLocalDate(year, month, day)) return null;

  if (!numeric[3]) {
    const selectedDate = localToUtcDate(year, month, day, 23, 59);
    const todayEnd = localToUtcDate(today.year, today.month, today.day, 23, 59);
    if (selectedDate.getTime() < todayEnd.getTime()) year += 1;
  }

  return { year, month, day };
}

function extractMeetingDate(text: string, today: LocalDateParts, time: { hour: number; minute: number }) {
  const numeric = text.match(/\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number.parseInt(numeric[1], 10);
    const month = Number.parseInt(numeric[2], 10);
    let year = numeric[3] ? Number.parseInt(numeric[3], 10) : today.year;
    if (year < 100) year += 2000;
    if (!isValidLocalDate(year, month, day)) return null;
    const candidate = localToUtcDate(year, month, day, time.hour, time.minute);
    if (!numeric[3] && candidate.getTime() <= localToUtcDate(today.year, today.month, today.day, today.hour, today.minute).getTime()) {
      year += 1;
    }
    return { year, month, day };
  }

  if (text.includes("depois de amanha")) return addLocalDays(today, 2);
  if (text.includes("amanha")) return addLocalDays(today, 1);
  if (text.includes("hoje")) return { year: today.year, month: today.month, day: today.day };

  const weekday = extractWeekday(text);
  if (weekday !== null) {
    const todayWeekday = getLocalWeekday(today.year, today.month, today.day);
    let delta = (weekday - todayWeekday + 7) % 7;
    if (delta === 0) delta = 7;
    return addLocalDays(today, delta);
  }

  return null;
}

function pickDefaultMeetingDate(today: LocalDateParts, time: { hour: number; minute: number }, now: Date) {
  let candidate = { year: today.year, month: today.month, day: today.day };
  let startsAt = localToUtcDate(candidate.year, candidate.month, candidate.day, time.hour, time.minute);

  for (let offset = 0; offset < 10; offset += 1) {
    const weekday = getLocalWeekday(candidate.year, candidate.month, candidate.day);
    if (weekday !== 0 && weekday !== 6 && startsAt.getTime() > now.getTime()) return candidate;
    candidate = addLocalDays(today, offset + 1);
    startsAt = localToUtcDate(candidate.year, candidate.month, candidate.day, time.hour, time.minute);
  }

  return candidate;
}

function extractWeekday(text: string) {
  const weekdays: Array<[string, number]> = [
    ["domingo", 0],
    ["segunda", 1],
    ["terca", 2],
    ["terça", 2],
    ["quarta", 3],
    ["quinta", 4],
    ["sexta", 5],
    ["sabado", 6],
    ["sábado", 6]
  ];
  return weekdays.find(([label]) => text.includes(label))?.[1] ?? null;
}

function isBusinessMeetingStart(hour: number, minute: number) {
  if (minute !== 0) return false;
  if (hour < businessStartHour || hour > latestMeetingStartHour) return false;
  if (hour === latestMeetingStartHour && minute > 0) return false;
  return minute >= 0 && minute <= 59;
}

function toIsoLocalDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseIsoLocalDate(input: string) {
  const [year, month, day] = input.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day || !isValidLocalDate(year, month, day)) {
    throw new Error("Data de reuniao invalida.");
  }
  return { year, month, day };
}

function formatDateOptionLabel(year: number, month: number, day: number) {
  const date = localToUtcDate(year, month, day, 12, 0);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: saoPauloTimezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(date).replace(".", "");
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}h`;
}

function formatTime(hour: number, minute: number) {
  return minute ? `${String(hour).padStart(2, "0")}h${String(minute).padStart(2, "0")}` : formatHour(hour);
}

function getSaoPauloParts(date: Date): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: saoPauloTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function localToUtcDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour + saoPauloUtcOffsetHours, minute, 0, 0));
}

function addLocalDays(parts: Pick<LocalDateParts, "year" | "month" | "day">, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function getLocalWeekday(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).getUTCDay();
}

function isValidLocalDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function formatDateLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: saoPauloTimezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatTimeLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: saoPauloTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function normalizeText(input: string | null | undefined) {
  return (input ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
