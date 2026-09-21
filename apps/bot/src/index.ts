import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import {createHash} from "node:crypto";
import {AsyncLocalStorage} from 'node:async_hooks';
import QRCode from "qrcode";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { normalizePhone, resolveBrazilTrafficGeo } from "@crm/shared";
import {
  classifyFoundationStatusWithAi,
  classifyInterestWithAi,
  answerGustavoSequenceQuestion,
  extractAthleteAgeWithAi,
  generateEc10SalesReplyWithAi,
  isAiLeadQualifiedForMeeting,
  selectEricAudioPathForAiReply,
  configuredAiPlatform,
  isBotAiEnabled,
  recoverEc10FlowWithAi,
  type AiSalesProfile,
  type BotRecoveryResult,
  transcribeAudioWithAi
} from "./ai.js";
import {answerEc10SdrQuestion} from './ai.js';
import {SDR_VERSION, decideEc10Sdr, sdrServiceMenu, sdrOffer, eligibleSdrOffers, explicitSdrHuman, explicitSdrStop, sdrGreeting, type SdrStep} from './sdr-flow.js';
import { config, hasDirectDatabaseConfig, hasServerSupabaseConfig } from "./config.js";
import { conversationRole } from './ec10-learning.mjs';
import { sendMetaQualityEvent } from "./meta.js";
import { normalizePollVote, pollParentId, pollVoteMessageId, readWhatsAppPollVotes, serializeWhatsAppKey } from './poll-votes.js';
import {parseBookingContactName,selectBookingContactName} from './booking-contact.js';
import {
  GUSTAVO_SEQUENCE_VERSION,
  extractExplicitGustavoAge,
  extractGustavoSelfName,
  gustavoAgePrompt,
  gustavoCareerAudios,
  gustavoIdentityPrompt,
  gustavoOpeningMessage,
  gustavoPendingQuestion,
  gustavoPlanIntroduction,
  hasGustavoMeetingIntent,
  normalizeGustavoSequencePhase,
  parseGustavoFamiliarity,
  parseGustavoRole,
  parseGustavoYesNo,
  type GustavoSequenceIdentity,
  type GustavoSequencePhase,
  type GustavoSpeakerRole,
} from './gustavo-sequence.js';
import {
  buildMeetingConfirmationMessage,
  buildMeetingDateOptions,
  buildMeetingDateQuestion,
  buildMeetingPresencePollBody,
  buildSellerMeetingMessage,
  buildMeetingTimeOptions,
  buildMeetingTimeQuestion,
  classifyMeetingPresenceChoice,
  buildScheduleFromOptions,
  ec10Messages,
  shouldSendEc10Welcome,
  isEurocampAudio,
  canSendEc10Audio,
  filterAvailableMeetingTimeOptions,
  extractAthleteAge,
  getEc10LeadPlan,
  isAgeQuestionDetour,
  isExplicitStopRequest,
  isNegativeInterest,
  isNegativeBotInterest,
  isGuardianConfirmation,
  isGuardianDenial,
  isPositiveInterest,
  isYesNoPollReply,
  isAudioSequenceInProgressMetadata,
  isRevelaTalentosEntry,
  isRestartCommand,
  isStaleFoundationReplyAfterStageAdvance,
  isUnknownFoundationStatus,
  parseFoundationStatus,
  shouldAskFoundationStatus,
  parseEc10MeetingSchedule,
  parseMeetingDateChoice,
  parseMeetingTimeChoice,
  wasPromptSentRecently,
  type Ec10MeetingDateOption,
  type Ec10MeetingSchedule,
  type Ec10MeetingTimeOption,
  type Ec10FlowKind,
  type Ec10LeadPlan,
  type Ec10ConversationStage
} from "./ec10-flow.js";
import {
  assignClientToSellerByName,
  appendClientTags,
  cancelQueuedFollowUpMessages,
  cancelQueuedMeetingMessages,
  checkBotPersistenceHealth,
  countRecentOutboundChatMessages,
  fetchActiveBotRules,
  fetchQueuedOutboundMessages,
  fetchRecentInboundRecoveryCandidates,
  fetchPendingWhatsAppPolls,
  createBotBookingLink,
  fetchBookedEc10MeetingStarts,
  fetchFutureEc10MeetingSellerCounts,
  fetchPendingCareerMeetingGroupStates,
  fetchDueGustavoRecoveryStates,
  fetchRecentClientMessages,
  fetchEc10LearningBase,
  fetchBotLabWhatsappMessages,
  hasClientOutboundMessages,
  downloadWhatsappMedia,
  findMatchingRule,
  getBotRuntime,
  getClientAutomationStateById,
  getClientAutomationStateByPhone,
  getBotConversationState,
  getClientTrafficAttribution,
  hasRecentOutboundChatMessage,
  findActiveBotLabWhatsappTester,
  getOrCreateBotLabWhatsappSession,
  markClientForFollowUp,
  markOutboundMessage,
  recordOutboundChatMessage,
  recordIncomingWhatsAppCall,
  recordBotLabWhatsappMessage,
  recordQueuedOutboundDelivery,
  recordWhatsAppMessageAck,
  recordTrafficEvent,
  requeueOutboundMessage,
  scheduleOutboundAudioMessage,
  saveBotConversationState,
  scheduleOutboundPollMessage,
  scheduleOutboundRecoveryTextMessage,
  scheduleOutboundTextMessage,
  shouldSendRuleResponse,
  tryAcquireBotDedupeLock,
  type ClientAutomationState,
  type Ec10MeetingRoute,
  type BotConversationState,
  type BotLabWhatsappTester,
  updateClientEc10Profile,
  updateBotLabWhatsappSession,
  updateClientFoundationStatus,
  updateClientAiProfile,
  storeInboundWhatsappMedia,
  upsertBotRuntime,
  upsertInboundMessage,
  touchBotLabWhatsappTester
} from "./store.js";

const { Client, LocalAuth, MessageMedia, Poll } = pkg;
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const conversationLocks = new Map<string, Promise<void>>();
const sdrOutboundContext=new AsyncLocalStorage<{clientId:string;turn:string;maxOutbound:number;learning?:{stage:string;age:number|null;role:string;message:string|null};learningUsed?:boolean}>();
function botPhoneAliases(value:string|null|undefined) {
  const phone=normalizePhone(value||'',config.BOT_DEFAULT_COUNTRY_CODE);
  const aliases=new Set(phone?[phone]:[]);
  if(phone.startsWith(config.BOT_DEFAULT_COUNTRY_CODE)) {
    const prefix=config.BOT_DEFAULT_COUNTRY_CODE;
    const national=phone.slice(prefix.length);
    if(national.length===11&&national[2]==='9')aliases.add(`${prefix}${national.slice(0,2)}${national.slice(3)}`);
    if(national.length===10)aliases.add(`${prefix}${national.slice(0,2)}9${national.slice(2)}`);
  }
  return aliases;
}
const botTestAllowedPhones=new Set(config.BOT_TEST_ALLOWED_PHONES.split(',').flatMap(phone=>[...botPhoneAliases(phone)]));
function isBotTestPhoneAllowed(phone:string|null|undefined) {
  return botTestAllowedPhones.size===0||[...botPhoneAliases(phone)].some(alias=>botTestAllowedPhones.has(alias));
}
async function withSdrCustomerTurn<T>(clientId:string,phone:string,work:()=>Promise<T>) {
  const history=await fetchRecentClientMessages(clientId,24);
  const incoming=history.filter(m=>m.direction==='inbound');
  const turn=incoming.at(-1)?.createdAt;
  const recentIncoming=incoming.filter(m=>Date.parse(m.createdAt)>Date.now()-config.WHATSAPP_RATE_LIMIT_WINDOW_MINUTES*60_000).length;
  if(!turn)return work();
  const state = await getBotConversationState(phone);
  const metadata = asMetadataRecord(state?.metadata);
  const discovery = state?.stage === 'awaiting_age' && metadata.andersonDiscoveryStep !== 'awaiting_age_natural';
  const message = incoming.at(-1)?.body || null;
  const learning = {stage:discovery?'discovery':state?.stage==='awaiting_age'?'awaiting_age':state?.stage==='awaiting_interest'?'diagnosing':state?.stage || 'discovery',
    age:state?.athlete_age || extractAthleteAge(message) || null,
    role:conversationRole(message,inferAndersonSpeakerRole(message) || state?.role_answer || 'outro',history),message};
  return sdrOutboundContext.run({clientId,turn,learning,maxOutbound:Math.max(config.WHATSAPP_MAX_OUTBOUND_PER_CONTACT_WINDOW,8+recentIncoming*3)},work);
}
const outboundSendLocks = new Map<string, Promise<void>>();
const careerMeetingGroupLocks = new Map<string, Promise<CareerMeetingGroupResult>>();
let currentBotStatus = "not_ready";
let currentBotStatusDetails: Record<string, unknown> = {};
let statusHeartbeat: ReturnType<typeof setInterval> | null = null;
let lastQrRuntimePersistAt = 0;
let reconnectingClient = false;
let whatsappReady = false;
let processingOutboundQueue = false;
let processingCareerGroupRepair = false;
let processingPollRecovery = false;
let processingGustavoRecovery = false;
let processingInboundRecovery = false;
let startupInboundRecoveryPending = true;
let lastInboundPersistenceFailureAt = 0;
let lastInboundRecoveryAt = 0;
const pollRecoveryCheckedAt = new Map<string, number>();
let lastReadyMaintenanceAt = 0;
let aiFallbackUsage = { day: "", count: 0 };
let processErrorGuardsInstalled = false;
let activeWhatsAppClient: any = null;
let activeWhatsAppClientGeneration = 0;
let readySinceMs = 0;
let currentWhatsAppState: string | null = null;
let lastHeavyWhatsAppOperationAt = 0;
let whatsappSafeModeUntilMs = 0;
let whatsappSafeModeReason: string | null = null;
let lastOutboundPauseLogAt = 0;
const recentLogoutTimestamps: number[] = [];
const careerMeetingGroupsEnabled = false;

type WhatsAppAckWaiter = {
  minAck: number;
  resolve: (ack: number | null) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const whatsappAckWaiters = new Map<string, WhatsAppAckWaiter[]>();

type BotRuntimeControl = {
  outboundQueueEnabled: boolean;
  groupAutomationEnabled: boolean;
  heavyWhatsAppOpsEnabled: boolean;
  pauseReason: string | null;
  manualSafeModeUntilMs: number;
  outboundQueuePausedUntilMs: number;
};

let botRuntimeControlCache: { expiresAt: number; value: BotRuntimeControl } | null = null;

const revelaCampaignTag = "campanha_revela_prioritario";
const revelaCampaignPollSentTag = "campanha_revela_enquete_enviada";
const revelaCampaignIgorSentTag = "campanha_revela_igor_enviado";
const revelaCampaignAutomationEnabled = process.env.REVELA_CAMPAIGN_AUTOMATION_ENABLED === "true";
const revelaCampaignPollQuestion = "Ainda restou alguma d\u00favida ou voc\u00ea quer conhecer melhor a plataforma?";
const revelaCampaignPollOptions = ["Fiquei com d\u00favida", "Quero conhecer melhor"];
const igorContactMessage = [
  "Perfeito. Para tirar sua d\u00favida e te orientar melhor, fale direto com nosso vendedor Igor Jardins:",
  "https://wa.me/553182331411"
].join("\n");
const ec10MeetingScheduledTag = "ec10_reuniao_agendada";
const ec10GoogleMeetUrl = config.EC10_GOOGLE_MEET_URL?.trim() || null;
const meetingReminderLeadMinutes = Number(process.env.MEETING_REMINDER_LEAD_MINUTES || 10);
const meetingDeclinedFollowUpTags = ["reuniao_recusada", "follow_up_consultivo"];
const foundationStatusPollQuestion = "Pra entender o momento do atleta: ele joga em clube federado ou treina em escolinha/projeto?";
const foundationStatusPollOptions = ["Clube federado", "Escolinha ou projeto"];
const interestPollQuestion = "Voce tem interesse em saber mais e marcar uma reuniao?";
const interestPollOptions = ["Sim", "Nao"];
const guardianPollQuestion = "Antes de abrir a agenda: estou falando com o pai, a mae ou o responsavel legal do atleta?";
const guardianPollOptions = ["Sim, sou responsavel", "Nao"];
const meetingDatePollQuestion = "Vamos marcar uma reuniao. Primeiro escolha a melhor data:";
const ec10FollowUpMarkerPrefix = "ec10_followup:meeting";
const meetingPresenceAudioPath = "media/audio/bot-principal/meeting_presence_cannot_attend_eric_cena_opus.ogg";
const meetingPresenceConfirmedTag = "ec10_presenca_confirmada";
const meetingPresenceRescheduleTag = "ec10_presenca_reagendar";
const meetingPresenceCannotAttendTag = "ec10_nao_podera_participar";

type Ec10FollowUpStep = {
  step: number;
  delayMinutes: number;
  text: (leadName?: string | null) => string;
  pollQuestion: string;
  pollOptions: string[];
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function isPuppeteerTargetClosedError(error: unknown) {
  const message = getErrorMessage(error);
  return (
    message.includes("Target closed") ||
    message.includes("Protocol error (Runtime.evaluate)") ||
    message.includes("Protocol error (Runtime.callFunctionOn)") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Session closed") ||
    message.includes("Connection closed")
  );
}

function isRecoverableWhatsAppExecutionError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("execution context was destroyed") ||
    message.includes("cannot find context with specified id") ||
    message.includes("runtime.callfunctionon") ||
    message.includes("runtime.evaluate") ||
    message.includes("data passed to getter must include an id property") ||
    message.includes("target closed") ||
    message.includes("session closed") ||
    message.includes("connection closed")
  );
}

function shouldIgnoreTransientBrowserClose(error: unknown) {
  return isPuppeteerTargetClosedError(error) && (
    reconnectingClient ||
    !whatsappReady ||
    currentBotStatus === "reconnecting" ||
    currentBotStatus === "waiting_qr_scan" ||
    currentBotStatus === "disconnected" ||
    currentBotStatus === "auth_failure"
  );
}

function shouldIgnoreLateWhatsAppAuthTimeout(error: unknown) {
  return whatsappReady && getErrorMessage(error).toLowerCase().includes("auth timeout");
}

function installProcessErrorGuards() {
  if (processErrorGuardsInstalled) return;
  processErrorGuardsInstalled = true;

  process.on("unhandledRejection", (reason) => {
    if (shouldIgnoreTransientBrowserClose(reason)) {
      console.warn("Ignored transient WhatsApp browser close while reconnecting:", getErrorMessage(reason));
      return;
    }
    if (shouldIgnoreLateWhatsAppAuthTimeout(reason)) {
      console.warn("Ignored late WhatsApp auth timeout after ready:", getErrorMessage(reason));
      return;
    }
    console.error("Unhandled promise rejection", reason);
    setTimeout(() => process.exit(1), 250).unref();
  });

  process.on("uncaughtException", (error) => {
    if (shouldIgnoreTransientBrowserClose(error)) {
      console.warn("Ignored transient WhatsApp browser close exception while reconnecting:", getErrorMessage(error));
      return;
    }
    console.error("Uncaught exception", error);
    setTimeout(() => process.exit(1), 250).unref();
  });
}

const ec10MeetingFollowUpSteps: Ec10FollowUpStep[] = [
  {
    step: 1,
    delayMinutes: 15,
    text: (leadName) => [
      `${buildLeadGreeting(leadName)} Vi que voce comecou o atendimento da EC10, mas ainda nao escolheu o horario da reuniao.`,
      "",
      "Quando existe objetivo no futebol, seguir no improviso pode custar tempo e oportunidade."
    ].join("\n"),
    pollQuestion: "Quer dar o proximo passo agora?",
    pollOptions: ["Quero agendar", "Tenho uma duvida", "Ver mais tarde"]
  },
  {
    step: 2,
    delayMinutes: 120,
    text: (leadName) => [
      `${buildLeadGreeting(leadName)} A reuniao e rapida e serve para entender o momento do atleta, os objetivos da familia e qual plano faz mais sentido.`,
      "",
      "Se fizer sentido, mostramos o caminho. Se nao fizer, tambem falamos com clareza."
    ].join("\n"),
    pollQuestion: "Como prefere seguir?",
    pollOptions: ["Separar um horario", "Entender melhor antes", "Falar com atendente"]
  },
  {
    step: 3,
    delayMinutes: 1440,
    text: (leadName) => [
      `${buildLeadGreeting(leadName)} Muitos responsaveis procuram orientacao so quando ja perderam tempo.`,
      "",
      "No futebol, quem tem plano chega mais preparado. Quem vai no achismo depende de sorte."
    ].join("\n"),
    pollQuestion: "Quer escolher um horario hoje?",
    pollOptions: ["Quero ver horarios", "Quero entender valores", "Ainda estou pensando"]
  },
  {
    step: 4,
    delayMinutes: 2880,
    text: (leadName) => `${buildLeadGreeting(leadName)} So para eu te direcionar certo: o que esta te travando agora?`,
    pollQuestion: "O que esta te travando agora?",
    pollOptions: [
      "Quero entender os valores",
      "Quero saber se faz sentido para o atleta",
      "Quero entender como funciona",
      "Quero agendar a reuniao"
    ]
  },
  {
    step: 5,
    delayMinutes: 4320,
    text: (leadName) => [
      `${buildLeadGreeting(leadName)} Vou deixar seu atendimento em aberto ate hoje.`,
      "",
      "Se o objetivo e levar esse projeto a serio, o primeiro passo e entender o caminho certo."
    ].join("\n"),
    pollQuestion: "Quer que eu te envie os horarios finais?",
    pollOptions: ["Enviar horarios finais", "Falar com consultor", "Encerrar por enquanto"]
  }
];

type Ec10MeetingSeller = {
  name: string;
  phone: string;
  route: Ec10MeetingRoute;
};

type CareerMeetingGroupKind = "tuesday_20h" | "thursday_20h";

type CareerMeetingGroupResult = {
  kind: CareerMeetingGroupKind;
  title: string;
  chatId: string | null;
  created: boolean;
  sandroPromoted: boolean;
  leadAdded: boolean;
  inviteSent?: boolean;
  inviteLinkSent?: boolean;
  addStatus?: Record<string, unknown> | null;
  addResult?: unknown;
  error?: string | null;
};

const pabloInternationalSeller: Ec10MeetingSeller = {
  name: "Pablo",
  phone: "+351 914 945 252",
  route: "plano_internacional"
};
const ec10CareerMeetingSeller: Ec10MeetingSeller = {
  name: config.EC10_CAREER_SELLER_NAME,
  phone: config.EC10_CAREER_SELLER_PHONE,
  route: "plano_carreira"
};
const ec10InternationalMeetingSellers = dedupeEc10MeetingSellers([
  {
    name: config.EC10_INTERNATIONAL_SELLER_NAME,
    phone: config.EC10_INTERNATIONAL_SELLER_PHONE,
    route: "plano_internacional"
  },
  pabloInternationalSeller
]);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function canUseAiFallback() {
  const day = new Date().toISOString().slice(0, 10);
  if (aiFallbackUsage.day !== day) {
    aiFallbackUsage = { day, count: 0 };
  }
  if (aiFallbackUsage.count >= config.BOT_AI_FALLBACK_DAILY_LIMIT) return false;
  aiFallbackUsage.count += 1;
  return true;
}

async function naturalPause(min = 1800, max = 3600) {
  await wait(randomBetween(min, max));
}

function isLikelyLidChatId(chatId: string) {
  const raw = chatId.trim();
  if (raw.endsWith("@lid")) return true;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 14 && !digits.startsWith(config.BOT_DEFAULT_COUNTRY_CODE);
}

async function resolveInboundChatId(client: any, chatId: string) {
  if (!isLikelyLidChatId(chatId) || typeof client.getContactLidAndPhone !== "function") {
    return chatId;
  }

  try {
    const [contact] = await client.getContactLidAndPhone([chatId]);
    if (contact?.pn) return contact.pn;
  } catch (error) {
    console.warn("Failed to resolve inbound LID", error instanceof Error ? error.message : String(error));
  }

  return chatId;
}

async function withConversationLock(chatId: string, task: () => Promise<void>) {
  const previous = conversationLocks.get(chatId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (conversationLocks.get(chatId) === next) {
        conversationLocks.delete(chatId);
      }
    });
  conversationLocks.set(chatId, next);
  return next;
}

async function withOutboundSendLock<T>(key: string, task: () => Promise<T>) {
  const previous = outboundSendLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const tracked = next.then(
    () => undefined,
    () => undefined
  );
  outboundSendLocks.set(key, tracked);

  try {
    return await next;
  } finally {
    if (outboundSendLocks.get(key) === tracked) {
      outboundSendLocks.delete(key);
    }
  }
}

function toChatId(phone: string) {
  const raw = phone.trim();
  if (raw.includes("@")) return raw;

  const digits = phone.replace(/\D/g, "");
  if (!digits) {
    throw new Error("Lead sem identificador de WhatsApp valido.");
  }
  if (digits.startsWith("120363")) return `${digits}@g.us`;
  if (!digits.startsWith(config.BOT_DEFAULT_COUNTRY_CODE) && digits.length >= 14) return `${digits}@lid`;
  return `${digits}@c.us`;
}

async function resolveOutboundChatIds(client: any, phone: string) {
  const primary = toChatId(phone);
  const chatIds = [primary];
  if (!primary.endsWith("@c.us")) {
    return chatIds;
  }

  if (typeof client.getNumberId === "function") {
    try {
      const numberId = await client.getNumberId(primary);
      if (numberId?._serialized && !chatIds.includes(numberId._serialized)) {
        chatIds.unshift(numberId._serialized);
      }
    } catch (error) {
      console.warn("Failed to resolve WhatsApp number id; using phone chat id", error instanceof Error ? error.message : String(error));
    }
  }

  if (typeof client.getContactLidAndPhone !== "function") {
    return chatIds;
  }

  try {
    const [contact] = await client.getContactLidAndPhone([primary]);
    if (contact?.lid && !chatIds.includes(contact.lid)) {
      chatIds.push(contact.lid);
    }
  } catch (error) {
    console.warn("Failed to resolve LID for outbound contact", error instanceof Error ? error.message : String(error));
  }

  return chatIds;
}

function parseQueuedPollLine(line: string) {
  return /^\d{1,2}\.\s+\S/.test(line.trim());
}

