import { ensureSeller, handleApiError, HttpError } from "./_auth.js";
import { pool } from "./_db.js";

const allowedStages = new Set([
  "opening",
  "awaiting_context",
  "awaiting_role",
  "awaiting_company_familiarity",
  "awaiting_age",
  "awaiting_interest",
  "awaiting_guardian_confirmation",
  "awaiting_meeting_date",
  "awaiting_meeting_time",
  "completed"
]);
const allowedRoles = new Set(["responsavel", "atleta", "outro"]);
const superAdminEmail = "matheusgdn94@gmail.com";
let labSchemaReady = false;

function ensureBotLabSuperAdmin(identity: { user?: { email?: string }; seller?: { email?: string } }) {
  const email = String(identity.user?.email || identity.seller?.email || "").trim().toLowerCase();
  if (email !== superAdminEmail) {
    throw new HttpError(403, "Laboratorio disponivel apenas para o superadministrador.");
  }
}

async function ensureLabSchema() {
  if (labSchemaReady) return;
  await pool.query(`
    create table if not exists public.bot_lab_sessions (
      id uuid primary key default gen_random_uuid(),
      created_by uuid not null references public.sellers(id) on delete cascade,
      name text not null default 'Nova simulacao',
      status text not null default 'active' check (status in ('active', 'completed', 'archived')),
      current_stage text not null default 'awaiting_age',
      athlete_age integer check (athlete_age is null or athlete_age between 1 and 99),
      speaker_role text not null default 'responsavel' check (speaker_role in ('responsavel', 'atleta', 'outro')),
      service_interest text,
      metadata jsonb not null default '{}'::jsonb,
      system_version text not null default 'eric-audios-2026-09-14-v1',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists public.bot_lab_messages (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references public.bot_lab_sessions(id) on delete cascade,
      direction text not null check (direction in ('user', 'assistant')),
      body text not null,
      stage text not null,
      audio_paths text[] not null default '{}',
      would_schedule boolean not null default false,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create table if not exists public.bot_training_examples (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references public.bot_lab_sessions(id) on delete set null,
      assistant_message_id uuid unique references public.bot_lab_messages(id) on delete set null,
      reviewed_by uuid not null references public.sellers(id) on delete cascade,
      stage text not null,
      athlete_age integer,
      speaker_role text,
      user_message text not null,
      assistant_response text not null,
      corrected_response text,
      rating text not null check (rating in ('approved', 'corrected', 'rejected')),
      source_version text not null default 'eric-audios-2026-09-14-v1',
      approved_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists bot_lab_sessions_created_by_updated_idx on public.bot_lab_sessions(created_by, updated_at desc);
    create index if not exists bot_lab_messages_session_created_idx on public.bot_lab_messages(session_id, created_at);
    create index if not exists bot_training_examples_lookup_idx on public.bot_training_examples(rating, stage, athlete_age, updated_at desc);
    alter table public.bot_lab_sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
  `);
  labSchemaReady = true;
}

const routes = {
  career: {
    min: 8,
    max: 99,
    service: "plano_carreira",
    label: "Plano de Carreira",
    audioPaths: [
      "media/audio/ec10/eric-2026-09-14/01_8-13_apresentacao.ogg",
      "media/audio/ec10/eric-2026-09-14/02_8-13_plano-de-carreira.ogg"
    ],
    knowledge: "Eric apresenta a EC10 e explica o Plano de Carreira com acompanhamento, mentoria, marketing e assessoria esportiva."
  },
  eurocamp: {
    min: 14,
    max: 19,
    service: "eurocamp",
    label: "Eurocamp",
    audioPaths: [
      "media/audio/ec10/eric-2026-09-14/04_14-19_apresentacao.ogg",
      "media/audio/ec10/eric-2026-09-14/05_14-19_eurocamp.ogg"
    ],
    knowledge: "Eric apresenta a EC10 e direciona atletas de 14 a 19 anos para o Eurocamp e sua analise individual."
  },
  international: {
    min: 20,
    max: 25,
    service: "plano_internacional",
    label: "Plano Internacional",
    audioPaths: ["media/audio/ec10/eric-2026-09-14/06_20-25_plano-internacional.ogg"],
    knowledge: "Eric explica o Plano Internacional para atletas de 20 a 25 anos e o direcionamento para oportunidades fora do Brasil."
  }
} as const;

