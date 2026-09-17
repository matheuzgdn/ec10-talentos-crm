import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildMeetingDateOptions,
  buildMeetingTimeOptions,
  classifyMeetingPresenceChoice,
  extractAthleteAge,
  getEc10LeadPlan,
  isNegativeBotInterest,
  isPositiveInterest,
  parseEc10MeetingSchedule,
  parseFoundationStatus,
  parseMeetingDateChoice,
  parseMeetingTimeChoice,
  shouldSendLeadPageMessage
} from "../apps/bot/dist/ec10-flow.js";
import {
  classifyFoundationStatusWithAi,
  classifyInterestWithAi,
  extractAthleteAgeWithAi,
  isBotAiEnabled,
  recoverEc10FlowWithAi
} from "../apps/bot/dist/ai.js";

const fixedNow = new Date("2026-06-27T15:00:00.000Z");
const args = new Set(process.argv.slice(2));
const fullOllama = args.has("--full-ollama");
const requestedOllamaLimit = readNumericArg("--ollama-limit");
const ollamaLimit = fullOllama ? 100 : requestedOllamaLimit ?? 24;

const dateOptions = buildMeetingDateOptions(fixedNow);
const timeOptions = buildMeetingTimeOptions();

const ageCases = [
  ["age-01", "meu filho tem 15 anos", 15],
  ["age-02", "tem quinze", 15],
  ["age-03", "atleta de 12", 12],
  ["age-04", "ela fez 8", 8],
  ["age-05", "idade dele e 17", 17],
  ["age-06", "ele nasceu em 2010", 16],
  ["age-07", "sub 13", 13],
  ["age-08", "tem 18 anos completos", 18],
  ["age-09", "meu filho tem dezesseis", 16],
  ["age-10", "o atleta esta com vinte anos", 20],
  ["age-11", "sou pai, ele tem 9", 9],
  ["age-12", "idade do menino: 14", 14],
  ["age-13", "minha filha tem 11 anos", 11],
  ["age-14", "fez treze semana passada", 13],
  ["age-15", "meu sobrinho tem oito", 8],
  ["age-16", "jogador de 19 anos", 19],
  ["age-17", "ele tem 10 e joga futebol", 10],
  ["age-18", "camisa 10 e idade 14", 14],
  ["age-19", "15 anos, meia direita", 15],
  ["age-20", "vai completar 21", 21]
];

const foundationCases = [
  ["foundation-01", "joga na base do cruzeiro", "base"],
  ["foundation-02", "esta no sub 13 do america", "base"],
  ["foundation-03", "joga federado", "base"],
  ["foundation-04", "time competitivo da cidade", "base"],
  ["foundation-05", "categoria de base", "base"],
  ["foundation-06", "clube aqui da cidade", "base"],
  ["foundation-07", "equipe sub 15", "base"],
  ["foundation-08", "campeonato estadual federado", "base"],
  ["foundation-09", "base do atletico", "base"],
  ["foundation-10", "esta na federacao", "base"],
  ["foundation-11", "treina na escolinha do bairro", "escolinha"],
  ["foundation-12", "projeto social", "escolinha"],
  ["foundation-13", "aula de futebol", "escolinha"],
  ["foundation-14", "nao esta em clube", "escolinha"],
  ["foundation-15", "so treina na rua", "escolinha"],
  ["foundation-16", "escolinha do flamengo", "escolinha"],
  ["foundation-17", "escola de futebol", "escolinha"],
  ["foundation-18", "academia de futebol", "escolinha"],
  ["foundation-19", "sem time, so escolinha", "escolinha"],
  ["foundation-20", "ainda nao joga na base", "escolinha"]
];

const interestCases = [
  ["interest-01", "sim", "positive"],
  ["interest-02", "quero saber mais", "positive"],
  ["interest-03", "qual valor?", "positive"],
  ["interest-04", "como funciona?", "positive"],
  ["interest-05", "pode marcar", "positive"],
  ["interest-06", "bora", "positive"],
  ["interest-07", "manda detalhes", "positive"],
  ["interest-08", "vamos agendar", "positive"],
  ["interest-09", "tenho interesse", "positive"],
  ["interest-10", "pode ser", "positive"],
  ["interest-11", "ok", "positive"],
  ["interest-12", "explica melhor", "positive"],
  ["interest-13", "quero sim", "positive"],
  ["interest-14", "nao", "negative"],
  ["interest-15", "agora nao", "negative"],
  ["interest-16", "sem interesse", "negative"],
  ["interest-17", "muito caro", "negative"],
  ["interest-18", "nao tenho dinheiro", "negative"],
  ["interest-19", "deixa pra depois", "negative"],
  ["interest-20", "nao quero reuniao", "negative"]
];

