export const GUSTAVO_SEQUENCE_VERSION = "career_audio_meeting_2026_09_18_v1";

export type GustavoSequencePhase =
  | "company_familiarity"
  | "identity_confirmation"
  | "identity"
  | "age"
  | "audio_delivery"
  | "audio_confirmation"
  | "meeting_interest"
  | "guardian_wait"
  | "booking_name"
  | "booking";

export type GustavoSpeakerRole = "atleta" | "responsavel";

export type GustavoSequenceIdentity = {
  registered: boolean;
  leadName: string | null;
  role: GustavoSpeakerRole | null;
  athleteAge: number | null;
};

export type GustavoCareerAudio = {
  label: string;
  audioPath: string;
};

function plainText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeGustavoSequencePhase(value: unknown): GustavoSequencePhase | null {
  return [
    "company_familiarity",
    "identity_confirmation",
    "identity",
    "age",
    "audio_delivery",
    "audio_confirmation",
    "meeting_interest",
    "guardian_wait",
    "booking_name",
    "booking",
  ].includes(String(value)) ? value as GustavoSequencePhase : null;
}

export function parseGustavoFamiliarity(value: string | null | undefined) {
  const text = plainText(value);
  if (!text) return null;
  if (/\b(nao conheco|nao conhecia|nunca ouvi|nunca vi|primeira vez|quero conhecer|quero saber|ainda nao)\b/.test(text)) return false;
  if (/^(nao|n|nn)$/.test(text)) return false;
  if (/\b(ja conheco|conheco sim|ja ouvi|ja vi|acompanho|sei o que voces fazem|sim conheco)\b/.test(text)) return true;
  if (/^(sim|s|ss|conheco)$/.test(text)) return true;
  return null;
}

export function parseGustavoRole(value: string | null | undefined): GustavoSpeakerRole | null {
  const text = plainText(value);
  if (!text) return null;
  if (/\b(sou (?:o |a )?(?:pai|mae|responsavel)|falo como responsavel|meu filho|minha filha|sou responsavel legal|responsavel por ele|responsavel por ela)\b/.test(text)) return "responsavel";
  if (/\b(sou (?:o |a )?atleta|o atleta sou eu|e pra mim|para mim mesmo|eu jogo|eu treino|sou jogador|sou jogadora)\b/.test(text)) return "atleta";
  if (/^(atleta|jogador|jogadora)$/.test(text)) return "atleta";
  if (/^(responsavel|pai|mae)$/.test(text)) return "responsavel";
  return null;
}

export function parseGustavoYesNo(value: string | null | undefined): boolean | null {
  const text = plainText(value);
  if (!text) return null;
  if (/^(sim|s|ss|claro|correto|certo|isso|isso mesmo|pode|pode sim|com certeza|quero|tenho interesse|vamos|bora)$/.test(text)) return true;
  if (/\b(quero marcar|quero agendar|pode mandar o link|vamos marcar|tenho interesse)\b/.test(text)) return true;
  if (/^(nao|n|nn|ainda nao|nao consegui|depois|agora nao|sem interesse)$/.test(text)) return false;
  if (/\b(nao ouvi|nao consegui ouvir|nao tenho interesse|nao quero|mais tarde)\b/.test(text)) return false;
  return null;
}

export function hasGustavoMeetingIntent(value: string | null | undefined) {
  return /\b(agendar|agendamento|agenda|marcar (?:a |uma )?reuniao|quero a reuniao|pode mandar o link|ver horarios)\b/.test(plainText(value));
}

export function extractExplicitGustavoAge(value: string | null | undefined) {
  const text = plainText(value);
  if (!text) return null;
  const direct = text.match(/^(?:tenho |ele tem |ela tem |o atleta tem |meu filho tem |minha filha tem )?(\d{1,2})(?: anos?)?$/);
  const contextual = text.match(/\b(?:idade (?:e |eh )?|tenho |tem |fez |faz |com )(\d{1,2})(?: anos?)?\b/)
    || text.match(/\b(\d{1,2}) anos?\b/);
  const age = Number(direct?.[1] || contextual?.[1] || 0);
  return Number.isInteger(age) && age >= 1 && age <= 99 ? age : null;
}