type LabRoute = (typeof routes)[keyof typeof routes];

function cleanText(value: unknown, max = 1500) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalize(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractAge(value: unknown) {
  const match = normalize(value).match(/\b([1-9]\d?)\b/);
  const age = match ? Number(match[1]) : null;
  return age && age <= 99 ? age : null;
}

function routeForAge(age: number | null): LabRoute | null {
  if (!age) return null;
  if (age >= 20 && age <= 25) return routes.international;
  if (age >= 14 && age <= 19) return routes.eurocamp;
  if (age >= 8) return routes.career;
  return null;
}

function pathsForAge(age: number | null) {
  if (!age || age < 8) return [];
  if (age <= 13) return ["Plano de Carreira", "Eurokids / Sudakids"];
  if (age <= 19) return ["Plano de Carreira", "Eurocamp"];
  if (age <= 25) return ["Plano de Carreira", "Plano Internacional"];
  return ["Plano de Carreira"];
}

function positive(value: unknown) {
  const text = normalize(value);
  return /^(1|sim|s|ok|beleza|blz)$/.test(text) || /\b(quero|tenho interesse|vamos marcar|pode agendar|quero agendar)\b/.test(text);
}

function negative(value: unknown) {
  const text = normalize(value);
  return /^(2|nao|n)$/.test(text) || /\b(nao quero|sem interesse|agora nao|nao sou responsavel|sou o atleta)\b/.test(text);
}

function roleFromMessage(value: unknown, fallback: string) {
  const text = normalize(value);
  if (/\b(sou (o |a )?(pai|mae|responsavel)|responsavel legal)\b/.test(text)) return "responsavel";
  if (/\b(sou (o )?atleta|o atleta sou eu|quero ser jogador|quero virar profissional|meu sonho e jogar|eu jogo|eu treino)\b/.test(text)) return "atleta";
  return allowedRoles.has(fallback) ? fallback : "outro";
}

function isGreeting(value: unknown) {
  const text=normalize(value).replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
  return /^(?:(?:oi|ola|opa|e ai|eai|bom dia|boa tarde|boa noite|tudo bem|td bem|tudo certo|tudo bom|como vai|beleza)\s*)+$/.test(text);
}

function companyFamiliarity(value: unknown) {
  const text=normalize(value);
  if(/\b(nao|nunca|ainda nao|nao conheco|primeira vez)\b/.test(text))return false;
  if(/\b(sim|conheco|ja vi|ja ouvi|acompanho|sei sim)\b/.test(text))return true;
  return null;
}

function explicitMeetingInterest(value:unknown) {
  const text=normalize(value);
  return /\b(quero agendar|quero marcar|vamos agendar|vamos marcar|pode agendar|pode marcar|ver horarios|marcar reuniao)\b/.test(text);
}

function firstName(value:unknown) {
  return cleanText(value,80).split(/\s+/)[0]||"";
}

function safeJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function aiDetour(input: {
  stage: string;
  message: string;
  age: number | null;
  role: string;
  route: LabRoute | null;
  instruction?:string;
  fallback?:string;
  history?:Array<{direction:string;body:string}>;
}) {
  if (!process.env.GROQ_API_KEY) return input.fallback||null;
  const examples = await pool.query(
    `
      select user_message, coalesce(corrected_response, assistant_response) as answer
      from public.bot_training_examples
      where rating in ('approved', 'corrected')
        and stage = $1
        and (athlete_age is null or $2::int is null or abs(athlete_age - $2::int) <= 3)
      order by updated_at desc
      limit 6
    `,
    [input.stage, input.age]
  );
  const system=[
    "Voce e Anderson, consultor comercial da EC10 Talentos, respondendo dentro de um laboratorio totalmente isolado.",
    "A EC10 e uma empresa de consultoria e desenvolvimento de carreira no futebol, com base em Belo Horizonte, no bairro Gutierrez.",
    "Converse como nos audios do Eric: proximo, seguro, caloroso e natural. Com atleta, pode usar 'irmao' com moderacao se combinar com o jeito dele. Com responsavel, seja acolhedor sem infantilizar.",
    "Nao transforme a conversa em formulario. Nunca encadeie perguntas rasas como 'qual seu objetivo?' e 'qual seu desafio?'. Conecte a fala anterior ao motivo da proxima descoberta e entregue contexto antes de perguntar.",
    "A abertura segue naturalmente: acolher, entender se fala com atleta ou responsavel, saber se conhece a EC10, descobrir a idade e entao apresentar caminhos compativeis.",
    "O Plano de Carreira e a base a partir de 8 anos. De 8 a 13 tambem existe Eurokids/Sudakids; de 14 a 19, Eurocamp; de 20 a 25, Plano Internacional.",
    "Mantenha o cliente sonhando com um caminho concreto de preparo, carreira e oportunidades. Nao centralize ressalvas, mas nao invente resultados, clubes, contratos, aprovacoes, precos ou prova social.",
    "Menor de 18 anos: pai, mae ou responsavel legal participa das decisoes esportivas e financeiras e precisa assumir o agendamento. Adulto pode decidir, mas voce identifica quem participa da decisao financeira.",
    "Uma pergunta por mensagem quando perguntar; nem toda resposta precisa terminar em pergunta. Nao comece com 'Entendi', 'Perfeito' ou uma nova saudacao se a conversa ja comecou.",
    input.route?.knowledge || "Idade ainda sem rota comercial definida.",
    `Etapa: ${input.stage}. Idade: ${input.age ?? "desconhecida"}. Papel: ${input.role}. Caminhos: ${pathsForAge(input.age).join(", ")||"a descobrir"}.`,
    input.instruction||"Responda ao que a pessoa disse e conduza o proximo passo com naturalidade.",
    `Historico recente: ${JSON.stringify((input.history||[]).slice(-12))}`,
    `Exemplos aprovados: ${JSON.stringify(examples.rows)}`,
    "Nao diga que marcou, enviou ou alterou algo real. Retorne JSON: {\"reply\":\"texto natural de ate 600 caracteres\"}."
  ].join("\n");
  const models=[process.env.GROQ_MODEL,"openai/gpt-oss-120b","openai/gpt-oss-20b","qwen/qwen3.8-27b"].filter((value,index,list)=>value&&list.indexOf(value)===index) as string[];
  for(const model of models) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {authorization: `Bearer ${process.env.GROQ_API_KEY}`,"content-type": "application/json"},
        body: JSON.stringify({model,temperature:0.35,max_completion_tokens:900,
          ...(model.startsWith("openai/gpt-oss")?{reasoning_effort:"low"}:{}),
          messages:[{role:"system",content:system},{role:"user",content:input.message}]}),
        signal: AbortSignal.timeout(18000)
      });
      if(!response.ok)continue;
      const payload:any=await response.json();
      const parsed=safeJson(String(payload?.choices?.[0]?.message?.content??""));
      const candidate=cleanText(parsed?.reply,600)
        .replace(/^(?:oi|ola|olá|bom dia|boa tarde|boa noite)[!.,:;\s-]+/i,input.stage==='opening'?'$&':'')
        .replace(/^(?:entendi|perfeito|certo|compreendo)(?:\s+que)?[.!,:]?\s*/i,"");
      if(candidate&&!/https?:|www\.|R\$|US\$|€\s*\d|garantimos|aprovacao garantida/i.test(candidate))return candidate;
    } catch {}
  }
  return input.fallback||null;
}