const meetingDateCases = [
  ["date-01", "1", true, false],
  ["date-02", "2", true, false],
  ["date-03", "6", true, true],
  ["date-04", "segunda", true, false],
  ["date-05", "depois de amanha", true, false],
  ["date-06", "29/06", true, false],
  ["date-07", "30-06", true, false],
  ["date-08", "03/07", true, false],
  ["date-09", "domingo", false, false],
  ["date-10", "28/06", false, false],
  ["date-11", "04/07", false, false],
  ["date-12", "qualquer dia", false, false],
  ["date-13", "ontem", false, false],
  ["date-14", "nenhuma dessas", true, true],
  ["date-15", "outra data", true, true]
];

const meetingTimeCases = [
  ["time-01", "1", true, false],
  ["time-02", "opcao 3", true, false],
  ["time-03", "8", true, false],
  ["time-04", "8h", true, false],
  ["time-05", "12:00", true, false],
  ["time-06", "14 horas", true, false],
  ["time-07", "duas da tarde", true, false],
  ["time-08", "meio dia", true, false],
  ["time-09", "seis da tarde", true, false],
  ["time-10", "12", true, false],
  ["time-11", "7h", false, false],
  ["time-12", "19", false, false],
  ["time-13", "22h", false, false],
  ["time-14", "14h30", false, false],
  ["time-15", "qualquer hora", false, false]
];

const routeCases = [
  ["route-01", () => assert.equal(getEc10LeadPlan(7), null)],
  ["route-02", () => assert.equal(getEc10LeadPlan(8, { foundationStatus: "base" })?.flowKind, "foundation_8_12")],
  ["route-03", () => assert.equal(getEc10LeadPlan(11, { foundationStatus: "escolinha" })?.leadScore, 68)],
  ["route-04", () => assert.equal(getEc10LeadPlan(13)?.flowKind, "career_13_17")],
  ["route-05", () => assert.equal(getEc10LeadPlan(17)?.serviceInterest, "plano_carreira")],
  ["route-06", () => assert.equal(getEc10LeadPlan(18)?.flowKind, "adult_18_plus")],
  ["route-07", () => assert.equal(getEc10LeadPlan(14, { flowKind: "revela_13_plus" })?.flowKind, "revela_13_plus")],
  ["route-08", () => assert.equal(shouldSendLeadPageMessage(getEc10LeadPlan(15)), false)],
  ["route-09", () => assert.equal(classifyMeetingPresenceChoice("quero reagendar"), "reschedule")],
  ["route-10", () => assert.equal(parseEc10MeetingSchedule("segunda as 14h", fixedNow).ok, true)]
];