function parseQueuedPollBody(body: string | null) {
  const lines = (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstOptionIndex = lines.findIndex(parseQueuedPollLine);
  const options = lines.filter(parseQueuedPollLine);
  const questionLines = firstOptionIndex >= 0 ? lines.slice(0, firstOptionIndex) : [];
  const question = questionLines.slice(-2).join("\n").trim() || meetingDatePollQuestion;

  return {
    question,
    options,
    fallbackBody: body ?? buildPollFallbackBody(question, options)
  };
}

async function sendQueuedPollWithConfirmation(client: any, chatId: string, item: { body: string | null }) {
  const { question, options, fallbackBody } = parseQueuedPollBody(item.body);
  if (options.length < 2 || typeof Poll !== "function") {
    return sendTextWithConversationConfirmation(client, chatId, fallbackBody);
  }

  try {
    const poll = new Poll(question, options, { allowMultipleAnswers: false, messageSecret: undefined });
    const sent = await sendWhatsAppWithRetry(() => client.sendMessage(chatId, poll, { waitUntilMsgSent: true }));
    if (!sent) throw new Error("WhatsApp nao confirmou o envio da enquete.");
    return sent;
  } catch (error) {
    console.warn("Failed to send queued WhatsApp poll, falling back to text", error instanceof Error ? error.message : String(error));
    return sendTextWithConversationConfirmation(client, chatId, fallbackBody);
  }
}

function normalizedMessageBody(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function findRecentSentText(client: any, chatId: string, body: string) {
  const expected = normalizedMessageBody(body);
  if (!expected) return null;

  await wait(1200);
  const chat = await client.getChatById(chatId).catch(() => null);
  if (!chat || typeof chat.fetchMessages !== "function") return null;

  const messages = await chat.fetchMessages({ limit: 20 }).catch(() => []);
  const minimumTimestamp = Math.floor(Date.now() / 1000) - 90;
  return messages.find((message: any) => (
    message?.fromMe === true
    && Number(message?.timestamp ?? 0) >= minimumTimestamp
    && normalizedMessageBody(message?.body) === expected
  )) ?? null;
}

async function findRecentSentAudio(client: any, chatId: string) {
  await wait(1200);
  const chat = await client.getChatById(chatId).catch(() => null);
  if (!chat || typeof chat.fetchMessages !== "function") return null;

  const messages = await chat.fetchMessages({ limit: 20 }).catch(() => []);
  const minimumTimestamp = Math.floor(Date.now() / 1000) - 90;
  return messages.find((message: any) => {
    const type = String(message?.type ?? "").toLowerCase();
    return message?.fromMe === true
      && Number(message?.timestamp ?? 0) >= minimumTimestamp
      && (type === "ptt" || type === "audio" || type === "voice");
  }) ?? null;
}

async function sendTextWithConversationConfirmation(client: any, chatId: string, body: string) {
  const sent = await sendWhatsAppWithRetry(() => client.sendMessage(chatId, body, { waitUntilMsgSent: true }));
  if (sent) return sent;

  const confirmed = await findRecentSentText(client, chatId, body);
  if (confirmed) return confirmed;
  throw new Error("WhatsApp nao confirmou o envio da mensagem.");
}

async function sendMessageWithConfirmation(client: any, chatId: string, item: {
  body: string | null;
  media_type: string;
  media_path: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
}) {
  if (item.media_type === "text") {
    return sendTextWithConversationConfirmation(client, chatId, item.body ?? "");
  }

  if (item.media_type === "poll") {
    return sendQueuedPollWithConfirmation(client, chatId, item);
  }

  if (!item.media_path) {
    throw new Error("Mensagem de midia sem arquivo configurado.");
  }

  const storedMedia = await downloadWhatsappMedia(item.media_path, item.media_mime_type, item.media_file_name);
  const media = storedMedia
    ? new MessageMedia(storedMedia.mimeType, storedMedia.base64Data, storedMedia.fileName)
    : MessageMedia.fromFilePath(resolveProjectPath(item.media_path));
  const sendAudioAsVoice = item.media_type === "audio";
  const sent = await sendWhatsAppWithRetry(() => client.sendMessage(chatId, media, {
    caption: item.media_type === "audio" || item.media_type === "audio_file" ? undefined : item.body ?? undefined,
    sendAudioAsVoice,
    sendMediaAsDocument: item.media_type === "document",
    waitUntilMsgSent: true
  }));
  if (!sent) throw new Error("WhatsApp nao confirmou o envio da midia.");
  return sent;
}

function queuedMediaTypeForDedupe(mediaType: string): "text" | "audio" | "image" | "document" | "poll" {
  if (mediaType === "audio_file") return "audio";
  if (mediaType === "audio" || mediaType === "image" || mediaType === "document" || mediaType === "poll") return mediaType;
  return "text";
}

async function sendQueuedOutboundMessage(client: any, item: {
  phone: string;
  body: string | null;
  media_type: string;
  media_path: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
}) {
  const chatIds = await resolveOutboundChatIds(client, item.phone);
  let lastError: unknown = null;

  for (const chatId of chatIds) {
    try {
      return await sendMessageWithConfirmation(client, chatId, item);
    } catch (error) {
      lastError = error;
      if (chatId !== chatIds.at(-1)) {
        await wait(800);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Falha ao enviar mensagem pelo WhatsApp."));
}

async function sendDirectWhatsAppText(client: any, phone: string, body: string) {
  const pauseReason = await getImmediateOutboundPauseReason();
  if (pauseReason) {
    throw new Error(`Envio WhatsApp pausado: ${pauseReason}`);
  }

  const chatIds = await resolveOutboundChatIds(client, phone);
  let lastError: unknown = null;

  for (const chatId of chatIds) {
    try {
      return await sendTextWithConversationConfirmation(client, chatId, body);
    } catch (error) {
      lastError = error;
      if (chatId !== chatIds.at(-1)) {
        await wait(800);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Falha ao enviar mensagem pelo WhatsApp."));
}

function sellerKey(name: string) {
  return name.trim().toLowerCase();
}

function dedupeEc10MeetingSellers(sellers: Ec10MeetingSeller[]) {
  const seen = new Set<string>();
  return sellers.filter((seller) => {
    const key = sellerKey(seller.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function pickBalancedEc10MeetingSeller(route: Ec10MeetingRoute, sellers: Ec10MeetingSeller[]) {
  if (sellers.length <= 1) return sellers[0] ?? ec10CareerMeetingSeller;

  try {
    const counts = await fetchFutureEc10MeetingSellerCounts(route, sellers.map((seller) => seller.name));
    return sellers
      .map((seller, index) => ({
        seller,
        index,
        meetings: counts[seller.name] ?? 0
      }))
      .sort((left, right) => left.meetings - right.meetings || left.index - right.index)[0]?.seller ?? sellers[0];
  } catch (error) {
    console.warn("Failed to balance EC10 meeting seller", error instanceof Error ? error.message : String(error));
    return sellers[0];
  }
}

function getSaoPauloScheduleParts(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    year,
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).getUTCDay()
  };
}

function isCareerPlanService(serviceInterest: string | null | undefined) {
  return serviceInterest === "plano_carreira";
}

function isInternationalPlanService(serviceInterest: string | null | undefined) {
  return serviceInterest === "plano_internacional" || serviceInterest === "ambos";
}

function isInternationalSellerAvailable(seller: Ec10MeetingSeller, schedule: Ec10MeetingSchedule) {
  if (seller.route !== "plano_internacional") return false;
  const parts = getSaoPauloScheduleParts(schedule.startsAt);
  if (parts.minute !== 0) return false;
  const sellerName = normalizeText(seller.name);

  if (sellerName.includes("pablo")) {
    if ([1, 2, 4].includes(parts.weekday)) return parts.hour >= 8 && parts.hour < 16;
    if ([3, 5].includes(parts.weekday)) return parts.hour >= 8 && parts.hour < 14;
    if (parts.weekday === 6) return parts.hour >= 8 && parts.hour < 12;
    return false;
  }

  if (sellerName.includes("igor")) {
    return parts.weekday >= 2 && parts.weekday <= 5 && parts.hour >= 10 && parts.hour < 17;
  }

  return false;
}

function pickRandomSeller(sellers: Ec10MeetingSeller[]) {
  if (sellers.length <= 1) return sellers[0];
  return sellers[Math.floor(Math.random() * sellers.length)];
}

async function resolveEc10MeetingSeller(
  serviceInterest: string | null | undefined,
  schedule?: Ec10MeetingSchedule | null
): Promise<Ec10MeetingSeller> {
  if (serviceInterest === "plano_internacional" || serviceInterest === "ambos") {
    if (schedule) {
      const eligibleSellers = ec10InternationalMeetingSellers.filter((seller) => isInternationalSellerAvailable(seller, schedule));
      const randomSeller = pickRandomSeller(eligibleSellers);
      if (randomSeller) return randomSeller;
    }
    return pickBalancedEc10MeetingSeller("plano_internacional", ec10InternationalMeetingSellers);
  }

  return ec10CareerMeetingSeller;
}

function careerGroupKindForSchedule(schedule: Ec10MeetingSchedule): CareerMeetingGroupKind | null {
  const parts = getSaoPauloScheduleParts(schedule.startsAt);
  if (parts.hour !== 20 || parts.minute !== 0) return null;
  if (parts.weekday === 2) return "tuesday_20h";
  if (parts.weekday === 4) return "thursday_20h";
  return null;
}

function careerMeetingGroupTitle(kind: CareerMeetingGroupKind) {
  return kind === "tuesday_20h"
    ? "EC10 Plano de Carreira | Terça 20h"
    : "EC10 Plano de Carreira | Quinta 20h";
}

function careerMeetingGroupRuntimeKey(kind: CareerMeetingGroupKind) {
  return `ec10_career_meeting_group:${kind}`;
}

function summarizeParticipantAddResult(result: unknown, participantId: string) {
  if (!result) {
    return { accepted: false, inviteSent: false, alreadyMember: false, statusCode: null, message: null };
  }
  if (typeof result === "string") {
    return { accepted: false, inviteSent: false, alreadyMember: false, statusCode: null, message: result };
  }

  const record = result as Record<string, any>;
  const values = Array.isArray(result) ? result : Object.values(record);
  const participantResult = record[participantId] ?? record[participantId.replace("@c.us", "@lid")] ?? values[0];
  if (!participantResult || typeof participantResult !== "object") {
    return { accepted: false, inviteSent: false, alreadyMember: false, statusCode: null, message: null };
  }

  const code = Number(participantResult.statusCode ?? participantResult.code);
  const message = typeof participantResult.message === "string" ? participantResult.message : null;
  const inviteSent = participantResult.isInviteV4Sent === true;
  const alreadyMember = code === 409 || Boolean(message?.toLowerCase().includes("already"));

  return {
    accepted: code === 200 || alreadyMember || inviteSent,
    inviteSent,
    alreadyMember,
    statusCode: Number.isFinite(code) ? code : null,
    message
  };
}

function participantResultWasAccepted(result: unknown, participantId: string) {
  return summarizeParticipantAddResult(result, participantId).accepted;
}

function groupHasParticipant(group: any, participantId: string) {
  const participants = Array.isArray(group?.participants) ? group.participants : [];
  return participants.some((participant: any) => getGroupParticipantSerializedId(participant) === participantId);
}

async function sendCareerGroupInviteLink(input: {
  client: any;
  clientId: string;
  phone: string;
  group: any;
  groupTitle: string;
  schedule: Ec10MeetingSchedule;
}) {
  if (typeof input.group?.getInviteCode !== "function") {
    return { sent: false, error: "Grupo nao permite gerar link de convite pelo bot." };
  }

  const inviteCode = await withOperationTimeout(
    input.group.getInviteCode(),
    15_000,
    "Gerar link do grupo de reuniao"
  );
  if (!inviteCode) return { sent: false, error: "WhatsApp nao retornou codigo de convite do grupo." };

  const inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
  const body = [
    "Sua reuniao do Plano de Carreira foi agendada.",
    `Grupo da reuniao: ${input.groupTitle}`,
    `Horario: ${input.schedule.dateLabel}, das ${input.schedule.timeLabel}`,
    "",
    "O WhatsApp bloqueou sua entrada automatica no grupo por configuracao de privacidade. Toque no link abaixo para entrar no grupo da reuniao:",
    inviteUrl
  ].join("\n");

  const lockAcquired = await tryAcquireBotDedupeLock({
    key: `career_group_invite:${input.clientId}:${input.schedule.startsAt}`,
    scope: "career_group_invite",
    clientId: input.clientId,
    phone: input.phone,
    ttlSeconds: 7 * 24 * 60 * 60,
    metadata: {
      groupTitle: input.groupTitle,
      schedule: input.schedule
    }
  });
  if (!lockAcquired) {
    return { sent: false, error: "Convite do grupo ja foi enviado recentemente para este agendamento." };
  }

  await withOperationTimeout(
    sendDirectWhatsAppText(input.client, input.phone, body),
    25_000,
    "Enviar link do grupo ao lead"
  );
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "career_meeting_group_invite_link_sent",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: {
      groupTitle: input.groupTitle,
      schedule: input.schedule
    }
  });

  return { sent: true, inviteUrl };
}

async function resolveGroupParticipantId(client: any, phone: string) {
  const candidates = await resolveOutboundChatIds(client, phone);
  return candidates.find((chatId) => chatId.endsWith("@c.us")) ?? candidates[0] ?? toChatId(phone);
}

function getGroupParticipantSerializedId(participant: any) {
  const id = participant?.id;
  if (typeof id === "string") return id;
  if (typeof id?._serialized === "string") return id._serialized;
  return null;
}

async function ensureCareerGroupSandroAdmin(client: any, chatId: string, sandroParticipantId: string) {
  try {
    const group = await client.getChatById(chatId);
    const participants = Array.isArray(group?.participants) ? group.participants : [];
    let sandroParticipant = participants.find((participant: any) => getGroupParticipantSerializedId(participant) === sandroParticipantId);

    if (!sandroParticipant && typeof group?.addParticipants === "function") {
      await group.addParticipants([sandroParticipantId]);
      const updatedGroup = await client.getChatById(chatId);
      const updatedParticipants = Array.isArray(updatedGroup?.participants) ? updatedGroup.participants : [];
      sandroParticipant = updatedParticipants.find((participant: any) => getGroupParticipantSerializedId(participant) === sandroParticipantId);
    }

    if (sandroParticipant?.isAdmin || sandroParticipant?.isSuperAdmin) return true;
    if (typeof group?.promoteParticipants !== "function") return false;

    await group.promoteParticipants([sandroParticipantId]);
    return true;
  } catch (error) {
    console.warn("Failed to ensure Sandro admin in career meeting group", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function getOrCreateCareerMeetingGroup(client: any, kind: CareerMeetingGroupKind) {
  const tracked = careerMeetingGroupLocks.get(kind);
  if (tracked) return tracked;

  const task = (async (): Promise<CareerMeetingGroupResult> => {
    const title = careerMeetingGroupTitle(kind);
    const runtimeKey = careerMeetingGroupRuntimeKey(kind);
    const runtime = await getBotRuntime(runtimeKey);
    const existingChatId = typeof runtime?.chatId === "string" ? runtime.chatId : null;
    const sandroParticipantId = await resolveGroupParticipantId(client, ec10CareerMeetingSeller.phone);

    if (existingChatId) {
      try {
        await client.getChatById(existingChatId);
        const sandroPromoted = await ensureCareerGroupSandroAdmin(client, existingChatId, sandroParticipantId);
        await upsertBotRuntime(runtimeKey, {
          kind,
          title,
          chatId: existingChatId,
          sandroPhone: ec10CareerMeetingSeller.phone,
          sandroPromoted,
          updatedAt: new Date().toISOString()
        });
        return { kind, title, chatId: existingChatId, created: false, sandroPromoted, leadAdded: false };
      } catch (error) {
        console.warn("Stored career meeting group not available, creating again", error instanceof Error ? error.message : String(error));
      }
    }

    const createResult = await client.createGroup(title, [sandroParticipantId]);
    const chatId = createResult?.gid?._serialized ?? null;
    if (!chatId) throw new Error("WhatsApp nao retornou ID do grupo criado.");

    const sandroPromoted = await ensureCareerGroupSandroAdmin(client, chatId, sandroParticipantId);

    await upsertBotRuntime(runtimeKey, {
      kind,
      title,
      chatId,
      sandroPhone: ec10CareerMeetingSeller.phone,
      sandroPromoted,
      createdAt: new Date().toISOString()
    });

    return { kind, title, chatId, created: true, sandroPromoted, leadAdded: false };
  })().finally(() => {
    careerMeetingGroupLocks.delete(kind);
  });

  careerMeetingGroupLocks.set(kind, task);
  return task;
}

async function ensureCareerMeetingGroups(client: any) {
  if (!(await canRunHeavyWhatsAppOperation("ensureCareerMeetingGroups"))) return;
  const kinds: CareerMeetingGroupKind[] = ["tuesday_20h", "thursday_20h"];
  for (const kind of kinds) {
    try {
      markHeavyWhatsAppOperation();
      const group = await getOrCreateCareerMeetingGroup(client, kind);
      console.log(`Career meeting group ready: ${group.title} (${group.chatId ?? "sem chatId"})`);
    } catch (error) {
      console.warn(
        "Failed to prepare career meeting group",
        kind,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

async function addLeadToCareerMeetingGroup(input: {
  client: any;
  clientId: string;
  phone: string;
  leadName: string | null;
  schedule: Ec10MeetingSchedule;
}): Promise<CareerMeetingGroupResult | null> {
  const kind = careerGroupKindForSchedule(input.schedule);
  if (!kind) return null;
  if (!(await canRunHeavyWhatsAppOperation("addLeadToCareerMeetingGroup"))) {
    return buildSkippedCareerGroupResult(kind, "Automacao de grupo pausada pelo modo seguro do WhatsApp.");
  }
  markHeavyWhatsAppOperation();

  const groupResult = await withOperationTimeout(
    getOrCreateCareerMeetingGroup(input.client, kind),
    25_000,
    "Preparar grupo de reuniao"
  );
  if (!groupResult.chatId) return groupResult;

  const leadParticipantId = await withOperationTimeout(
    resolveGroupParticipantId(input.client, input.phone),
    20_000,
    "Resolver WhatsApp do lead para grupo"
  );
  let group: any = await withOperationTimeout(
    input.client.getChatById(groupResult.chatId),
    20_000,
    "Abrir grupo de reuniao"
  );
  let addResult: unknown = null;
  let addStatus = summarizeParticipantAddResult(null, leadParticipantId);
  let leadAdded = groupHasParticipant(group, leadParticipantId);
  let inviteLinkSent = false;
  let inviteLinkError: string | null = null;

  if (!leadAdded) {
    try {
      addResult = await withOperationTimeout(
        group.addParticipants([leadParticipantId], {
          autoSendInviteV4: true,
          comment: [
            "Reuniao EC10 Plano de Carreira confirmada.",
            `Horario: ${input.schedule.dateLabel}, das ${input.schedule.timeLabel}`
          ].join("\n"),
          sleep: 350
        }),
        45_000,
        "Adicionar lead ao grupo de reuniao"
      );
    } catch (error) {
      addResult = error instanceof Error ? error.message : String(error);
      console.warn("Career meeting group add failed, sending invite fallback", addResult);
    }
    addStatus = summarizeParticipantAddResult(addResult, leadParticipantId);
    group = await withOperationTimeout(
      input.client.getChatById(groupResult.chatId),
      15_000,
      "Reabrir grupo de reuniao"
    ).catch(() => group);
    leadAdded = groupHasParticipant(group, leadParticipantId) || addStatus.alreadyMember;
  } else {
    addStatus = { accepted: true, inviteSent: false, alreadyMember: true, statusCode: 409, message: "Participante ja estava no grupo." };
  }

  if (!leadAdded && !addStatus.inviteSent) {
    try {
      const inviteResult = await sendCareerGroupInviteLink({
        client: input.client,
        clientId: input.clientId,
        phone: input.phone,
        group,
        groupTitle: groupResult.title,
        schedule: input.schedule
      });
      inviteLinkSent = inviteResult.sent;
      inviteLinkError = inviteResult.error ?? null;
    } catch (error) {
      inviteLinkError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to send career meeting invite link", inviteLinkError);
    }
  }

  if (leadAdded || addStatus.inviteSent || inviteLinkSent) {
    await sendWhatsAppWithRetry(() => input.client.sendMessage(
      groupResult.chatId,
      [
        "Novo lead confirmado para a reuniao do Plano de Carreira.",
        input.leadName ? `Nome: ${input.leadName}` : `Contato: +${input.phone}`,
        `Horario: ${input.schedule.dateLabel}, das ${input.schedule.timeLabel}`,
        leadAdded ? "Status: adicionado ao grupo." : "Status: convite enviado ao lead."
      ].join("\n")
    )).catch((error) => {
      console.warn("Failed to send career meeting group notice", error instanceof Error ? error.message : String(error));
      return null;
    });
  }

  return {
    ...groupResult,
    leadAdded,
    inviteSent: addStatus.inviteSent,
    inviteLinkSent,
    addStatus,
    addResult,
    error: inviteLinkError
  };
}

async function repairPendingCareerMeetingGroups(client: any) {
  if (processingCareerGroupRepair) return;
  if (!(await canRunHeavyWhatsAppOperation("repairPendingCareerMeetingGroups"))) return;
  processingCareerGroupRepair = true;

  try {
    const states = await fetchPendingCareerMeetingGroupStates(1);
    console.log(`Pending career meeting group repairs: ${states.length}`);
    if (!states.length) return;

    for (const state of states) {
      const schedule = readStoredMeetingSchedule(state);
      if (!schedule || !careerGroupKindForSchedule(schedule)) continue;

      const metadata = asMetadataRecord(state.metadata);
      const leadName = typeof metadata.leadName === "string" ? metadata.leadName : null;
      let repairResult: CareerMeetingGroupResult | null = null;
      let repairError: string | null = null;

      try {
        repairResult = await addLeadToCareerMeetingGroup({
          client,
          clientId: state.client_id,
          phone: state.phone,
          leadName,
          schedule
        });
      } catch (error) {
        repairError = error instanceof Error ? error.message : String(error);
        console.warn("Failed to repair career meeting group add", state.phone, repairError);
      }

      await saveBotConversationState({
        clientId: state.client_id,
        phone: state.phone,
        stage: state.stage,
        roleAnswer: state.role_answer,
        athleteAge: state.athlete_age,
        ageGroup: state.age_group,
        serviceInterest: state.service_interest,
        leadPageUrl: state.lead_page_url,
        completedAt: state.completed_at,
        metadata: {
          ...metadata,
          meetingWhatsAppGroup: repairResult ?? metadata.meetingWhatsAppGroup ?? null,
          meetingWhatsAppGroupError: repairError,
          meetingWhatsAppGroupRepairCheckedAt: new Date().toISOString()
        }
      });

      await recordTrafficEvent({
        clientId: state.client_id,
        phone: state.phone,
        eventType: "career_meeting_group_repair_result",
        channel: "whatsapp",
        platform: "whatsapp",
        serviceInterest: state.service_interest,
        athleteAge: state.athlete_age,
        ageGroup: state.age_group,
        metadata: {
          schedule,
          result: repairResult,
          error: repairError
        }
      });

      console.log(
        `Career meeting group repair checked for ${state.phone}: added=${Boolean(repairResult?.leadAdded)} invite=${Boolean(repairResult?.inviteSent || repairResult?.inviteLinkSent)} error=${repairError ?? repairResult?.error ?? "none"}`
      );

      await wait(1200);
    }
  } catch (error) {
    console.warn("Failed to repair pending career meeting groups", error instanceof Error ? error.message : String(error));
  } finally {
    processingCareerGroupRepair = false;
  }
}

function normalizeWhatsAppMediaType(type: string) {
  if (["ptt", "audio", "voice"].includes(type)) return "audio";
  if (["image", "document"].includes(type)) return type;
  return type || "unknown";
}

function isAudioMessageType(mediaType: string) {
  return normalizeWhatsAppMediaType(mediaType) === "audio";
}

function repairWhatsAppMessageId(message: any) {
  const id = message?.id;
  if (!id || typeof id !== "object") return null;
  if (typeof id._serialized === "string" && id._serialized) return id._serialized;

  const serialized = typeof id.$1 === "string" && id.$1
    ? id.$1
    : id.id && (id.remote || message.from)
      ? `${Boolean(id.fromMe)}_${id.remote || message.from}_${id.id}`
      : null;
  if (!serialized) return null;

  try {
    id._serialized = serialized;
  } catch {
    try {
      Object.defineProperty(id, "_serialized", { configurable: true, value: serialized });
    } catch {
      return null;
    }
  }
  return serialized;
}

async function downloadInboundMediaWithRetry(client: any, message: any) {
  const messageId = repairWhatsAppMessageId(message);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const candidate = attempt === 0 || !messageId
        ? message
        : await client.getMessageById(messageId);
      repairWhatsAppMessageId(candidate);
      const media = await candidate?.downloadMedia();
      if (media?.data) return media;
      lastError = new Error("WhatsApp returned empty media data.");
    } catch (error) {
      lastError = error;
    }
    await wait(900 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error("WhatsApp media download failed.");
}

async function resolveMessageBody(client: any, message: any, mediaType: string, downloadedMedia?: any | null) {
  const body = String(message.body ?? "").trim();
  if (!message.hasMedia || !isAudioMessageType(mediaType) || !isBotAiEnabled()) return body || null;

  try {
    const media = downloadedMedia ?? await downloadInboundMediaWithRetry(client, message);
    const transcript = await transcribeAudioWithAi({
      base64Data: media.data,
      mimeType: media.mimetype || "audio/ogg"
    });
    const spokenText = transcript?.trim() || "";
    return [body ? `Legenda: ${body}` : null, spokenText ? `Áudio transcrito: ${spokenText}` : null]
      .filter(Boolean)
      .join("\n") || body || null;
  } catch (error) {
    console.warn("Audio transcription unavailable", error instanceof Error ? error.message : String(error));
    return body || "Áudio recebido, mas a transcrição automática não ficou disponível.";
  }
}

function normalizeText(input: string | null | undefined) {
  return (input ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLeadGreeting(name?: string | null) {
  const firstName = (name ?? "")
    .trim()
    .split(/\s+/)
    .find(Boolean);
  return firstName ? `Oi, ${firstName}.` : "Oi, tudo bem?";
}

function buildEc10FollowUpPollBody(step: Ec10FollowUpStep) {
  return [
    step.pollQuestion,
    ...step.pollOptions.map((option, index) => `${index + 1}. ${option}`)
  ].join("\n");
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

async function scheduleEc10MeetingFollowUps(input: {
  clientId: string;
  phone: string;
  leadName?: string | null;
  baseline?: Date;
  steps?: Ec10FollowUpStep[];
}) {
  if (process.env.EC10_FOLLOWUPS_ENABLED !== "true") {
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.phone,
      eventType: "bot_followup_sequence_suppressed",
      channel: "whatsapp",
      platform: "whatsapp",
      metadata: { reason: "followups_disabled_by_safety_flag" }
    });
    return;
  }

  const clientState = await getClientAutomationStateByPhone(input.phone);
  const unsafeTags = new Set([
    "ec10_reuniao_agendada",
    "reuniao_recusada",
    "ec10_presenca_confirmada",
    "ec10_nao_podera_participar"
  ]);
  if (clientState?.tags?.some((tag) => unsafeTags.has(tag))) {
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.phone,
      eventType: "bot_followup_sequence_suppressed",
      channel: "whatsapp",
      platform: "whatsapp",
      metadata: { reason: "unsafe_client_tags", tags: clientState.tags }
    });
    return;
  }

  const baseline = input.baseline ?? new Date();
  const steps = input.steps ?? ec10MeetingFollowUpSteps;

  for (const step of steps) {
    const textAt = addMinutes(baseline, step.delayMinutes).toISOString();
    const pollAt = addMinutes(baseline, step.delayMinutes).getTime() + 20_000;
    await scheduleOutboundTextMessage({
      clientId: input.clientId,
      phone: input.phone,
      body: step.text(input.leadName),
      scheduledAt: textAt,
      mediaPath: `${ec10FollowUpMarkerPrefix}:${step.step}:text`
    });
    await scheduleOutboundPollMessage({
      clientId: input.clientId,
      phone: input.phone,
      body: buildEc10FollowUpPollBody(step),
      scheduledAt: new Date(pollAt).toISOString(),
      mediaPath: `${ec10FollowUpMarkerPrefix}:${step.step}:poll`
    });
  }
}

function normalizeFollowUpChoice(body: string | null | undefined) {
  return normalizeText((body ?? "").replace(/^\s*\d{1,2}\.\s+/, ""));
}

function classifyFollowUpChoice(body: string | null | undefined) {
  const text = normalizeFollowUpChoice(body);
  if (!text) return null;

  const scheduleChoices = new Set([
    "quero agendar",
    "separar um horario",
    "quero ver horarios",
    "quero agendar a reuniao",
    "enviar horarios finais"
  ]);
  const valuesChoices = new Set(["quero entender valores", "quero entender os valores"]);
  const fitChoices = new Set(["quero saber se faz sentido para o atleta"]);
  const howChoices = new Set(["quero entender como funciona", "entender melhor antes"]);
  const sellerChoices = new Set(["tenho uma duvida", "falar com atendente", "falar com consultor", "aguardar consultor"]);
  const laterChoices = new Set(["ver mais tarde", "ainda estou pensando"]);
  const closeChoices = new Set(["encerrar por enquanto"]);

  if (scheduleChoices.has(text)) return "schedule";
  if (valuesChoices.has(text)) return "values";
  if (fitChoices.has(text)) return "fit";
  if (howChoices.has(text)) return "how";
  if (sellerChoices.has(text)) return "seller";
  if (laterChoices.has(text)) return "later";
  if (closeChoices.has(text)) return "close";
  return null;
}

function resolveProjectPath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(projectRoot, filePath);
}

async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(resolveProjectPath(filePath)), { recursive: true });
}

function isEnabledFlag(value: string | null | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function parseTimestampMs(value: unknown) {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeWhatsAppState(state: unknown) {
  const value = String(state ?? "").trim().toUpperCase();
  return value || null;
}

async function readBotRuntimeControl(): Promise<BotRuntimeControl> {
  const now = Date.now();
  if (botRuntimeControlCache && botRuntimeControlCache.expiresAt > now) {
    return botRuntimeControlCache.value;
  }

  const runtime = await getBotRuntime("bot_control").catch((error) => {
    console.warn("Failed to read bot runtime control", error instanceof Error ? error.message : String(error));
    return null;
  });
  const guardrail = await getBotRuntime("whatsapp_guardrail").catch((error) => {
    console.warn("Failed to read WhatsApp guardrail", error instanceof Error ? error.message : String(error));
    return null;
  });
  const manualSafeModeUntilMs = Math.max(
    parseTimestampMs(runtime?.safeModeUntil),
    parseTimestampMs(guardrail?.safeModeUntil)
  );
  const guardrailReason = typeof guardrail?.reason === "string" ? guardrail.reason : "";
  const guardrailBlocksOutbound = guardrail?.outboundQueuePaused === true
    || /banimento|banido|temporari/i.test(guardrailReason);
  const outboundQueuePausedUntilMs = Math.max(
    parseTimestampMs(runtime?.outboundQueuePausedUntil),
    parseTimestampMs(guardrail?.outboundQueuePausedUntil),
    guardrailBlocksOutbound ? parseTimestampMs(guardrail?.safeModeUntil) : 0
  );
  const value: BotRuntimeControl = {
    outboundQueueEnabled: runtime?.outboundQueueEnabled !== false,
    groupAutomationEnabled: runtime?.groupAutomationEnabled !== false,
    heavyWhatsAppOpsEnabled: runtime?.heavyWhatsAppOpsEnabled !== false,
    pauseReason: typeof runtime?.pauseReason === "string" ? runtime.pauseReason : null,
    manualSafeModeUntilMs,
    outboundQueuePausedUntilMs
  };
  // Runtime controls are operational switches, not per-message data. A longer
  // cache avoids thousands of idle reads without delaying an emergency pause.
  botRuntimeControlCache = { expiresAt: now + 60_000, value };
  return value;
}

async function activateWhatsAppSafeMode(reason: string, durationMs = config.WHATSAPP_SAFE_MODE_MS) {
  const untilMs = Date.now() + Math.max(durationMs, 60_000);
  whatsappSafeModeUntilMs = Math.max(whatsappSafeModeUntilMs, untilMs);
  whatsappSafeModeReason = reason;
  const safeModeUntil = new Date(whatsappSafeModeUntilMs).toISOString();
  botRuntimeControlCache = null;
  await upsertBotRuntime("whatsapp_guardrail", {
    safeModeUntil,
    reason,
    updatedAt: new Date().toISOString(),
    repeatedLogoutWindowMs: config.WHATSAPP_REPEATED_LOGOUT_WINDOW_MS,
    groupAutomationPaused: true
  }).catch((error) => {
    console.warn("Failed to persist WhatsApp safe mode", error instanceof Error ? error.message : String(error));
  });
}

async function recordWhatsAppLogout(reason: string) {
  const now = Date.now();
  const windowStart = now - config.WHATSAPP_REPEATED_LOGOUT_WINDOW_MS;
  recentLogoutTimestamps.push(now);
  while (recentLogoutTimestamps.length && recentLogoutTimestamps[0] < windowStart) {
    recentLogoutTimestamps.shift();
  }

  const repeatedLogout = recentLogoutTimestamps.length >= config.WHATSAPP_SAFE_MODE_AFTER_LOGOUTS;
  const safeModeReason = repeatedLogout
    ? `WhatsApp despareou ${recentLogoutTimestamps.length} vezes em janela curta: ${reason}`
    : `WhatsApp despareou a sessao: ${reason}`;
  await activateWhatsAppSafeMode(safeModeReason);
}

function getReadyAgeMs() {
  return whatsappReady && readySinceMs ? Date.now() - readySinceMs : 0;
}

function isWhatsAppConnected() {
  return currentWhatsAppState === "CONNECTED";
}

function logOutboundNotConnected(context: string, state = currentWhatsAppState) {
  if (Date.now() - lastOutboundPauseLogAt > 60_000) {
    lastOutboundPauseLogAt = Date.now();
    console.warn(`Skipping ${context}: WhatsApp state is ${state ?? "unknown"}, expected CONNECTED.`);
  }
}

function isCurrentWhatsAppClient(client: any) {
  return activeWhatsAppClient === client;
}

async function canProcessOutboundQueue(client: any) {
  if (!isCurrentWhatsAppClient(client) || !whatsappReady || currentBotStatus !== "ready") return false;
  if (!isWhatsAppConnected()) {
    logOutboundNotConnected("outbound queue");
    return false;
  }
  if (getReadyAgeMs() < config.WHATSAPP_OUTBOUND_MIN_READY_MS) return false;
  const control = await readBotRuntimeControl();
  if (control.outboundQueuePausedUntilMs > Date.now()) {
    if (Date.now() - lastOutboundPauseLogAt > 60_000) {
      lastOutboundPauseLogAt = Date.now();
      console.warn(`Outbound queue paused by WhatsApp guardrail until ${new Date(control.outboundQueuePausedUntilMs).toISOString()}`);
    }
    return false;
  }
  return control.outboundQueueEnabled && !control.pauseReason;
}

async function getImmediateOutboundPauseReason() {
  if (currentWhatsAppState && !isWhatsAppConnected()) {
    return `WhatsApp ainda nao conectado: estado ${currentWhatsAppState}`;
  }
  const control = await readBotRuntimeControl();
  if (control.pauseReason) return control.pauseReason;
  if (control.outboundQueuePausedUntilMs > Date.now()) {
    return `WhatsApp guardrail ativo ate ${new Date(control.outboundQueuePausedUntilMs).toISOString()}`;
  }
  return null;
}

async function recordImmediateOutboundPaused(input: {
  clientId: string;
  phone?: string | null;
  mediaType: "text" | "audio" | "image" | "document" | "poll";
  body?: string | null;
  mediaPath?: string | null;
  reason: string;
}) {
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone ?? null,
    eventType: "whatsapp_immediate_outbound_paused",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: {
      mediaType: input.mediaType,
      body: input.body ?? null,
      mediaPath: input.mediaPath ?? null,
      reason: input.reason
    }
  });
}

async function canRunHeavyWhatsAppOperation(operation: string) {
  if (!whatsappReady || currentBotStatus !== "ready") return false;
  if (!isWhatsAppConnected()) {
    console.warn(`Skipping ${operation}: WhatsApp state is ${currentWhatsAppState ?? "unknown"}, expected CONNECTED.`);
    return false;
  }
  const control = await readBotRuntimeControl();
  const safeModeUntilMs = Math.max(whatsappSafeModeUntilMs, control.manualSafeModeUntilMs);
  if (safeModeUntilMs > Date.now()) {
    console.warn(
      `Skipping ${operation}: WhatsApp safe mode active until ${new Date(safeModeUntilMs).toISOString()}`
    );
    return false;
  }
  if (!isEnabledFlag(config.WHATSAPP_GROUP_AUTOMATION_ENABLED)) return false;
  if (!control.groupAutomationEnabled || !control.heavyWhatsAppOpsEnabled || control.pauseReason) return false;
  if (getReadyAgeMs() < config.WHATSAPP_HEAVY_OPS_MIN_READY_MS) return false;
  if (Date.now() - lastHeavyWhatsAppOperationAt < config.WHATSAPP_HEAVY_OPS_COOLDOWN_MS) return false;
  return true;
}

function markHeavyWhatsAppOperation() {
  lastHeavyWhatsAppOperationAt = Date.now();
}

function buildSkippedCareerGroupResult(kind: CareerMeetingGroupKind, reason: string): CareerMeetingGroupResult {
  return {
    kind,
    title: careerMeetingGroupTitle(kind),
    chatId: null,
    created: false,
    sandroPromoted: false,
    leadAdded: false,
    inviteSent: false,
    inviteLinkSent: false,
    addStatus: null,
    error: reason
  };
}

function readMessageContactName(message: any) {
  const candidates = [
    message?._data?.notifyName,
    message?._data?.sender?.pushname,
    message?._data?.sender?.name,
    message?.authorName,
    message?.notifyName
  ];
  const name = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof name === "string" ? name.trim() : null;
}

function buildMeetingDeclinedMessage() {
  return "Sem problema. Vou registrar que voce prefere retomar depois. Nosso time pode te chamar para entender o melhor momento e orientar o proximo passo.";
}

function buildFollowUpAt() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function buildMeetingReminderAt(startsAt: string, now = new Date()) {
  const startsAtDate = new Date(startsAt);
  if (!Number.isFinite(startsAtDate.getTime()) || startsAtDate.getTime() <= now.getTime()) return null;

  const leadMinutes = Number.isFinite(meetingReminderLeadMinutes) && meetingReminderLeadMinutes > 0
    ? meetingReminderLeadMinutes
    : 10;
  const leadBefore = new Date(startsAtDate.getTime() - leadMinutes * 60 * 1000);
  const soonest = new Date(now.getTime() + 2 * 60 * 1000);
  const reminderAt = leadBefore.getTime() > soonest.getTime() ? leadBefore : soonest;
  return reminderAt.getTime() < startsAtDate.getTime() ? reminderAt.toISOString() : null;
}

function buildClientMeetingReminderMessage(input: {
  schedule: Ec10MeetingSchedule;
  sellerName: string;
  meetUrl: string | null;
}) {
  return [
    `Lembrete EC10: sua reuniao esta marcada para ${input.schedule.dateLabel}, das ${input.schedule.timeLabel}.`,
    `O atendimento sera com ${input.sellerName}.`,
    "Entre na sala no maximo 10 minutos antes do seu horario para evitar espera.",
    input.meetUrl ? `Google Meet: ${input.meetUrl}` : "Se o link do Meet ainda nao aparecer, responda por aqui que o time confirma."
  ].join("\n");
}

function buildSellerMeetingReminderMessage(input: {
  leadPhone: string;
  leadName: string | null;
  schedule: Ec10MeetingSchedule;
  meetUrl: string | null;
}) {
  return [
    "Lembrete EC10: reuniao chegando.",
    input.leadName ? `Lead: ${input.leadName} (+${input.leadPhone})` : `Lead: +${input.leadPhone}`,
    `Horario: ${input.schedule.dateLabel}, das ${input.schedule.timeLabel}`,
    input.meetUrl ? `Google Meet: ${input.meetUrl}` : "Google Meet: link pendente de configuracao no CRM"
  ].join("\n");
}

async function scheduleMeetingReminders(input: {
  clientId: string;
  clientPhone: string;
  leadName: string | null;
  seller: Ec10MeetingSeller;
  schedule: Ec10MeetingSchedule;
}) {
  const reminderAt = buildMeetingReminderAt(input.schedule.startsAt);
  if (!reminderAt) return;

  const clientBody = buildClientMeetingReminderMessage({
    schedule: input.schedule,
    sellerName: input.seller.name,
    meetUrl: ec10GoogleMeetUrl
  });
  const sellerBody = buildSellerMeetingReminderMessage({
    leadPhone: input.clientPhone,
    leadName: input.leadName,
    schedule: input.schedule,
    meetUrl: ec10GoogleMeetUrl
  });

  try {
    await scheduleOutboundTextMessage({
      clientId: input.clientId,
      phone: input.clientPhone,
      body: clientBody,
      scheduledAt: reminderAt
    });
    await scheduleOutboundTextMessage({
      clientId: input.clientId,
      phone: input.seller.phone,
      body: sellerBody,
      scheduledAt: reminderAt
    });
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.clientPhone,
      eventType: "bot_meeting_reminders_scheduled",
      channel: "whatsapp",
      platform: "whatsapp",
      metadata: {
        reminderAt,
        meetingStartsAt: input.schedule.startsAt,
        sellerName: input.seller.name,
        sellerPhone: input.seller.phone
      }
    });
  } catch (error) {
    console.warn("Failed to schedule meeting reminders", error instanceof Error ? error.message : String(error));
  }
}

async function sendTypingPause(client: any, chatId: string, minMs = 1800, maxMs = 3600) {
  let chat: any = null;
  try {
    chat = await client.getChatById(chatId);
    await chat?.sendStateTyping?.();
  } catch {
    chat = null;
  }

  await naturalPause(minMs, maxMs);

  try {
    await chat?.clearState?.();
  } catch {
    // The typing indicator is cosmetic; message delivery should continue.
  }
}

function normalizeOutboundLockValue(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() || "";
}

function sanitizeBotOutboundBody(value: string) {
  const raw = String(value || "").trim();
  if (/```|\bapi_call\b|update_qualification\s*\(|"arguments"\s*:|"role"\s*:\s*"response"/i.test(raw)) {
    return "Tive uma falha ao montar a resposta e não vou te enviar informação incompleta. Pode repetir sua última mensagem?";
  }
  const withoutObsoleteLinks = raw
    .replace(/https?:\/\/cliente-whatsapp-crm\.vercel\.app\/\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return withoutObsoleteLinks || "Quando chegarmos à agenda, eu envio o link oficial da EC10 por aqui.";
}

function outboundCanonicalContent(input: {body?:string|null;mediaPath?:string|null}) {
  if (input.mediaPath) return `path:${normalizeOutboundLockValue(input.mediaPath)}`;
  const bookingUrl = input.body?.match(/https:\/\/ec10talentos\.com\/agendar[^\s]*/i)?.[0];
  if (bookingUrl) return `booking:${normalizeOutboundLockValue(bookingUrl)}`;
  return `body:${normalizeOutboundLockValue(input.body)}`;
}

function buildOutboundSendLockKey(input: {
  clientId: string;
  body?: string | null;
  mediaType: "text" | "audio" | "image" | "document" | "poll";
  mediaPath?: string | null;
}) {
  const content = outboundCanonicalContent(input);
  return `${input.clientId}:${input.mediaType}:${content}`;
}

async function shouldSendBotOutbound(input: {
  clientId: string;
  phone?: string | null;
  body?: string | null;
  mediaType: "text" | "audio" | "image" | "document" | "poll";
  mediaPath?: string | null;
  windowMinutes?: number;
}) {
  if(botTestAllowedPhones.size) {
    const stored=input.phone?null:await getClientAutomationStateById(input.clientId);
    const phone=input.phone||stored?.phone||null;
    if(!isBotTestPhoneAllowed(phone)) {
      await recordTrafficEvent({clientId:input.clientId,phone,eventType:'bot_test_isolation_suppressed',channel:'whatsapp',platform:'whatsapp',metadata:{direction:'outbound'}});
      return false;
    }
  }
  const windowMinutes = input.windowMinutes
    ?? (input.mediaType === "audio" ? 24 * 60
      : input.mediaType === "poll" ? 10
        : /https:\/\/ec10talentos\.com\/agendar/i.test(input.body || "") ? 60
          : 5);

  const recentOutboundCount = await countRecentOutboundChatMessages({
    clientId: input.clientId,
    windowMinutes: config.WHATSAPP_RATE_LIMIT_WINDOW_MINUTES
  });
  const interactive=sdrOutboundContext.getStore();
  const sdrTurn=interactive?.clientId===input.clientId?interactive:null;
  const maxOutbound=sdrTurn?.maxOutbound??config.WHATSAPP_MAX_OUTBOUND_PER_CONTACT_WINDOW;
  if (recentOutboundCount >= maxOutbound) {
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.phone ?? null,
      eventType: "bot_outbound_rate_limited",
      channel: "whatsapp",
      platform: "whatsapp",
      metadata: {
        mediaType: input.mediaType,
        mediaPath: input.mediaPath ?? null,
        body: input.body ?? null,
        windowMinutes: config.WHATSAPP_RATE_LIMIT_WINDOW_MINUTES,
        maxOutbound,
        recentOutboundCount
      }
    });
    return false;
  }

  if (input.mediaType === "audio") {
    const recentAudioCount = await countRecentOutboundChatMessages({
      clientId: input.clientId,
      mediaType: "audio",
      windowMinutes: config.WHATSAPP_AUDIO_RATE_LIMIT_WINDOW_MINUTES
    });
    if (recentAudioCount >= config.WHATSAPP_MAX_AUDIO_PER_CONTACT_WINDOW) {
      await recordTrafficEvent({
        clientId: input.clientId,
        phone: input.phone ?? null,
        eventType: "bot_audio_rate_limited",
        channel: "whatsapp",
        platform: "whatsapp",
        metadata: {
          mediaPath: input.mediaPath ?? null,
          windowMinutes: config.WHATSAPP_AUDIO_RATE_LIMIT_WINDOW_MINUTES,
          maxAudio: config.WHATSAPP_MAX_AUDIO_PER_CONTACT_WINDOW,
          recentAudioCount
        }
      });
      return false;
    }
  }

  const lockKey = buildOutboundSendLockKey({
    clientId: input.clientId,
    body: input.body ?? null,
    mediaType: input.mediaType,
    mediaPath: input.mediaPath ?? null
  });
  const lockAcquired = await tryAcquireBotDedupeLock({
      key: `whatsapp:outbound:${lockKey}`,
    scope: "whatsapp_outbound",
    clientId: input.clientId,
    phone: input.phone ?? null,
    ttlSeconds: windowMinutes * 60,
    metadata: {
      mediaType: input.mediaType,
      mediaPath: input.mediaPath ?? null,
      body: input.body ?? null
    }
  });

  if (!lockAcquired) {
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.phone ?? null,
      eventType: "bot_outbound_duplicate_suppressed",
      channel: "whatsapp",
      platform: "whatsapp",
      metadata: {
        mediaType: input.mediaType,
        mediaPath: input.mediaPath ?? null,
        body: input.body ?? null,
        windowMinutes,
        reason: "dedupe_lock"
      }
    });
    return false;
  }

  const duplicate = await hasRecentOutboundChatMessage({
    clientId: input.clientId,
    body: input.body ?? null,
    mediaType: input.mediaType,
    mediaPath: input.mediaPath ?? null,
    windowMinutes
  });

  const fallbackTextDuplicate = input.mediaType === "poll"
    ? await hasRecentOutboundChatMessage({
        clientId: input.clientId,
        body: input.body ?? null,
        mediaType: "text",
        mediaPath: null,
        windowMinutes
      })
    : false;

  if (!duplicate && !fallbackTextDuplicate) return true;

  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone ?? null,
    eventType: "bot_outbound_duplicate_suppressed",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: {
      mediaType: input.mediaType,
      mediaPath: input.mediaPath ?? null,
      body: input.body ?? null,
      windowMinutes
    }
  });
  return false;
}

function isWhatsAppProtocolTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Runtime\.callFunctionOn timed out|protocolTimeout|timed out/i.test(message);
}

async function withOperationTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function sendWhatsAppWithRetry(task: () => Promise<any>, attempts = 1): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      // WhatsApp Web timeouts are ambiguous: the message may have been sent even
      // when Puppeteer does not return a result. Retrying here can duplicate sends.
      if (attempt >= attempts || isWhatsAppProtocolTimeout(error)) break;
      await wait(2500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Falha ao enviar pelo WhatsApp."));
}

function getWhatsAppMessageId(message: any) {
  const serialized = message?.id?._serialized ?? message?.id?.$1 ?? null;
  const stringified = typeof message?.id?.toString === "function" ? message.id.toString() : null;
  const value = serialized ?? (stringified && stringified !== "[object Object]" ? stringified : null) ?? message?.id?.id ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getWhatsAppChatId(message: any) {
  const candidate = message?.to ?? message?.from ?? message?.id?.remote ?? null;
  const serialized = candidate?._serialized ?? candidate?.$1 ?? null;
  const stringified = typeof candidate?.toString === "function" ? candidate.toString() : null;
  const value = typeof candidate === "string"
    ? candidate
    : serialized ?? (stringified && stringified !== "[object Object]" ? stringified : null);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getWhatsAppAck(message: any) {
  const value = Number(message?.ack);
  return Number.isFinite(value) ? value : null;
}

function isWhatsAppAckConfirmed(ack: number | null | undefined) {
  return typeof ack === "number" && ack >= 1;
}

function resolveWhatsAppAckWaiters(whatsappMessageId: string, ack: number) {
  const waiters = whatsappAckWaiters.get(whatsappMessageId);
  if (!waiters?.length) return;

  const remaining: WhatsAppAckWaiter[] = [];
  for (const waiter of waiters) {
    if (ack >= waiter.minAck) {
      clearTimeout(waiter.timeout);
      waiter.resolve(ack);
    } else {
      remaining.push(waiter);
    }
  }

  if (remaining.length) {
    whatsappAckWaiters.set(whatsappMessageId, remaining);
  } else {
    whatsappAckWaiters.delete(whatsappMessageId);
  }
}

async function waitForWhatsAppServerAck(message: any, timeoutMs = config.WHATSAPP_DELIVERY_ACK_TIMEOUT_MS) {
  const initialAck = getWhatsAppAck(message);
  if (isWhatsAppAckConfirmed(initialAck)) return initialAck;

  const whatsappMessageId = getWhatsAppMessageId(message);
  if (!whatsappMessageId) return initialAck;

  return new Promise<number | null>((resolve) => {
    const timeout = setTimeout(() => {
      const waiters = whatsappAckWaiters.get(whatsappMessageId) ?? [];
      const remaining = waiters.filter((waiter) => waiter.resolve !== resolve);
      if (remaining.length) {
        whatsappAckWaiters.set(whatsappMessageId, remaining);
      } else {
        whatsappAckWaiters.delete(whatsappMessageId);
      }
      resolve(getWhatsAppAck(message));
    }, Math.max(1000, timeoutMs));

    const waiter = { minAck: 1, resolve, timeout };
    whatsappAckWaiters.set(whatsappMessageId, [...(whatsappAckWaiters.get(whatsappMessageId) ?? []), waiter]);
  });
}

function nextPendingAckRetryAt(attempts: number) {
  const baseMs = Math.max(60_000, config.WHATSAPP_PENDING_ACK_RETRY_MS);
  const multiplier = Math.min(6, Math.max(1, attempts + 1));
  return new Date(Date.now() + baseMs * multiplier).toISOString();
}

async function sendBotText(client: any, chatId: string, clientId: string, body: string, delayRange?: [number, number]) {
  body = sanitizeBotOutboundBody(body);
  return withOutboundSendLock(buildOutboundSendLockKey({ clientId, body, mediaType: "text" }), async () => {
    const pauseReason = await getImmediateOutboundPauseReason();
    if (pauseReason) {
      await recordImmediateOutboundPaused({ clientId, phone: chatId, mediaType: "text", body, reason: pauseReason });
      return false;
    }
    if (!(await shouldSendBotOutbound({ clientId, body, mediaType: "text" }))) return false;
    await sendTypingPause(client, chatId, delayRange?.[0] ?? 1800, delayRange?.[1] ?? 3600);
    let sent: any;
    try {
      sent = await sendTextWithConversationConfirmation(client, chatId, body);
    } catch (error) {
      if (!isRecoverableWhatsAppExecutionError(error)) throw error;

      const firstConfirmationClient = activeWhatsAppClient ?? client;
      const firstConfirmation = await findRecentSentText(firstConfirmationClient, chatId, body).catch(() => null);
      if (firstConfirmation) {
        sent = firstConfirmation;
      } else {
        await wait(1800);
        const retryClient = activeWhatsAppClient ?? client;
        const secondConfirmation = await findRecentSentText(retryClient, chatId, body).catch(() => null);
        if (secondConfirmation) {
          sent = secondConfirmation;
        } else {
          try {
            sent = await sendTextWithConversationConfirmation(retryClient, chatId, body);
          } catch (retryError) {
            const stored = await getClientAutomationStateById(clientId);
            await scheduleOutboundRecoveryTextMessage({
              clientId,
              phone: stored?.phone ?? chatId,
              body,
              scheduledAt: new Date(Date.now() + 3000).toISOString(),
              errorMessage: `Recuperacao automatica apos falha do WhatsApp Web: ${getErrorMessage(retryError)}`
            });
            await recordTrafficEvent({
              clientId,
              phone: stored?.phone ?? chatId,
              eventType: "whatsapp_immediate_recovery_queued",
              channel: "whatsapp",
              platform: "whatsapp",
              metadata: { firstError: getErrorMessage(error), retryError: getErrorMessage(retryError) }
            });
            return true;
          }
        }
      }
    }
    await recordOutboundChatMessage({
      clientId,
      body,
      mediaType: "text",
      whatsappMessageId: getWhatsAppMessageId(sent),
      whatsappChatId: getWhatsAppChatId(sent),
      whatsappAck: getWhatsAppAck(sent)
    });
    return true;
  });
}

function buildPollFallbackBody(question: string, options: string[]) {
  return [
    question,
    ...options.map((option, index) => `${index + 1}. ${option}`)
  ].join("\n");
}

async function sendBotPoll(input: {
  client: any;
  chatId: string;
  clientId: string;
  question: string;
  options: string[];
  fallbackBody?: string;
  delayRange?: [number, number];
}) {
  const fallbackBody = input.fallbackBody ?? buildPollFallbackBody(input.question, input.options);
  return withOutboundSendLock(
    buildOutboundSendLockKey({ clientId: input.clientId, body: fallbackBody, mediaType: "poll" }),
    async () => {
      const pauseReason = await getImmediateOutboundPauseReason();
      if (pauseReason) {
        await recordImmediateOutboundPaused({
          clientId: input.clientId,
          phone: input.chatId,
          mediaType: "poll",
          body: fallbackBody,
          reason: pauseReason
        });
        return false;
      }
      if (!(await shouldSendBotOutbound({ clientId: input.clientId, body: fallbackBody, mediaType: "poll" }))) return false;
      if (typeof Poll !== "function") {
        return sendBotText(input.client, input.chatId, input.clientId, fallbackBody, input.delayRange);
      }

      try {
        await sendTypingPause(
          input.client,
          input.chatId,
          input.delayRange?.[0] ?? 1800,
          input.delayRange?.[1] ?? 3600
        );
        const poll = new Poll(input.question, input.options, { allowMultipleAnswers: false, messageSecret: undefined });
        const sent = await sendWhatsAppWithRetry(() => input.client.sendMessage(input.chatId, poll));
        await recordOutboundChatMessage({
          clientId: input.clientId,
          body: fallbackBody,
          mediaType: "poll",
          whatsappMessageId: getWhatsAppMessageId(sent),
          whatsappChatId: getWhatsAppChatId(sent),
          whatsappAck: getWhatsAppAck(sent)
        });
        return true;
      } catch (error) {
        console.warn("Failed to send WhatsApp poll, falling back to text", error instanceof Error ? error.message : String(error));
        return sendBotText(input.client, input.chatId, input.clientId, fallbackBody, input.delayRange);
      }
    }
  );
}

async function sendBotAudio(client: any, chatId: string, clientId: string, audioPath: string) {
  return withOutboundSendLock(buildOutboundSendLockKey({ clientId, mediaType: "audio", mediaPath: audioPath }), async () => {
    if(isEurocampAudio(audioPath)) {
      const contact=await getClientAutomationStateById(clientId);
      const state=contact?await getBotConversationState(contact.phone):null;
      if(!canSendEc10Audio(state?.athlete_age??contact?.athlete_age,audioPath))return false;
    }
    const pauseReason = await getImmediateOutboundPauseReason();
    if (pauseReason) {
      await recordImmediateOutboundPaused({ clientId, phone: chatId, mediaType: "audio", mediaPath: audioPath, reason: pauseReason });
      return false;
    }
    if (await hasRecentOutboundChatMessage({
      clientId,
      mediaType: "audio",
      mediaPath: audioPath,
      windowMinutes: 24 * 60
    })) {
      return true;
    }
    await sendTypingPause(client, chatId, 900, 1800);
    const resolvedAudioPath = resolveProjectPath(audioPath);
    let sent: any;
    try {
      const voiceMedia = MessageMedia.fromFilePath(resolvedAudioPath);
      sent = await sendWhatsAppWithRetry(() => client.sendMessage(chatId, voiceMedia, {
        sendAudioAsVoice: true,
        waitUntilMsgSent: true
      }));
    } catch (voiceError) {
      const confirmationClient = activeWhatsAppClient ?? client;
      sent = await findRecentSentAudio(confirmationClient, chatId).catch(() => null);
      if (!sent) {
        try {
          const regularAudio = MessageMedia.fromFilePath(resolvedAudioPath);
          sent = await sendWhatsAppWithRetry(() => confirmationClient.sendMessage(chatId, regularAudio, {
            waitUntilMsgSent: true
          }));
        } catch (regularError) {
          sent = await findRecentSentAudio(activeWhatsAppClient ?? client, chatId).catch(() => null);
          if (!sent) {
            throw new Error(
              `Falha no áudio como voz (${getErrorMessage(voiceError)}) e como arquivo (${getErrorMessage(regularError)}).`
            );
          }
        }
      }
    }
    if (!sent) throw new Error("WhatsApp não confirmou o envio do áudio.");
    await recordOutboundChatMessage({
      clientId,
      body: null,
      mediaType: "audio",
      mediaPath: audioPath,
      whatsappMessageId: getWhatsAppMessageId(sent),
      whatsappChatId: getWhatsAppChatId(sent),
      whatsappAck: getWhatsAppAck(sent)
    });
    return true;
  });
}

async function sendPlanAudioSequence(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  athleteAge: number;
  plan: Ec10LeadPlan;
}) {
  if(input.athleteAge>=18&&input.athleteAge<=19&&input.plan.serviceInterest==='eurocamp') {
    await sendBotText(input.client,input.chatId,input.clientId,
      'A EC10 orienta sua carreira e analisa seu momento no futebol, seus vídeos e o caminho de preparação para uma experiência internacional. Na reunião, nosso time explica o formato adequado ao seu perfil e tira suas dúvidas.',[900,1800]);
  }
  for (const [index, item] of input.plan.audioItems.entries()) {
    const sent = await sendBotAudio(input.client, input.chatId, input.clientId, item.audioPath);
    if (sent) {
      await recordTrafficEvent({
        clientId: input.clientId,
        phone: input.phone,
        eventType: "bot_audio_sent",
        channel: "whatsapp",
        platform: "meta_ads",
        serviceInterest: input.plan.serviceInterest,
        athleteAge: input.athleteAge,
        ageGroup: input.plan.ageGroup,
        qualityScore: input.plan.leadScore,
        metadata: {
          flowKind: input.plan.flowKind,
          audioPath: item.audioPath,
          audioLabel: item.label,
          audioIndex: index + 1
        }
      });
    }

    if (index < input.plan.audioItems.length - 1) {
      await naturalPause(2500, 5500);
    }
  }
}

async function notifyEc10SellerMeeting(client: any, seller: Ec10MeetingSeller, body: string) {
  await sendDirectWhatsAppText(client, seller.phone, body);
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasConfirmedGuardian(state: BotConversationState | null) {
  if (!state?.athlete_age || state.athlete_age >= 18) return true;
  const metadata = asMetadataRecord(state.metadata);
  const role = normalizeText(state.role_answer ?? "");
  const responsibleRole = role === "responsavel"
    || role.includes("pai")
    || role.includes("mae")
    || role.includes("responsavel legal");
  return metadata.guardianConfirmed === true && responsibleRole;
}

function isAmbiguousGuardianAffirmation(value: string | null | undefined) {
  return /^(?:1|01|sim|s|ss)$/i.test(String(value || "").trim());
}

function guardianIdentityPreviouslyContradicted(state: BotConversationState) {
  const role = normalizeText(state.role_answer || "");
  const metadata = asMetadataRecord(state.metadata);
  return role === "atleta"
    || role === "nao responsavel"
    || role === "nao_responsavel"
    || metadata.guardianConfirmed === false && Boolean(metadata.guardianDeniedAt);
}

async function askGuardianConfirmation(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  previous: BotConversationState;
}) {
  await sendBotPoll({
    client: input.client,
    chatId: input.chatId,
    clientId: input.clientId,
    question: guardianPollQuestion,
    options: guardianPollOptions,
    fallbackBody: ec10Messages.guardianQuestion,
    delayRange: [900, 1800]
  });
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: input.previous,
    stage: "awaiting_guardian_confirmation",
    completedAt: null,
    metadata: {
      guardianConfirmationAskedAt: new Date().toISOString(),
      guardianConfirmed: false
    }
  });
}

async function ensureGuardianBeforeMeeting(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  state: BotConversationState | null;
}) {
  if (hasConfirmedGuardian(input.state)) return true;
  if (!input.state) return false;
  await askGuardianConfirmation({ ...input, previous: input.state });
  return false;
}

function readMetadataText(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function buildMetaTrafficContext(input: {
  phone: string;
  state: BotConversationState;
  attributionMetadata: Record<string, unknown>;
  eventKind: "QualifiedLead" | "Schedule" | "Purchase";
}) {
  const city = readMetadataText(input.attributionMetadata, "city", "geoCity");
  const geo = resolveBrazilTrafficGeo({ city, phone: input.phone });
  const role = readMetadataText(input.attributionMetadata, "role") || input.state.role_answer || "nao_informado";
  const metadataAthleteAge = Number(input.attributionMetadata.athleteAge ?? 0);
  const athleteAge = input.state.athlete_age ?? (Number.isFinite(metadataAthleteAge) && metadataAthleteAge > 0 ? metadataAthleteAge : null);
  const ageGroup = (input.state.age_group ?? readMetadataText(input.attributionMetadata, "ageGroup")) || "sem_faixa";
  const persona = role.toLowerCase().includes("respons")
    && athleteAge
    && athleteAge >= 13
    && athleteAge <= 17
      ? "responsavel_atleta_13_17"
      : role.toLowerCase().includes("respons")
        ? "responsavel_atleta"
        : athleteAge && athleteAge >= 13 && athleteAge <= 17
          ? "atleta_13_17"
          : "triagem_plano_carreira";

  return {
    city: geo.city || city || null,
    state: geo.stateCode,
    customData: {
      persona,
      role,
      athlete_age: athleteAge ?? 0,
      age_group: ageGroup,
      geo_priority: geo.priority,
      geo_state: geo.stateCode ?? "nao_identificado",
      event_kind: input.eventKind,
      ideal_customer_profile: persona === "responsavel_atleta_13_17" || input.eventKind === "Schedule",
      optimization_note: "responsavel_13_17_sp_mg_agendamento"
    }
  };
}

async function sendMeetingSchedulingIntentSignal(input: {
  clientId: string;
  phone: string;
  state: BotConversationState;
  source: string;
  body?: string | null;
  seller?: Ec10MeetingSeller | null;
}) {
  const eventId = `crm-${input.clientId}-meeting-intent`;
  const attribution = await getClientTrafficAttribution(input.clientId).catch((error) => {
    console.warn("Failed to load client attribution for scheduling intent CAPI", error instanceof Error ? error.message : String(error));
    return null;
  });
  const attributionMetadata = asMetadataRecord(attribution?.attribution_metadata);
  const metaContext = buildMetaTrafficContext({
    phone: input.phone,
    state: input.state,
    attributionMetadata,
    eventKind: "QualifiedLead"
  });
  const capiSent = await sendMetaQualityEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventName: "QualifiedLead",
    status: "quente",
    serviceInterest: attribution?.service_interest ?? input.state.service_interest,
    leadScore: Math.max(85, attribution?.lead_score ?? 0),
    fbclid: attribution?.fbclid ?? null,
    fbc: typeof attributionMetadata.fbc === "string" ? attributionMetadata.fbc : null,
    fbp: typeof attributionMetadata.fbp === "string" ? attributionMetadata.fbp : null,
    city: metaContext.city,
    state: metaContext.state,
    country: "BR",
    eventSourceUrl: typeof attributionMetadata.eventSourceUrl === "string" ? attributionMetadata.eventSourceUrl : input.state.lead_page_url,
    eventTime: new Date(),
    eventId,
    customData: metaContext.customData
  });

  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "QualifiedLead",
    channel: "whatsapp",
    platform: "meta_ads",
    serviceInterest: attribution?.service_interest ?? input.state.service_interest,
    athleteAge: input.state.athlete_age,
    ageGroup: input.state.age_group,
    leadStatus: "quente",
    qualityScore: 85,
    metadata: {
      source: input.source,
      eventId,
      capiSent,
      metaContext: metaContext.customData,
      body: input.body ?? null,
      sellerName: input.seller?.name ?? null,
      sellerRoute: input.seller?.route ?? null
    }
  });
}

async function notifySellerAboutFollowUp(input: {
  client: any;
  seller: Ec10MeetingSeller;
  phone: string;
  choice: string;
  state: BotConversationState;
}) {
  const serviceLabel = input.state.service_interest === "plano_internacional"
    ? "Plano internacional"
    : input.state.service_interest === "plano_carreira"
      ? "Plano de carreira"
      : "EC10";
  const body = [
    "Lead respondeu o follow-up EC10.",
    `Lead: ${input.phone}`,
    `Opcao: ${input.choice}`,
    `Servico: ${serviceLabel}`,
    input.state.athlete_age ? `Idade informada: ${input.state.athlete_age}` : null,
    "",
    "Prioridade: responder com contexto e tentar converter para reuniao."
  ].filter(Boolean).join("\n");

  await sendDirectWhatsAppText(input.client, input.seller.phone, body);
}

function isStoredMeetingSchedule(value: unknown): value is Ec10MeetingSchedule {
  const schedule = value as Partial<Ec10MeetingSchedule>;
  return Boolean(
    schedule
      && typeof schedule.startsAt === "string"
      && typeof schedule.endsAt === "string"
      && typeof schedule.dateLabel === "string"
      && typeof schedule.timeLabel === "string"
  );
}

function readStoredMeetingSchedule(state: BotConversationState): Ec10MeetingSchedule | null {
  const metadata = asMetadataRecord(state.metadata);
  return isStoredMeetingSchedule(metadata.meeting) ? metadata.meeting : null;
}

function describeStoredMeeting(state: BotConversationState) {
  const schedule = readStoredMeetingSchedule(state);
  if (schedule) return `${schedule.dateLabel}, das ${schedule.timeLabel}`;
  return "horario registrado no CRM";
}

async function resolveMeetingSellerFromState(state: BotConversationState): Promise<Ec10MeetingSeller> {
  const metadata = asMetadataRecord(state.metadata);
  const sellerName = typeof metadata.meetingSellerName === "string" ? metadata.meetingSellerName : null;
  const sellerPhone = typeof metadata.meetingSellerPhone === "string" ? metadata.meetingSellerPhone : null;
  const sellerRoute = metadata.meetingSellerRoute === "plano_internacional" || metadata.meetingSellerRoute === "plano_carreira"
    ? metadata.meetingSellerRoute
    : state.service_interest === "plano_internacional"
      ? "plano_internacional"
      : "plano_carreira";

  if (sellerName && sellerPhone) {
    return {
      name: sellerName,
      phone: sellerPhone,
      route: sellerRoute
    };
  }

  return resolveEc10MeetingSeller(state.service_interest);
}

function buildMeetingPresenceSellerMessage(input: {
  phone: string;
  state: BotConversationState;
  seller: Ec10MeetingSeller;
}) {
  const serviceLabel = input.state.service_interest === "plano_internacional"
    ? "Plano internacional"
    : input.state.service_interest === "plano_carreira"
      ? "Plano de carreira"
      : "EC10";

  return [
    "Confirmacao de presenca EC10.",
    `Lead: +${input.phone}`,
    `Servico: ${serviceLabel}`,
    `Reuniao: ${describeStoredMeeting(input.state)}`,
    `Vendedor responsavel: ${input.seller.name}`,
    ec10GoogleMeetUrl ? `Google Meet: ${ec10GoogleMeetUrl}` : null,
    "",
    "Status: lead confirmou presenca pelo WhatsApp."
  ].filter(Boolean).join("\n");
}

async function handleMeetingPresenceOption(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  currentState: BotConversationState;
  body: string | null;
}) {
  const choice = classifyMeetingPresenceChoice(input.body);
  if (!choice) return false;
  const meeting = readStoredMeetingSchedule(input.currentState);
  if (!meeting) return false;

  const selectedOption = (input.body ?? "").trim();
  const seller = await resolveMeetingSellerFromState(input.currentState);
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_meeting_presence_option_selected",
    channel: "whatsapp",
    platform: "whatsapp",
    serviceInterest: input.currentState.service_interest,
    athleteAge: input.currentState.athlete_age,
    ageGroup: input.currentState.age_group,
    leadStatus: choice === "confirm" ? "triagem" : "aguardando_cliente",
    qualityScore: choice === "confirm" ? 90 : 70,
    metadata: {
      choice,
      selectedOption,
      meeting,
      sellerName: seller.name,
      sellerRoute: seller.route
    }
  });

  if (choice === "confirm") {
    const confirmedAt = new Date().toISOString();
    await appendClientTags(input.clientId, [meetingPresenceConfirmedTag]);
    await cancelQueuedFollowUpMessages(input.clientId, "Lead confirmou presenca em reuniao ja agendada.");
    await persistEc10State({
      clientId: input.clientId,
      phone: input.phone,
      previous: input.currentState,
      stage: "completed",
      metadata: {
        meetingPresenceConfirmedAt: confirmedAt,
        meetingPresenceConfirmedBody: selectedOption,
        meetingPresenceSellerNotifiedAt: confirmedAt
      }
    });
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Presenca confirmada. Obrigado. O vendedor responsavel recebeu sua confirmacao.",
      [900, 1800]
    );
    await sendDirectWhatsAppText(input.client, seller.phone, buildMeetingPresenceSellerMessage({
      phone: input.phone,
      state: input.currentState,
      seller
    }));
    return true;
  }

  if (choice === "reschedule") {
    const requestedAt = new Date().toISOString();
    await appendClientTags(input.clientId, [meetingPresenceRescheduleTag]);
    await cancelQueuedMeetingMessages(input.clientId, "Lead pediu reagendamento da reuniao.");
    await persistEc10State({
      clientId: input.clientId,
      phone: input.phone,
      previous: input.currentState,
      stage: "awaiting_meeting_date",
      completedAt: null,
      metadata: {
        previousMeetingBeforeReschedule: readStoredMeetingSchedule(input.currentState),
        meetingRescheduleRequestedAt: requestedAt,
        meetingRescheduleRequestedBody: selectedOption
      }
    });
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Sem problema. Vou te mostrar novamente as datas disponiveis para reagendar.",
      [900, 1800]
    );
    await askMeetingDate(input.client, input.chatId, input.clientId, input.phone, input.currentState);
    return true;
  }

  const declinedAt = new Date().toISOString();
  await appendClientTags(input.clientId, [meetingPresenceCannotAttendTag]);
  await cancelQueuedMeetingMessages(input.clientId, "Lead informou que nao podera participar da reuniao.");
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: input.currentState,
    stage: "completed",
    metadata: {
      meetingCannotAttendAt: declinedAt,
      meetingCannotAttendBody: selectedOption,
      meetingCannotAttendAudioPath: meetingPresenceAudioPath
    }
  });
  await scheduleOutboundAudioMessage({
    clientId: input.clientId,
    phone: input.phone,
    mediaPath: meetingPresenceAudioPath,
    scheduledAt: new Date().toISOString()
  });
  return true;
}

async function sendFollowUpDecisionPoll(input: {
  client: any;
  chatId: string;
  clientId: string;
  question?: string;
}) {
  await sendBotPoll({
    client: input.client,
    chatId: input.chatId,
    clientId: input.clientId,
    question: input.question ?? "Como voce prefere seguir agora?",
    options: ["Quero agendar", "Falar com consultor", "Ver mais tarde"],
    delayRange: [900, 1800]
  });
}

async function askAgeBeforeFollowUpSchedule(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  currentState: BotConversationState;
}) {
  await sendBotText(
    input.client,
    input.chatId,
    input.clientId,
    "Perfeito. Para eu te direcionar certo antes da agenda, me mande a idade do atleta em numero. Exemplo: 15.",
    [900, 1800]
  );
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: input.currentState,
    stage: "awaiting_age",
    completedAt: null,
    metadata: {
      followUpRequestedScheduleAt: new Date().toISOString()
    }
  });
}

async function handleEc10FollowUpOption(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  currentState: BotConversationState;
  body: string | null;
}) {
  const choice = classifyFollowUpChoice(input.body);
  if (!choice) return false;

  const selectedOption = (input.body ?? "").trim();
  const seller = await resolveEc10MeetingSeller(input.currentState.service_interest);
  await appendClientTags(input.clientId, ["ec10_followup_respondeu"]);
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_followup_option_selected",
    channel: "whatsapp",
    platform: "meta_ads",
    serviceInterest: input.currentState.service_interest,
    athleteAge: input.currentState.athlete_age,
    ageGroup: input.currentState.age_group,
    leadStatus: choice === "schedule" ? "quente" : "aguardando_cliente",
    qualityScore: choice === "schedule" ? 88 : 72,
    metadata: {
      choice,
      selectedOption,
      stage: input.currentState.stage,
      sellerName: seller.name,
      sellerRoute: seller.route
    }
  });

  if (choice === "schedule") {
    await sendMeetingSchedulingIntentSignal({
      clientId: input.clientId,
      phone: input.phone,
      state: input.currentState,
      source: "bot_followup_schedule_requested",
      body: input.body,
      seller
    });
    if (!input.currentState.athlete_age) {
      await askAgeBeforeFollowUpSchedule(input);
      return true;
    }
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Perfeito. Vou te mostrar os horarios disponiveis agora.",
      [800, 1600]
    );
    await askMeetingDate(input.client, input.chatId, input.clientId, input.phone, input.currentState);
    return true;
  }

  if (choice === "values") {
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Perfeito. Os valores dependem do tipo de plano e do momento do atleta. Para nao te passar algo generico, o ideal e uma conversa rapida para entender o caso e mostrar o caminho mais adequado.",
      [900, 1800]
    );
    await notifySellerAboutFollowUp({
      client: input.client,
      seller,
      phone: input.phone,
      choice: selectedOption,
      state: input.currentState
    }).catch((error) => {
      console.warn("Failed to notify seller about value follow-up", error instanceof Error ? error.message : String(error));
    });
    await sendFollowUpDecisionPoll({ ...input, question: "Quer seguir de qual forma?" });
    return true;
  }

  if (choice === "fit") {
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Faz sentido. A reuniao serve exatamente para isso: entender idade, nivel, objetivo e rotina do atleta antes de indicar qualquer plano.",
      [900, 1800]
    );
    await sendFollowUpDecisionPoll({ ...input, question: "Quer validar isso com um consultor?" });
    return true;
  }

  if (choice === "how") {
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Funciona assim: primeiro entendemos o perfil do atleta e da familia, depois mostramos o plano mais adequado e os proximos passos. A reuniao evita decisao no escuro.",
      [900, 1800]
    );
    await sendFollowUpDecisionPoll({ ...input, question: "Quer ver os horarios ou falar com consultor?" });
    return true;
  }

  if (choice === "seller") {
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Perfeito. Vou acionar um consultor para te ajudar por aqui. Se preferir adiantar, tambem posso te enviar os horarios da reuniao.",
      [900, 1800]
    );
    await notifySellerAboutFollowUp({
      client: input.client,
      seller,
      phone: input.phone,
      choice: selectedOption,
      state: input.currentState
    }).catch((error) => {
      console.warn("Failed to notify seller about follow-up", error instanceof Error ? error.message : String(error));
    });
    await sendFollowUpDecisionPoll({ ...input, question: "Como prefere continuar?" });
    return true;
  }

  if (choice === "later") {
    await markClientForFollowUp({
      clientId: input.clientId,
      status: "aguardando_cliente",
      nextFollowUpAt: addMinutes(new Date(), 240).toISOString(),
      tags: ["ec10_followup_aguardar"],
      note: `Lead pediu para ver mais tarde no follow-up: ${selectedOption}`
    });
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Sem problema. Vou te chamar novamente mais tarde com as opcoes.",
      [900, 1800]
    );
    return true;
  }

  if (choice === "close") {
    await cancelQueuedFollowUpMessages(input.clientId, "Lead pediu para encerrar o follow-up.");
    await markClientForFollowUp({
      clientId: input.clientId,
      status: "aguardando_cliente",
      nextFollowUpAt: addMinutes(new Date(), 10_080).toISOString(),
      tags: ["ec10_followup_encerrado"],
      note: `Lead encerrou por enquanto no follow-up: ${selectedOption}`
    });
    await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      "Combinado, vou encerrar por enquanto. Se quiser retomar, e so responder por aqui.",
      [900, 1800]
    );
    return true;
  }

  return false;
}

function readMeetingDateOptions(state: BotConversationState | null) {
  const metadata = asMetadataRecord(state?.metadata);
  const options = Array.isArray(metadata.meetingDateOptions) ? metadata.meetingDateOptions : [];
  return options.filter(isMeetingDateOption);
}

function readMeetingTimeOptions(state: BotConversationState | null) {
  const metadata = asMetadataRecord(state?.metadata);
  const options = Array.isArray(metadata.meetingTimeOptions) ? metadata.meetingTimeOptions : [];
  return options.filter(isMeetingTimeOption);
}

function readSelectedMeetingDate(state: BotConversationState | null) {
  const metadata = asMetadataRecord(state?.metadata);
  return isMeetingDateOption(metadata.meetingSelectedDate) ? metadata.meetingSelectedDate : null;
}

function isAllowedMeetingDateOption(option: Ec10MeetingDateOption, allowedOptions: Ec10MeetingDateOption[]) {
  return allowedOptions.some((allowed) => allowed.isoDate === option.isoDate);
}

function isAllowedMeetingTimeOption(option: Ec10MeetingTimeOption, allowedOptions: Ec10MeetingTimeOption[]) {
  const optionMinute = option.minute ?? 0;
  return allowedOptions.some((allowed) => allowed.hour === option.hour && (allowed.minute ?? 0) === optionMinute);
}

function readRequestedFlow(state: BotConversationState | null): Ec10FlowKind | null {
  const metadata = asMetadataRecord(state?.metadata);
  return isEc10FlowKind(metadata.requestedFlow) ? metadata.requestedFlow : null;
}

function buildConfiguredMeetAccessMetadata() {
  if (!ec10GoogleMeetUrl) return {};
  return {
    meetingMeetAccessOpenedAt: new Date().toISOString(),
    meetingMeetAccessOpenStatus: "opened_manual",
    meetingMeetAccessType: "OPEN",
    meetingMeetEntryPointAccess: "ALL",
    meetingMeetConfiguredBy: "selecaoec10_google_meet_ui"
  };
}

function isRecentStaleInterestPollReply(state: BotConversationState | null, body: string | null, promptKey: string) {
  return isYesNoPollReply(body)
    && wasPromptSentRecently(asMetadataRecord(state?.metadata), promptKey, new Date(), 45_000);
}

function isAudioSequenceInProgress(state: BotConversationState | null) {
  return isAudioSequenceInProgressMetadata(asMetadataRecord(state?.metadata));
}

function isInterestInformationDetour(body: string | null | undefined) {
  const text = String(body ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(como funciona|funciona|explica|detalhes|saber mais|entender melhor|qual o plano|valor|preco|quanto custa|mensalidade|investimento|onde|endereco|localizacao|teste|peneira|avaliacao|vaga|clube|atendente|humano|consultor)\b/.test(text);
}

async function tryRecoverFlowWithAi(input: {
  clientId: string;
  phone: string;
  state: BotConversationState;
  body: string | null;
  mediaType: string;
  reason: string;
}): Promise<BotRecoveryResult | null> {
  if (!canUseAiFallback()) {
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.phone,
      eventType: "bot_ai_fallback_limit_reached",
      channel: "whatsapp",
      platform: configuredAiPlatform(),
      serviceInterest: input.state.service_interest,
      athleteAge: input.state.athlete_age,
      ageGroup: input.state.age_group,
      metadata: {
        stage: input.state.stage,
        reason: input.reason
      }
    });
    return null;
  }

  const recovery = await recoverEc10FlowWithAi({
    stage: input.state.stage,
    message: input.body,
    mediaType: input.mediaType,
    athleteAge: input.state.athlete_age,
    ageGroup: input.state.age_group,
    serviceInterest: input.state.service_interest
  });

  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_ai_fallback_used",
    channel: "whatsapp",
    platform: configuredAiPlatform(),
    serviceInterest: input.state.service_interest,
    athleteAge: input.state.athlete_age,
    ageGroup: input.state.age_group,
    metadata: {
      stage: input.state.stage,
      reason: input.reason,
      body: input.body,
      recovery
    }
  });

  if (!recovery || recovery.action === "none" || recovery.confidence < 0.55) return null;
  return recovery;
}

function readAiRecoveryAttempts(state: BotConversationState | null) {
  const value = Number(asMetadataRecord(state?.metadata).aiRecoveryAttempts ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isExplicitHumanRequest(body: string | null | undefined) {
  const text = normalizeText(body);
  return /\b(quero falar com (uma pessoa|alguem|atendente|consultor)|chama (um |o )?consultor|me passa para (uma pessoa|alguem|atendente|consultor)|atendimento humano)\b/.test(text);
}

async function maybeEscalateAfterRecovery(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  state: BotConversationState;
  body: string | null;
}) {
  const attempts = readAiRecoveryAttempts(input.state) + 1;
  const shouldEscalate = attempts >= 4 || (attempts >= 2 && isExplicitHumanRequest(input.body));
  if (!shouldEscalate) return attempts;

  await updateClientAiProfile({
    clientId: input.clientId,
    serviceInterest: input.state.service_interest,
    athleteAge: input.state.athlete_age,
    leadTemperature: "quente",
    handoffRequested: true
  });
  await appendClientTags(input.clientId, ["ia_transferencia_humana", "consultor_responsavel"]);
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_recovery_handoff_requested",
    channel: "whatsapp",
    platform: configuredAiPlatform(),
    serviceInterest: input.state.service_interest,
    athleteAge: input.state.athlete_age,
    ageGroup: input.state.age_group,
    leadStatus: "quente",
    qualityScore: 90,
    metadata: { attempts, body: input.body, stage: input.state.stage }
  });
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: input.state,
    stage: input.state.stage,
    completedAt: null,
    metadata: {
      aiRecoveryAttempts: attempts,
      consultantHandoffRequestedAt: new Date().toISOString(),
      consultantHandoffReason: isExplicitHumanRequest(input.body) ? "explicit_request" : "recovery_exhausted"
    }
  });
  await sendBotText(
    input.client,
    input.chatId,
    input.clientId,
    "Entendi. Já organizei o que você contou e vou direcionar a conversa para o consultor responsável continuar daqui, sem você precisar repetir tudo.",
    [700, 1400]
  );
  return null;
}

function buildMeetingDatePollOptions(options: Ec10MeetingDateOption[]) {
  return [
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Nao posso em nenhuma dessas datas`
  ];
}

function buildMeetingTimePollOptions(options: Ec10MeetingTimeOption[]) {
  return [
    ...options.map((option) => `${option.index}. ${option.label}`),
    `${options.length + 1}. Nao posso em nenhum desses horarios`
  ];
}

async function askFoundationStatus(client: any, chatId: string, clientId: string, delayRange?: [number, number]) {
  await sendBotPoll({
    client,
    chatId,
    clientId,
    question: foundationStatusPollQuestion,
    options: foundationStatusPollOptions,
    fallbackBody: ec10Messages.foundationStatusQuestion,
    delayRange
  });
}

async function askInterest(client: any, chatId: string, clientId: string, delayRange?: [number, number]) {
  await sendBotPoll({
    client,
    chatId,
    clientId,
    question: interestPollQuestion,
    options: interestPollOptions,
    fallbackBody: ec10Messages.interestQuestion,
    delayRange
  });
}

function isEc10FlowKind(value: unknown): value is Ec10FlowKind {
  return value === "career_8_13"
    || value === "eurocamp_14_19"
    || value === "international_20_25"
    || value === "international_26_plus"
    || value === "foundation_8_12"
    || value === "career_13_17"
    || value === "revela_13_plus"
    || value === "adult_18_plus";
}

function isMeetingDateOption(value: unknown): value is Ec10MeetingDateOption {
  const option = value as Partial<Ec10MeetingDateOption>;
  return Boolean(
    option
      && typeof option.index === "number"
      && typeof option.isoDate === "string"
      && typeof option.label === "string"
  );
}

function isMeetingTimeOption(value: unknown): value is Ec10MeetingTimeOption {
  const option = value as Partial<Ec10MeetingTimeOption>;
  return Boolean(
    option
      && typeof option.index === "number"
      && typeof option.hour === "number"
      && typeof option.label === "string"
  );
}

async function askMeetingDate(
  client: any,
  chatId: string,
  clientId: string,
  phone: string,
  previous: BotConversationState | null,
  options: { aiLed?: boolean } = {},
) {
  // Always reload: the previous audio-sequence snapshot may contain obsolete flags.
  previous=await getBotConversationState(phone)??previous;
  const service = previous?.service_interest === "plano_internacional" || previous?.service_interest === "ambos"
    ? "plano_internacional"
    : previous?.service_interest === "eurocamp" ? "eurocamp" : "plano_carreira";
  const minor=!!previous?.athlete_age&&previous.athlete_age<18;
  const knownRole=previous?.role_answer==='responsavel';
  if (minor && !hasConfirmedGuardian(previous)) {
    if (previous) await askGuardianConfirmation({ client, chatId, clientId, phone, previous });
    return;
  }
  const contactName=selectBookingContactName({metadata:previous?.metadata,minor,responsibleRole:knownRole});
  if(!contactName) {
    if (options.aiLed) {
      throw new Error("ai_booking_contact_name_missing");
    }
    await persistEc10State({clientId,phone,previous,stage:'awaiting_interest',completedAt:null,
      metadata:{bookingContactPending:true,audioSequenceInProgress:false}});
    await sendBotText(client,chatId,clientId,minor
      ? 'Antes de abrir a agenda, qual é o nome completo do responsável que participará da reunião? A confirmação chegará neste WhatsApp.'
      : 'Antes de abrir a agenda, qual é o nome completo de quem participará da reunião? A confirmação chegará neste WhatsApp.');
    return;
  }
  const bookingUrl=await createBotBookingLink({clientId,service,name:contactName,role:minor||knownRole?'responsavel':'atleta',
    existingUrl:typeof previous?.metadata?.bookingUrl==='string'?previous.metadata.bookingUrl:undefined});
  const guardianNote = previous?.athlete_age && previous.athlete_age < 18
    ? "Como o atleta e menor de idade, o responsavel precisa fazer a reserva. " : "";
  await persistEc10State({
    clientId,
    phone,
    previous,
    stage: "awaiting_booking_completion",
    completedAt: null,
    metadata: {
      bookingUrl,
      bookingContactPending:false,
      bookingContactName:contactName,
      bookingLinkSentAt: new Date().toISOString(),
      aiRecoveryAttempts: 0
    }
  });
  await sendBotText(
    client,
    chatId,
    clientId,
    options.aiLed
      ? bookingUrl
      : `${guardianNote}Sua agenda já está com o plano, nome, WhatsApp e idade preenchidos. Escolha primeiro o dia, depois o horário, e confirme.\n\n${bookingUrl}`,
    [700, 1400],
  );
}

function bookingMessageIntent(body: string | null | undefined) {
  const text = normalizeText(body || "");
  if (/\b(reagendar|re agendar|remarcar|mudar (?:o )?horario|mudar (?:a )?data)\b/.test(text)) return "reschedule";
  if (/\b(cancelar|desmarcar|nao vou poder|nao poderei|nao consigo ir)\b/.test(text)) return "cancel";
  if (/\b(link|agenda|agendar|marcar reuniao)\b/.test(text)) return "link";
  if (/\b(onde|local|endereco|presencial|campinas)\b/.test(text)) return "location";
  if (/^(?:ok|okay|certo|beleza|blz|obrigad[oa]|valeu|combinado)$/i.test(String(body || "").trim())) return "ack";
  return "other";
}

async function handleBookingCompletionConversation(input:{
  client:any;chatId:string;clientId:string;phone:string;state:BotConversationState;body:string|null;
}) {
  const intent = bookingMessageIntent(input.body);
  const metadata = asMetadataRecord(input.state.metadata);
  const bookingUrl = typeof metadata.bookingUrl === "string" ? metadata.bookingUrl : null;
  if (intent === "cancel") {
    await persistEc10State({clientId:input.clientId,phone:input.phone,previous:input.state,stage:"completed",
      completedAt:new Date().toISOString(),metadata:{bookingCancelledBeforeConfirmationAt:new Date().toISOString()}});
    await sendBotText(input.client,input.chatId,input.clientId,"Tudo certo. Como a reserva ainda não estava confirmada, encerrei esta tentativa. Quando quiser retomar, é só chamar.",[400,800]);
    return true;
  }
  if (intent === "location") {
    await sendBotText(input.client,input.chatId,input.clientId,"Nossa base fica em Belo Horizonte, no bairro Gutierrez. A reunião comercial é online; para confirmar, escolha o dia e o horário no link que enviei acima.",[400,800]);
    return true;
  }
  if ((intent === "link" || intent === "reschedule") && bookingUrl) {
    await sendBotText(input.client,input.chatId,input.clientId,
      `${intent === "reschedule" ? "Como a reunião ainda não foi confirmada, você pode escolher outro dia e horário no mesmo link:" : "Claro. Este é o link oficial da sua agenda:"}\n\n${bookingUrl}`,[400,800]);
    return true;
  }
  if (intent === "ack") {
    await sendBotText(input.client,input.chatId,input.clientId,"Combinado. O agendamento só fica confirmado depois que você escolher o dia e o horário no link. Assim que concluir, a confirmação chega neste WhatsApp.",[400,800]);
    return true;
  }
  await sendBotText(input.client,input.chatId,input.clientId,"Sua reunião ainda não foi confirmada. Se ficou alguma dúvida antes de escolher o dia e o horário, pode me falar por aqui.",[400,800]);
  return true;
}

async function askMeetingTime(
  client: any,
  chatId: string,
  clientId: string,
  phone: string,
  previous: BotConversationState,
  selectedDate: Ec10MeetingDateOption
) {
  const bookedStarts = await fetchBookedEc10MeetingStarts(selectedDate.isoDate);
  const baseTimeOptions = buildMeetingTimeOptions(selectedDate, previous.service_interest);
  const timeOptions = isCareerPlanService(previous.service_interest)
    ? baseTimeOptions
    : filterAvailableMeetingTimeOptions(baseTimeOptions, bookedStarts);
  if (!timeOptions.length) {
    await sendBotText(
      client,
      chatId,
      clientId,
      `Essa data ja esta sem horarios disponiveis. Vamos escolher outra data.`,
      [1200, 2400]
    );
    await askMeetingDate(client, chatId, clientId, phone, previous);
    return;
  }

  await sendBotPoll({
    client,
    chatId,
    clientId,
    question: `Perfeito. Para ${selectedDate.label}, escolha o melhor horario:`,
    options: buildMeetingTimePollOptions(timeOptions),
    fallbackBody: buildMeetingTimeQuestion(selectedDate, timeOptions),
    delayRange: [1200, 2400]
  });
  await persistEc10State({
    clientId,
    phone,
    previous,
    stage: "awaiting_meeting_time",
    completedAt: null,
    metadata: {
      meetingSelectedDate: selectedDate,
      meetingTimeOptions: timeOptions,
      meetingTimeAskedAt: new Date().toISOString(),
      meetingCustomTimeAllowed: false,
      aiRecoveryAttempts: 0
    }
  });
}

async function finishEc10MeetingSchedule(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  currentState: BotConversationState;
  schedule: Ec10MeetingSchedule;
}) {
  const flowMetadata = asMetadataRecord(input.currentState.metadata);
  if (!await ensureGuardianBeforeMeeting({
    client: input.client,
    chatId: input.chatId,
    clientId: input.clientId,
    phone: input.phone,
    state: input.currentState
  })) return;
  const isMentoriaPrimeFlow = flowMetadata.source === "mentoria_prime_form";
  const leadName = typeof flowMetadata.leadName === "string" ? flowMetadata.leadName : null;
  const meetingSeller = await resolveEc10MeetingSeller(input.currentState.service_interest, input.schedule);
  const meetingDate = String(input.schedule.startsAt).slice(0, 10);
  const bookedStarts = await fetchBookedEc10MeetingStarts(meetingDate);
  if (!isCareerPlanService(input.currentState.service_interest) && bookedStarts.includes(input.schedule.startsAt)) {
    const selectedDate = readSelectedMeetingDate(input.currentState);
    if (selectedDate) {
      await sendBotText(
        input.client,
        input.chatId,
        input.clientId,
        "Esse horario acabou de ser reservado. Vou te mostrar os horarios disponiveis novamente.",
        [1200, 2400]
      );
      await askMeetingTime(input.client, input.chatId, input.clientId, input.phone, input.currentState, selectedDate);
      return;
    }
  }

  const sellerMessage = buildSellerMeetingMessage({
    leadPhone: input.phone,
    leadName,
    flowLabel: isMentoriaPrimeFlow ? "Mentoria Esportiva Prime" : null,
    roleAnswer: input.currentState.role_answer,
    athleteAge: input.currentState.athlete_age,
    serviceInterest: input.currentState.service_interest,
    leadPageUrl: input.currentState.lead_page_url,
    schedule: input.schedule,
    meetUrl: ec10GoogleMeetUrl
  });

  let sellerNotified = false;
  let sellerNotificationError: string | null = null;
  try {
    await notifyEc10SellerMeeting(input.client, meetingSeller, sellerMessage);
    sellerNotified = true;
  } catch (error) {
    sellerNotificationError = error instanceof Error ? error.message : String(error);
    console.warn("Failed to notify EC10 seller meeting", sellerNotificationError);
  }

  await appendClientTags(input.clientId, [
    isMentoriaPrimeFlow ? "mentoria_prime_reuniao_agendada" : ec10MeetingScheduledTag
  ]);
  let sellerAssignmentError: string | null = null;
  try {
    await assignClientToSellerByName(input.clientId, meetingSeller.name);
  } catch (error) {
    sellerAssignmentError = error instanceof Error ? error.message : String(error);
    console.warn("Failed to assign EC10 meeting seller", sellerAssignmentError);
  }

  let careerGroupResult: CareerMeetingGroupResult | null = null;
  let careerGroupError: string | null = null;
  if (careerMeetingGroupsEnabled && !isMentoriaPrimeFlow && isCareerPlanService(input.currentState.service_interest)) {
    try {
      careerGroupResult = await addLeadToCareerMeetingGroup({
        client: input.client,
        clientId: input.clientId,
        phone: input.phone,
        leadName,
        schedule: input.schedule
      });
    } catch (error) {
      careerGroupError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to add lead to career meeting group", careerGroupError);
    }
  }

  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_meeting_scheduled",
    channel: "whatsapp",
    platform: isMentoriaPrimeFlow ? "site" : "meta_ads",
    serviceInterest: input.currentState.service_interest,
    athleteAge: input.currentState.athlete_age,
    ageGroup: input.currentState.age_group,
    leadStatus: "triagem",
    qualityScore: 90,
    metadata: {
      schedule: input.schedule,
      sellerName: meetingSeller.name,
      sellerPhone: meetingSeller.phone,
      sellerRoute: meetingSeller.route,
      sellerNotified,
      sellerNotificationError,
      sellerAssignmentError,
      careerMeetingGroup: careerGroupResult,
      careerMeetingGroupError: careerGroupError,
      meetConfigured: Boolean(ec10GoogleMeetUrl),
      meetUrl: ec10GoogleMeetUrl,
      flowSource: isMentoriaPrimeFlow ? "mentoria_prime_form" : "ec10_whatsapp_flow",
      leadName
    }
  });
  const capiEventId = `crm-${input.clientId}-schedule-${input.schedule.startsAt}`;
  const attribution = await getClientTrafficAttribution(input.clientId).catch((error) => {
    console.warn("Failed to load client attribution for CAPI", error instanceof Error ? error.message : String(error));
    return null;
  });
  const attributionMetadata = asMetadataRecord(attribution?.attribution_metadata);
  const metaContext = buildMetaTrafficContext({
    phone: input.phone,
    state: input.currentState,
    attributionMetadata,
    eventKind: "Schedule"
  });
  const capiSent = await sendMetaQualityEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventName: "Schedule",
    status: "orcamento",
    serviceInterest: attribution?.service_interest ?? input.currentState.service_interest,
    leadScore: Math.max(90, attribution?.lead_score ?? 0),
    fbclid: attribution?.fbclid ?? null,
    fbc: typeof attributionMetadata.fbc === "string" ? attributionMetadata.fbc : null,
    fbp: typeof attributionMetadata.fbp === "string" ? attributionMetadata.fbp : null,
    city: metaContext.city,
    state: metaContext.state,
    country: "BR",
    eventSourceUrl: typeof attributionMetadata.eventSourceUrl === "string" ? attributionMetadata.eventSourceUrl : input.currentState.lead_page_url,
    eventTime: new Date(),
    eventId: capiEventId,
    customData: metaContext.customData
  });
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "Schedule",
    channel: "whatsapp",
    platform: "meta_ads",
    serviceInterest: input.currentState.service_interest,
    athleteAge: input.currentState.athlete_age,
    ageGroup: input.currentState.age_group,
    leadStatus: "orcamento",
    qualityScore: 90,
    metadata: {
      source: "bot_meeting_scheduled",
      eventId: capiEventId,
      capiSent,
      metaContext: metaContext.customData,
      schedule: input.schedule,
      sellerName: meetingSeller.name,
      sellerRoute: meetingSeller.route,
      careerMeetingGroup: careerGroupResult,
      careerMeetingGroupError: careerGroupError
    }
  });
  await cancelQueuedFollowUpMessages(input.clientId, "Lead agendou reuniao EC10.");
  await cancelQueuedMeetingMessages(input.clientId, "Lead reagendou ou confirmou novo horario EC10.");
  await scheduleMeetingReminders({
    clientId: input.clientId,
    clientPhone: input.phone,
    leadName,
    seller: meetingSeller,
    schedule: input.schedule
  });

  const meetingConfirmationMessage = buildMeetingConfirmationMessage(input.schedule, ec10GoogleMeetUrl, sellerNotified, meetingSeller.name);
  let meetingConfirmationSent = false;
  let meetingConfirmationDeduped = false;
  let meetingConfirmationQueued = false;
  let meetingConfirmationError: string | null = null;
  try {
    const sent = await sendBotText(
      input.client,
      input.chatId,
      input.clientId,
      meetingConfirmationMessage,
      [1600, 3000]
    );
    meetingConfirmationSent = sent !== false;
    meetingConfirmationDeduped = sent === false;
  } catch (error) {
    meetingConfirmationError = error instanceof Error ? error.message : String(error);
    console.warn("Failed to send meeting confirmation to lead", meetingConfirmationError);
    if (!isWhatsAppProtocolTimeout(error)) {
      try {
        await scheduleOutboundTextMessage({
          clientId: input.clientId,
          phone: input.phone,
          body: meetingConfirmationMessage,
          scheduledAt: new Date(Date.now() + 60_000).toISOString(),
          mediaPath: `site_bot:ec10:meeting_confirmation:${input.schedule.startsAt}`
        });
        meetingConfirmationQueued = true;
      } catch (queueError) {
        meetingConfirmationError = [
          meetingConfirmationError,
          queueError instanceof Error ? queueError.message : String(queueError)
        ].filter(Boolean).join(" | ");
      }
    }
  }

  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_meeting_confirmation_result",
    channel: "whatsapp",
    platform: "whatsapp",
    serviceInterest: input.currentState.service_interest,
    athleteAge: input.currentState.athlete_age,
    ageGroup: input.currentState.age_group,
    metadata: {
      schedule: input.schedule,
      sellerName: meetingSeller.name,
      sent: meetingConfirmationSent,
      deduped: meetingConfirmationDeduped,
      queued: meetingConfirmationQueued,
      error: meetingConfirmationError
    }
  });
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: input.currentState,
    stage: "completed",
    completedAt: new Date().toISOString(),
    metadata: {
      meeting: input.schedule,
      meetingSellerName: meetingSeller.name,
      meetingSellerPhone: meetingSeller.phone,
      meetingSellerRoute: meetingSeller.route,
      meetingSellerNotified: sellerNotified,
      meetingSellerNotificationError: sellerNotificationError,
      meetingSellerAssignmentError: sellerAssignmentError,
      meetingWhatsAppGroup: careerGroupResult,
      meetingWhatsAppGroupError: careerGroupError,
      meetingConfirmationSent,
      meetingConfirmationDeduped,
      meetingConfirmationQueued,
      meetingConfirmationError,
      meetingMeetUrl: ec10GoogleMeetUrl,
      ...buildConfiguredMeetAccessMetadata()
    }
  });
}

