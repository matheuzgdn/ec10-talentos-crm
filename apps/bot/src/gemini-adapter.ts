// @ts-nocheck
const TOOL_NAMES = new Set([
  "update_qualification",
  "get_booking_link",
  "handoff_to_seller",
]);

function unescapeQuoted(value = "") {
  return value.replace(/\\n/g, "\n").replace(/\\(["'])/g, "$1");
}

function textualValue(input, key) {
  const pattern = new RegExp(
    `\\b${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1(?=\\s*,\\s*\\w+\\s*=|\\s*$)`,
    "i",
  );
  return unescapeQuoted(input.match(pattern)?.[2]);
}

function safeArguments(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function normalizeToolName(value = "") {
  const name = String(value).split(".").at(-1)?.trim().toLowerCase() || "";
  return TOOL_NAMES.has(name) ? name : null;
}

function stripFence(value = "") {
  const trimmed = String(value).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function jsonToolCall(content) {
  const clean = stripFence(content);
  if (!clean.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(clean);
    const toolName = normalizeToolName(
      parsed.api_call || parsed.name || parsed.function_call?.name || parsed.tool,
    );
    if (!toolName) return null;
    return {
      kind: "tool",
      toolName,
      args: safeArguments(parsed.arguments || parsed.function_call?.arguments),
      source: "json_wrapper",
    };
  } catch {
    return null;
  }
}

function textualToolCall(content) {
  const clean = stripFence(content);
  const call = clean.match(
    /^(?:default_api\.)?(update_qualification|get_booking_link|handoff_to_seller)\s*\(([\s\S]*)\)\s*$/i,
  );
  if (!call) return null;
  const toolName = normalizeToolName(call[1]);
  const body = call[2];
  const args = {};
  if (toolName === "update_qualification") {
    for (const field of ["reply", "name", "responsibleName", "athleteName", "role", "club"]) {
      const value = textualValue(body, field);
      if (value) args[field] = value;
    }
    const age = body.match(/\bathleteAge\s*=\s*(\d{1,3})\b/i)?.[1];
    if (age) args.athleteAge = Number(age);
    for (const field of ["guardianConfirmed", "contactAdult"]) {
      const value = body.match(new RegExp(`\\b${field}\\s*=\\s*(true|false)`, "i"))?.[1];
      if (value) args[field] = value.toLowerCase() === "true";
    }
    if (!args.reply) return null;
  } else if (toolName === "handoff_to_seller") {
    args.reason = textualValue(body, "reason");
    const value = body.match(/\bdisqualified\s*=\s*(true|false)/i)?.[1];
    if (value) args.disqualified = value.toLowerCase() === "true";
    if (!args.reason) return null;
  }
  return { kind: "tool", toolName, args, source: "textual_wrapper" };
}

export function normalizeGeminiMessage(message = {}) {
  const structured = message.tool_calls?.[0];
  if (structured) {
    const toolName = normalizeToolName(structured.function?.name);
    if (!toolName) return { kind: "blocked", reason: "unknown_tool" };
    return {
      kind: "tool",
      toolName,
      args: safeArguments(structured.function?.arguments),
      source: "structured",
    };
  }
  const content = String(message.content || "").trim();
  const normalized = jsonToolCall(content) || textualToolCall(content);
  if (normalized) return normalized;
  if (/```|[{}]|"api_call"|\b(?:default_api\.)?(?:update_qualification|get_booking_link|handoff_to_seller)\s*\(/i.test(content)) {
    return { kind: "blocked", reason: "internal_tool_leak" };
  }
  return { kind: "text", reply: content, source: "plain_text" };
}

function normalizedText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9? ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function selectGustavoKnowledgeAction(value = "") {
  const text = normalizedText(value);
  const humanRequest=/\b(?:quero|preciso|gostaria)\s+(?:de\s+)?(?:falar|conversar)\s+com\s+(?:uma\s+)?(?:pessoa|humano|atendente|consultor)\b|\batendimento\s+humano\b/.test(text);
  if(humanRequest)return {kind:'handoff',product:'atendimento humano',reply:'Claro. Vou encaminhar sua conversa para uma pessoa da equipe continuar com você.'};
  const askingInclusions = /\b(?:inclui|incluido|incluso|cobre|paga|ja vem|faz parte)\b/.test(text);
  if (askingInclusions && /\bplano de carreira\b/.test(text) && /\b(?:viagem|viagens|hospedagem|passagens|alimentacao|camps)\b/.test(text)) {
    return { kind: "reply", reply: "Não. O Plano de Carreira é o acompanhamento do atleta e da família. Viagens, camps, passagens, hospedagem e alimentação são contratados separadamente, conforme a proposta." };
  }
  const otherProduct = text.match(/\b(?:eurokids|sudakids|eurocamp|plano internacional|brasilcamp)\b/)?.[0];
  const negativeInterest = otherProduct && new RegExp(`\\bnao\\s+(?:quero|tenho interesse|busco)\\s+(?:o\\s+|a\\s+)?${otherProduct}\\b`).test(text);
  if (otherProduct && !negativeInterest) {
    return { kind: "handoff", product: otherProduct, reply: "Esse programa é acompanhado por outro representante da nossa equipe. Vou encaminhar sua conversa para ele te orientar direitinho." };
  }
  return null;
}

export function factsFromInbound(value = ""): Record<string, any> {
  const text = normalizedText(value);
  const facts = {};
  if (/\b(?:eu\s+sou|sou)\s+(?:(?:o|a)\s+)?(?:pai|mae|responsavel)\b/.test(text) || (/\b(?:meu nome e|me chamo|eu sou|sou)\b/.test(text) && /\b(?:meu|minha)\s+(?:filho|filha|atleta)\b/.test(text))) {
    facts.role = "responsavel";
    facts.guardianConfirmed = true;
    facts.contactAdult = true;
  }
  if (/\b(?:eu\s+(?:mesmo\s+)?sou\s+(?:o\s+|a\s+)?atleta|sou\s+(?:o\s+|a\s+)?atleta)\b/.test(text) && facts.role !== 'responsavel') facts.role = 'atleta';
  const age = text.match(/\b(?:tenho|tem|idade(?:\s+e)?|atleta(?:\s+tem)?)\s*(\d{1,2})\s*(?:anos)?\b/)?.[1];
  if (age) facts.athleteAge = Number(age);
  if (/\b(?:esta|ta|ficou|segue)\s+sem\s+clube\b|\bsem\s+clube\b/.test(text)) facts.club = "sem clube";
  return facts;
}

function sentences(value = "") {
  return String(value).match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) || [];
}

function keepOnlyFirstQuestion(value = "") {
  let questionSeen = false;
  return String(value).split(/(?<=\?)/u).filter((part) => {
    if (!part.includes('?')) return true;
    if (questionSeen) return false;
    questionSeen = true;
    return true;
  }).join('').trim();
}

export function recoverQualification(state: any = {}, messages: any[] = []): any {
  const recovered = { ...state };
  for (const message of messages) {
    if (message.role !== 'user' && message.direction !== 'inbound') continue;
    Object.assign(recovered, factsFromInbound(message.content || message.body || ''));
  }
  return recovered;
}

function protectUrls(value = "") {
  const urls = [];
  const text = String(value).replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    const marker = `__EC10URL${urls.length}__`;
    urls.push(url);
    return marker;
  });
  return { text, restore: (output) => output.replace(/__EC10URL(\d+)__/g, (_, index) => urls[Number(index)]) };
}

export function formatBookingReply(name, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['ec10talentos.com', 'cliente-whatsapp-crm.vercel.app'].includes(parsed.hostname) || /\s/.test(url)) throw new Error('invalid_booking_url');
  const firstName = String(name || '').trim().split(/\s+/)[0];
  return `Perfeito, ${firstName}. Escolha primeiro o dia e depois o horário disponível neste link:\n\n${url}`;
}

function repeatedAgeRange(sentence, recentAssistantReplies) {
  const range = normalizedText(sentence).match(/\b(?:de\s+)?(\d{1,2})\s+a\s+(\d{1,2})\s+anos\b/);
  if (!range) return false;
  const marker = `${range[1]} a ${range[2]} anos`;
  return recentAssistantReplies.some((reply) => normalizedText(reply).includes(marker));
}

function confirmsKnownClub(sentence, latestInbound) {
  const incoming = normalizedText(latestInbound);
  const output = normalizedText(sentence);
  return incoming.includes("sem clube") && output.includes("sem clube") && /\bcerto\??$/.test(output);
}

export function repairNaturalReply({ reply, state = {}, recentAssistantReplies = [], latestInbound = "" }) {
  const merged = { ...state };
  const inbound = normalizedText(latestInbound);
  const answeringQuestion = /\?|\b(?:queria|quero|gostaria de)\s+(?:entender|saber|conhecer)|\b(?:como funciona|o que voces|quem sao|quanto custa|me explique|me explica)\b/.test(inbound);
  const output = normalizedText(reply);
  const ageKnown = Number.isInteger(merged.athleteAge) && merged.athleteAge >= 9 && merged.athleteAge <= 18;
  const asksKnownAge = ageKnown && /\?/.test(output) && /\b(?:idade|quantos anos|tem quantos)\b/.test(output);
  const newAthleteFacts = /\b(?:sou atleta|tenho \d{1,2} anos)\b/.test(inbound);
  const wantsToStart = /\b(?:quero|gostaria de)\s+(?:participar|comecar|entrar|contratar)|\b(?:tenho|estou)\s+interess/.test(inbound);
  if(!answeringQuestion&&ageKnown&&Number(merged.athleteAge)<18&&merged.role==='atleta'&&merged.guardianConfirmed!==true) {
    return 'Como você ainda é menor, preciso trazer seu pai, sua mãe ou responsável para a conversa e para a reunião. Ele está com você para seguir?';
  }
  if (!answeringQuestion && ageKnown && !merged.club && (asksKnownAge || newAthleteFacts || wantsToStart)) {
    return merged.role === 'atleta' ? 'O Plano de Carreira pode te ajudar a organizar sua evolução no futebol. Você joga em algum clube hoje ou está sem clube?' : 'O Plano de Carreira organiza a evolução do atleta junto da família. Ele joga em algum clube hoje ou está sem clube?';
  }
  // Do not replace a customer's business question with a qualification prompt.
  if (!answeringQuestion && merged.guardianConfirmed === true) {
    const knownName=String(merged.responsibleName||merged.name||'').trim().replace(/\s+/g,' ');
    if(!knownName)return "Perfeito. Qual é o seu nome completo?";
    if(knownName.split(' ').length<2)return knownName+", qual é seu sobrenome para eu completar o agendamento?";
  }
  if (
    !answeringQuestion &&
    Number.isInteger(merged.athleteAge) &&
    merged.athleteAge >= 9 &&
    merged.athleteAge < 18 &&
    merged.club &&
    merged.guardianConfirmed !== true
  ) {
    if (merged.role === 'atleta') return 'Para conhecer o plano e decidir os próximos passos, a reunião precisa ser junto de um responsável adulto. Seu pai, mãe ou responsável pode participar com você?';
    return "Perfeito. Como o atleta é menor de idade, preciso falar com um responsável adulto para avançarmos. Você é o responsável por ele?";
  }
  const protectedReply = protectUrls(stripFence(reply));
  const previousSentences = recentAssistantReplies.flatMap((text) => sentences(protectUrls(text).text)).map(normalizedText);
  const redundantKnownQuestion = (part = "") => {
    const sentence = normalizedText(part);
    if (!part.includes('?')) return false;
    const repeatsAge = ageKnown && /\b(?:idade|quantos anos|tem quantos)\b/.test(sentence);
    const repeatsClub = Boolean(merged.club) && /\b(?:joga|jogando|esta|ta)\b[\s\S]{0,35}\bclube\b|\bsem clube\b/.test(sentence);
    return repeatsAge || repeatsClub;
  };
  const cleaned = protectedReply.text
    .replace(/[^.!?]+[.!?]?/g, (part) => repeatedAgeRange(part.trim(), recentAssistantReplies) || confirmsKnownClub(part.trim(), latestInbound) || redundantKnownQuestion(part.trim()) || (!part.includes('__EC10URL') && previousSentences.includes(normalizedText(part))) ? '' : part)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (asksKnownAge && !answeringQuestion) {
    if (!merged.club) return merged.role === 'atleta' ? 'Você joga em algum clube hoje ou está sem clube?' : 'Ele joga em algum clube hoje ou está sem clube?';
    if (merged.guardianConfirmed === true) return merged.name ? 'Posso te enviar o link para escolher o dia e horário da reunião?' : 'Qual é o seu nome completo para deixar o agendamento preenchido?';
  }
  const repaired = keepOnlyFirstQuestion(protectedReply.restore(cleaned));
  if (repaired) return repaired;
  const responsibleName=String(merged.responsibleName||merged.name||'').trim();
  if(ageKnown&&Number(merged.athleteAge)<18&&merged.guardianConfirmed===true&&responsibleName.split(/\s+/).length>=2) return 'Perfeito. Posso te enviar o link para escolher o dia e o horário da reunião?';
  if(ageKnown&&merged.club&&merged.guardianConfirmed!==true) return merged.role==='atleta'
    ? 'Para avançar, preciso que seu pai, sua mãe ou responsável adulto participe. Ele está com você?'
    : 'Como o atleta é menor, você é o pai, a mãe ou o responsável adulto por ele?';
  if(ageKnown&&!merged.club) return merged.role==='atleta'?'Você joga em algum clube hoje ou está sem clube?':'Ele joga em algum clube hoje ou está sem clube?';
  return 'Certo. O que você gostaria de entender melhor sobre a EC10?';
}

export function validateNaturalReply(reply, recentAssistantReplies = []) {
  const issues = [];
  const text = String(reply || "").trim();
  if (!text) issues.push("empty_reply");
  if (/```|[{}]|"api_call"|\b(?:default_api\.)?(?:update_qualification|get_booking_link|handoff_to_seller)\s*\(/i.test(text)) {
    issues.push("internal_tool_leak");
  }
  if ((protectUrls(text).text.match(/\?/g) || []).length > 1) issues.push("multiple_questions");
  if (/\p{Extended_Pictographic}/u.test(text)) issues.push("emoji");
  if (/[—]|\s-\s/.test(text)) issues.push("forbidden_dash");
  for (const sentence of sentences(text)) {
    if (repeatedAgeRange(sentence, recentAssistantReplies)) issues.push("repeated_age_range");
  }
  return [...new Set(issues)];
}

export function resolveSafeReply({ message, state = {}, recentAssistantReplies = [], latestInbound = "" }) {
  const normalized = normalizeGeminiMessage(message);
  if (normalized.kind === "blocked") return { ok: false, issues: [normalized.reason] };
  const updates = normalized.kind === "tool" ? Object.fromEntries(Object.entries(normalized.args).filter(([, value]) => value !== null && value !== undefined && value !== "")) : {};
  const explicitFacts = factsFromInbound(latestInbound);
  // Role and guardian status are authorization gates for a minor's meeting.
  // The model may phrase the reply, but it must never infer these gates.
  for (const key of ['role', 'guardianConfirmed', 'contactAdult']) {
    if (!(key in explicitFacts)) delete updates[key];
  }
  for (const key of ['athleteAge', 'role', 'club', 'guardianConfirmed', 'contactAdult']) {
    if (state[key] !== null && state[key] !== undefined && state[key] !== '' && !(key in explicitFacts)) delete updates[key];
  }
  const nextState = {
    ...state,
    ...updates,
    ...explicitFacts,
  };
  const rawReply = normalized.kind === "tool" ? normalized.args.reply : normalized.reply;
  const reply = repairNaturalReply({ reply: rawReply, state: nextState, recentAssistantReplies, latestInbound });
  const issues = validateNaturalReply(reply, recentAssistantReplies);
  return {
    ok: issues.length === 0,
    issues,
    reply,
    toolName: normalized.kind === "tool" ? normalized.toolName : null,
    toolArgs: normalized.kind === "tool" ? normalized.args : null,
    state: nextState,
    source: normalized.source,
  };
}