async function createSession(sellerId: string, request: any, response: any) {
  const age = Number(request.body?.athleteAge) || null;
  const role = allowedRoles.has(String(request.body?.speakerRole)) ? String(request.body.speakerRole) : "outro";
  const { rows } = await pool.query(
    `insert into public.bot_lab_sessions (created_by, name, athlete_age, speaker_role, current_stage, system_version, metadata)
     values ($1, $2, $3, $4, 'opening', 'anderson-natural-v2', $5::jsonb)
     returning *`,
    [sellerId, cleanText(request.body?.name, 80) || `Conversa ${new Date().toLocaleDateString("pt-BR")}`, age, role,
      JSON.stringify({isolated:true,realActions:0,qualification:{}})]
  );
  response.status(201).json({ session: rows[0], messages: [] });
}

async function listLab(sellerId: string, request: any, response: any) {
  const sessions = await pool.query(
    `select * from public.bot_lab_sessions where created_by = $1 order by updated_at desc limit 20`,
    [sellerId]
  );
  const sessionId = cleanText(request.query?.sessionId, 80) || sessions.rows[0]?.id;
  const messages = sessionId
    ? await pool.query(
      `select * from public.bot_lab_messages where session_id = $1 order by created_at, id`,
      [sessionId]
    )
    : { rows: [] };
  const stats = await pool.query(
    `select
       count(*) filter (where rating = 'approved')::int as approved,
       count(*) filter (where rating = 'corrected')::int as corrected,
       count(*) filter (where rating = 'rejected')::int as rejected
     from public.bot_training_examples`
  );
  response.setHeader("cache-control", "no-store");
  response.status(200).json({ sessions: sessions.rows, sessionId: sessionId ?? null, messages: messages.rows, stats: stats.rows[0] });
}