function hasClientTag(clientState: { tags?: string[] | null }, tag: string) {
  return Array.isArray(clientState.tags) && clientState.tags.includes(tag);
}

function clientAttributionMetadata(clientState: ClientAutomationState) {
  const metadata = clientState.attribution_metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function hasTrafficSignal(clientState: ClientAutomationState) {
  const metadata = clientAttributionMetadata(clientState);
  return clientState.source === "site"
    || Boolean(clientState.traffic_source?.trim())
    || Boolean(clientState.utm_source?.trim())
    || Boolean(clientState.utm_campaign?.trim())
    || Boolean(clientState.fbclid?.trim())
    || typeof metadata.fbp === "string"
    || typeof metadata.fbc === "string"
    || typeof metadata.eventSourceUrl === "string"
    || hasClientTag(clientState, "lead_page")
    || hasClientTag(clientState, "plano_carreira_bot_ativo")
    || hasClientTag(clientState, "mentoria_prime_bot_ativo")
    || hasClientTag(clientState, "campanha_revela_prioritario");
}

function isDirectCareerWhatsAppEntry(clientState: ClientAutomationState) {
  return clientState.bot_instance_id === config.BOT_INSTANCE_ID
    && clientState.source === "whatsapp"
    && clientState.service_interest === "plano_carreira"
    && hasClientTag(clientState, "entrada_direta_whatsapp");
}

function automationSuppressionReason(clientState: ClientAutomationState) {
  if (clientState.bot_instance_id !== config.BOT_INSTANCE_ID) return "different_bot_instance";
  if (clientState.source === "manual" || clientState.source === "indicacao") return "manual_or_referral_without_traffic";
  if (clientState.source === "whatsapp") return "whatsapp_without_traffic_or_direct_career_tag";
  return "missing_traffic_signal";
}

function shouldRunWhatsAppAutomation(clientState: ClientAutomationState) {
  if (clientState.bot_instance_id !== config.BOT_INSTANCE_ID) return false;
  if (!isBotTestPhoneAllowed(clientState.phone)) return false;
  if (config.BOT_AI_MODE === "primary") return true;
  return hasTrafficSignal(clientState) || isDirectCareerWhatsAppEntry(clientState);
}

async function recordAutomationSuppressed(clientState: ClientAutomationState, context: string) {
  await recordTrafficEvent({
    clientId: clientState.id,
    phone: clientState.phone,
    eventType: "bot_automation_suppressed",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: {
      context,
      reason: automationSuppressionReason(clientState),
      botInstanceId: clientState.bot_instance_id,
      source: clientState.source,
      serviceInterest: clientState.service_interest,
      tags: clientState.tags ?? []
    }
  });
}

async function evaluateQueuedOutboundPermission(item: {
  client_id: string;
  bot_instance_id: string;
}) {
  const clientState = await getClientAutomationStateById(item.client_id);
  if (!clientState) return { allowed: false, reason: "client_not_found", clientState: null };
  if (clientState.bot_instance_id !== item.bot_instance_id) {
    return { allowed: false, reason: "queue_client_bot_instance_mismatch", clientState };
  }
  if (!shouldRunWhatsAppAutomation(clientState)) {
    return { allowed: false, reason: automationSuppressionReason(clientState), clientState };
  }
  return { allowed: true, reason: null, clientState };
}

function shouldSendIgorAccess(body: string | null, selectedOptions: string[] = []) {
  const text = normalizeText([body, ...selectedOptions].filter(Boolean).join(" "));
  return [
    "duvida",
    "duvidas",
    "conhecer",
    "plataforma",
    "quero",
    "sim",
    "igor",
    "vendedor",
    "atendimento"
  ].some((trigger) => text.includes(trigger));
}

async function sendRevelaCampaignPoll(client: any, chatId: string, clientId: string) {
  const pauseReason = await getImmediateOutboundPauseReason();
  if (pauseReason) {
    await recordImmediateOutboundPaused({
      clientId,
      phone: chatId,
      mediaType: "poll",
      body: revelaCampaignPollQuestion,
      reason: pauseReason
    });
    return;
  }
  await sendTypingPause(client, chatId, 1400, 2800);
  const poll = new Poll(revelaCampaignPollQuestion, revelaCampaignPollOptions, { allowMultipleAnswers: false, messageSecret: undefined });
  const sent = await sendWhatsAppWithRetry(() => client.sendMessage(chatId, poll));
  if (!sent) throw new Error("WhatsApp nao confirmou o envio da enquete.");
  await recordOutboundChatMessage({
    clientId,
    body: revelaCampaignPollQuestion,
    mediaType: "poll",
    whatsappMessageId: getWhatsAppMessageId(sent),
    whatsappChatId: getWhatsAppChatId(sent),
    whatsappAck: getWhatsAppAck(sent)
  });
  await appendClientTags(clientId, [revelaCampaignPollSentTag]);
  await recordTrafficEvent({
    clientId,
    phone: chatId,
    eventType: "campaign_revela_poll_sent",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: { options: revelaCampaignPollOptions }
  });
}

async function sendIgorAccess(client: any, chatId: string, clientId: string) {
  await sendBotText(client, chatId, clientId, igorContactMessage, [1200, 2600]);
  await appendClientTags(clientId, [revelaCampaignIgorSentTag]);
  await recordTrafficEvent({
    clientId,
    phone: chatId,
    eventType: "campaign_revela_igor_sent",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: { seller: "Igor Jardins", contact: "553182331411" }
  });
}

async function handleRevelaCampaignAutomation(
  client: any,
  chatId: string,
  clientState: { id: string; phone: string; tags?: string[] | null },
  body: string | null,
  selectedOptions: string[] = []
) {
  if (!revelaCampaignAutomationEnabled) return false;
  if (!hasClientTag(clientState, revelaCampaignTag)) return false;

  if (!hasClientTag(clientState, revelaCampaignPollSentTag)) {
    await sendRevelaCampaignPoll(client, chatId, clientState.id);
    return true;
  }

  if (!hasClientTag(clientState, revelaCampaignIgorSentTag) && shouldSendIgorAccess(body, selectedOptions)) {
    await sendIgorAccess(client, chatId, clientState.id);
    return true;
  }

  return true;
}

async function persistEc10State(input: {
  clientId: string;
  phone: string;
  previous: BotConversationState | null;
  stage: Ec10ConversationStage;
  roleAnswer?: string | null;
  athleteAge?: number | null;
  ageGroup?: string | null;
  serviceInterest?: BotConversationState["service_interest"];
  leadPageUrl?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return saveBotConversationState({
    clientId: input.clientId,
    phone: input.phone,
    stage: input.stage,
    roleAnswer: input.roleAnswer ?? input.previous?.role_answer ?? null,
    athleteAge: input.athleteAge ?? input.previous?.athlete_age ?? null,
    ageGroup: input.ageGroup ?? input.previous?.age_group ?? null,
    serviceInterest: input.serviceInterest ?? input.previous?.service_interest ?? null,
    leadPageUrl: input.leadPageUrl ?? input.previous?.lead_page_url ?? null,
    completedAt: input.completedAt ?? input.previous?.completed_at ?? null,
    metadata: {
      ...(input.previous?.metadata ?? {}),
      ...(input.metadata ?? {})
    }
  });
}

async function handleMeetingDeclined(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  currentState: BotConversationState;
  body: string | null;
}) {
  const declinedAt = new Date().toISOString();
  const nextFollowUpAt = buildFollowUpAt();
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: input.currentState,
    stage: "completed",
    completedAt: declinedAt,
    metadata: {
      meetingDeclinedAt: declinedAt,
      meetingDeclinedBody: input.body,
      followUpAt: nextFollowUpAt
    }
  });
  await cancelQueuedFollowUpMessages(input.clientId, "Lead recusou reuniao no fluxo EC10.");

  await sendBotText(input.client, input.chatId, input.clientId, buildMeetingDeclinedMessage(), [1400, 2600]);
  await markClientForFollowUp({
    clientId: input.clientId,
    status: "aguardando_cliente",
    nextFollowUpAt,
    tags: meetingDeclinedFollowUpTags,
    note: [
      "Bot EC10: lead recusou marcar reuniao neste momento.",
      "Follow-up consultivo agendado sem reenvio de página.",
      `Follow-up sugerido para ${nextFollowUpAt}.`
    ].join("\n")
  });
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_meeting_declined_revela_follow_up",
    channel: "whatsapp",
    platform: "meta_ads",
    serviceInterest: input.currentState.service_interest,
    athleteAge: input.currentState.athlete_age,
    ageGroup: input.currentState.age_group,
    leadStatus: "aguardando_cliente",
    metadata: {
      body: input.body,
      followUpAt: nextFollowUpAt
    }
  });
}

