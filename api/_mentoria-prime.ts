import {
  buildMeetingDatePollOptions,
  buildMeetingDateOptions,
  meetingDatePollQuestion,
  type Ec10MeetingDateOption,
} from "../apps/bot/src/ec10-flow.js";

export const MENTORIA_PRIME_AUDIO_PATHS = {
  presentation: "media/audio/mentoria-prime/01_apresentacao_eric.ogg",
  sixMonthPlan: "media/audio/mentoria-prime/02_plano_seis_meses.ogg",
} as const;

const MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS = {
  welcome: 0,
  presentationAudio: 4,
  sixMonthPlanAudio: 10,
  plans: 16,
  meetingPoll: 22,
} as const;

export function buildMentoriaPrimeWelcome(name: string) {
  const firstName = name.trim().split(/\s+/)[0] || name.trim();
  return [
    `Olá, ${firstName}! Seu cadastro na Mentoria Esportiva Prime foi realizado com sucesso. ⚽`,
    "Em alguns instantes, nossa equipe continuará o atendimento por aqui. Enquanto isso, enviaremos uma breve apresentação para você conhecer o acompanhamento oferecido ao atleta.",
  ].join("\n\n");
}

export function buildMentoriaPrimePlansMessage() {
  return [
    "*PLANOS — MENTORIA ESPORTIVA PRIME*",
    "Acompanhamento completo por 6 meses.",
    "",
    "*PLANO BÁSICO*",
    "• 3 mentorias coletivas",
    "• 1 mentoria individual",
    "• Participação em palestras presenciais",
    "• Suporte mental individual, de segunda a sexta, das 8h às 19h",
    "• Suporte básico de marketing + 5 flyers de jogos",
    "• Grupo exclusivo com mensagens diárias de mentoria esportiva em áudio",
    "• Programa individual de treino de força e velocidade",
    "",
    "*PLANO INTERMEDIÁRIO*",
    "Inclui tudo do plano Básico, mais:",
    "• Análise individual de desempenho",
    "• Edição de vídeo com os melhores momentos",
    "",
    "*PLANO PREMIUM*",
    "Inclui tudo do plano Intermediário, mais:",
    "• Intercâmbio esportivo de 15 dias",
    "• Experiência em clubes parceiros, como Getafe, Argentinos Juniors, Atlético de Madrid, Sporting Gijón e Braga",
  ].join("\n");
}

export function buildMentoriaPrimeMeetingMessage(options: Ec10MeetingDateOption[]) {
  return [
    "*AGENDAMENTO DA REUNIÃO* 📅",
    "Para conhecer o plano mais indicado e tirar suas dúvidas, escolha a melhor data para uma reunião on-line pelo Google Meet:",
    "",
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Não posso em nenhuma dessas datas`,
    "",
    "Responda com o número da opção ou envie outra data no formato DD/MM.",
  ].join("\n");
}

export type MentoriaPrimeSequenceItem = {
  body: string | null;
  mediaType: "text" | "audio" | "poll";
  mediaPath: string | null;
  delaySeconds: number;
  pollQuestion?: string | null;
  pollOptions?: string[] | null;
};

export function buildMentoriaPrimeSequence(name: string, now = new Date()) {
  const meetingDateOptions = buildMeetingDateOptions(now);
  const items: MentoriaPrimeSequenceItem[] = [
    {
      body: buildMentoriaPrimeWelcome(name),
      mediaType: "text",
      mediaPath: null,
      delaySeconds: MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS.welcome,
    },
    {
      body: null,
      mediaType: "audio",
      mediaPath: MENTORIA_PRIME_AUDIO_PATHS.presentation,
      delaySeconds: MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS.presentationAudio,
    },
    {
      body: null,
      mediaType: "audio",
      mediaPath: MENTORIA_PRIME_AUDIO_PATHS.sixMonthPlan,
      delaySeconds: MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS.sixMonthPlanAudio,
    },
    {
      body: buildMentoriaPrimePlansMessage(),
      mediaType: "text",
      mediaPath: null,
      delaySeconds: MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS.plans,
    },
    {
      body: buildMentoriaPrimeMeetingMessage(meetingDateOptions),
      mediaType: "poll",
      mediaPath: null,
      delaySeconds: MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS.meetingPoll,
      pollQuestion: meetingDatePollQuestion,
      pollOptions: buildMeetingDatePollOptions(meetingDateOptions),
    },
  ];

  return {
    items,
    meetingDateOptions,
    meetingPromptScheduledAt: new Date(now.getTime() + MENTORIA_PRIME_SEQUENCE_DELAYS_SECONDS.meetingPoll * 1_000).toISOString(),
  };
}