const recoveryCases = [
  ["recovery-01", "awaiting_age", "ele tem 16", ["extract_age"], { age: 16 }],
  ["recovery-02", "awaiting_age", "idade quinze", ["extract_age"], { age: 15 }],
  ["recovery-03", "awaiting_age", "quero saber valor", ["ask_age"]],
  ["recovery-04", "awaiting_age", "sou o pai dele", ["ask_age", "none"]],
  ["recovery-05", "awaiting_age", "audio ruim", ["ask_age", "none"]],
  ["recovery-06", "awaiting_foundation_status", "joga no sub 12 do clube", ["extract_foundation_status"], { foundationStatus: "base" }],
  ["recovery-07", "awaiting_foundation_status", "escolinha do bairro", ["extract_foundation_status"], { foundationStatus: "escolinha" }],
  ["recovery-08", "awaiting_foundation_status", "projeto social, nao e clube", ["extract_foundation_status"], { foundationStatus: "escolinha" }],
  ["recovery-09", "awaiting_foundation_status", "nao entendi", ["ask_foundation_status", "none"]],
  ["recovery-10", "awaiting_foundation_status", "opcao 1 base", ["extract_foundation_status"], { foundationStatus: "base" }],
  ["recovery-11", "awaiting_interest", "sim quero marcar", ["confirm_interest"]],
  ["recovery-12", "awaiting_interest", "qual valor?", ["confirm_interest", "ask_interest"]],
  ["recovery-13", "awaiting_interest", "quanto custa", ["confirm_interest", "ask_interest"]],
  ["recovery-14", "awaiting_interest", "nao quero agora", ["decline_interest"]],
  ["recovery-15", "awaiting_interest", "talvez", ["ask_interest", "none"]],
  ["recovery-16", "awaiting_interest", "pode ser amanha", ["confirm_interest"]],
  ["recovery-17", "awaiting_interest", "sem dinheiro", ["decline_interest"]],
  ["recovery-18", "awaiting_interest", "me explica melhor", ["confirm_interest", "ask_interest"]],
  ["recovery-19", "awaiting_meeting_date", "segunda", ["extract_meeting_date"], { dateText: true }],
  ["recovery-20", "awaiting_meeting_date", "segunda feira", ["extract_meeting_date"], { dateText: true }],
  ["recovery-21", "awaiting_meeting_date", "25/06", ["ask_meeting_date", "extract_meeting_date"]],
  ["recovery-22", "awaiting_meeting_date", "nao quero mais", ["decline_interest"]],
  ["recovery-23", "awaiting_meeting_date", "nao entendi", ["ask_meeting_date", "none"]],
  ["recovery-24", "awaiting_meeting_date", "qualquer dia", ["ask_meeting_date", "none"]],
  ["recovery-25", "awaiting_meeting_date", "depois de amanha", ["extract_meeting_date"], { dateText: true }],
  ["recovery-26", "awaiting_meeting_time", "14h", ["extract_meeting_time"], { timeText: true }],
  ["recovery-27", "awaiting_meeting_time", "duas da tarde", ["extract_meeting_time"], { timeText: true }],
  ["recovery-28", "awaiting_meeting_time", "meio dia", ["extract_meeting_time"], { timeText: true }],
  ["recovery-29", "awaiting_meeting_time", "as 22h", ["extract_meeting_time", "ask_meeting_time"]],
  ["recovery-30", "awaiting_meeting_time", "manha cedo", ["ask_meeting_time", "none"]],
  ["recovery-31", "awaiting_meeting_time", "nao quero reuniao", ["decline_interest"]],
  ["recovery-32", "awaiting_meeting_time", "9", ["extract_meeting_time"], { timeText: true }],
  ["recovery-33", "awaiting_meeting_time", "18 horas", ["extract_meeting_time"], { timeText: true }],
  ["recovery-34", "awaiting_meeting_time", "qualquer hora", ["ask_meeting_time", "none"]],
  ["recovery-35", "awaiting_age", "meu menino tem 12 e treina", ["extract_age"], { age: 12 }],
  ["recovery-36", "awaiting_foundation_status", "ainda nao esta em time", ["extract_foundation_status"], { foundationStatus: "escolinha" }],
  ["recovery-37", "awaiting_interest", "deixa para depois", ["decline_interest"]],
  ["recovery-38", "awaiting_meeting_date", "sexta", ["extract_meeting_date"], { dateText: true }],
  ["recovery-39", "awaiting_meeting_time", "sete da noite", ["ask_meeting_time", "extract_meeting_time"]],
  ["recovery-40", "awaiting_age", "bom dia", ["ask_age", "none"]]
];

const deterministicChecks = [
  ...ageCases.map(([id, input, expected]) => [id, () => assert.equal(extractAthleteAge(input), expected)]),
  ...foundationCases.map(([id, input, expected]) => [id, () => assert.equal(parseFoundationStatus(input), expected)]),
  ...interestCases.map(([id, input, expected]) => [
    id,
    () => {
      assert.equal(isPositiveInterest(input), expected === "positive");
      assert.equal(isNegativeBotInterest(input), expected === "negative");
    }
  ]),
  ...meetingDateCases.map(([id, input, expectedOk, expectedNone]) => [
    id,
    () => {
      const parsed = parseMeetingDateChoice(input, dateOptions, fixedNow);
      assert.equal(parsed.ok, expectedOk);
      if (parsed.ok) assert.equal(Boolean(parsed.none), expectedNone);
    }
  ]),
  ...meetingTimeCases.map(([id, input, expectedOk, expectedNone]) => [
    id,
    () => {
      const parsed = parseMeetingTimeChoice(input, timeOptions);
      assert.equal(parsed.ok, expectedOk);
      if (parsed.ok) assert.equal(Boolean(parsed.none), expectedNone);
    }
  ]),
  ...routeCases
];