async function sendPlanAndContinue(input: {
  client: any;
  chatId: string;
  clientId: string;
  phone: string;
  currentState: BotConversationState;
  athleteAge: number;
  plan: Ec10LeadPlan;
  nextStep: "interest" | "meeting";
  extraMetadata?: Record<string, unknown>;
}) {
  await updateClientEc10Profile({
    clientId: input.clientId,
    serviceInterest: input.plan.serviceInterest,
    athleteAge: input.athleteAge,
    ageGroup: input.plan.ageGroup,
    roleAnswer: input.currentState.role_answer,
    leadPageUrl: input.plan.leadPageUrl,
    leadPageSection: input.plan.leadPageSection,
    leadScore: input.plan.leadScore
  });

  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_age_captured",
    channel: "whatsapp",
    platform: "meta_ads",
    serviceInterest: input.plan.serviceInterest,
    athleteAge: input.athleteAge,
    ageGroup: input.plan.ageGroup,
    leadStatus: "triagem",
    qualityScore: input.plan.leadScore,
    metadata: {
      roleAnswer: input.currentState.role_answer,
      flowKind: input.plan.flowKind,
      ...(input.extraMetadata ?? {})
    }
  });

  const stateSnapshot = {
    ...input.currentState,
    athlete_age: input.athleteAge,
    age_group: input.plan.ageGroup,
    service_interest: input.plan.serviceInterest,
    lead_page_url: input.plan.leadPageUrl,
    metadata: {
      ...(input.currentState.metadata ?? {}),
      flowKind: input.plan.flowKind,
      audioPaths: input.plan.audioItems.map((item) => item.audioPath),
      leadPageSection: input.plan.leadPageSection,
      ...(input.extraMetadata ?? {})
    }
  };

  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: stateSnapshot,
    stage: "awaiting_interest",
    athleteAge: input.athleteAge,
    ageGroup: input.plan.ageGroup,
    serviceInterest: input.plan.serviceInterest,
    leadPageUrl: input.plan.leadPageUrl,
    completedAt: null,
    metadata: {
      ...stateSnapshot.metadata,
      audioSequenceInProgress: true,
      audioSequenceStartedAt: new Date().toISOString(),
      meetingConsentRequired: true
    }
  });

  let audioSequenceError: string | null = null;
  try {
    await sendPlanAudioSequence({
      client: input.client,
      chatId: input.chatId,
      clientId: input.clientId,
      phone: input.phone,
      athleteAge: input.athleteAge,
      plan: input.plan
    });
  } catch (error) {
    audioSequenceError = error instanceof Error ? error.message : String(error);
    console.warn("Failed to send plan audio sequence", audioSequenceError);
    await recordTrafficEvent({
      clientId: input.clientId,
      phone: input.phone,
      eventType: "bot_audio_sequence_failed",
      channel: "whatsapp",
      platform: "whatsapp",
      serviceInterest: input.plan.serviceInterest,
      athleteAge: input.athleteAge,
      ageGroup: input.plan.ageGroup,
      leadStatus: "triagem",
      qualityScore: input.plan.leadScore,
      metadata: {
        flowKind: input.plan.flowKind,
        audioPaths: input.plan.audioItems.map((item) => item.audioPath),
        error: audioSequenceError
      }
    });
  }

  await naturalPause(1800, 3200);
  const meetingSeller = await resolveEc10MeetingSeller(input.plan.serviceInterest);
  await recordTrafficEvent({
    clientId: input.clientId,
    phone: input.phone,
    eventType: "bot_meeting_consent_requested",
    channel: "whatsapp",
    platform: "meta_ads",
    serviceInterest: input.plan.serviceInterest,
    athleteAge: input.athleteAge,
    ageGroup: input.plan.ageGroup,
    leadStatus: "triagem",
    qualityScore: input.plan.leadScore,
    metadata: {
      flowKind: input.plan.flowKind,
      sellerName: meetingSeller.name,
      sellerPhone: meetingSeller.phone,
      sellerRoute: meetingSeller.route,
      meetConfigured: Boolean(ec10GoogleMeetUrl),
      nextStep: input.nextStep
    }
  });
  const audioSequenceFinishedAt = new Date().toISOString();
  await persistEc10State({
    clientId: input.clientId,
    phone: input.phone,
    previous: stateSnapshot,
    stage: "awaiting_interest",
    athleteAge: input.athleteAge,
    ageGroup: input.plan.ageGroup,
    serviceInterest: input.plan.serviceInterest,
    leadPageUrl: input.plan.leadPageUrl,
    completedAt: null,
    metadata: {
      ...stateSnapshot.metadata,
      audioSequenceInProgress: false,
      audioSequenceFinishedAt,
      ...(audioSequenceError ? {
        audioSequenceFailedAt: audioSequenceFinishedAt,
        audioSequenceError
      } : {}),
      meetingConsentAskedAt: audioSequenceFinishedAt,
      meetingConsentRequired: true
    }
  });
  await askMeetingDate(input.client, input.chatId, input.clientId, input.phone, stateSnapshot);
  const leadMetadata = asMetadataRecord(stateSnapshot.metadata);
  await scheduleEc10MeetingFollowUps({
    clientId: input.clientId,
    phone: input.phone,
    leadName: typeof leadMetadata.leadName === "string" ? leadMetadata.leadName : null
  });
}