export function extractGustavoSelfName(value: string | null | undefined) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  const match = raw.match(/\b(?:meu nome (?:e|é)|me chamo|aqui (?:e|é)|sou o|sou a)\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,5})/iu);
  if (!match) return null;
  const candidate = match[1]
    .replace(/\s+(?:e|sou|tenho|meu|minha|pai|mae|responsavel|atleta)\b.*$/iu, "")
    .trim();
  if (!candidate || candidate.length > 80) return null;
  return candidate;
}

export function gustavoOpeningMessage(identity: GustavoSequenceIdentity) {
  const firstName = identity.leadName?.trim().split(/\s+/)[0] || "";
  return `Oi${firstName ? `, ${firstName}` : ""}! Sou o Gustavo, da EC10 Talentos. A gente ajuda atletas e familias a organizar a carreira no futebol, com planejamento e acompanhamento. Voce ja conhece a EC10 e o nosso trabalho?`;
}

export function gustavoIdentityPrompt(identity: GustavoSequenceIdentity) {
  if (!identity.role) return "Pra eu seguir do jeito certo: voce e o atleta ou o responsavel por ele?";
  const role = identity.role === "responsavel" ? "responsavel" : "atleta";
  const age = identity.athleteAge ? ` e o atleta tem ${identity.athleteAge} anos` : "";
  return `Encontrei no seu cadastro que voce e ${role}${age}. Continua correto?`;
}

export function gustavoAgePrompt(role: GustavoSpeakerRole | null) {
  return role === "atleta" ? "Pra eu te orientar pelo momento certo, quantos anos voce tem?" : "Pra eu te orientar pelo momento certo, qual e a idade do atleta?";
}

export function gustavoPlanIntroduction(age: number | null) {
  const ageContext = age ? ` Para o momento de um atleta de ${age} anos,` : "";
  return `${ageContext} o primeiro caminho na EC10 e o Plano de Carreira, porque ele organiza o desenvolvimento do atleta e os proximos passos junto com a familia. Vou te mandar agora alguns audios do nosso CEO, Eric Cena, explicando como funciona.`.trim();
}

export function gustavoPendingQuestion(phase: GustavoSequencePhase, identity: GustavoSequenceIdentity) {
  if (phase === "company_familiarity") return "Voce ja conhece a EC10 e o nosso trabalho?";
  if (phase === "identity_confirmation" || phase === "identity") return gustavoIdentityPrompt(identity);
  if (phase === "age") return gustavoAgePrompt(identity.role);
  if (phase === "audio_confirmation") return "Conseguiu ouvir os audios do Eric?";
  if (phase === "meeting_interest") return "Faz sentido marcar uma reuniao rapida com a nossa equipe para analisar o momento do atleta?";
  if (phase === "guardian_wait") return "O pai, a mae ou o responsavel legal pode continuar esta conversa por aqui e se identificar?";
  if (phase === "booking_name") return "Qual e o nome completo de quem vai participar da reuniao?";
  return "";
}

export function gustavoCareerAudios(age: number | null): GustavoCareerAudio[] {
  if (age && age >= 18) {
    return [
      { label: "18-plus-introducao-eric", audioPath: "media/audio/bot-principal/18-plus/01_18plus_0m26.ogg" },
      { label: "18-plus-plano-eric", audioPath: "media/audio/bot-principal/18-plus/02_18plus_1m54.ogg" },
    ];
  }
  if (age && age >= 13) {
    return [
      { label: "13-17-introducao-eric", audioPath: "media/audio/bot-principal/13-17-plano-carreira/01_intro_0m29.ogg" },
      { label: "13-17-plano-eric", audioPath: "media/audio/bot-principal/13-17-plano-carreira/02_plano_1m49.ogg" },
    ];
  }
  return [
    { label: "8-13-apresentacao-eric", audioPath: "media/audio/ec10/eric-2026-09-14/01_8-13_apresentacao.ogg" },
    { label: "8-13-plano-de-carreira-eric", audioPath: "media/audio/ec10/eric-2026-09-14/02_8-13_plano-de-carreira.ogg" },
  ];
}

export function isGustavoRegisteredIdentity(identity: GustavoSequenceIdentity) {
  return identity.registered && Boolean(identity.leadName || identity.role || identity.athleteAge);
}