const aiChecks = [
  ...ageCases.map(([id, input, expected]) => ({
    id: `ai-${id}`,
    run: async () => assert.equal(await extractAthleteAgeWithAi(input), expected)
  })),
  ...foundationCases.map(([id, input, expected]) => ({
    id: `ai-${id}`,
    run: async () => assert.equal(await classifyFoundationStatusWithAi(input), expected)
  })),
  ...interestCases.map(([id, input, expected]) => ({
    id: `ai-${id}`,
    run: async () => assert.equal(await classifyInterestWithAi(input), expected)
  })),
  ...recoveryCases.map(([id, stage, message, expectedActions, expectedFields = {}]) => ({
    id: `ai-${id}`,
    run: async () => {
      const result = await recoverEc10FlowWithAi({ stage, message, mediaType: "text" });
      assert.ok(result, "sem resultado de recuperacao");
      assert.ok(expectedActions.includes(result.action), `acao ${result.action} fora de ${expectedActions.join(", ")}`);
      if (expectedFields.age) assert.equal(result.age, expectedFields.age);
      if (expectedFields.foundationStatus) assert.equal(result.foundationStatus, expectedFields.foundationStatus);
      if (expectedFields.dateText) assert.ok(result.dateText, "dateText ausente");
      if (expectedFields.timeText) assert.ok(result.timeText, "timeText ausente");
    }
  }))
];

assert.equal(deterministicChecks.length, 100, "a bateria deterministica deve ter 100 testes");
assert.equal(aiChecks.length, 100, "a bateria Ollama deve ter 100 testes");

const startedAt = new Date();
const deterministic = runDeterministicChecks();
const connectivity = await runOllamaConnectivityCheck();
const ollama = await runOllamaChecks(aiChecks.slice(0, ollamaLimit));
const failed = [
  ...deterministic.failed,
  ...(connectivity.ok ? [] : [{ id: "ollama-connectivity", error: connectivity.error }]),
  ...ollama.failed
];

const report = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  deterministic: {
    total: deterministic.total,
    passed: deterministic.passed,
    failed: deterministic.failed.length
  },
  ollama: {
    enabled: isBotAiEnabled(),
    connectivity,
    requested: Math.min(ollamaLimit, aiChecks.length),
    passed: ollama.passed,
    failed: ollama.failed.length,
    full: fullOllama
  },
  failed
};

await fs.mkdir(path.resolve("runtime"), { recursive: true });
await fs.writeFile(
  path.resolve("runtime", "bot-ollama-100-tests-latest.json"),
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(JSON.stringify(report, null, 2));

if (failed.length) {
  process.exitCode = 1;
}

function runDeterministicChecks() {
  const failedItems = [];

  for (const [id, run] of deterministicChecks) {
    try {
      run();
    } catch (error) {
      failedItems.push({ id, error: errorMessage(error) });
    }
  }

  return {
    total: deterministicChecks.length,
    passed: deterministicChecks.length - failedItems.length,
    failed: failedItems
  };
}

async function runOllamaChecks(checks) {
  if (!checks.length) return { passed: 0, failed: [] };
  if (!isBotAiEnabled()) {
    return {
      passed: 0,
      failed: [{ id: "ollama-enabled", error: "BOT_AI/Ollama nao esta habilitado" }]
    };
  }

  const failedItems = [];
  let passed = 0;

  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index];
    try {
      await check.run();
      passed += 1;
    } catch (error) {
      failedItems.push({ id: check.id, error: errorMessage(error) });
    }

    if ((index + 1) % 10 === 0 || index + 1 === checks.length) {
      console.log(`Ollama checks: ${index + 1}/${checks.length}`);
    }
  }

  return { passed, failed: failedItems };
}

async function runOllamaConnectivityCheck() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen3:4b";
  const timeoutMs = Number.parseInt(process.env.OLLAMA_REQUEST_TIMEOUT_MS || "120000", 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 120000);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        think: false,
        stream: false,
        format: "json",
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
        messages: [
          { role: "system", content: "Retorne somente JSON valido." },
          { role: "user", content: "/no_think\nRetorne {\"ok\":true,\"model\":\"ollama\"}." }
        ],
        options: { temperature: 0, num_predict: 40, num_ctx: 512 }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      return { ok: false, model, error: `HTTP ${response.status}: ${message.slice(0, 160)}` };
    }

    const payload = await response.json();
    const content = String(payload.message?.content || "").trim();
    const parsed = parseJson(content);
    return {
      ok: Boolean(content) && Boolean(parsed),
      model,
      raw: parsed ?? content.slice(0, 160),
      error: parsed ? undefined : "Ollama respondeu sem JSON valido"
    };
  } catch (error) {
    return { ok: false, model, error: errorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function readNumericArg(name) {
  const prefix = `${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