function botLabSpeakerRole(value: string | null | undefined): "responsavel" | "atleta" | "outro" {
  if (value === "responsavel" || value === "atleta") return value;
  return "outro";
}

function botLabStageFromReply(input: {
  qualifiesForMeeting: boolean;
  athleteAge: number | null;
  speakerRole: string | null | undefined;
}) {
  if (input.qualifiesForMeeting) return "ready_for_meeting";
  if (input.athleteAge && input.athleteAge < 18 && input.speakerRole === "atleta") {
    return "awaiting_guardian_confirmation";
  }
  return input.athleteAge ? "diagnosing" : "discovery";
}

async function handleBotLabWhatsappConversation(input: {
  client: any;
  chatId: string;
  tester: BotLabWhatsappTester;
  body: string | null;
  mediaType: string;
  whatsappMessageId: string | null;
}) {
  const session = await getOrCreateBotLabWhatsappSession(input.tester);
  const inserted = await recordBotLabWhatsappMessage({
    sessionId: session.id,
    direction: "user",
    body: input.body || `[${input.mediaType || "mensagem"}]`,
    stage: session.current_stage || "discovery",
    whatsappMessageId: input.whatsappMessageId,
    metadata: { testerId: input.tester.id, mediaType: input.mediaType }
  });
  if (!inserted) return true;

  const history = await fetchBotLabWhatsappMessages(session.id, 24);
  const sessionMetadata = asMetadataRecord(session.metadata);
  const profile = asMetadataRecord(sessionMetadata.aiProfile) as AiSalesProfile;
  let aiReply: Awaited<ReturnType<typeof generateEc10SalesReplyWithAi>> = null;
  try {
    aiReply = await generateEc10SalesReplyWithAi({
      message: input.body,
      mediaType: input.mediaType,
      history: history.map((item) => ({
        direction: item.direction === "assistant" ? "outbound" : "inbound",
        body: item.body,
        mediaType: typeof item.metadata?.mediaType === "string" ? item.metadata.mediaType : "text"
      })),
      serviceInterest: session.service_interest,
      profile,
      athleteAge: session.athlete_age,
      learningStage: session.current_stage || "discovery",
      leadContext: {
        registered: false,
        leadName: input.tester.display_name,
        source: "whatsapp_test",
        landingVariant: "crm_bot_lab",
        sourcePath: "/crm/ambiente-de-testes",
        purchaseStage: "laboratorio"
      }
    });
  } catch (error) {
    console.warn("Bot lab AI provider unavailable", error instanceof Error ? error.message : String(error));
    await touchBotLabWhatsappTester(input.tester.id, "provider_fallback");
  }

  const fallback = session.athlete_age
    ? "Quero seguir exatamente do ponto em que você parou. Me conta um pouco mais sobre esse momento no futebol."
    : "Tudo certo por aqui 😄 Me conta, o que te trouxe até a EC10?";
  const baseReply = aiReply?.reply?.trim() || fallback;
  const qualifiesForMeeting = aiReply ? isAiLeadQualifiedForMeeting(aiReply) : false;
  const reply = qualifiesForMeeting
    ? `${baseReply}\n\n🧪 Teste concluído: aqui o cliente receberia o link da agenda. Nenhum lead ou reunião foi criado.`
    : baseReply;
  const nextStage = botLabStageFromReply({
    qualifiesForMeeting,
    athleteAge: aiReply?.athleteAge ?? session.athlete_age,
    speakerRole: aiReply?.speakerRole ?? profile.speakerRole
  });

  const pauseReason = await getImmediateOutboundPauseReason();
  if (pauseReason) throw new Error(`Envio WhatsApp pausado: ${pauseReason}`);
  await sendTypingPause(input.client, input.chatId, 700, 1300);
  const sent = await sendWhatsAppWithRetry(() => input.client.sendMessage(input.chatId, reply));
  await recordBotLabWhatsappMessage({
    sessionId: session.id,
    direction: "assistant",
    body: reply,
    stage: nextStage,
    whatsappMessageId: getWhatsAppMessageId(sent),
    metadata: {
      testerId: input.tester.id,
      mediaType: "text",
      provider: configuredAiPlatform(),
      qualifiesForMeeting,
      wouldSchedule: qualifiesForMeeting
    }
  });

  const nextProfile: AiSalesProfile = aiReply ? {
    responsibleName: aiReply.responsibleName || profile.responsibleName || null,
    athleteName: aiReply.athleteName || profile.athleteName || null,
    speakerRole: aiReply.speakerRole || profile.speakerRole || null,
    guardianConfirmed: aiReply.guardianConfirmed,
    qualificationStatus: aiReply.qualificationStatus,
    qualificationReason: aiReply.qualificationReason,
    objectiveConfirmed: aiReply.objectiveConfirmed,
    decisionMakerConfirmed: aiReply.decisionMakerConfirmed,
    mainPain: aiReply.mainPain,
    mainDifficulty: aiReply.mainDifficulty,
    primaryObjective: aiReply.primaryObjective,
    currentSituation: aiReply.currentSituation,
    urgency: aiReply.urgency,
    decisionReadiness: aiReply.decisionReadiness,
    investmentReadiness: aiReply.investmentReadiness,
    journeyStage: aiReply.journeyStage,
    conversationStyle: aiReply.conversationStyle,
    objectionCategory: aiReply.objectionCategory,
    recommendedNextStep: aiReply.recommendedNextStep
  } : profile;

  await updateBotLabWhatsappSession({
    sessionId: session.id,
    stage: nextStage,
    athleteAge: aiReply?.athleteAge ?? session.athlete_age,
    speakerRole: botLabSpeakerRole(aiReply?.speakerRole ?? profile.speakerRole),
    serviceInterest: aiReply?.serviceInterest ?? session.service_interest,
    metadata: {
      ...sessionMetadata,
      channel: "whatsapp",
      testerId: input.tester.id,
      isolated: true,
      realActions: 0,
      aiProfile: nextProfile,
      lastProvider: configuredAiPlatform(),
      lastReplyAt: new Date().toISOString(),
      wouldSchedule: qualifiesForMeeting
    }
  });
  await touchBotLabWhatsappTester(input.tester.id, qualifiesForMeeting ? "meeting_ready_isolated" : "reply_sent");
  return true;
}

async function handleEc10AiConversation(
  client: any,
  chatId: string,
  clientState: ClientAutomationState,
  body: string | null,
  mediaType = "text",
) {
  let existingFlowState = await getBotConversationState(clientState.phone);
  if (!existingFlowState) {
    const initialAge = extractAthleteAge(body) ?? clientState.athlete_age ?? null;
    const initialPlan = initialAge ? getEc10LeadPlan(initialAge) : null;
    existingFlowState = await persistEc10State({
      clientId: clientState.id,
      phone: clientState.phone,
      previous: null,
      stage: initialAge ? "awaiting_interest" : "awaiting_age",
      roleAnswer: null,
      athleteAge: initialAge,
      ageGroup: initialPlan?.ageGroup ?? null,
      serviceInterest: clientState.service_interest ?? null,
      completedAt: null,
      metadata: {
        source: "gustavo_ai_sdr",
        professionalAiSdr: true,
        sdrActiveEngine: "gustavo_gemini_primary",
        aiConversationStartedAt: new Date().toISOString(),
      },
    });
  }
  if (!existingFlowState) {
    throw new Error("ai_conversation_state_unavailable");
  }

  const history = await fetchRecentClientMessages(clientState.id, 14);
  const leadMetadata=asMetadataRecord(existingFlowState?.metadata);
  const storedAiProfile=(clientState.attribution_metadata?.ai_sdr as Record<string, unknown> | undefined) ?? {};
  const stateRole=existingFlowState?.role_answer==='responsavel'||existingFlowState?.role_answer==='atleta'||existingFlowState?.role_answer==='gestor'
    ? existingFlowState.role_answer
    : null;
  const mergedAiProfile={
    ...storedAiProfile,
    ...(stateRole?{speakerRole:stateRole}:{}),
    ...(leadMetadata.guardianConfirmed===true?{guardianConfirmed:true}:{}),
    ...(typeof leadMetadata.responsibleName==='string'?{responsibleName:leadMetadata.responsibleName}:{}),
    ...(typeof leadMetadata.athleteName==='string'?{athleteName:leadMetadata.athleteName}:{}),
  } as AiSalesProfile;
  const aiRequest = {
    athleteAge: existingFlowState?.athlete_age || clientState.athlete_age || null,
    learningStage: existingFlowState.stage,
    message: body,
    mediaType,
    history,
    serviceInterest: clientState.service_interest,
    profile: mergedAiProfile,
    campaignProduct: existingFlowState?.metadata?.funnelKey === "ec10_campaign_landing_pages" ? {
      id: String(existingFlowState.metadata.campaignProductId || ""),
      name: String(existingFlowState.metadata.campaignProductName || ""),
      service: String(existingFlowState.metadata.campaignService || ""),
    } : null,
    leadContext:{registered:leadMetadata.crmRegistered===true||leadMetadata.funnelKey==='ec10_campaign_landing_pages',
      leadName:typeof leadMetadata.leadName==='string'?leadMetadata.leadName:null,
      source:typeof leadMetadata.source==='string'?leadMetadata.source:clientState.source,
      landingVariant:typeof leadMetadata.landingVariant==='string'?leadMetadata.landingVariant:null,
      sourcePath:typeof leadMetadata.sourcePath==='string'?leadMetadata.sourcePath:null,
      purchaseStage:typeof leadMetadata.purchaseStage==='string'?leadMetadata.purchaseStage:null},
  };
  let aiReply = await generateEc10SalesReplyWithAi(aiRequest);
  if (!aiReply) {
    console.warn(JSON.stringify({
      event: "ai_primary_reply_retry",
      clientId: clientState.id,
      stage: existingFlowState.stage,
    }));
    aiReply = await generateEc10SalesReplyWithAi({ ...aiRequest, qualityRetry: true });
  }

  if (!aiReply) {
    await appendClientTags(clientState.id, ["ia_resposta_reserva"]);
    await recordTrafficEvent({
      clientId: clientState.id,
      phone: clientState.phone,
      eventType: "ai_primary_temporary_fallback",
      channel: "whatsapp",
      platform: configuredAiPlatform(),
      serviceInterest: clientState.service_interest,
      metadata: { mediaType, aiMode: config.BOT_AI_MODE, retried: true },
    });
    throw new Error("ai_primary_no_valid_reply");
  }

  if(existingFlowState) {
    const nextAiStage = existingFlowState.stage === "completed" || existingFlowState.stage === "awaiting_booking_completion"
      ? existingFlowState.stage
      : aiReply.athleteAge
        ? "awaiting_interest"
        : "awaiting_age";
    await persistEc10State({clientId:clientState.id,phone:clientState.phone,previous:existingFlowState,
      stage:nextAiStage,
      roleAnswer:aiReply.speakerRole==='unknown'?existingFlowState.role_answer:aiReply.speakerRole,
      athleteAge:aiReply.athleteAge??existingFlowState.athlete_age,
      serviceInterest:aiReply.serviceInterest??existingFlowState.service_interest,
      metadata:{
        ...(aiReply.responsibleName?{responsibleName:aiReply.responsibleName}:{}),
        ...(aiReply.athleteName?{athleteName:aiReply.athleteName}:{}),
        ...(aiReply.guardianConfirmed?{guardianConfirmed:true}:{}),
        aiStateSynchronizedAt:new Date().toISOString()
      }});
  }
  const synchronizedMetadata = {
    ...leadMetadata,
    ...(aiReply.responsibleName ? { responsibleName: aiReply.responsibleName } : {}),
    ...(aiReply.athleteName ? { athleteName: aiReply.athleteName } : {}),
  };
  const bookingContactName = selectBookingContactName({
    metadata: synchronizedMetadata,
    minor: Boolean(aiReply.athleteAge && aiReply.athleteAge < 18),
    responsibleRole: aiReply.speakerRole === "responsavel",
  });
  const qualifiesForMeeting = existingFlowState.stage !== "completed"
    && existingFlowState.stage !== "awaiting_booking_completion"
    && Boolean(bookingContactName)
    && isAiLeadQualifiedForMeeting(aiReply);
  const sentEricAudioPaths = Array.isArray(leadMetadata.ericAiAudioPathsSent)
    ? leadMetadata.ericAiAudioPathsSent.filter((item): item is string => typeof item === "string")
    : [];
  const ericAudioPath = qualifiesForMeeting
    ? null
    : selectEricAudioPathForAiReply(aiReply, sentEricAudioPaths);
  let ericAudioSent = false;
  await updateClientAiProfile({
    clientId: clientState.id,
    responsibleName: aiReply.responsibleName,
    athleteName: aiReply.athleteName,
    serviceInterest: aiReply.serviceInterest,
    athleteAge: aiReply.athleteAge,
    leadTemperature: aiReply.leadTemperature,
    handoffRequested: aiReply.handoffRequested && !qualifiesForMeeting,
    speakerRole: aiReply.speakerRole,
    guardianConfirmed: aiReply.guardianConfirmed,
    qualificationStatus: aiReply.qualificationStatus,
    qualificationReason: aiReply.qualificationReason,
    objectiveConfirmed: aiReply.objectiveConfirmed,
    decisionMakerConfirmed: aiReply.decisionMakerConfirmed,
    mainPain: aiReply.mainPain,
    mainDifficulty: aiReply.mainDifficulty,
    primaryObjective: aiReply.primaryObjective,
    currentSituation: aiReply.currentSituation,
    urgency: aiReply.urgency,
    decisionReadiness: aiReply.decisionReadiness,
    investmentReadiness:aiReply.investmentReadiness,
    journeyStage:aiReply.journeyStage,
    conversationStyle:aiReply.conversationStyle,
    objectionCategory:aiReply.objectionCategory,
    recommendedNextStep: aiReply.recommendedNextStep,
  });
  await sendBotText(client, chatId, clientState.id, aiReply.reply, [500, 1000]);

  ericAudioSent = ericAudioPath
    ? await sendBotAudio(client, chatId, clientState.id, ericAudioPath)
    : false;

  if (ericAudioSent && ericAudioPath) {
    const latestState = await getBotConversationState(clientState.phone) ?? existingFlowState;
    await persistEc10State({
      clientId: clientState.id,
      phone: clientState.phone,
      previous: latestState,
      stage: latestState.stage,
      metadata: {
        ericAiAudioPathsSent: [...new Set([...sentEricAudioPaths, ericAudioPath])],
        ericAiLastAudioSentAt: new Date().toISOString(),
      },
    });
  }

  const bookingIntent = bookingMessageIntent(body);
  const existingBookingUrl = typeof leadMetadata.bookingUrl === "string" ? leadMetadata.bookingUrl : null;
  if (existingBookingUrl && (bookingIntent === "link" || bookingIntent === "reschedule")) {
    await sendBotText(client, chatId, clientState.id, existingBookingUrl, [250, 500]);
  }

  await recordTrafficEvent({
    clientId: clientState.id,
    phone: clientState.phone,
    eventType: qualifiesForMeeting ? "ai_primary_qualified_for_meeting" : aiReply.handoffRequested ? "ai_primary_handoff" : "ai_primary_reply_sent",
    channel: "whatsapp",
    platform: configuredAiPlatform(),
    serviceInterest: aiReply.serviceInterest || clientState.service_interest,
    athleteAge: aiReply.athleteAge,
    metadata: {
      intent: aiReply.intent,
      leadTemperature: aiReply.leadTemperature,
      handoffRequested: aiReply.handoffRequested,
      speakerRole: aiReply.speakerRole,
      guardianConfirmed: aiReply.guardianConfirmed,
      qualificationStatus: aiReply.qualificationStatus,
      qualificationReason: aiReply.qualificationReason,
      meetingRequested: aiReply.meetingRequested,
      objectiveConfirmed: aiReply.objectiveConfirmed,
      decisionMakerConfirmed: aiReply.decisionMakerConfirmed,
      mainPain: aiReply.mainPain,
      mainDifficulty: aiReply.mainDifficulty,
      primaryObjective: aiReply.primaryObjective,
      currentSituation: aiReply.currentSituation,
      urgency: aiReply.urgency,
      decisionReadiness: aiReply.decisionReadiness,
      investmentReadiness:aiReply.investmentReadiness,
      journeyStage:aiReply.journeyStage,
      conversationStyle:aiReply.conversationStyle,
      objectionCategory:aiReply.objectionCategory,
      recommendedNextStep: aiReply.recommendedNextStep,
      qualifiesForMeeting,
      ericAudioRecommended: aiReply.ericAudioRecommended,
      ericAudioSent,
      ericAudioPath: ericAudioSent ? ericAudioPath : null,
      mediaType,
      historyMessages: history.length,
      aiMode: config.BOT_AI_MODE,
    },
  });
  if (qualifiesForMeeting) {
    const previous = await getBotConversationState(clientState.phone);
    const ageGroup = aiReply.athleteAge
      ? aiReply.athleteAge <= 13
        ? "8-13"
        : aiReply.athleteAge <= 19
          ? "14-19"
          : aiReply.athleteAge <= 25
            ? "20-25"
            : "26-plus"
      : null;
    const schedulingState = await persistEc10State({
      clientId: clientState.id,
      phone: clientState.phone,
      previous,
      stage: "awaiting_meeting_date",
      roleAnswer: aiReply.speakerRole,
      athleteAge: aiReply.athleteAge,
      ageGroup,
      serviceInterest: aiReply.serviceInterest,
      completedAt: null,
      metadata: {
        source: "gustavo_ai_sdr",
        aiQualifiedAt: new Date().toISOString(),
        qualificationReason: aiReply.qualificationReason,
        guardianConfirmed: aiReply.guardianConfirmed,
        ...(aiReply.responsibleName?{responsibleName:aiReply.responsibleName}:{}),
        ...(aiReply.athleteName?{athleteName:aiReply.athleteName}:{}),
      },
    });
    await appendClientTags(clientState.id, ["ia_qualificado", "ia_agendamento_iniciado"]);
    await askMeetingDate(client, chatId, clientState.id, clientState.phone, schedulingState, { aiLed: true });
  }
  return true;
}

function gustavoSequenceMetadata(state:BotConversationState|null) {
  return asMetadataRecord(state?.metadata);
}

function gustavoStoredRole(state:BotConversationState|null,clientState:ClientAutomationState):GustavoSpeakerRole|null {
  if(state?.role_answer==='atleta'||state?.role_answer==='responsavel')return state.role_answer;
  const metadata=gustavoSequenceMetadata(state);
  if(metadata.speakerRole==='atleta'||metadata.speakerRole==='responsavel')return metadata.speakerRole;
  const ai=asMetadataRecord(clientState.attribution_metadata?.ai_sdr);
  return ai.speakerRole==='atleta'||ai.speakerRole==='responsavel'?ai.speakerRole:null;
}

function gustavoStoredName(state:BotConversationState|null,clientState:ClientAutomationState) {
  const metadata=gustavoSequenceMetadata(state);
  const ai=asMetadataRecord(clientState.attribution_metadata?.ai_sdr);
  const role=gustavoStoredRole(state,clientState);
  const values=role==='responsavel'
    ? [metadata.responsibleName,ai.responsibleName,metadata.leadName,clientState.name,metadata.athleteName,ai.athleteName]
    : role==='atleta'
      ? [metadata.athleteName,ai.athleteName,metadata.leadName,clientState.name,metadata.responsibleName,ai.responsibleName]
      : [metadata.leadName,clientState.name,metadata.responsibleName,ai.responsibleName,metadata.athleteName,ai.athleteName];
  return values.find(value=>typeof value==='string'&&value.trim())?.toString().trim()||null;
}

function gustavoIsRegistered(state:BotConversationState|null,clientState:ClientAutomationState) {
  const metadata=gustavoSequenceMetadata(state);
  return Boolean(
    state
    || clientState.source==='site'
    || clientState.athlete_age
    || clientState.attribution_metadata
    || clientState.tags?.some(tag=>/lead_page|plano_carreira_bot_ativo|campanha/i.test(tag))
    || metadata.crmRegistered===true
  );
}

function gustavoIdentity(state:BotConversationState|null,clientState:ClientAutomationState):GustavoSequenceIdentity {
  return {
    registered:gustavoIsRegistered(state,clientState),
    leadName:gustavoStoredName(state,clientState),
    role:gustavoStoredRole(state,clientState),
    athleteAge:state?.athlete_age??clientState.athlete_age??null,
  };
}

function gustavoAgeGroup(age:number|null) {
  if(!age)return null;
  return age<=13?'8-13':age<=19?'14-19':age<=25?'20-25':'26-plus';
}

async function persistGustavoSequence(input:{
  clientState:ClientAutomationState;
  previous:BotConversationState|null;
  phase:GustavoSequencePhase;
  role?:GustavoSpeakerRole|null;
  athleteAge?:number|null;
  metadata?:Record<string,unknown>;
}) {
  const role=input.role===undefined?gustavoStoredRole(input.previous,input.clientState):input.role;
  const athleteAge=input.athleteAge===undefined?(input.previous?.athlete_age??input.clientState.athlete_age??null):input.athleteAge;
  return persistEc10State({
    clientId:input.clientState.id,
    phone:input.clientState.phone,
    previous:input.previous,
    stage:input.phase==='booking'?'awaiting_booking_completion':athleteAge?'awaiting_interest':'awaiting_age',
    roleAnswer:role,
    athleteAge,
    ageGroup:gustavoAgeGroup(athleteAge),
    serviceInterest:'plano_carreira',
    completedAt:null,
    metadata:{
      source:'gustavo_mandatory_sequence',
      professionalAiSdr:true,
      sdrPersona:'gustavo',
      sdrActiveEngine:'gustavo_sequence_with_gemini_answers',
      gustavoSequenceVersion:GUSTAVO_SEQUENCE_VERSION,
      gustavoSequencePhase:input.phase,
      ...(input.metadata??{}),
    },
  });
}

async function answerAndResumeGustavoSequence(input:{
  client:any;chatId:string;clientState:ClientAutomationState;state:BotConversationState;
  phase:GustavoSequencePhase;identity:GustavoSequenceIdentity;body:string|null;
}) {
  const history=await fetchRecentClientMessages(input.clientState.id,8);
  const answer=await answerGustavoSequenceQuestion({
    message:input.body,
    athleteAge:input.identity.athleteAge,
    speakerRole:input.identity.role,
    phase:input.phase,
    history,
  });
  const pending=gustavoPendingQuestion(input.phase,input.identity);
  await persistGustavoSequence({clientState:input.clientState,previous:input.state,phase:input.phase,
    metadata:{gustavoLastDetourAt:new Date().toISOString()}});
  await sendBotText(input.client,input.chatId,input.clientState.id,[answer,pending].filter(Boolean).join('\n\n'),[450,900]);
  return true;
}

async function deliverGustavoCareerAudios(input:{
  client:any;chatId:string;clientState:ClientAutomationState;state:BotConversationState;identity:GustavoSequenceIdentity;
}) {
  const metadata=gustavoSequenceMetadata(input.state);
  const sentPaths=Array.isArray(metadata.ericAiAudioPathsSent)
    ? metadata.ericAiAudioPathsSent.filter((item):item is string=>typeof item==='string')
    : [];
  let state=await persistGustavoSequence({
    clientState:input.clientState,
    previous:input.state,
    phase:'audio_delivery',
    role:input.identity.role,
    athleteAge:input.identity.athleteAge,
    metadata:{
      guardianConfirmed:input.identity.role==='responsavel'&&Boolean(input.identity.athleteAge&&input.identity.athleteAge<18),
      audioSequenceInProgress:true,
      audioSequenceStartedAt:new Date().toISOString(),
    },
  })??input.state;
  await updateClientAiProfile({
    clientId:input.clientState.id,
    serviceInterest:'plano_carreira',
    athleteAge:input.identity.athleteAge,
    speakerRole:input.identity.role??'unknown',
    guardianConfirmed:input.identity.role==='responsavel'&&Boolean(input.identity.athleteAge&&input.identity.athleteAge<18),
    leadTemperature:'morno',
  });
  await sendBotText(input.client,input.chatId,input.clientState.id,gustavoPlanIntroduction(input.identity.athleteAge),[450,900]);
  const delivered=[...sentPaths];
  for(const [index,item] of gustavoCareerAudios(input.identity.athleteAge).entries()) {
    if(delivered.includes(item.audioPath))continue;
    const sent=await sendBotAudio(input.client,input.chatId,input.clientState.id,item.audioPath);
    if(sent)delivered.push(item.audioPath);
    if(index<1)await naturalPause(1400,2400);
  }
  state=await persistGustavoSequence({
    clientState:input.clientState,
    previous:await getBotConversationState(input.clientState.phone)??state,
    phase:'audio_confirmation',
    role:input.identity.role,
    athleteAge:input.identity.athleteAge,
    metadata:{
      ericAiAudioPathsSent:[...new Set(delivered)],
      ericAiLastAudioSentAt:new Date().toISOString(),
      audioSequenceInProgress:false,
      audioSequenceFinishedAt:new Date().toISOString(),
    },
  })??state;
  await naturalPause(2600,4200);
  await sendBotText(input.client,input.chatId,input.clientState.id,gustavoPendingQuestion('audio_confirmation',gustavoIdentity(state,input.clientState)),[350,700]);
  return true;
}

async function openGustavoBooking(input:{
  client:any;chatId:string;clientState:ClientAutomationState;state:BotConversationState;identity:GustavoSequenceIdentity;
}) {
  const minor=Boolean(input.identity.athleteAge&&input.identity.athleteAge<18);
  if(minor&&input.identity.role!=='responsavel') {
    await persistGustavoSequence({clientState:input.clientState,previous:input.state,phase:'guardian_wait',
      role:'atleta',athleteAge:input.identity.athleteAge,metadata:{guardianConfirmed:false,guardianRequestedAt:new Date().toISOString()}});
    await sendBotText(input.client,input.chatId,input.clientState.id,
      'Como o atleta e menor de idade, o pai, a mae ou o responsavel legal precisa participar da decisao e fazer o agendamento. Ele pode continuar esta conversa por aqui e se identificar?',[450,900]);
    return true;
  }
  const metadata=gustavoSequenceMetadata(input.state);
  const bookingContactName=selectBookingContactName({metadata,minor,responsibleRole:input.identity.role==='responsavel'});
  if(!bookingContactName) {
    await persistGustavoSequence({clientState:input.clientState,previous:input.state,phase:'booking_name',
      role:input.identity.role,athleteAge:input.identity.athleteAge,
      metadata:{guardianConfirmed:minor&&input.identity.role==='responsavel'}});
    await sendBotText(input.client,input.chatId,input.clientState.id,
      minor?'Pra deixar a reuniao no nome certo, qual e o seu nome completo como responsavel?':'Pra deixar a reuniao no nome certo, qual e o seu nome completo?',[450,900]);
    return true;
  }
  const ready=await persistGustavoSequence({clientState:input.clientState,previous:input.state,phase:'booking',
    role:input.identity.role,athleteAge:input.identity.athleteAge,
    metadata:{bookingContactName,guardianConfirmed:minor&&input.identity.role==='responsavel',meetingInterestConfirmedAt:new Date().toISOString()}})??input.state;
  await appendClientTags(input.clientState.id,['ia_qualificado','ia_agendamento_iniciado','plano_carreira']);
  await askMeetingDate(input.client,input.chatId,input.clientState.id,input.clientState.phone,ready,{aiLed:true});
  return true;
}