async function sendLabMessage(sellerId: string, request: any, response: any) {
  const sessionId = cleanText(request.body?.sessionId, 80);
  const message = cleanText(request.body?.message);
  if (!sessionId || !message) throw new HttpError(400, "Sessao e mensagem sao obrigatorias.");

  const sessionResult = await pool.query(
    `select * from public.bot_lab_sessions where id = $1 and created_by = $2 limit 1`,
    [sessionId, sellerId]
  );
  const session = sessionResult.rows[0];
  if (!session) throw new HttpError(404, "Simulacao nao encontrada.");

  const requestedAge = Number(request.body?.athleteAge) || null;
  const age = session.athlete_age || extractAge(message) || requestedAge;
  const requestedRole=String(request.body?.speakerRole||"");
  const role = roleFromMessage(message, allowedRoles.has(requestedRole)&&requestedRole!=="outro"?requestedRole:String(session.speaker_role));
  const route = routeForAge(age);
  const currentStage = allowedStages.has(session.current_stage) ? session.current_stage : "opening";
  const sessionMetadata=session.metadata&&typeof session.metadata==="object"?session.metadata:{};
  await pool.query(
    `insert into public.bot_lab_messages (session_id, direction, body, stage)
     values ($1, 'user', $2, $3)`,
    [sessionId, message, currentStage]
  );

  let nextStage = currentStage;
  let reply = "";
  let audioPaths: string[] = [];
  let wouldSchedule = false;
  const historyResult=await pool.query(
    `select direction, body from public.bot_lab_messages where session_id=$1 order by created_at desc limit 14`,
    [sessionId]
  );
  const history=[...historyResult.rows].reverse();
  const name=firstName(request.body?.leadName||sessionMetadata.leadName);
  const paths=pathsForAge(age);
  const pathText=paths.length>1?`${paths.slice(0,-1).join(", ")} e ${paths[paths.length-1]}`:paths[0]||"o caminho adequado";

  if (currentStage === "opening") {
    if(isGreeting(message)) {
      nextStage="awaiting_context";
      const fallback=`${/boa tarde/i.test(message)?"Boa tarde":/boa noite/i.test(message)?"Boa noite":/bom dia/i.test(message)?"Bom dia":"Oi"}${name?`, ${name}`:""}! Tudo certo por aqui 😄 E com você? Me conta, o que te trouxe até a EC10?`;
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Responda a saudacao com calor humano e pergunte de forma aberta o que trouxe a pessoa ate a EC10. Nao pergunte idade nem objetivo esportivo agora."})||fallback;
    } else if(role!=="outro") {
      nextStage="awaiting_company_familiarity";
      const fallback=role==="atleta"?"Boa. Você já conhece a EC10 e o trabalho que a gente faz com a carreira do atleta?":"Boa. Você já conhece a EC10 e o trabalho que a gente faz junto com atletas e famílias?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Reconheca o que a pessoa disse e pergunte se ela ja conhece o trabalho da EC10. Nao pergunte idade ainda."})||fallback;
    } else {
      nextStage="awaiting_role";
      const fallback="Quero entender seu momento sem transformar isso num questionário. Você é o atleta ou está falando como responsável por ele?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Acolha a mensagem e descubra naturalmente se fala com o atleta ou com um responsavel. Faca somente essa pergunta."})||fallback;
    }
  } else if(currentStage==="awaiting_context"||currentStage==="awaiting_role") {
    if(role!=="outro") {
      nextStage="awaiting_company_familiarity";
      const fallback=role==="atleta"?"Boa. Você já conhece a EC10 e o trabalho que a gente faz com a carreira do atleta?":"Boa. Você já conhece a EC10 e o trabalho que a gente faz junto com atletas e famílias?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Conecte a resposta ao fato de falar com atleta ou responsavel e pergunte se ja conhece a EC10. Nao pergunte idade ou objetivo ainda."})||fallback;
    } else {
      nextStage="awaiting_role";
      const fallback="Legal. Pra eu conversar com você do jeito certo: você é o atleta ou é responsável por ele?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Reconheca o assunto mencionado e descubra se fala com atleta ou responsavel, sem parecer formulario."})||fallback;
    }
  } else if(currentStage==="awaiting_company_familiarity") {
    if(age&&age>=8) {
      nextStage=age<18&&role==="atleta"?"awaiting_guardian_confirmation":"awaiting_interest";
      audioPaths=route?[...route.audioPaths]:[];
      const fallback=role==="atleta"&&age<18
        ? `Boa. Com ${age} anos, a EC10 pode trabalhar caminhos como ${pathText}, olhando preparação, carreira e sua família junto com você. Como você ainda é menor, quem é o responsável que acompanha sua carreira?`
        : `Boa. Para ${age} anos, caminhos como ${pathText} podem fazer sentido. Antes de indicar qualquer passo, a EC10 olha o momento esportivo e o que a família busca. O que fez vocês procurarem orientação agora?`;
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:`A idade ja apareceu. Apresente primeiro os caminhos ${pathText} e o valor do preparo individual. ${age<18&&role==="atleta"?"Depois envolva o responsavel que participa das decisoes financeiras.":"Continue com uma pergunta contextual, ligada ao momento atual."}`})||fallback;
    } else {
      nextStage="awaiting_age";
      const known=companyFamiliarity(message);
      const fallback=role==="atleta"
        ? `${known===false?"Tranquilo. A EC10 organiza a carreira, prepara o caminho e envolve a família nas decisões importantes.":"Boa. Então você já sabe que a gente olha a carreira como um todo, não só uma oportunidade solta."} Só pra eu te orientar do jeito certo: você tem quantos anos, irmão?`
        : `${known===false?"Tranquilo. A EC10 organiza a carreira do atleta e ajuda a família a tomar decisões com mais direção.":"Boa. Então você já conhece um pouco do nosso trabalho."} Qual é a idade do atleta?`;
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Responda se a pessoa conhece ou nao a EC10, explique em uma frase se necessario e descubra a idade de forma informal e contextualizada."})||fallback;
    }
  } else if (currentStage === "awaiting_age") {
    if (!age) {
      const fallback=role==="atleta"?"Já vou ligar seu momento aos caminhos certos. Me fala sua idade, irmão?":"Já vou ligar o momento dele aos caminhos certos. Qual é a idade do atleta?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"A idade ainda nao ficou clara. Explique em poucas palavras por que precisa dela e pergunte de forma natural."})||fallback;
    } else if (age < 8) {
      reply = "A EC10 estrutura este atendimento a partir dos 8 anos. Quero entender melhor a fase dele antes de indicar qualquer caminho: ele já completou 8 anos?";
    } else {
      nextStage=age<18&&role==="atleta"?"awaiting_guardian_confirmation":"awaiting_interest";
      audioPaths=route?[...route.audioPaths]:[];
      const fallback=role==="atleta"&&age<18
        ? `Boa, irmão. Com ${age} anos, a EC10 pode trabalhar caminhos como ${pathText}, olhando seu preparo e sua família junto com você. Quem é o responsável que acompanha sua carreira e participa dessas decisões?`
        : `Para ${age} anos, caminhos como ${pathText} podem fazer sentido. Antes de indicar qualquer passo, quero entender o momento esportivo. Onde o atleta joga ou treina hoje?`;
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:`Apresente os caminhos ${pathText} antes de perguntar outra coisa. Conecte carreira, preparo individual e familia. ${age<18&&role==="atleta"?"Convide o responsavel para a conversa.":"Descubra o momento atual com uma pergunta contextual."}`})||fallback;
    }
  } else if (currentStage === "awaiting_interest") {
    if(explicitMeetingInterest(message)) {
      if(age&&age<18&&role!=="responsavel") {
        nextStage="awaiting_guardian_confirmation";
        reply="Quero organizar essa conversa com você, irmão. Como você ainda é menor, seu pai, sua mãe ou responsável legal precisa continuar por aqui para participar da decisão e abrir a agenda. Quem acompanha essa parte com você?";
      } else {
        nextStage="awaiting_meeting_date";
        reply="Faz sentido avançar. No laboratório, agora eu mostraria somente os dias realmente disponíveis para você escolher primeiro.";
      }
    } else {
      const fallback=`O que você contou ajuda a enxergar melhor seu momento. A EC10 usa esse diagnóstico para organizar ${pathText} sem jogar uma oportunidade solta. Me conta onde você joga ou treina hoje e há quanto tempo está nesse ambiente.`;
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Responda exatamente ao que a pessoa disse. Gere valor antes da proxima descoberta e avance a qualificacao de forma conversada: momento esportivo, dificuldade, decisor, prioridade ou disposicao para analisar investimento. Escolha apenas o ponto que nasce naturalmente desta resposta. Nao convide para reuniao sem interesse claro."})||fallback;
    }
  } else if (currentStage === "awaiting_guardian_confirmation") {
    if(role==="responsavel") {
      nextStage="awaiting_interest";
      const fallback="Que bom que você entrou na conversa. Quero aproveitar o que o atleta já contou sem fazer vocês repetirem tudo. Hoje ele joga ou treina onde?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"A pessoa agora e o responsavel. Acolha, preserve o contexto anterior e retome a qualificacao naturalmente, sem abrir a agenda imediatamente."})||fallback;
    } else {
      const fallback="Seu sonho continua no centro da conversa, irmão. Como você é menor, preciso que seu pai, sua mãe ou responsável legal fale com a gente por aqui para participar das decisões. Quem acompanha sua carreira com você?";
      reply=await aiDetour({stage:currentStage,message,age,role,route,history,fallback,
        instruction:"Valorize o sonho do atleta menor e explique de modo acolhedor por que o responsavel precisa participar. Pergunte quem acompanha a carreira dele."})||fallback;
    }
  } else if (currentStage === "awaiting_meeting_date") {
    reply = "Dia reconhecido somente na simulação. Agora eu mostraria os horários disponíveis desse dia para você escolher.";
    nextStage = "awaiting_meeting_time";
  } else if (currentStage === "awaiting_meeting_time") {
    const guardianBlocked = Boolean(age && age < 18 && role !== "responsavel");
    if (guardianBlocked) {
      reply = "Para um atleta menor, o responsável legal precisa assumir esta etapa. Nenhuma agenda real foi aberta.";
      nextStage = "awaiting_guardian_confirmation";
    } else {
      reply = "Simulação concluída: a reunião estaria pronta para confirmação. Nenhuma agenda, lead ou mensagem real foi alterada.";
      nextStage = "completed";
      wouldSchedule = true;
    }
  } else {
    reply = "Esta simulacao terminou. Inicie uma nova para testar outro perfil.";
  }

  const service = route?.service ?? session.service_interest;
  const nextMetadata={...sessionMetadata,isolated:true,realActions:0,lastStage:currentStage,aiTurns:Number(sessionMetadata.aiTurns||0)+1};
  const assistantResult = await pool.query(
    `insert into public.bot_lab_messages
       (session_id, direction, body, stage, audio_paths, would_schedule, metadata)
     values ($1, 'assistant', $2, $3, $4, $5, $6::jsonb)
     returning *`,
    [sessionId, reply, nextStage, audioPaths, wouldSchedule, JSON.stringify({
      isolated: true,
      realActions: 0,
      fromStage: currentStage,
      source: "anderson-natural-v2"
    })]
  );
  await pool.query(
    `update public.bot_lab_sessions
     set current_stage = $2, athlete_age = $3, speaker_role = $4, service_interest = $5, metadata=$6::jsonb,
         system_version='anderson-natural-v2', status = case when $2 = 'completed' then 'completed' else 'active' end, updated_at = now()
     where id = $1`,
    [sessionId, nextStage, age, role, service,JSON.stringify(nextMetadata)]
  );
  response.status(200).json({
    message: assistantResult.rows[0],
    session: { ...session, current_stage: nextStage, athlete_age: age, speaker_role: role, service_interest: service },
    safety: { isolated: true, whatsappSent: 0, leadsCreated: 0, meetingsCreated: 0 }
  });
}