async function handleGustavoMandatorySequence(
  client:any,
  chatId:string,
  clientState:ClientAutomationState,
  body:string|null,
  _mediaType='text',
) {
  let state=await getBotConversationState(clientState.phone);
  if(explicitSdrStop(body)) {
    await appendClientTags(clientState.id,['ia_atendimento_encerrado']);
    await sendBotText(client,chatId,clientState.id,'Tudo certo. Vou encerrar o atendimento automático por aqui. Se quiser retomar depois, é só chamar.',[350,650]);
    await updateClientAiProfile({clientId:clientState.id,automationPauseRequested:true});
    return true;
  }
  if(explicitSdrHuman(body)) {
    await appendClientTags(clientState.id,['aguardando_vendedor']);
    await sendBotText(client,chatId,clientState.id,'Combinado. Vou deixar a conversa com a nossa equipe comercial a partir daqui.',[350,650]);
    await updateClientAiProfile({clientId:clientState.id,handoffRequested:true});
    return true;
  }
  const incomingRole=parseGustavoRole(body);
  const incomingAge=extractExplicitGustavoAge(body);
  const incomingName=extractGustavoSelfName(body);
  if(!state||gustavoSequenceMetadata(state).gustavoSequenceVersion!==GUSTAVO_SEQUENCE_VERSION) {
    const initialRole=incomingRole??gustavoStoredRole(state,clientState);
    const initialAge=incomingAge??state?.athlete_age??clientState.athlete_age??null;
    const knownName=incomingName??gustavoStoredName(state,clientState);
    state=await persistGustavoSequence({clientState,previous:state,phase:'company_familiarity',role:initialRole,athleteAge:initialAge,
      metadata:{
        sequenceStartedAt:new Date().toISOString(),
        crmRegistered:gustavoIsRegistered(state,clientState),
        ...(knownName?{leadName:knownName}:{}),
        ...(incomingName?{capturedSelfName:incomingName}:{}),
      }})??state;
    if(!state)throw new Error('gustavo_sequence_state_unavailable');
    await sendBotText(client,chatId,clientState.id,gustavoOpeningMessage(gustavoIdentity(state,clientState)),[450,900]);
    return true;
  }

  let identity=gustavoIdentity(state,clientState);
  if(incomingRole||incomingAge||incomingName) {
    const nextRole=incomingRole??identity.role;
    const nextAge=incomingAge??identity.athleteAge;
    const namePatch=incomingName
      ? nextRole==='responsavel'?{responsibleName:incomingName,leadName:incomingName,capturedSelfName:incomingName}
        :nextRole==='atleta'?{athleteName:incomingName,leadName:incomingName,capturedSelfName:incomingName}
          :{leadName:incomingName,capturedSelfName:incomingName}
      :{};
    state=await persistGustavoSequence({clientState,previous:state,
      phase:normalizeGustavoSequencePhase(gustavoSequenceMetadata(state).gustavoSequencePhase)??'company_familiarity',
      role:nextRole,athleteAge:nextAge,metadata:namePatch})??state;
    identity=gustavoIdentity(state,clientState);
  }

  const phase=normalizeGustavoSequencePhase(gustavoSequenceMetadata(state).gustavoSequencePhase)??'company_familiarity';
  if(phase==='company_familiarity') {
    const familiarity=parseGustavoFamiliarity(body);
    if(familiarity===null)return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    const nextPhase: GustavoSequencePhase=identity.role?'identity_confirmation':'identity';
    state=await persistGustavoSequence({clientState,previous:state,phase:nextPhase,
      metadata:{companyFamiliarity:familiarity,companyFamiliarityConfirmedAt:new Date().toISOString()}})??state;
    identity=gustavoIdentity(state,clientState);
    await sendBotText(client,chatId,clientState.id,gustavoIdentityPrompt(identity),[450,900]);
    return true;
  }

  if(phase==='identity_confirmation') {
    const explicitRole=parseGustavoRole(body);
    const confirmation=parseGustavoYesNo(body);
    if(explicitRole)identity={...identity,role:explicitRole};
    else if(confirmation===false) {
      await persistGustavoSequence({clientState,previous:state,phase:'identity',role:null,metadata:{storedIdentityRejectedAt:new Date().toISOString()}});
      await sendBotText(client,chatId,clientState.id,gustavoIdentityPrompt({...identity,role:null}),[450,900]);
      return true;
    } else if(confirmation!==true) {
      return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    }
    state=await persistGustavoSequence({clientState,previous:state,phase:identity.athleteAge?'audio_delivery':'age',
      role:identity.role,athleteAge:identity.athleteAge,
      metadata:{identityConfirmedAt:new Date().toISOString(),guardianConfirmed:identity.role==='responsavel'&&Boolean(identity.athleteAge&&identity.athleteAge<18)}})??state;
    identity=gustavoIdentity(state,clientState);
    if(!identity.athleteAge) {
      await sendBotText(client,chatId,clientState.id,gustavoAgePrompt(identity.role),[450,900]);
      return true;
    }
    return deliverGustavoCareerAudios({client,chatId,clientState,state,identity});
  }

  if(phase==='identity') {
    const role=parseGustavoRole(body);
    if(!role)return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    state=await persistGustavoSequence({clientState,previous:state,phase:identity.athleteAge?'audio_delivery':'age',role,
      metadata:{identityConfirmedAt:new Date().toISOString(),guardianConfirmed:role==='responsavel'&&Boolean(identity.athleteAge&&identity.athleteAge<18)}})??state;
    identity=gustavoIdentity(state,clientState);
    if(!identity.athleteAge) {
      await sendBotText(client,chatId,clientState.id,gustavoAgePrompt(role),[450,900]);
      return true;
    }
    return deliverGustavoCareerAudios({client,chatId,clientState,state,identity});
  }

  if(phase==='age') {
    const age=extractExplicitGustavoAge(body);
    if(!age)return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    if(age<8) {
      await persistGustavoSequence({clientState,previous:state,phase:'age',athleteAge:null,metadata:{underMinimumAgeReported:age}});
      await appendClientTags(clientState.id,['aguardando_vendedor']);
      await sendBotText(client,chatId,clientState.id,'O Plano de Carreira da EC10 atende atletas a partir de 8 anos. Quando ele completar 8, pode me chamar por aqui que eu retomo o atendimento.',[450,900]);
      return true;
    }
    state=await persistGustavoSequence({clientState,previous:state,phase:'audio_delivery',role:identity.role,athleteAge:age,
      metadata:{ageConfirmedAt:new Date().toISOString(),guardianConfirmed:identity.role==='responsavel'&&age<18}})??state;
    identity=gustavoIdentity(state,clientState);
    return deliverGustavoCareerAudios({client,chatId,clientState,state,identity});
  }

  if(phase==='audio_delivery')return deliverGustavoCareerAudios({client,chatId,clientState,state,identity});

  if(phase==='audio_confirmation') {
    const heard=parseGustavoYesNo(body);
    if(heard===null)return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    if(!heard) {
      await sendBotText(client,chatId,clientState.id,'Sem problema. Os audios ficaram acima. Quando terminar, me avise com “ouvi” e eu continuo daqui.',[450,900]);
      return true;
    }
    if(hasGustavoMeetingIntent(body))return openGustavoBooking({client,chatId,clientState,state,identity});
    await persistGustavoSequence({clientState,previous:state,phase:'meeting_interest',metadata:{audioListeningConfirmedAt:new Date().toISOString()}});
    await sendBotText(client,chatId,clientState.id,gustavoPendingQuestion('meeting_interest',identity),[450,900]);
    return true;
  }

  if(phase==='meeting_interest') {
    const interest=parseGustavoYesNo(body);
    if(interest===null&&!hasGustavoMeetingIntent(body))return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    if(interest===false) {
      await sendBotText(client,chatId,clientState.id,'Tudo certo. Se mudar de ideia, me chama por aqui que eu retomo exatamente deste ponto.',[450,900]);
      await appendClientTags(clientState.id,['aguardando_vendedor']);
      return true;
    }
    return openGustavoBooking({client,chatId,clientState,state,identity});
  }

  if(phase==='guardian_wait') {
    const role=parseGustavoRole(body);
    if(role!=='responsavel')return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    const name=incomingName??parseBookingContactName(body);
    state=await persistGustavoSequence({clientState,previous:state,phase:name?'booking':'booking_name',role:'responsavel',
      metadata:{guardianConfirmed:true,guardianConfirmedAt:new Date().toISOString(),...(name?{responsibleName:name,bookingContactName:name}: {})}})??state;
    identity=gustavoIdentity(state,clientState);
    if(name)return openGustavoBooking({client,chatId,clientState,state,identity});
    await sendBotText(client,chatId,clientState.id,'Obrigado. Qual é o seu nome completo como responsável que participará da reunião?',[450,900]);
    return true;
  }

  if(phase==='booking_name') {
    const name=parseBookingContactName(body);
    if(!name)return answerAndResumeGustavoSequence({client,chatId,clientState,state,phase,identity,body});
    const minor=Boolean(identity.athleteAge&&identity.athleteAge<18);
    state=await persistGustavoSequence({clientState,previous:state,phase:'booking',role:identity.role,athleteAge:identity.athleteAge,
      metadata:{bookingContactName:name,...(identity.role==='responsavel'?{responsibleName:name}:{athleteName:name}),guardianConfirmed:minor&&identity.role==='responsavel'}})??state;
    identity=gustavoIdentity(state,clientState);
    return openGustavoBooking({client,chatId,clientState,state,identity});
  }

  return openGustavoBooking({client,chatId,clientState,state,identity});
}

async function handleGustavoPrimaryRoute(
  client:any,
  chatId:string,
  clientState:ClientAutomationState,
  body:string|null,
  mediaType="text",
  sourceMessageId:string|null=null,
) {
  if(config.GUSTAVO_V2_ORACLE_URL&&body?.trim()) {
    try {
      return await handleGustavoV2Oracle(client,chatId,clientState,body,mediaType,sourceMessageId);
    } catch (error) {
      await appendClientTags(clientState.id,["ia_rota_reserva_acionada"]);
      await recordTrafficEvent({
        clientId:clientState.id,phone:clientState.phone,eventType:"gustavo_v2_ai_failover_started",
        channel:"whatsapp",platform:"multi_provider",serviceInterest:clientState.service_interest,
        metadata:{primary:"gustavo_v2_oracle",fallback:"ec10_ai_multi_provider",
          error:getErrorMessage(error).slice(0,160)},
      }).catch(()=>undefined);
      return withSdrCustomerTurn(clientState.id,clientState.phone,()=>
        handleEc10AiConversation(client,chatId,clientState,body,mediaType));
    }
  }
  const state=await getBotConversationState(clientState.phone);
  if(state&&['awaiting_meeting_date','awaiting_meeting_time','awaiting_booking_completion'].includes(state.stage)) {
    return handleEc10ConversationInternal(client,chatId,clientState.id,clientState.phone,body,mediaType);
  }
  return withSdrCustomerTurn(clientState.id,clientState.phone,()=>handleGustavoMandatorySequence(client,chatId,clientState,body,mediaType));
}

type GustavoV2OracleResult={
  reply:string;
  audio_key:"eric_8_13"|"eric_14_18"|"eric_20_25"|null;
  booking_url:string|null;
  poll:{kind:"meeting_day"|"meeting_time";question:string;options:string[]}|null;
  booking:{id:string;starts_at:string;seller_name:string}|null;
  athlete_age:number|null;
  stage:string;
  model:string;
};

async function requestGustavoV2Oracle(clientState:ClientAutomationState,body:string,mediaType:string,sourceMessageId:string|null) {
  const stableFallback=createHash("sha256")
    .update([clientState.id,clientState.phone,mediaType,body].join("|"))
    .digest("hex");
  const messageId=(sourceMessageId?.trim()||`oracle:${stableFallback}`).slice(0,300);
  let lastError:unknown;
  for(let attempt=0;attempt<1;attempt+=1) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),config.GUSTAVO_V2_ORACLE_TIMEOUT_MS);
    try {
      const response=await fetch(config.GUSTAVO_V2_ORACLE_URL!,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          phone:clientState.phone,
          message_id:messageId,
          inbound:body,
          client_id:clientState.id,
          known_name:clientState.name,
          known_age:clientState.athlete_age??null,
          lead_source:clientState.traffic_source??clientState.utm_source??clientState.source,
          service_interest:clientState.service_interest,
        }),
        signal:controller.signal,
      });
      if(!response.ok)throw new Error(`gustavo_v2_http_${response.status}`);
      const result=await response.json() as GustavoV2OracleResult;
      if(!result?.reply?.trim())throw new Error("gustavo_v2_empty_reply");
      return result;
    }catch(error){
      lastError=error;
    }finally{clearTimeout(timeout);}
  }
  throw lastError instanceof Error?lastError:new Error("gustavo_v2_unavailable");
}

async function confirmGustavoV2OracleAudioDelivery(
  phone:string,audioKey:NonNullable<GustavoV2OracleResult["audio_key"]>,
) {
  const endpoint=new URL(config.GUSTAVO_V2_ORACLE_URL!);
  endpoint.pathname="/oracle/audio-delivered";
  endpoint.search="";
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),config.GUSTAVO_V2_ORACLE_TIMEOUT_MS);
  try {
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({phone,audio_key:audioKey}),
      signal:controller.signal,
    });
    if(!response.ok)throw new Error(`gustavo_v2_audio_confirmation_http_${response.status}`);
  } finally {clearTimeout(timeout);}
}

function gustavoV2AudioKeyForPath(path:string|null|undefined):GustavoV2OracleResult["audio_key"] {
  const value=String(path||'').replace(/\\/g,'/').toLowerCase();
  if(value.includes('02_8-13_plano-de-carreira.ogg'))return 'eric_8_13';
  if(value.includes('13-17-plano-carreira/02_plano_1m49.ogg'))return 'eric_14_18';
  if(value.includes('18-plus/02_18plus_1m54.ogg'))return 'eric_20_25';
  return null;
}

async function handleGustavoV2Oracle(
  client:any,chatId:string,clientState:ClientAutomationState,body:string,mediaType:string,sourceMessageId:string|null,
) {
  try {
    const result=await requestGustavoV2Oracle(clientState,body,mediaType,sourceMessageId);
    await sendBotText(client,chatId,clientState.id,result.reply,[350,750]);
    if(result.audio_key) {
      const audio=gustavoCareerAudios(result.athlete_age).at(-1);
      if(audio) {
        await naturalPause(900,1600);
        const audioSent=await sendBotAudio(client,chatId,clientState.id,audio.audioPath).catch(()=>false);
        if(audioSent) {
          await confirmGustavoV2OracleAudioDelivery(clientState.phone,result.audio_key);
        } else {
          await scheduleOutboundAudioMessage({
            clientId:clientState.id,phone:clientState.phone,mediaPath:audio.audioPath,
            scheduledAt:new Date(Date.now()+3000).toISOString(),
          });
          await recordTrafficEvent({
            clientId:clientState.id,phone:clientState.phone,eventType:"gustavo_v2_audio_recovery_queued",
            channel:"whatsapp",platform:"whatsapp",metadata:{audioKey:result.audio_key},
          }).catch(()=>undefined);
        }
      }
    }
    if(result.poll?.question&&Array.isArray(result.poll.options)&&result.poll.options.length>=2) {
      await naturalPause(450,850);
      const pollSent=await sendBotPoll({
        client,chatId,clientId:clientState.id,question:result.poll.question,
        options:result.poll.options,delayRange:[250,550],
      });
      if(!pollSent) {
        await scheduleOutboundPollMessage({
          clientId:clientState.id,phone:clientState.phone,
          body:buildPollFallbackBody(result.poll.question,result.poll.options),
          scheduledAt:new Date(Date.now()+3000).toISOString(),
        });
        await recordTrafficEvent({
          clientId:clientState.id,phone:clientState.phone,eventType:"gustavo_v2_poll_recovery_queued",
          channel:"whatsapp",platform:"whatsapp",metadata:{pollKind:result.poll.kind},
        }).catch(()=>undefined);
      }
    }
    if(result.booking) {
      await recordTrafficEvent({
        clientId:clientState.id,phone:clientState.phone,eventType:"bot_meeting_scheduled",
        channel:"whatsapp",platform:"gustavo_v2",serviceInterest:"plano_carreira",
        athleteAge:result.athlete_age,metadata:{bookingId:result.booking.id,
          startsAt:result.booking.starts_at,sellerName:result.booking.seller_name,source:"gustavo_chat"},
      });
      await recordTrafficEvent({
        clientId:clientState.id,phone:clientState.phone,eventType:"Schedule",
        channel:"whatsapp",platform:"gustavo_v2",serviceInterest:"plano_carreira",
        athleteAge:result.athlete_age,metadata:{bookingId:result.booking.id,
          startsAt:result.booking.starts_at,sellerName:result.booking.seller_name,source:"gustavo_chat"},
      });
    }
    await recordTrafficEvent({
      clientId:clientState.id,phone:clientState.phone,eventType:"gustavo_v2_oracle_reply_sent",
      channel:"whatsapp",platform:"gemini",serviceInterest:clientState.service_interest,
      athleteAge:result.athlete_age,metadata:{stage:result.stage,model:result.model,audioKey:result.audio_key,
        bookingSent:Boolean(result.booking),pollKind:result.poll?.kind??null},
    });
    return true;
  } catch(error) {
    await recordTrafficEvent({
      clientId:clientState.id,phone:clientState.phone,eventType:"gustavo_v2_oracle_error",
      channel:"whatsapp",platform:"gemini",metadata:{error:error instanceof Error?error.message.slice(0,120):"unknown"},
    }).catch(()=>undefined);
    throw error;
  }
}

async function saveGustavoRecoveryPatch(state:BotConversationState,patch:Record<string,unknown>) {
  const latest=await getBotConversationState(state.phone)??state;
  const metadata=asMetadataRecord(latest.metadata);
  const gustavo=asMetadataRecord(metadata.gustavo);
  return persistEc10State({
    clientId:latest.client_id,
    phone:latest.phone,
    previous:latest,
    stage:latest.stage,
    metadata:{...metadata,gustavo:{...gustavo,...patch},sdrActiveEngine:"gustavo_primary"}
  });
}

async function processGustavoRecoveryState(client:any,state:BotConversationState) {
  const clientState=await getClientAutomationStateById(state.client_id);
  const metadata=asMetadataRecord(state.metadata);
  const gustavo=asMetadataRecord(metadata.gustavo);
  if(!clientState||clientState.bot_paused) {
    await saveGustavoRecoveryPatch(state,{pending:false,recoverySkippedAt:new Date().toISOString(),recoverySkipReason:"client_paused_or_missing"});
    return;
  }
  const history=await fetchRecentClientMessages(clientState.id,12);
  const latestInbound=[...history].reverse().find(item=>item.direction==='inbound');
  const latestOutbound=[...history].reverse().find(item=>item.direction==='outbound');
  if(!latestInbound) {
    await saveGustavoRecoveryPatch(state,{pending:false,recoverySkippedAt:new Date().toISOString(),recoverySkipReason:"no_inbound"});
    return;
  }
  if(latestOutbound&&Date.parse(latestOutbound.createdAt)>=Date.parse(latestInbound.createdAt)) {
    await saveGustavoRecoveryPatch(state,{pending:false,pendingText:"",recoveryResolvedAt:new Date().toISOString(),recoveryResult:"already_answered"});
    return;
  }
  const body=typeof gustavo.pendingText==='string'&&gustavo.pendingText.trim()?gustavo.pendingText.trim():latestInbound.body;
  const chatId=typeof gustavo.chatId==='string'&&gustavo.chatId.trim()?gustavo.chatId:`${clientState.phone}@c.us`;
  try {
    await handleGustavoPrimaryRoute(client,chatId,clientState,body,latestInbound.mediaType||"text");
    await saveGustavoRecoveryPatch(state,{pending:false,pendingText:"",retryCount:0,recoveryResolvedAt:new Date().toISOString(),recoveryResult:"reprocessed"});
    await recordTrafficEvent({clientId:clientState.id,phone:clientState.phone,eventType:"gustavo_recovery_processed",channel:"whatsapp",platform:configuredAiPlatform(),metadata:{source:"python_guardian",stage:state.stage}});
  } catch(error) {
    const retryCount=Math.max(0,Number(gustavo.retryCount)||0)+1;
    const exhausted=retryCount>=5;
    await saveGustavoRecoveryPatch(state,{
      pending:!exhausted,
      retryCount,
      dueAt:new Date(Date.now()+Math.min(120_000,15_000*retryCount)).toISOString(),
      lastRecoveryErrorAt:new Date().toISOString(),
      lastRecoveryError:error instanceof Error?error.message.slice(0,180):"recovery_failed"
    });
    if(exhausted) {
      await appendClientTags(clientState.id,["ia_transferencia_humana","consultor_responsavel"]);
      await updateClientAiProfile({clientId:clientState.id,handoffRequested:true,leadTemperature:"quente"});
    }
    throw error;
  }
}

async function beginEc10Sdr(client:any,chatId:string,clientId:string,phone:string,previous:BotConversationState,age:number) {
  const menu=sdrServiceMenu(age,typeof previous.metadata?.campaignProductName==='string'?previous.metadata.campaignProductName:undefined);
  const plan=getEc10LeadPlan(age)!;
  await persistEc10State({clientId,phone,previous,stage:'awaiting_interest',athleteAge:age,ageGroup:plan.ageGroup,
    metadata:{sdrVersion:SDR_VERSION,sdrStep:'service',sdrOfferId:null,sdrStartedAt:new Date().toISOString(),audioSequenceInProgress:false,bookingContactPending:false}});
  await updateClientAiProfile({clientId,athleteAge:age,leadTemperature:'morno'});
  await recordTrafficEvent({clientId,phone,eventType:'bot_sdr_service_menu',channel:'whatsapp',platform:'whatsapp',athleteAge:age,metadata:{version:SDR_VERSION,eligible:eligibleSdrOffers(age).map(o=>o.id)}});
  await sendBotText(client,chatId,clientId,menu.explanation,[700,1200]);
  await sendBotPoll({client,chatId,clientId,question:menu.question,options:menu.options,delayRange:[500,1000]});
}

function andersonPlainText(value:string|null|undefined) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

function inferAndersonSpeakerRole(value:string|null|undefined) : 'atleta'|'responsavel'|null {
  const text=andersonPlainText(value);
  if(/\b((pra|para|por) mim( mesmo| mesma)?|sou eu|eu mesmo|eu mesma)\b/.test(text))return 'atleta';
  if(/\b(sou|eu sou|falo como|o atleta sou eu|atleta)\b/.test(text)&&!/\b(meu|minha|filho|filha|sobrinho|sobrinha|responsavel|pai|mae)\b/.test(text))return 'atleta';
  if(/\b(responsavel|pai|mae|meu filho|minha filha|meu atleta|sou a mae|sou o pai)\b/.test(text))return 'responsavel';
  return null;
}

function readAndersonCompanyFamiliarity(value:string|null|undefined) : boolean|null {
  const text=andersonPlainText(value);
  if(/\b(nao|nunca|ainda nao|nao conheco|primeira vez)\b/.test(text))return false;
  if(/\b(sim|conheco|ja vi|ja ouvi|acompanho|sei sim)\b/.test(text))return true;
  return null;
}

function andersonFirstName(state:BotConversationState) {
  const metadata=asMetadataRecord(state.metadata);
  const raw=typeof metadata.leadName==='string'?metadata.leadName.trim():'';
  return raw.split(/\s+/)[0]||'';
}

function andersonNaturalGreeting(body:string|null,firstName:string) {
  const text=andersonPlainText(body);
  const greeting=/boa tarde/.test(text)?'Boa tarde':/boa noite/.test(text)?'Boa noite':/bom dia/.test(text)?'Bom dia':'Oi';
  return `${greeting}${firstName?`, ${firstName}`:''}! Tudo certo por aqui 😄 Me conta, o que te trouxe até a EC10?`;
}

async function handleAndersonNaturalDiscoveryBeforeAge(input:{client:any;chatId:string;clientId:string;phone:string;state:BotConversationState;body:string|null}) {
  if(config.BOT_AI_MODE!=='primary'||input.state.stage!=='awaiting_age')return false;
  const metadata=asMetadataRecord(input.state.metadata);
  const phase=typeof metadata.andersonDiscoveryStep==='string'?metadata.andersonDiscoveryStep:'opening';
  const firstName=andersonFirstName(input.state);
  const greeting=sdrGreeting(input.body);
  const capturedAge=extractAthleteAge(input.body);

  if(capturedAge)return false;

  if(phase==='opening'&&greeting) {
    await persistEc10State({clientId:input.clientId,phone:input.phone,previous:input.state,stage:'awaiting_age',completedAt:null,
      metadata:{andersonDiscoveryStep:'awaiting_context',naturalSdrStartedAt:new Date().toISOString()}});
    await sendBotText(input.client,input.chatId,input.clientId,andersonNaturalGreeting(input.body,firstName),[450,900]);
    return true;
  }

  if(phase==='opening'||phase==='awaiting_context'||phase==='awaiting_role') {
    const storedRole=input.state.role_answer==='atleta'||input.state.role_answer==='responsavel'
      ? input.state.role_answer
      : metadata.speakerRole==='atleta'||metadata.speakerRole==='responsavel'
        ? metadata.speakerRole
        : null;
    const role=inferAndersonSpeakerRole(input.body) || storedRole;
    if(!role) {
      const prefix=phase==='awaiting_context'&&input.body?.trim()
        ? `${firstName?`${firstName}, `:''}quero entender seu momento sem transformar isso num questionário.`
        : `${firstName?`${firstName}, `:''}pra eu conversar com você do jeito certo, me conta uma coisa.`;
      await persistEc10State({clientId:input.clientId,phone:input.phone,previous:input.state,stage:'awaiting_age',completedAt:null,
        metadata:{andersonDiscoveryStep:'awaiting_role'}});
      await sendBotText(input.client,input.chatId,input.clientId,`${prefix} Você é o atleta ou está falando como responsável por ele?`,[500,1000]);
      return true;
    }
    await persistEc10State({clientId:input.clientId,phone:input.phone,previous:input.state,stage:'awaiting_age',roleAnswer:role,completedAt:null,
      metadata:{andersonDiscoveryStep:'awaiting_company_familiarity',speakerRole:role}});
    await updateClientAiProfile({clientId:input.clientId,speakerRole:role,leadTemperature:'morno'});
    const text=role==='atleta'
      ? `Boa${firstName?`, ${firstName}`:''}. Você já conhece a EC10 e o trabalho que a gente faz com a carreira do atleta?`
      : `Boa${firstName?`, ${firstName}`:''}. Você já conhece a EC10 e o trabalho que a gente faz junto com atletas e famílias?`;
    await sendBotText(input.client,input.chatId,input.clientId,text,[500,1000]);
    return true;
  }

  if(phase==='awaiting_company_familiarity') {
    if(capturedAge)return false;
    const familiarity=readAndersonCompanyFamiliarity(input.body);
    const role=input.state.role_answer==='responsavel'?'responsavel':'atleta';
    const intro=familiarity===true
      ? `Boa${firstName?`, ${firstName}`:''}. Então você já sabe que a gente olha a carreira como um todo, não só uma oportunidade solta.`
      : `Tranquilo${firstName?`, ${firstName}`:''}. A EC10 organiza a carreira do atleta, prepara o caminho e envolve a família nas decisões importantes, no Brasil ou fora.`;
    const ageQuestion=role==='atleta'
      ? 'Só pra eu te orientar do jeito certo: você tem quantos anos, irmão?'
      : 'Só pra eu te orientar pelo momento certo: qual é a idade do atleta?';
    await persistEc10State({clientId:input.clientId,phone:input.phone,previous:input.state,stage:'awaiting_age',completedAt:null,
      metadata:{andersonDiscoveryStep:'awaiting_age_natural',companyFamiliarity:familiarity,ageQuestionAskedAt:new Date().toISOString()}});
    await sendBotText(input.client,input.chatId,input.clientId,`${intro} ${ageQuestion}`,[600,1200]);
    return true;
  }

  if(phase==='awaiting_age_natural'&&!capturedAge) {
    const role=input.state.role_answer==='responsavel'?'responsavel':'atleta';
    const text=role==='atleta'
      ? `${firstName?`${firstName}, `:''}já vou ligar seu momento aos caminhos certos. Me fala sua idade, irmão?`
      : `${firstName?`${firstName}, `:''}já vou ligar o momento dele aos caminhos certos. Qual é a idade do atleta?`;
    await sendBotText(input.client,input.chatId,input.clientId,text,[500,1000]);
    return true;
  }
  return false;
}

async function beginEc10ProfessionalSdr(client:any,chatId:string,clientId:string,phone:string,previous:BotConversationState,age:number) {
  const metadata=asMetadataRecord(previous.metadata);
  const registered=metadata.crmRegistered===true||metadata.funnelKey==='ec10_campaign_landing_pages'||Boolean(previous.id);
  const product=typeof metadata.campaignProductName==='string'?metadata.campaignProductName:null;
  const rawName=typeof metadata.leadName==='string'?metadata.leadName.trim():'';
  const firstName=rawName.split(/\s+/)[0]||'';
  const plan=getEc10LeadPlan(age)!;
  const purchaseStage=product?'consideracao':'descoberta';
  const next=await persistEc10State({clientId,phone,previous,stage:'awaiting_interest',athleteAge:age,ageGroup:plan.ageGroup,
    serviceInterest:product?previous.service_interest:'nao_definido',completedAt:null,
    metadata:{professionalAiSdr:true,sdrPersona:'gustavo',sdrVersion:SDR_VERSION,purchaseStage,
      crmRegistered:registered,leadName:rawName||undefined,ageCapturedAt:new Date().toISOString()}});
  await updateClientAiProfile({clientId,athleteAge:age,leadTemperature:product?'morno':'frio'});
  await recordTrafficEvent({clientId,phone,eventType:'gustavo_sdr_started',channel:'whatsapp',platform:'whatsapp',athleteAge:age,
    metadata:{registered,product,purchaseStage,version:SDR_VERSION}});
  const role=previous.role_answer==='responsavel'?'responsavel':previous.role_answer==='atleta'?'atleta':null;
  const paths=eligibleSdrOffers(age).map(item=>item.name);
  const pathText=paths.length>1?`${paths.slice(0,-1).join(', ')} e ${paths.at(-1)}`:paths[0]||'Plano de Carreira';
  const opening=!role
    ? `${firstName?`${firstName}, `:''}agora que sei sua idade, me conta: você é o atleta ou está falando como responsável por ele?`
    : role==='atleta'&&age<18
      ? `Boa${firstName?`, ${firstName}`:''}. Com ${age} anos, a EC10 pode trabalhar caminhos como ${pathText}, sempre olhando preparação, carreira e o momento certo para cada passo. A ideia é cuidar do seu desenvolvimento e orientar sua família junto com você. Como você ainda é menor, quero trazer quem decide essa parte com você para a conversa. Quem é o responsável que acompanha sua carreira?`
      : role==='responsavel'
        ? `Boa${firstName?`, ${firstName}`:''}. Para ${age} anos, os caminhos que podem fazer sentido são ${pathText}. Antes de indicar qualquer passo, a EC10 olha preparação, momento esportivo e o que a família busca para construir algo realmente individual. O que fez vocês procurarem orientação agora?`
        : `Boa${firstName?`, ${firstName}`:''}. Com ${age} anos, a EC10 pode analisar caminhos como ${pathText}, ligando seu momento atual a uma rota de carreira mais organizada. Me conta onde você joga ou treina hoje para eu enxergar esse cenário com você.`;
  await sendBotText(client,chatId,clientId,opening,[500,1000]);
  return next;
}

async function handleEc10SdrTurn(client:any,chatId:string,clientId:string,phone:string,currentState:BotConversationState,body:string|null) {
  const age=currentState.athlete_age;
  if(!age||!getEc10LeadPlan(age))return false;
  const rawStep=currentState.metadata?.sdrStep;
  if(!['service','help','next','question','booking'].includes(String(rawStep)))return false;
  const decision=decideEc10Sdr({age,step:rawStep as SdrStep,offerId:currentState.metadata?.sdrOfferId,body});
  if(decision.stop||decision.handoff) {
    await cancelQueuedFollowUpMessages(clientId,'SDR: pedido explícito de pausa ou atendimento humano.');
    await sendBotText(client,chatId,clientId,decision.stop?'Tudo certo. Vou parar o atendimento por aqui. Se quiser voltar, é só chamar.':'Vou deixar sua conversa com a equipe EC10, junto com o que você já informou. Não precisa começar de novo.',[500,1000]);
    await persistEc10State({clientId,phone,previous:currentState,stage:decision.stop?'completed':'awaiting_interest',completedAt:decision.stop?new Date().toISOString():null,
      metadata:{sdrPaused:true,sdrPauseReason:decision.stop?'opt_out':'human_request',consultantHandoffRequestedAt:decision.handoff?new Date().toISOString():null}});
    // Pause the actual automation, including queues, instead of only setting a label.
    await updateClientAiProfile({clientId,handoffRequested:!!decision.handoff,automationPauseRequested:true,leadTemperature:decision.handoff?'quente':'frio'});
    await recordTrafficEvent({clientId,phone,eventType:decision.stop?'bot_sdr_opt_out':'bot_sdr_handoff',channel:'whatsapp',platform:'whatsapp',metadata:{version:SDR_VERSION}});
    return true;
  }
  const saved=await persistEc10State({clientId,phone,previous:currentState,stage:'awaiting_interest',
    ...(decision.offer?{serviceInterest:decision.offer.service}:{}),
    metadata:{sdrVersion:SDR_VERSION,sdrStep:decision.step,sdrOfferId:decision.offer?.id??null,sdrLastTurnAt:new Date().toISOString(),sdrLastQuestion:decision.answer?body:null}});
  const next=saved??{...currentState,service_interest:decision.offer?.service??currentState.service_interest,metadata:{...currentState.metadata,sdrStep:decision.step,sdrOfferId:decision.offer?.id??null}};
  if(decision.offer&&currentState.metadata?.sdrOfferId!==decision.offer.id) {
    await cancelQueuedFollowUpMessages(clientId,'SDR: serviço escolhido; impedir sequência antiga de áudios.');
    await updateClientAiProfile({clientId,athleteAge:age,serviceInterest:decision.offer.service,leadTemperature:'morno'});
    await appendClientTags(clientId,['ec10_sdr',`sdr_${decision.offer.id}`]);
    await recordTrafficEvent({clientId,phone,eventType:'bot_sdr_service_selected',channel:'whatsapp',platform:'whatsapp',serviceInterest:decision.offer.service,athleteAge:age,metadata:{offerId:decision.offer.id,version:SDR_VERSION}});
  }
  if(decision.book) {
    await cancelQueuedFollowUpMessages(clientId,'SDR: lead aceitou agendar.');
    if(await ensureGuardianBeforeMeeting({client,chatId,clientId,phone,state:next}))await askMeetingDate(client,chatId,clientId,phone,next);
    return true;
  }
  if(decision.reply)await sendBotText(client,chatId,clientId,decision.reply,[500,1000]);
  if(decision.answer) {
    const history=await fetchRecentClientMessages(clientId,8);
    const answer=await answerEc10SdrQuestion({age,offer:decision.offer,step:decision.step,message:body,history});
    await sendBotText(client,chatId,clientId,answer,[500,1000]);
  }
  if(decision.audio) {
    try {await sendBotAudio(client,chatId,clientId,decision.audio);}
    catch {await sendBotText(client,chatId,clientId,'O áudio não carregou agora, mas podemos continuar por aqui. A explicação do serviço está acima e você pode mandar sua dúvida.',[500,1000]);}
  }
  if(decision.menu)await sendBotPoll({client,chatId,clientId,...decision.menu,delayRange:[500,1000]});
  return true;
}

async function handleEc10Conversation(client: any, chatId: string, clientId: string, phone: string, body: string | null, mediaType = "text"):Promise<boolean> {
  const state=await getBotConversationState(phone);
  if(!state||state.stage==='awaiting_age'||state.metadata?.sdrVersion===SDR_VERSION) {
    return withSdrCustomerTurn(clientId,phone,()=>handleEc10ConversationInternal(client,chatId,clientId,phone,body,mediaType));
  }
  return handleEc10ConversationInternal(client,chatId,clientId,phone,body,mediaType);
}

async function handleEc10ConversationInternal(client: any, chatId: string, clientId: string, phone: string, body: string | null, mediaType = "text"):Promise<boolean> {
  const currentState = await getBotConversationState(phone);
  const restartRequested = isRestartCommand(body);
  const greeting=sdrGreeting(body);
  if(currentState&&!restartRequested&&await handleAndersonNaturalDiscoveryBeforeAge({client,chatId,clientId,phone,state:currentState,body}))return true;
  if(greeting&&currentState?.stage==='awaiting_age'&&!restartRequested) {
    await sendBotText(client,chatId,clientId,`${greeting} ${ec10Messages.ageQuestion}`,[500,1000]);
    return true;
  }
  if(greeting&&currentState?.metadata?.bookingContactPending===true) {
    const participant=currentState.athlete_age&&currentState.athlete_age<18?'do responsável que participará':'de quem participará';
    await sendBotText(client,chatId,clientId,`${greeting} Para abrir sua agenda, qual é o nome completo ${participant} da reunião?`,[500,1000]);
    return true;
  }

  if (!currentState || restartRequested) {
    const startLockAcquired = await tryAcquireBotDedupeLock({
      key: `conversation_start:${config.BOT_INSTANCE_ID}:${phone}`,
      scope: "conversation_start",
      clientId,
      phone,
      ttlSeconds: restartRequested ? 60 : 5 * 60,
      metadata: {
        botInstanceId: config.BOT_INSTANCE_ID,
        restartRequested,
        mediaType
      }
    });
    if (!startLockAcquired) return true;

    const requestedFlow = isRevelaTalentosEntry(body) ? "revela_13_plus" : null;
    const contact=await getClientAutomationStateById(clientId);
    const firstMessageAge = !restartRequested ? extractAthleteAge(body)??contact?.athlete_age??null : null;
    const ageQuestionAskedAt = firstMessageAge ? null : new Date().toISOString();
    const startedState=await persistEc10State({
      clientId,
      phone,
      previous: null,
      stage: "awaiting_age",
      roleAnswer: null,
      athleteAge: firstMessageAge,
      ageGroup: null,
      serviceInterest: null,
      leadPageUrl: null,
      completedAt: null,
      metadata: {
        source: "ec10_whatsapp_flow",
        flowVersion: "bot_principal_2026_06",
        requestedFlow,
        leadName:typeof (contact as any)?.name==='string'?(contact as any).name:undefined,
        ...(ageQuestionAskedAt ? { ageQuestionAskedAt } : {})
      }
    });
    await recordTrafficEvent({
      clientId,
      phone,
      eventType: "bot_started",
      channel: "whatsapp",
      platform: "meta_ads",
      metadata: {
        trigger: currentState ? "restart_command" : "first_message",
        requestedFlow
      }
    });
    if (firstMessageAge) {
      return handleEc10Conversation(client, chatId, clientId, phone, body, mediaType);
    }

    if(config.BOT_AI_MODE==='primary'&&startedState) {
      return handleAndersonNaturalDiscoveryBeforeAge({client,chatId,clientId,phone,state:startedState,body});
    }

    await sendBotText(
      client,
      chatId,
      clientId,
      requestedFlow === "revela_13_plus" ? ec10Messages.revelaAgeQuestion : ec10Messages.ageQuestion
    );
    return true;
  }

  if (isAudioSequenceInProgress(currentState)) {
    await recordTrafficEvent({
      clientId,
      phone,
      eventType: "bot_input_during_audio_sequence",
      channel: "whatsapp",
      platform: "whatsapp",
      serviceInterest: currentState.service_interest,
      athleteAge: currentState.athlete_age,
      ageGroup: currentState.age_group,
      metadata: {
        stage: currentState.stage,
        body,
        mediaType
      }
    });
    return true;
  }

  if (await handleMeetingPresenceOption({ client, chatId, clientId, phone, currentState, body })) {
    return true;
  }

  if (currentState.stage === "awaiting_booking_completion") {
    return handleBookingCompletionConversation({client,chatId,clientId,phone,state:currentState,body});
  }

  if (currentState.stage === "completed") {
    return true;
  }

  if(currentState.metadata?.bookingContactPending===true) {
    if(isExplicitStopRequest(body)){await handleMeetingDeclined({client,chatId,clientId,phone,currentState,body});return true;}
    if(isExplicitHumanRequest(body)||/^(atendente|humano|consultor)$/i.test((body||'').trim())) {
      await maybeEscalateAfterRecovery({client,chatId,clientId,phone,state:{...currentState,metadata:{...currentState.metadata,aiRecoveryAttempts:3}},body});
      return true;
    }
    if(currentState.metadata?.sdrVersion===SDR_VERSION&&/\?|\b(como|quanto|valor|pre[cç]o|investimento|funciona|inclui|garantia|d[uú]vida)\b/i.test(body||'')) {
      const age=currentState.athlete_age||8;
      const answer=await answerEc10SdrQuestion({age,offer:sdrOffer(age,currentState.metadata.sdrOfferId),step:'booking',message:body});
      const participant=currentState.athlete_age&&currentState.athlete_age<18?'do responsável que participará':'de quem participará';
      await sendBotText(client,chatId,clientId,`${answer}\n\nPara continuar com a agenda, me envie o nome completo ${participant} da reunião.`,[500,1000]);
      return true;
    }
    const contactName=parseBookingContactName(body);
    if(!contactName) {
      const participant=currentState.athlete_age&&currentState.athlete_age<18?'do responsável que participará':'de quem participará';
      await sendBotText(client,chatId,clientId,`Me envie o nome completo ${participant} da reunião, por exemplo: Maria Oliveira. Se preferir atendimento humano, escreva “atendente”.`);
      return true;
    }
    const next=await persistEc10State({clientId,phone,previous:currentState,stage:'awaiting_interest',
      metadata:{bookingContactName:contactName,
        ...(currentState.athlete_age&&currentState.athlete_age<18?{responsibleName:contactName}:{}),bookingContactPending:false}});
    await askMeetingDate(client,chatId,clientId,phone,next);
    return true;
  }

  if(currentState.stage==='awaiting_interest'&&currentState.metadata?.sdrVersion===SDR_VERSION) {
    return handleEc10SdrTurn(client,chatId,clientId,phone,currentState,body);
  }

  if (!body?.trim() && isAudioMessageType(mediaType)) {
    if (currentState.stage === "awaiting_role" || currentState.stage === "awaiting_age" || currentState.stage === "awaiting_foundation_status") {
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_audio_input_needs_text",
        channel: "whatsapp",
        platform: "whatsapp",
        metadata: { stage: currentState.stage, mediaType }
      });
      await sendBotText(
        client,
        chatId,
        clientId,
        currentState.stage === "awaiting_foundation_status"
          ? ec10Messages.audioFoundationFallback
          : currentState.stage === "awaiting_role"
            ? ec10Messages.audioRoleFallback
            : ec10Messages.audioAgeFallback,
        [1400, 2600]
      );
      return true;
    }
  }

  if (currentState.stage === "awaiting_guardian_confirmation") {
    if (isAmbiguousGuardianAffirmation(body) && guardianIdentityPreviouslyContradicted(currentState)) {
      await persistEc10State({
        clientId, phone, previous: currentState, stage: "awaiting_guardian_confirmation", completedAt: null,
        metadata: { guardianConfirmed: false, guardianIdentityRequiredAt: new Date().toISOString() }
      });
      await sendBotText(
        client,
        chatId,
        clientId,
        "Como você é o atleta e ainda é menor, preciso que seu pai, sua mãe ou responsável legal mande uma mensagem neste WhatsApp e informe o nome completo. Aí eu libero a agenda com segurança.",
        [500, 1000]
      );
      return true;
    }
    if (isGuardianConfirmation(body)) {
      const confirmedAt = new Date().toISOString();
      const savedState = await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_guardian_confirmation",
        roleAnswer: "responsavel",
        completedAt: null,
        metadata: {
          guardianConfirmed: true,
          guardianConfirmedAt: confirmedAt,
          guardianConfirmationBody: body
        }
      });
      const confirmedState = savedState ?? {
        ...currentState,
        role_answer: "responsavel",
        metadata: {
          ...asMetadataRecord(currentState.metadata),
          guardianConfirmed: true,
          guardianConfirmedAt: confirmedAt
        }
      };
      await appendClientTags(clientId, ["responsavel_confirmado"]);
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_guardian_confirmed",
        channel: "whatsapp",
        platform: "whatsapp",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        leadStatus: "triagem",
        qualityScore: 88,
        metadata: { body }
      });
      await sendBotText(client, chatId, clientId, "Agora você pode escolher o melhor dia e horário para conversar com a equipe.", [700, 1400]);
      await askMeetingDate(client, chatId, clientId, phone, confirmedState);
      return true;
    }

    if (isGuardianDenial(body)) {
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_guardian_confirmation",
        roleAnswer: "nao_responsavel",
        completedAt: null,
        metadata: {
          guardianConfirmed: false,
          guardianDeniedAt: new Date().toISOString(),
          guardianDenialBody: body
        }
      });
      await appendClientTags(clientId, ["aguardando_responsavel"]);
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_guardian_required",
        channel: "whatsapp",
        platform: "whatsapp",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        leadStatus: "aguardando_cliente",
        qualityScore: 70,
        metadata: { body }
      });
      await sendBotText(client, chatId, clientId, ec10Messages.guardianRequired, [900, 1800]);
      return true;
    }

    const recovery = await tryRecoverFlowWithAi({
      clientId,
      phone,
      state: currentState,
      body,
      mediaType,
      reason: "guardian_confirmation_unknown"
    });
    if (recovery?.action === "confirm_guardian") {
      return handleEc10Conversation(client, chatId, clientId, phone, "1", mediaType);
    }
    if (recovery?.action === "deny_guardian") {
      return handleEc10Conversation(client, chatId, clientId, phone, "2", mediaType);
    }
    if (recovery?.action === "ask_guardian" && recovery.reply) {
      await sendBotText(client, chatId, clientId, recovery.reply, [700, 1400]);
    } else {
      await sendBotText(client, chatId, clientId, ec10Messages.invalidGuardian, [700, 1400]);
    }
    await askGuardianConfirmation({ client, chatId, clientId, phone, previous: currentState });
    return true;
  }

  if (
    (currentState.stage === "awaiting_meeting_date" || currentState.stage === "awaiting_meeting_time")
    && !hasConfirmedGuardian(currentState)
  ) {
    await askGuardianConfirmation({ client, chatId, clientId, phone, previous: currentState });
    return true;
  }

  if (await handleEc10FollowUpOption({ client, chatId, clientId, phone, currentState, body })) {
    return true;
  }

  if (currentState.stage === "awaiting_meeting_date") {
    if (isRecentStaleInterestPollReply(currentState, body, "meetingDateAskedAt")) {
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_stale_interest_poll_reply_suppressed",
        channel: "whatsapp",
        platform: "whatsapp",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        metadata: { body, stage: currentState.stage }
      });
      return true;
    }

    const dateOptions = readMeetingDateOptions(currentState);
    const activeDateOptions = dateOptions.length
      ? dateOptions
      : buildMeetingDateOptions(new Date(), 5, currentState.service_interest);
    let parsedDate = parseMeetingDateChoice(body, activeDateOptions);
    if (!parsedDate.ok) {
      if (isExplicitStopRequest(body)) {
        await handleMeetingDeclined({
          client,
          chatId,
          clientId,
          phone,
          currentState,
          body
        });
        return true;
      }

      const recovery = await tryRecoverFlowWithAi({
        clientId,
        phone,
        state: currentState,
        body,
        mediaType,
        reason: `meeting_date_${parsedDate.reason}`
      });
      if (recovery?.action === "decline_interest" && isExplicitStopRequest(body)) {
        await handleMeetingDeclined({
          client,
          chatId,
          clientId,
          phone,
          currentState,
          body
        });
        return true;
      }
      if (recovery?.action === "extract_meeting_date" && recovery.dateText) {
        parsedDate = parseMeetingDateChoice(recovery.dateText, activeDateOptions);
      } else if (recovery?.action === "ask_meeting_date" && recovery.reply) {
        const recoveryAttempts = await maybeEscalateAfterRecovery({ client, chatId, clientId, phone, state: currentState, body });
        if (recoveryAttempts === null) return true;
        await sendBotText(client, chatId, clientId, recovery.reply, [900, 1800]);
        await persistEc10State({
          clientId,
          phone,
          previous: currentState,
          stage: "awaiting_meeting_date",
          completedAt: null,
          metadata: {
            meetingDateOptions: activeDateOptions,
            invalidMeetingDatePromptedAt: new Date().toISOString(),
            lastInvalidMeetingDateBody: body,
            aiRecoveryAction: recovery.action,
            aiRecoveryAttempts: recoveryAttempts
          }
        });
        return true;
      }
    }

    if (!parsedDate.ok) {
      const recoveryAttempts = await maybeEscalateAfterRecovery({ client, chatId, clientId, phone, state: currentState, body });
      if (recoveryAttempts === null) return true;
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_meeting_date_invalid",
        channel: "whatsapp",
        platform: "meta_ads",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        metadata: { body, reason: parsedDate.reason }
      });
      await sendBotText(client, chatId, clientId, "Não entendi essa parte. Pode me dizer o que ainda ficou em dúvida? Depois continuamos pelas datas que já enviei.", [900, 1800]);
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_date",
        completedAt: null,
        metadata: {
          meetingDateOptions: activeDateOptions,
          invalidMeetingDatePromptedAt: new Date().toISOString(),
          lastInvalidMeetingDateBody: body,
          aiRecoveryAttempts: recoveryAttempts
        }
      });
      return true;
    }

    if (parsedDate.none) {
      await sendBotText(
        client,
        chatId,
        clientId,
        "Para manter a agenda organizada, consigo marcar apenas nas opcoes disponiveis das proximas duas semanas. Escolha uma das datas da enquete.",
        [1200, 2400]
      );
      await sendBotPoll({
        client,
        chatId,
        clientId,
        question: meetingDatePollQuestion,
        options: buildMeetingDatePollOptions(activeDateOptions),
        fallbackBody: buildMeetingDateQuestion(activeDateOptions),
        delayRange: [900, 1800]
      });
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_date",
        completedAt: null,
        metadata: {
          meetingDateOptions: activeDateOptions,
          meetingCustomDateAllowed: false,
          customMeetingDateRejectedAt: new Date().toISOString()
        }
      });
      return true;
    }

    if (!isAllowedMeetingDateOption(parsedDate.option, activeDateOptions)) {
      await sendBotText(
        client,
        chatId,
        clientId,
        "Essa data fica fora das opcoes abertas para as proximas duas semanas. Vou te enviar as datas disponiveis novamente.",
        [1200, 2400]
      );
      await sendBotPoll({
        client,
        chatId,
        clientId,
        question: meetingDatePollQuestion,
        options: buildMeetingDatePollOptions(activeDateOptions),
        fallbackBody: buildMeetingDateQuestion(activeDateOptions),
        delayRange: [900, 1800]
      });
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_date",
        completedAt: null,
        metadata: {
          meetingDateOptions: activeDateOptions,
          invalidMeetingDatePromptedAt: new Date().toISOString(),
          lastInvalidMeetingDateBody: body
        }
      });
      return true;
    }

    if (isCareerPlanService(currentState.service_interest)) {
      const scheduleResult = buildScheduleFromOptions(parsedDate.option, { index: 1, hour: 20, label: "20h-21h" });
      if (!scheduleResult.ok) {
        await sendBotText(client, chatId, clientId, scheduleResult.message, [1400, 2600]);
        await askMeetingDate(client, chatId, clientId, phone, currentState);
        return true;
      }
      await finishEc10MeetingSchedule({ client, chatId, clientId, phone, currentState, schedule: scheduleResult.schedule });
      return true;
    }

    await askMeetingTime(client, chatId, clientId, phone, currentState, parsedDate.option);
    return true;
  }

  if (currentState.stage === "awaiting_meeting_time") {
    if (isRecentStaleInterestPollReply(currentState, body, "meetingTimeAskedAt")) {
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_stale_interest_poll_reply_suppressed",
        channel: "whatsapp",
        platform: "whatsapp",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        metadata: { body, stage: currentState.stage }
      });
      return true;
    }

    const selectedDate = readSelectedMeetingDate(currentState);
    if (!selectedDate) {
      const parsedSchedule = parseEc10MeetingSchedule(body);
      if (!parsedSchedule.ok) {
        await askMeetingDate(client, chatId, clientId, phone, currentState);
        return true;
      }
      await finishEc10MeetingSchedule({ client, chatId, clientId, phone, currentState, schedule: parsedSchedule.schedule });
      return true;
    }

    const timeOptions = readMeetingTimeOptions(currentState);
    const activeTimeOptions = timeOptions.length
      ? timeOptions
      : buildMeetingTimeOptions(selectedDate, currentState.service_interest);
    let parsedTime = parseMeetingTimeChoice(body, activeTimeOptions);
    if (!parsedTime.ok) {
      if (isExplicitStopRequest(body)) {
        await handleMeetingDeclined({
          client,
          chatId,
          clientId,
          phone,
          currentState,
          body
        });
        return true;
      }

      const recovery = await tryRecoverFlowWithAi({
        clientId,
        phone,
        state: currentState,
        body,
        mediaType,
        reason: `meeting_time_${parsedTime.reason}`
      });
      if (recovery?.action === "decline_interest" && isExplicitStopRequest(body)) {
        await handleMeetingDeclined({
          client,
          chatId,
          clientId,
          phone,
          currentState,
          body
        });
        return true;
      }
      if (recovery?.action === "extract_meeting_time" && recovery.timeText) {
        parsedTime = parseMeetingTimeChoice(recovery.timeText, activeTimeOptions);
      } else if (recovery?.action === "ask_meeting_time" && recovery.reply) {
        const recoveryAttempts = await maybeEscalateAfterRecovery({ client, chatId, clientId, phone, state: currentState, body });
        if (recoveryAttempts === null) return true;
        await sendBotText(client, chatId, clientId, recovery.reply, [900, 1800]);
        await persistEc10State({
          clientId,
          phone,
          previous: currentState,
          stage: "awaiting_meeting_time",
          completedAt: null,
          metadata: {
            invalidMeetingTimePromptedAt: new Date().toISOString(),
            lastInvalidMeetingTimeBody: body,
            aiRecoveryAction: recovery.action,
            aiRecoveryAttempts: recoveryAttempts
          }
        });
        return true;
      }
    }

    if (!parsedTime.ok) {
      const recoveryAttempts = await maybeEscalateAfterRecovery({ client, chatId, clientId, phone, state: currentState, body });
      if (recoveryAttempts === null) return true;
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_meeting_time_invalid",
        channel: "whatsapp",
        platform: "meta_ads",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        metadata: { body, reason: parsedTime.reason }
      });
      await sendBotText(client, chatId, clientId, "Não entendi essa parte. Me conta o que ainda precisa esclarecer e depois retomamos os horários que já enviei.", [900, 1800]);
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_time",
        completedAt: null,
        metadata: {
          invalidMeetingTimePromptedAt: new Date().toISOString(),
          lastInvalidMeetingTimeBody: body,
          aiRecoveryAttempts: recoveryAttempts
        }
      });
      return true;
    }

    if (parsedTime.none) {
      await sendBotText(
        client,
        chatId,
        clientId,
        "Para evitar choque de agenda, consigo marcar apenas nos horarios disponiveis da enquete. Escolha uma das opcoes abaixo.",
        [1200, 2400]
      );
      await sendBotPoll({
        client,
        chatId,
        clientId,
        question: `Perfeito. Para ${selectedDate.label}, escolha o melhor horario:`,
        options: buildMeetingTimePollOptions(activeTimeOptions),
        fallbackBody: buildMeetingTimeQuestion(selectedDate, activeTimeOptions),
        delayRange: [900, 1800]
      });
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_time",
        completedAt: null,
        metadata: {
          meetingTimeOptions: activeTimeOptions,
          meetingCustomTimeAllowed: false,
          customMeetingTimeRejectedAt: new Date().toISOString()
        }
      });
      return true;
    }

    if (!isAllowedMeetingTimeOption(parsedTime.option, activeTimeOptions)) {
      await sendBotText(
        client,
        chatId,
        clientId,
        "Esse horario fica fora da agenda aberta para essa data. Vou te enviar os horarios disponiveis novamente.",
        [1200, 2400]
      );
      await sendBotPoll({
        client,
        chatId,
        clientId,
        question: `Perfeito. Para ${selectedDate.label}, escolha o melhor horario:`,
        options: buildMeetingTimePollOptions(activeTimeOptions),
        fallbackBody: buildMeetingTimeQuestion(selectedDate, activeTimeOptions),
        delayRange: [900, 1800]
      });
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_time",
        completedAt: null,
        metadata: {
          meetingTimeOptions: activeTimeOptions,
          invalidMeetingTimePromptedAt: new Date().toISOString(),
          lastInvalidMeetingTimeBody: body
        }
      });
      return true;
    }

    const scheduleResult = buildScheduleFromOptions(selectedDate, parsedTime.option);
    if (!scheduleResult.ok) {
      if (wasPromptSentRecently(asMetadataRecord(currentState.metadata), "invalidMeetingTimePromptedAt")) {
        await recordTrafficEvent({
          clientId,
          phone,
          eventType: "bot_meeting_time_invalid_suppressed",
          channel: "whatsapp",
          platform: "meta_ads",
          serviceInterest: currentState.service_interest,
          athleteAge: currentState.athlete_age,
          ageGroup: currentState.age_group,
          metadata: { body, reason: scheduleResult.reason }
        });
        return true;
      }

      await sendBotText(client, chatId, clientId, scheduleResult.message, [1400, 2600]);
      const retryOptions = activeTimeOptions;
      await sendBotPoll({
        client,
        chatId,
        clientId,
        question: `Perfeito. Para ${selectedDate.label}, escolha o melhor horario:`,
        options: buildMeetingTimePollOptions(retryOptions),
        fallbackBody: buildMeetingTimeQuestion(selectedDate, retryOptions),
        delayRange: [900, 1800]
      });
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_meeting_time",
        completedAt: null,
        metadata: {
          invalidMeetingTimePromptedAt: new Date().toISOString(),
          lastInvalidMeetingTimeBody: body
        }
      });
      return true;
    }

    await finishEc10MeetingSchedule({ client, chatId, clientId, phone, currentState, schedule: scheduleResult.schedule });
    return true;
  }

  if (currentState.stage === "awaiting_interest") {
    if (isStaleFoundationReplyAfterStageAdvance(asMetadataRecord(currentState.metadata), body)) {
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_stale_foundation_reply_suppressed",
        channel: "whatsapp",
        platform: "whatsapp",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        metadata: { body, stage: currentState.stage }
      });
      return true;
    }

    const informationDetour = isInterestInformationDetour(body);
    let interest = isExplicitStopRequest(body)
      ? "negative"
      : !informationDetour && isPositiveInterest(body)
        ? "positive"
        : informationDetour
          ? "unknown"
          : await classifyInterestWithAi(body);

    if (interest === "unknown") {
      const recovery = await tryRecoverFlowWithAi({
        clientId,
        phone,
        state: currentState,
        body,
        mediaType,
        reason: "interest_unknown"
      });
      if (recovery?.action === "confirm_interest") {
        interest = "positive";
      } else if (recovery?.action === "decline_interest" && isExplicitStopRequest(body)) {
        interest = "negative";
      } else if (recovery?.action === "ask_interest" && recovery.reply) {
        const recoveryAttempts = await maybeEscalateAfterRecovery({ client, chatId, clientId, phone, state: currentState, body });
        if (recoveryAttempts === null) return true;
        await sendBotText(client, chatId, clientId, recovery.reply, [900, 1800]);
        await persistEc10State({
          clientId,
          phone,
          previous: currentState,
          stage: "awaiting_interest",
          completedAt: null,
          metadata: {
            invalidInterestPromptedAt: new Date().toISOString(),
            lastInvalidInterestBody: body,
            aiRecoveryAction: recovery.action,
            aiRecoveryAttempts: recoveryAttempts
          }
        });
        return true;
      }

      if (wasPromptSentRecently(asMetadataRecord(currentState.metadata), "invalidInterestPromptedAt")) {
        await recordTrafficEvent({
          clientId,
          phone,
          eventType: "bot_interest_clarification_continued",
          channel: "whatsapp",
          platform: "meta_ads",
          serviceInterest: currentState.service_interest,
          athleteAge: currentState.athlete_age,
          ageGroup: currentState.age_group,
          metadata: { body }
        });
        await sendBotText(
          client,
          chatId,
          clientId,
          "Pode falar comigo normalmente. Quero entender o que ainda não ficou claro para te orientar antes da reunião.",
          [700, 1400]
        );
        return true;
      }
    }

    if (interest === "negative") {
      await handleMeetingDeclined({
        client,
        chatId,
        clientId,
        phone,
        currentState,
        body
      });
      return true;
    }

    if (interest === "positive") {
      const meetingSeller = await resolveEc10MeetingSeller(currentState.service_interest);
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_interest_confirmed",
        channel: "whatsapp",
        platform: "meta_ads",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        metadata: { body }
      });
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_meeting_requested",
        channel: "whatsapp",
        platform: "meta_ads",
        serviceInterest: currentState.service_interest,
        athleteAge: currentState.athlete_age,
        ageGroup: currentState.age_group,
        leadStatus: "triagem",
        qualityScore: 85,
        metadata: {
          body,
          sellerName: meetingSeller.name,
          sellerPhone: meetingSeller.phone,
          sellerRoute: meetingSeller.route,
          meetConfigured: Boolean(ec10GoogleMeetUrl)
        }
      });
      await sendMeetingSchedulingIntentSignal({
        clientId,
        phone,
        state: currentState,
        source: "bot_meeting_requested",
        body,
        seller: meetingSeller
      });
      await askMeetingDate(client, chatId, clientId, phone, currentState);
      return true;
    }

    await sendBotText(client, chatId, clientId, ec10Messages.invalidInterest, [1200, 2400]);
    await askInterest(client, chatId, clientId, [900, 1800]);
    await persistEc10State({
      clientId,
      phone,
      previous: currentState,
      stage: "awaiting_interest",
      completedAt: null,
      metadata: {
        invalidInterestPromptedAt: new Date().toISOString(),
        lastInvalidInterestBody: body
      }
    });
    return true;
  }

  if (currentState.stage === "awaiting_role") {
    const roleAnswer = (body ?? "").trim().slice(0, 120) || null;
    await persistEc10State({
      clientId,
      phone,
      previous: currentState,
      stage: "awaiting_age",
      roleAnswer
    });
    await recordTrafficEvent({
      clientId,
      phone,
      eventType: "bot_role_captured",
      channel: "whatsapp",
      platform: "meta_ads",
      metadata: { roleAnswer }
    });
    await sendBotText(client, chatId, clientId, ec10Messages.ageQuestion);
    return true;
  }

  if (currentState.stage === "awaiting_foundation_status") {
    const athleteAge = currentState.athlete_age ?? extractAthleteAge(body);
    if (!athleteAge) {
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_age",
        completedAt: null,
        metadata: {
          foundationAgeRecoveryAt: new Date().toISOString()
        }
      });
      await sendBotText(client, chatId, clientId, ec10Messages.ageQuestion, [900, 1800]);
      return true;
    }

    if (isUnknownFoundationStatus(body)) {
      const requestedFlow = readRequestedFlow(currentState);
      const plan = requestedFlow === 'revela_13_plus' && athleteAge >= 13
        ? getEc10LeadPlan(athleteAge, { flowKind: 'revela_13_plus' })
        : getEc10LeadPlan(athleteAge);
      if (!plan) {
        await sendBotText(client, chatId, clientId, ec10Messages.underMinimumAge, [900, 1800]);
        return true;
      }
      await appendClientTags(clientId, ['situacao_futebol_pendente']);
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: 'bot_foundation_status_pending',
        channel: 'whatsapp',
        platform: 'whatsapp',
        serviceInterest: plan.serviceInterest,
        athleteAge,
        ageGroup: plan.ageGroup,
        metadata: { answer: body }
      });
      await sendBotText(client, chatId, clientId, 'Tranquilo, a gente pode confirmar isso depois na reunião. Vou te explicar o caminho pela idade dele.', [700, 1400]);
      await sendPlanAndContinue({
        client,
        chatId,
        clientId,
        phone,
        currentState,
        athleteAge,
        plan,
        nextStep: 'meeting',
        extraMetadata: { foundationStatus: 'pendente', foundationAnswer: body }
      });
      return true;
    }

    let foundationStatus = parseFoundationStatus(body);
    if (!foundationStatus) {
      const recovery = await tryRecoverFlowWithAi({
        clientId,
        phone,
        state: currentState,
        body,
        mediaType,
        reason: 'foundation_status_not_found'
      });
      if (recovery?.action === 'extract_foundation_status') {
        foundationStatus = recovery.foundationStatus;
      }
      if (!foundationStatus) {
        await sendBotText(client, chatId, clientId, recovery?.reply || ec10Messages.invalidFoundationStatus, [700, 1400]);
        await persistEc10State({
          clientId,
          phone,
          previous: currentState,
          stage: 'awaiting_foundation_status',
          completedAt: null,
          metadata: { foundationClarificationAskedAt: new Date().toISOString(), lastFoundationBody: body }
        });
        return true;
      }
    }

    const requestedFlow = readRequestedFlow(currentState);
    const plan = requestedFlow === 'revela_13_plus' && athleteAge >= 13
      ? getEc10LeadPlan(athleteAge, { flowKind: 'revela_13_plus', foundationStatus })
      : getEc10LeadPlan(athleteAge, { foundationStatus });
    if (!plan) {
      await sendBotText(client, chatId, clientId, ec10Messages.underMinimumAge, [1400, 2600]);
      return true;
    }

    await updateClientFoundationStatus({
      clientId,
      foundationStatus,
      answer: body || foundationStatus
    });
    await recordTrafficEvent({
      clientId,
      phone,
      eventType: 'bot_foundation_status_captured',
      channel: 'whatsapp',
      platform: 'whatsapp',
      serviceInterest: plan.serviceInterest,
      athleteAge,
      ageGroup: plan.ageGroup,
      leadStatus: 'triagem',
      qualityScore: plan.leadScore,
      metadata: { foundationStatus, answer: body }
    });

    await sendPlanAndContinue({
      client,
      chatId,
      clientId,
      phone,
      currentState,
      athleteAge,
      plan,
      nextStep: "meeting",
      extraMetadata: {
        foundationStatus,
        foundationAnswer: body
      }
    });
    return true;
  }

  if (currentState.stage === "awaiting_age") {
    let athleteAge = extractAthleteAge(body) ?? currentState.athlete_age;
    if (!athleteAge) {
      const ageMetadata = asMetadataRecord(currentState.metadata);
      if (
        wasPromptSentRecently(ageMetadata, "ageQuestionAskedAt")
        || wasPromptSentRecently(ageMetadata, "invalidAgePromptedAt")
      ) {
        const recovery = await tryRecoverFlowWithAi({
          clientId,
          phone,
          state: currentState,
          body,
          mediaType,
          reason: "age_detour_after_recent_prompt"
        });
        if (recovery?.action === "extract_age" && recovery.age) {
          athleteAge = recovery.age;
        } else {
          const reply = recovery?.reply
            || "Te explico certinho. Primeiro me manda a idade do atleta em numero para eu te direcionar para o caminho correto. Exemplo: 15.";
          await sendBotText(client, chatId, clientId, reply, [600, 1200]);
          await persistEc10State({
            clientId,
            phone,
            previous: currentState,
            stage: "awaiting_age",
            completedAt: null,
            metadata: {
              ageClarificationPromptedAt: new Date().toISOString(),
              lastAgeDetourBody: body,
              aiRecoveryAction: recovery?.action ?? "fallback"
            }
          });
          return true;
        }
      }

      if (!athleteAge) athleteAge = await extractAthleteAgeWithAi(body);
    }

    if (!athleteAge) {
      const recovery = await tryRecoverFlowWithAi({
        clientId,
        phone,
        state: currentState,
        body,
        mediaType,
        reason: "age_not_found"
      });
      if (recovery?.action === "extract_age" && recovery.age) {
        athleteAge = recovery.age;
      } else if (recovery?.action === "ask_age" && recovery.reply) {
        await sendBotText(client, chatId, clientId, recovery.reply, [900, 1800]);
        await persistEc10State({
          clientId,
          phone,
          previous: currentState,
          stage: "awaiting_age",
          completedAt: null,
          metadata: {
            invalidAgePromptedAt: new Date().toISOString(),
            lastInvalidAgeBody: body,
            aiRecoveryAction: recovery.action
          }
        });
        return true;
      }
    }

    if (!athleteAge) {
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_age_invalid",
        channel: "whatsapp",
        platform: "meta_ads",
        metadata: { body }
      });
      await sendBotText(client, chatId, clientId, ec10Messages.invalidAge, [1400, 2600]);
      await persistEc10State({
        clientId,
        phone,
        previous: currentState,
        stage: "awaiting_age",
        completedAt: null,
        metadata: {
          invalidAgePromptedAt: new Date().toISOString(),
          lastInvalidAgeBody: body
        }
      });
      return true;
    }

    const requestedFlow = readRequestedFlow(currentState);

    const plan = requestedFlow === "revela_13_plus" && athleteAge >= 13
      ? getEc10LeadPlan(athleteAge, { flowKind: "revela_13_plus" })
      : getEc10LeadPlan(athleteAge);

    if (!plan) {
      await recordTrafficEvent({
        clientId,
        phone,
        eventType: "bot_under_minimum_age",
        channel: "whatsapp",
        platform: "meta_ads",
        athleteAge,
        metadata: { body }
      });
      await sendBotText(client, chatId, clientId, ec10Messages.underMinimumAge, [1400, 2600]);
      return true;
    }

    if(botTestAllowedPhones.size)await beginEc10ProfessionalSdr(client,chatId,clientId,phone,currentState,athleteAge);
    else await beginEc10Sdr(client,chatId,clientId,phone,currentState,athleteAge);
    return true;
  }

  return false;
}