async function reviewMessage(sellerId: string, request: any, response: any) {
  const messageId = cleanText(request.body?.messageId, 80);
  const rating = cleanText(request.body?.rating, 20);
  const correction = cleanText(request.body?.correctedResponse, 1500) || null;
  if (!messageId || !["approved", "corrected", "rejected"].includes(rating)) {
    throw new HttpError(400, "Avaliacao invalida.");
  }
  if (rating === "corrected" && !correction) throw new HttpError(400, "Informe a resposta corrigida.");
  const messageResult = await pool.query(
    `select m.*, s.athlete_age, s.speaker_role, s.created_by
     from public.bot_lab_messages m
     join public.bot_lab_sessions s on s.id = m.session_id
     where m.id = $1 and m.direction = 'assistant' and s.created_by = $2`,
    [messageId, sellerId]
  );
  const message = messageResult.rows[0];
  if (!message) throw new HttpError(404, "Resposta do laboratorio nao encontrada.");
  const previous = await pool.query(
    `select body from public.bot_lab_messages
     where session_id = $1 and direction = 'user' and created_at <= $2
     order by created_at desc limit 1`,
    [message.session_id, message.created_at]
  );
  const { rows } = await pool.query(
    `insert into public.bot_training_examples
       (session_id, assistant_message_id, reviewed_by, stage, athlete_age, speaker_role,
        user_message, assistant_response, corrected_response, rating, approved_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,case when $10 in ('approved','corrected') then now() else null end)
     on conflict (assistant_message_id) do update set
       reviewed_by = excluded.reviewed_by,
       corrected_response = excluded.corrected_response,
       rating = excluded.rating,
       approved_at = excluded.approved_at,
       updated_at = now()
     returning *`,
    [
      message.session_id,
      message.id,
      sellerId,
      cleanText(message.metadata?.fromStage, 80) || message.stage,
      message.athlete_age,
      message.speaker_role,
      previous.rows[0]?.body || "",
      message.body,
      correction,
      rating
    ]
  );
  response.status(200).json({ example: rows[0] });
}

export default async function handler(request: any, response: any) {
  try {
    const identity = await ensureSeller(request, { requireActive: true, requireAdmin: true });
    ensureBotLabSuperAdmin(identity);
    await ensureLabSchema();
    const { seller } = identity;
    const action = cleanText(request.query?.action, 40) || "state";
    if (request.method === "GET" && action === "state") return await listLab(seller.id, request, response);
    if (request.method === "POST" && action === "session") return await createSession(seller.id, request, response);
    if (request.method === "POST" && action === "message") return await sendLabMessage(seller.id, request, response);
    if (request.method === "POST" && action === "review") return await reviewMessage(seller.id, request, response);
    response.status(404).json({ error: "Acao do laboratorio nao encontrada." });
  } catch (error) {
    handleApiError(response, error);
  }
}