async function writeStatus(status: string, details: Record<string, unknown> = {}) {
  const systemDetails = {
    botInstanceId: config.BOT_INSTANCE_ID,
    botInstanceLabel: config.BOT_INSTANCE_LABEL,
    databaseSchema: config.BOT_DB_SCHEMA,
    aiEnabled: config.BOT_AI_ENABLED === "true",
    sdrVersion:SDR_VERSION,
    aiMode: config.BOT_AI_MODE,
    aiAudioEnabled: config.BOT_AI_AUDIO_ENABLED === "true",
    aiProvider: config.BOT_AI_PROVIDER,
    aiConfigured: config.BOT_AI_PROVIDER === "groq"
      ? Boolean(config.GROQ_API_KEY)
      : config.BOT_AI_PROVIDER === "gemini"
        ? Boolean(config.GEMINI_API_KEY)
        : Boolean(config.GROQ_API_KEY || config.GEMINI_API_KEY)
  };
  currentBotStatus = status;
  currentBotStatusDetails = { ...systemDetails, ...details };
  const payload = {
    status,
    updatedAt: new Date().toISOString(),
    ...currentBotStatusDetails
  };
  await ensureParentDir(config.BOT_STATUS_PATH);
  await fs.writeFile(
    resolveProjectPath(config.BOT_STATUS_PATH),
    JSON.stringify(payload, null, 2)
  );
  try {
    await upsertBotRuntime("bot_status", payload);
  } catch (error) {
    console.error("Failed to persist bot status remotely", error);
  }
}

function startStatusHeartbeat() {
  if (statusHeartbeat) return;
  statusHeartbeat = setInterval(() => {
    writeStatus(currentBotStatus, {
      ...currentBotStatusDetails,
      heartbeat: true
    }).catch((error) => console.error("Failed to write bot heartbeat", error));
  }, Math.max(60_000, config.BOT_STATUS_HEARTBEAT_MS));
}

async function persistQr(qr: string) {
  await ensureParentDir(config.BOT_QR_PATH);
  await ensureParentDir(config.BOT_QR_TEXT_PATH);
  await QRCode.toFile(resolveProjectPath(config.BOT_QR_PATH), qr, { margin: 2, width: 360 });
  await fs.writeFile(resolveProjectPath(config.BOT_QR_TEXT_PATH), qr);
  const now = Date.now();
  if (now - lastQrRuntimePersistAt < Math.max(60_000, config.BOT_QR_RUNTIME_PERSIST_MS)) {
    return false;
  }

  lastQrRuntimePersistAt = now;
  const qrDataUrl = await QRCode.toDataURL(qr, { margin: 4, width: 1000 });
  try {
    await upsertBotRuntime("whatsapp_qr", {
      qrDataUrl,
      updatedAt: new Date(now).toISOString()
    });
    return true;
  } catch (error) {
    lastQrRuntimePersistAt = 0;
    throw error;
  }
}

async function restartWhatsAppClient(client: any, reason: string) {
  if (reconnectingClient) return;
  reconnectingClient = true;
  whatsappReady = false;
  readySinceMs = 0;

  try {
    await wait(4000);
    const normalizedReason = String(reason).toUpperCase();
    const isLogout = normalizedReason.includes("LOGOUT");
    if (isLogout) {
      await recordWhatsAppLogout(reason);
    }
    await writeStatus("reconnecting", {
      reason,
      action: isLogout ? "restart_process_after_logout" : "restart_process_after_disconnect",
      safeModeUntil: whatsappSafeModeUntilMs ? new Date(whatsappSafeModeUntilMs).toISOString() : null,
      safeModeReason: whatsappSafeModeReason
    });

    if (isLogout) {
      await fs.rm(resolveProjectPath(config.BOT_SESSION_PATH), { recursive: true, force: true }).catch(() => undefined);
    }

    if (activeWhatsAppClient === client) {
      activeWhatsAppClient = null;
    }
    await client.destroy().catch(() => undefined);
    await wait(1000);
    setTimeout(() => process.exit(0), 250).unref();
  } catch (error) {
    await writeStatus("auth_failure", {
      message: error instanceof Error ? error.message : String(error)
    });
    setTimeout(() => process.exit(1), 250).unref();
  } finally {
    reconnectingClient = false;
  }
}

function sendJson(response: http.ServerResponse, statusCode: number, body: Record<string, unknown>) {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function startStatusServer() {
  if (config.BOT_HTTP_ENABLED !== "true") return;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "authorization, content-type"
      });
      response.end();
      return;
    }

    if (url.pathname === "/health") {
      const persistence = await checkBotPersistenceHealth();
      const status = persistence.ok ? currentBotStatus : "degraded";
      sendJson(response, persistence.ok ? 200 : 503, {
        ok: persistence.ok,
        status,
        transportStatus: currentBotStatus,
        persistence,
        updatedAt: new Date().toISOString(),
        botInstanceId: config.BOT_INSTANCE_ID
      });
      return;
    }

    const authorization = request.headers.authorization ?? "";
    if (config.BOT_HTTP_TOKEN && authorization !== `Bearer ${config.BOT_HTTP_TOKEN}`) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    if (url.pathname === "/status") {
      try {
        const status = await fs.readFile(resolveProjectPath(config.BOT_STATUS_PATH), "utf8");
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8"
        });
        response.end(status);
      } catch {
        sendJson(response, 404, { status: "not_ready" });
      }
      return;
    }

    if (url.pathname === "/qr.png") {
      try {
        const qr = await fs.readFile(resolveProjectPath(config.BOT_QR_PATH));
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-type": "image/png"
        });
        response.end(qr);
      } catch {
        sendJson(response, 404, { error: "QR not available" });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  server.listen(config.BOT_HTTP_PORT, config.BOT_HTTP_HOST, () => {
    console.log(`Bot status server listening on ${config.BOT_HTTP_HOST}:${config.BOT_HTTP_PORT}`);
  });
}

async function sendRuleResponse(client: any, chatId: string, clientId: string, body: string | null) {
  const rules = await fetchActiveBotRules();
  const rule = findMatchingRule(rules, body);
  if (!rule) return;
  if (!(await shouldSendRuleResponse(clientId, rule))) return;

  if (rule.response_audio_path) {
    await withOutboundSendLock(
      buildOutboundSendLockKey({
        clientId,
        body: rule.response_text,
        mediaType: "audio",
        mediaPath: rule.response_audio_path
      }),
      async () => {
        const pauseReason = await getImmediateOutboundPauseReason();
        if (pauseReason) {
          await recordImmediateOutboundPaused({
            clientId,
            phone: chatId,
            mediaType: "audio",
            body: rule.response_text,
            mediaPath: rule.response_audio_path,
            reason: pauseReason
          });
          return false;
        }
        if (!(await shouldSendBotOutbound({
          clientId,
          body: rule.response_text,
          mediaType: "audio",
          mediaPath: rule.response_audio_path
        }))) return false;
        const audioPath = resolveProjectPath(rule.response_audio_path!);
        const media = MessageMedia.fromFilePath(audioPath);
        const sent = await sendWhatsAppWithRetry(() => client.sendMessage(chatId, media, {
          caption: rule.response_text ?? undefined,
          sendAudioAsVoice: true
        }));
        if (!sent) throw new Error("WhatsApp nao confirmou o envio da midia.");
        await recordOutboundChatMessage({
          clientId,
          body: rule.response_text,
          mediaType: "audio",
          mediaPath: rule.response_audio_path,
          whatsappMessageId: getWhatsAppMessageId(sent),
          whatsappChatId: getWhatsAppChatId(sent),
          whatsappAck: getWhatsAppAck(sent)
        });
        return true;
      }
    );
    return;
  }

  if (rule.response_text) {
    await sendBotText(client, chatId, clientId, rule.response_text);
  }
}

async function main() {
  installProcessErrorGuards();
  console.log("Cliente WhatsApp CRM bot");
  console.log(`Supabase server config: ${hasServerSupabaseConfig ? "ok" : "missing"}`);
  console.log(`Direct database config: ${hasDirectDatabaseConfig ? "ok" : "missing"}`);
  console.log(`BOT_INSTANCE_ID=${config.BOT_INSTANCE_ID}`);
  console.log(`BOT_ENABLED=${config.BOT_ENABLED}`);
  console.log(`BOT_TEST_ISOLATION=${botTestAllowedPhones.size?'active':'off'}`);
  startStatusServer();
  await writeStatus("booting", {
    hasServerSupabaseConfig,
    hasDirectDatabaseConfig,
    botEnabled: config.BOT_ENABLED,
    testIsolationActive:botTestAllowedPhones.size>0,
    testAllowedPhoneAliases:botTestAllowedPhones.size
  });

  if (config.BOT_ENABLED !== "true") {
    console.log("Bot disabled. Set BOT_ENABLED=true in .env to open WhatsApp Web.");
    await writeStatus("disabled");
    return;
  }

  startStatusHeartbeat();

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: resolveProjectPath(config.BOT_SESSION_PATH) }),
    webVersionCache: { type: config.WHATSAPP_WEB_VERSION_CACHE },
    userAgent: config.WHATSAPP_WEB_USER_AGENT,
    deviceName: config.WHATSAPP_DEVICE_NAME,
    browserName: config.WHATSAPP_BROWSER_NAME,
    puppeteer: {
      headless: true,
      protocolTimeout: config.BOT_PROTOCOL_TIMEOUT_MS,
      executablePath: config.CHROME_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--window-size=1280,720"
      ]
    }
  });
  activeWhatsAppClient = client;
  activeWhatsAppClientGeneration += 1;
  const clientGeneration = activeWhatsAppClientGeneration;

  client.on("qr", (qr: string) => {
    if (!isCurrentWhatsAppClient(client)) return;
    whatsappReady = false;
    readySinceMs = 0;
    currentWhatsAppState = null;
    console.log("Scan this QR Code with the WhatsApp bot number:");
    qrcode.generate(qr, { small: true });
    persistQr(qr)
      .then((runtimeUpdated) => {
        if (currentBotStatus === "waiting_qr_scan" && !runtimeUpdated) return;
        return writeStatus("waiting_qr_scan", { qrPath: resolveProjectPath(config.BOT_QR_PATH) });
      })
      .catch((error) => console.error("Failed to persist QR Code", error));
  });

  client.on("loading_screen", (percent: string, message: string) => {
    if (!isCurrentWhatsAppClient(client)) return;
    console.log(`WhatsApp loading ${percent}%: ${message}`);
    if (whatsappReady) return;
    writeStatus("loading", { percent, message }).catch((error) => console.error("Failed to write loading status", error));
  });

  client.on("change_state", (state: string) => {
    if (!isCurrentWhatsAppClient(client)) return;
    currentWhatsAppState = normalizeWhatsAppState(state);
    console.log(`WhatsApp state changed: ${currentWhatsAppState ?? state}`);
    if (whatsappReady && currentWhatsAppState === "CONNECTED") {
      writeStatus("ready", { state: currentWhatsAppState }).catch((error) => console.error("Failed to keep ready state status", error));
      return;
    }
    if (whatsappReady) {
      writeStatus("state_changed", {
        state: currentWhatsAppState,
        queuePaused: true,
        pauseReason: "WhatsApp ainda nao conectado."
      }).catch((error) => console.error("Failed to write state status", error));
      return;
    }
    writeStatus("state_changed", { state: currentWhatsAppState }).catch((error) => console.error("Failed to write state status", error));
  });

  client.on("ready", () => {
    if (!isCurrentWhatsAppClient(client)) return;
    whatsappReady = true;
    readySinceMs = Date.now();
    console.log("WhatsApp client is ready.");
    currentWhatsAppState = "CONNECTED";
    writeStatus("ready", {
      clientGeneration,
      state: currentWhatsAppState,
      safeModeUntil: whatsappSafeModeUntilMs ? new Date(whatsappSafeModeUntilMs).toISOString() : null,
      safeModeReason: whatsappSafeModeReason
    }).catch((error) => console.error("Failed to write ready status", error));
    const now = Date.now();
    if (now - lastReadyMaintenanceAt < config.WHATSAPP_HEAVY_OPS_COOLDOWN_MS) return;
    lastReadyMaintenanceAt = now;
    void wait(config.WHATSAPP_HEAVY_OPS_MIN_READY_MS)
      .then(() => {
        if (!isCurrentWhatsAppClient(client) || !whatsappReady || currentBotStatus !== "ready") return null;
        return careerMeetingGroupsEnabled ? ensureCareerMeetingGroups(client) : null;
      })
      .then(() => {
        if (!isCurrentWhatsAppClient(client) || !whatsappReady || currentBotStatus !== "ready") return null;
        return careerMeetingGroupsEnabled ? repairPendingCareerMeetingGroups(client) : null;
      })
      .catch((error) => console.error("Failed to prepare career meeting groups", error));
  });

  client.on("authenticated", () => {
    if (!isCurrentWhatsAppClient(client)) return;
    whatsappReady = false;
    readySinceMs = 0;
    currentWhatsAppState = null;
    console.log("WhatsApp client authenticated.");
    writeStatus("authenticated").catch((error) => console.error("Failed to write authenticated status", error));
  });

  client.on("auth_failure", (message: string) => {
    if (!isCurrentWhatsAppClient(client)) return;
    whatsappReady = false;
    readySinceMs = 0;
    currentWhatsAppState = null;
    console.error("WhatsApp authentication failed", message);
    writeStatus("auth_failure", { message }).catch((error) => console.error("Failed to write auth failure", error));
  });

  client.on("disconnected", (reason: string) => {
    if (!isCurrentWhatsAppClient(client)) return;
    whatsappReady = false;
    readySinceMs = 0;
    currentWhatsAppState = normalizeWhatsAppState(reason);
    console.error("WhatsApp client disconnected", reason);
    writeStatus("disconnected", { reason, state: currentWhatsAppState }).catch((error) => console.error("Failed to write disconnected status", error));
    restartWhatsAppClient(client, reason).catch((error) => console.error("Failed to restart WhatsApp client", error));
  });

  client.on("message_ack", async (message: any, ack: number) => {
    try {
      if (!isCurrentWhatsAppClient(client)) return;
      const whatsappMessageId = getWhatsAppMessageId(message);
      if (!whatsappMessageId) return;
      const numericAck = Number(ack);
      if (!Number.isFinite(numericAck)) return;
      resolveWhatsAppAckWaiters(whatsappMessageId, numericAck);
      await recordWhatsAppMessageAck({
        whatsappMessageId,
        ack: numericAck,
        whatsappChatId: getWhatsAppChatId(message)
      });
    } catch (error) {
      console.error("Failed to record WhatsApp message ack", error);
    }
  });

  client.on("call", async (call: any) => {
    try {
      if (!isCurrentWhatsAppClient(client) || call?.fromMe || call?.isGroup || !call?.from) return;
      const resolvedPhone = await resolveInboundChatId(client, call.from);
      const timestamp = Number(call.timestamp);
      await recordIncomingWhatsAppCall({
        whatsappCallId: String(call.id || `${resolvedPhone}-${timestamp || Date.now()}`),
        phone: resolvedPhone,
        callType: call.isVideo ? "video" : "voice",
        startedAt: new Date(Number.isFinite(timestamp) ? timestamp * 1000 : Date.now()).toISOString(),
        canHandleLocally: call.canHandleLocally,
        webClientShouldHandle: call.webClientShouldHandle,
      });
      console.log(`WhatsApp ${call.isVideo ? "video" : "voice"} call recorded for ${resolvedPhone.slice(-4)}`);
    } catch (error) {
      console.error("Failed to record incoming WhatsApp call", error);
    }
  });

  const handlePollVote = async (vote: any, source: 'event' | 'recovery' = 'event') => {
    try {
      if (!isCurrentWhatsAppClient(client)) return;
      let normalized = normalizePollVote(vote);
      if (!normalized.names.length && pollParentId(vote)) {
        const parent = await client.getMessageById(pollParentId(vote));
        normalized = normalizePollVote(vote, parent);
      }
      if (!normalized.names.length || !normalized.voter || !normalized.parentId) return;
      const selectedOptions = normalized.names;
      const resolvedVoterPhone = await resolveInboundChatId(client, normalized.voter);
      const clientState = await getClientAutomationStateByPhone(resolvedVoterPhone);
      if (!clientState) return;
      await withConversationLock(clientState.phone, async () => {
        const latest = await getClientAutomationStateById(clientState.id);
        if (!latest || !shouldRunWhatsAppAutomation(latest)) {
          if (latest) await recordAutomationSuppressed(latest, "poll_vote");
          return;
        }
        if (latest.bot_paused) return;
        const pending = await fetchPendingWhatsAppPolls(1, latest.id);
        if (!pending.some(p => p.client_id===latest.id && p.whatsapp_message_id===normalized.parentId)) return;
        const selectedBody = selectedOptions.join('\n');
        const activeClientState = await upsertInboundMessage({
          phone: latest.phone, name: null, body: selectedBody, mediaType: 'text',
          whatsappMessageId: pollVoteMessageId(normalized, latest.phone)
        });
        if (!activeClientState) return;
        await recordTrafficEvent({clientId:latest.id,phone:latest.phone,eventType:'bot_poll_vote_received',
          channel:'whatsapp',platform:'whatsapp',metadata:{selectedOptions,source,pollMessageId:normalized.parentId}});
        const chatId = serializeWhatsAppKey(vote.parentMessage?.to) || normalized.voter;

        if (config.BOT_AI_MODE === "primary") {
          await handleGustavoPrimaryRoute(client,chatId,activeClientState,selectedBody,"text");
          return;
        }

        const campaignHandled = await handleRevelaCampaignAutomation(client, chatId, activeClientState, null, selectedOptions);
        if (campaignHandled) return;

        await handleEc10Conversation(
          client,
          chatId,
          activeClientState.id,
          activeClientState.phone,
          selectedBody,
          "text"
        );
      });
    } catch (error) {
      console.error("Failed to handle poll vote", error);
    }
  };
  client.on('vote_update', (vote: any) => { void handlePollVote(vote); });

  const recoverMissedInboundMessages = async () => {
    if (processingInboundRecovery || !isCurrentWhatsAppClient(client) || !whatsappReady || !isWhatsAppConnected()) return;
    const needsRecovery = startupInboundRecoveryPending || lastInboundPersistenceFailureAt > lastInboundRecoveryAt;
    if (!needsRecovery) return;
    const persistence = await checkBotPersistenceHealth(true);
    if (!persistence.ok) return;

    processingInboundRecovery = true;
    try {
      const cutoffSeconds = Math.floor((Date.now() - 24 * 60 * 60_000) / 1000);
      const candidates = await fetchRecentInboundRecoveryCandidates(24, 80);
      let recoveredMessages = 0;
      let recoveredConversations = 0;

      for (const candidate of candidates) {
        if (candidate.bot_paused || !shouldRunWhatsAppAutomation(candidate)) continue;
        const chatIds = await resolveOutboundChatIds(client, candidate.phone);
        let chat: any = null;
        for (const chatId of chatIds) {
          chat = await client.getChatById(chatId).catch(() => null);
          if (chat && typeof chat.fetchMessages === 'function') break;
        }
        if (!chat || chat.isGroup || typeof chat.fetchMessages !== 'function') continue;
        const messages = (await chat.fetchMessages({ limit: 40 }).catch(() => []))
          .filter((item: any) => !item?.fromMe && Number(item?.timestamp ?? 0) >= cutoffSeconds)
          .sort((left: any, right: any) => Number(left?.timestamp ?? 0) - Number(right?.timestamp ?? 0));
        const recovered: Array<{ body: string; messageId: string; mediaType: string; chatId: string; state: ClientAutomationState }> = [];

        for (const message of messages) {
          if (String(message?.from ?? '').includes('status@broadcast')) continue;
          if (!String(message?.body ?? '').trim() && !message?.hasMedia) continue;
          const chatId = String(message?.from ?? chat?.id?._serialized ?? chatIds[0] ?? '');
          if (!chatId) continue;
          const resolvedPhone = await resolveInboundChatId(client, chatId);
          if (await findActiveBotLabWhatsappTester(resolvedPhone)) continue;
          const mediaType = message.hasMedia ? normalizeWhatsAppMediaType(message.type) : 'text';
          const messageId = repairWhatsAppMessageId(message) ?? message?.id?.id ?? '';
          const body = message.hasMedia
            ? await resolveMessageBody(client, message, mediaType, null)
            : String(message.body ?? '').trim();
          if (!body) continue;
          const state = await upsertInboundMessage({
            phone: resolvedPhone,
            name: readMessageContactName(message),
            body,
            mediaType,
            whatsappMessageId: messageId,
          });
          if (state) recovered.push({ body, messageId, mediaType, chatId, state });
        }

        if (!recovered.length) continue;
        const latest = recovered.at(-1)!;
        const combinedBody = recovered.map((item) => item.body).join('\n').slice(0, 5000);
        await withConversationLock(latest.state.phone, async () => {
          const currentState = await getClientAutomationStateById(latest.state.id) ?? latest.state;
          if (!shouldRunWhatsAppAutomation(currentState)) {
            await recordAutomationSuppressed(currentState, 'inbound_recovery');
            return;
          }
          if (currentState.bot_paused) return;
          await handleGustavoPrimaryRoute(
            client,
            latest.chatId,
            currentState,
            combinedBody,
            latest.mediaType,
            latest.messageId,
          );
        });
        recoveredMessages += recovered.length;
        recoveredConversations += 1;
      }

      startupInboundRecoveryPending = false;
      lastInboundRecoveryAt = Date.now();
      if (recoveredMessages) {
        console.log('Recovered missed WhatsApp inbound messages', { recoveredMessages, recoveredConversations });
      }
    } catch (error) {
      console.error('Failed to recover missed WhatsApp inbound messages', error instanceof Error ? error.message : String(error));
    } finally {
      processingInboundRecovery = false;
    }
  };

  client.on("message", async (message: any) => {
    try {
      if (!isCurrentWhatsAppClient(client)) return;
      if (message.fromMe) return;
      if (String(message.from ?? "").includes("status@broadcast")) return;
      if (!String(message.body ?? "").trim() && !message.hasMedia) return;

      const contactName = readMessageContactName(message);
      const repairedMessageId = repairWhatsAppMessageId(message);
      const mediaType = message.hasMedia ? normalizeWhatsAppMediaType(message.type) : "text";
      const downloadedMedia = message.hasMedia
        ? await downloadInboundMediaWithRetry(client, message).catch((error) => {
            console.warn("WhatsApp media download unavailable", error instanceof Error ? error.message : String(error));
            return null;
          })
        : null;
      const messageBody = await resolveMessageBody(client, message, mediaType, downloadedMedia);
      const resolvedPhone = await resolveInboundChatId(client, message.from);
      const labTester = await findActiveBotLabWhatsappTester(resolvedPhone);
      if (labTester) {
        await withConversationLock(resolvedPhone, async () => {
          await handleBotLabWhatsappConversation({
            client,
            chatId: message.from,
            tester: labTester,
            body: messageBody,
            mediaType,
            whatsappMessageId: repairedMessageId ?? message.id?.id ?? null
          });
        });
        return;
      }
      const clientState = await upsertInboundMessage({
        phone: resolvedPhone,
        name: contactName,
        body: messageBody,
        mediaType,
        whatsappMessageId: repairedMessageId ?? message.id?.id ?? ""
      });

      if (clientState && downloadedMedia?.data && repairedMessageId) {
        await storeInboundWhatsappMedia({
          clientId: clientState.id,
          whatsappMessageId: repairedMessageId,
          mediaType,
          mimeType: downloadedMedia.mimetype || "application/octet-stream",
          base64Data: downloadedMedia.data,
          fileName: downloadedMedia.filename || null
        }).catch((error) => {
          console.warn("Failed to persist inbound WhatsApp media", error instanceof Error ? error.message : String(error));
        });
      }

      if (clientState) {
        await withConversationLock(clientState.phone, async () => {
          if (!shouldRunWhatsAppAutomation(clientState)) {
            await recordAutomationSuppressed(clientState, "inbound_message");
            return;
          }

          if (clientState.bot_paused) return;

          if(config.BOT_AI_MODE!=='primary'&&shouldSendEc10Welcome(await hasClientOutboundMessages(clientState.id),messageBody)) {
            const welcomed=await sendBotText(client,message.from,clientState.id,ec10Messages.welcome,[700,1400]);
            if(!welcomed)return;
          }

          if (config.BOT_AI_MODE === "primary") {
            await handleGustavoPrimaryRoute(
              client,message.from,clientState,messageBody,mediaType,
              repairedMessageId ?? message.id?.id ?? null,
            );
            return;
          }


          const campaignHandled = await handleRevelaCampaignAutomation(
            client,
            message.from,
            clientState,
            messageBody
          );
          if (campaignHandled) return;

          const handled = await handleEc10Conversation(
            client,
            message.from,
            clientState.id,
            clientState.phone,
            messageBody,
            mediaType
          );

          if (!handled) {
            await sendRuleResponse(client, message.from, clientState.id, messageBody);
          }
        });
      }
    } catch (error) {
      lastInboundPersistenceFailureAt = Date.now();
      console.error("Failed to persist inbound message", error);
    }
  });

  await client.initialize();

  setTimeout(() => { void recoverMissedInboundMessages(); }, 8_000).unref();
  setInterval(() => { void recoverMissedInboundMessages(); }, 60_000);

  setInterval(async () => {
    if (processingPollRecovery || !isCurrentWhatsAppClient(client) || !whatsappReady || currentBotStatus!=='ready' || !isWhatsAppConnected()) return;
    processingPollRecovery = true;
    try {
      const pending = await fetchPendingWhatsAppPolls();
      const activeIds = new Set(pending.map(p=>p.whatsapp_message_id));
      for (const id of pollRecoveryCheckedAt.keys()) if (!activeIds.has(id)) pollRecoveryCheckedAt.delete(id);
      const batch = pending.sort((a,b)=>(pollRecoveryCheckedAt.get(a.whatsapp_message_id)??0)-(pollRecoveryCheckedAt.get(b.whatsapp_message_id)??0)).slice(0,10);
      for (const poll of batch) {
        pollRecoveryCheckedAt.set(poll.whatsapp_message_id,Date.now());
        try {
          const votes = await readWhatsAppPollVotes(client,poll.whatsapp_message_id);
          for (const vote of votes) await handlePollVote(vote,'recovery');
        } catch (error) {
          console.warn('Poll vote recovery failed', error instanceof Error?error.message:String(error));
        }
      }
    } catch (error) { console.error('Failed to recover pending poll votes',error); }
    finally { processingPollRecovery=false; }
  }, 60_000);

  setInterval(async () => {
    if(processingGustavoRecovery||!isCurrentWhatsAppClient(client)||!whatsappReady||currentBotStatus!=="ready"||!isWhatsAppConnected())return;
    processingGustavoRecovery=true;
    try {
      for(const state of await fetchDueGustavoRecoveryStates(5)) {
        try {await processGustavoRecoveryState(client,state);}
        catch(error) {console.warn("Gustavo recovery deferred",error instanceof Error?error.message:"recovery_failed");}
      }
    } catch(error) {
      console.warn("Gustavo recovery scheduler unavailable",error instanceof Error?error.message:"recovery_query_failed");
    } finally {
      processingGustavoRecovery=false;
    }
  },15_000);

  setInterval(async () => {
    if (processingOutboundQueue) return;
    processingOutboundQueue = true;

    try {
      if (!isCurrentWhatsAppClient(client) || !(await canProcessOutboundQueue(client))) return;

      const queue = await fetchQueuedOutboundMessages();
      for (const item of queue) {
        try {
          if (!(await canProcessOutboundQueue(client))) break;
          if (item.whatsapp_send_attempts >= config.WHATSAPP_MAX_DELIVERY_ATTEMPTS) {
            await markOutboundMessage(
              item.id,
              "failed",
              `WhatsApp nao confirmou entrega apos ${item.whatsapp_send_attempts} tentativa(s).`
            );
            continue;
          }

          const permission = await evaluateQueuedOutboundPermission(item);
          if (!permission.allowed) {
            await markOutboundMessage(item.id, "cancelled", `Envio bloqueado por politica do bot: ${permission.reason}`);
            if (permission.clientState) {
              await recordAutomationSuppressed(permission.clientState, "outbound_queue");
            }
            continue;
          }

          const queuedMediaType = queuedMediaTypeForDedupe(item.media_type);
          if(queuedMediaType==='audio'&&isEurocampAudio(item.media_path)) {
            const state=permission.clientState?await getBotConversationState(permission.clientState.phone):null;
            if(!canSendEc10Audio(state?.athlete_age??permission.clientState?.athlete_age,item.media_path)) {
              await markOutboundMessage(item.id,'cancelled','Áudio Eurocamp bloqueado: reservado a atletas menores de 18 anos.');
              continue;
            }
          }
          const isPendingAckRetry = item.whatsapp_send_attempts > 0
            || Boolean(item.whatsapp_message_id && !isWhatsAppAckConfirmed(item.whatsapp_ack));
          if (!isPendingAckRetry) {
            const canSendQueued = await shouldSendBotOutbound({
              clientId: item.client_id,
              phone: item.phone,
              body: item.body ?? null,
              mediaType: queuedMediaType,
              mediaPath: item.media_path ?? null,
              windowMinutes: queuedMediaType === "audio" ? 24 * 60 : 15
            });
            if (!canSendQueued) {
              await markOutboundMessage(item.id, "cancelled", "Envio cancelado por deduplicacao de mensagem recente.");
              continue;
            }
          }

          const sent = await sendQueuedOutboundMessage(client, item);
          const whatsappMessageId = getWhatsAppMessageId(sent);
          const whatsappChatId = getWhatsAppChatId(sent);
          const whatsappAck = await waitForWhatsAppServerAck(sent);
          const delivery = {
            whatsappMessageId,
            whatsappChatId,
            whatsappAck
          };
          if (!whatsappMessageId) {
            const retryAt = nextPendingAckRetryAt(item.whatsapp_send_attempts);
            await requeueOutboundMessage(
              item.id,
              `WhatsApp nao retornou id da mensagem; aguardando nova tentativa com seguranca.`,
              retryAt,
              delivery
            );
            await recordTrafficEvent({
              clientId: item.client_id,
              phone: item.phone,
              eventType: "whatsapp_outbound_message_id_missing",
              channel: "whatsapp",
              platform: "whatsapp",
              metadata: {
                outboundMessageId: item.id,
                whatsappChatId,
                whatsappAck,
                retryAt,
                attempt: item.whatsapp_send_attempts + 1
              }
            });
            continue;
          }

          await markOutboundMessage(item.id, "sent", undefined, {
            ...delivery,
            whatsappAck
          });
          await recordQueuedOutboundDelivery({
            clientId: item.client_id,
            botInstanceId: item.bot_instance_id,
            body: item.body,
            mediaType: item.media_type,
            mediaPath: item.media_path,
            mediaMimeType: item.media_mime_type,
            mediaFileName: item.media_file_name,
            mediaSizeBytes: item.media_size_bytes,
            whatsappMessageId,
            whatsappChatId,
            whatsappAck
          }).catch((error) => {
            console.error("Failed to record queued outbound delivery", error);
          });
          const deliveredEricAudio=queuedMediaType==='audio'?gustavoV2AudioKeyForPath(item.media_path):null;
          if(deliveredEricAudio&&permission.clientState) {
            await confirmGustavoV2OracleAudioDelivery(permission.clientState.phone,deliveredEricAudio)
              .catch((error)=>console.error('Failed to confirm Eric audio in Gustavo V2',getErrorMessage(error)));
          }
          if (!isWhatsAppAckConfirmed(whatsappAck)) {
            await recordTrafficEvent({
              clientId: item.client_id,
              phone: item.phone,
              eventType: "whatsapp_outbound_ack_deferred",
              channel: "whatsapp",
              platform: "whatsapp",
              metadata: {
                outboundMessageId: item.id,
                whatsappMessageId,
                whatsappChatId,
                whatsappAck,
                attempt: item.whatsapp_send_attempts + 1,
                note: "Mensagem criada no WhatsApp; aguardando evento ACK posterior."
              }
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (
            isWhatsAppProtocolTimeout(error)
            && item.whatsapp_send_attempts + 1 < config.WHATSAPP_MAX_DELIVERY_ATTEMPTS
          ) {
            const retryAt = nextPendingAckRetryAt(item.whatsapp_send_attempts);
            await requeueOutboundMessage(item.id, errorMessage, retryAt);
            await recordTrafficEvent({
              clientId: item.client_id,
              phone: item.phone,
              eventType: "whatsapp_outbound_transient_retry",
              channel: "whatsapp",
              platform: "whatsapp",
              metadata: {
                outboundMessageId: item.id,
                retryAt,
                attempt: item.whatsapp_send_attempts + 1,
                error: errorMessage
              }
            });
            continue;
          }
          await markOutboundMessage(item.id, "failed", errorMessage);
        }
      }
    } catch (error) {
      console.error("Failed to process outbound queue", error);
    } finally {
      processingOutboundQueue = false;
    }
  }, config.BOT_POLL_INTERVAL_MS);

  setInterval(() => {
    if (!careerMeetingGroupsEnabled || !isCurrentWhatsAppClient(client) || !whatsappReady || currentBotStatus !== "ready" || !isWhatsAppConnected()) return;
    void repairPendingCareerMeetingGroups(client);
  }, 15 * 60_000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
