import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const args = new Set(process.argv.slice(2));
const selfTest = args.has("--self-test");
const dryRun = args.has("--dry-run") || !args.has("--apply");
const limit = readNumericArg("--limit") ?? numberEnv("OLLAMA_WATCHDOG_LIMIT", 20);
const staleQueueMinutes = numberEnv("OLLAMA_WATCHDOG_STALE_QUEUE_MINUTES", 20);
const failureLookbackMinutes = numberEnv("OLLAMA_WATCHDOG_FAILURE_LOOKBACK_MINUTES", 60);
const replyDelayMinutes = numberEnv("OLLAMA_WATCHDOG_REPLY_DELAY_MINUTES", 3);
const watchdogReplyCooldownMinutes = numberEnv("OLLAMA_WATCHDOG_REPLY_COOLDOWN_MINUTES", 12 * 60);
const autoReplyEnabled = envFlag("OLLAMA_WATCHDOG_AUTO_REPLY", true);
const minReplyConfidence = numberEnv("OLLAMA_WATCHDOG_MIN_CONFIDENCE", 82) / 100;
const maxRepliesPerRun = numberEnv("OLLAMA_WATCHDOG_MAX_REPLIES_PER_RUN", 3);
const model = process.env.OLLAMA_WATCHDOG_MODEL || process.env.OLLAMA_MODEL || "qwen3:4b";
const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
const timeoutMs = numberEnv("OLLAMA_WATCHDOG_TIMEOUT_MS", numberEnv("OLLAMA_REQUEST_TIMEOUT_MS", 60_000));
const numCtx = numberEnv("OLLAMA_WATCHDOG_NUM_CTX", numberEnv("OLLAMA_NUM_CTX", 2048));

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) throw new Error("SUPABASE_DB_URL ausente.");

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 1000,
  connectionTimeoutMillis: 10000
});

const startedAt = new Date();
const actions = [];
const issues = [];
const ollamaDecisions = [];

try {
  const ollamaStatus = await checkOllama();
  if (!ollamaStatus.ok) {
    issues.push({
      type: "ollama_unavailable",
      severity: "high",
      detail: ollamaStatus.error || `HTTP ${ollamaStatus.httpStatus}`
    });
  }

  const contacts = await loadRecentContacts(pool, limit, staleQueueMinutes, failureLookbackMinutes);
  for (const contact of contacts) {
    inspectContact(contact);
  }

  if (!dryRun) {
    await applyFollowupCancellations(pool, contacts);
  }

  if (ollamaStatus.ok && autoReplyEnabled) {
    const replyCandidates = contacts.filter(shouldClassifyForReply).slice(0, limit);
    let repliesPlanned = 0;
    for (const contact of replyCandidates) {
      if (repliesPlanned >= maxRepliesPerRun) break;
      const decision = await classifyMessageWithOllama(contact);
      ollamaDecisions.push({
        clientId: contact.id,
        phone: maskPhone(contact.phone),
        stage: contact.stage,
        action: decision.action,
        confidence: decision.confidence,
        reason: short(decision.reason, 180)
      });

      const reply = replyForDecision(contact, decision);
      if (!reply) continue;
      repliesPlanned += 1;

      if (dryRun) {
        actions.push({
          type: "would_enqueue_reply",
          clientId: contact.id,
          phone: maskPhone(contact.phone),
          action: decision.action,
          body: short(reply.body, 220)
        });
        continue;
      }

      if (decision.action === "handoff_human" && decision.confidence >= 0.72) {
        const paused = await pauseBotForHumanHandoff(pool, contact);
        if (paused) actions.push({ type: "bot_paused_for_handoff", clientId: contact.id, phone: maskPhone(contact.phone) });
      }

      const queued = await enqueueWatchdogReply(pool, contact, reply);
      if (queued) {
        actions.push({
          type: "reply_enqueued",
          clientId: contact.id,
          phone: maskPhone(contact.phone),
          outboundId: queued.id,
          action: decision.action
        });
      }
    }
  }

  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    config: {
      limit,
      staleQueueMinutes,
      failureLookbackMinutes,
      replyDelayMinutes,
      watchdogReplyCooldownMinutes,
      autoReplyEnabled,
      minReplyConfidence,
      maxRepliesPerRun,
      model
    },
    ollama: await checkOllama(),
    contactsChecked: contacts.length,
    actions,
    issues,
    ollamaDecisions,
    codexPromptRequired: issues.some((issue) => issue.severity === "high" || issue.needsCodeReview)
  };

  await writeRuntimeReports(report);
  if (!dryRun) await upsertRuntime(pool, report);

  console.log(JSON.stringify({
    dryRun,
    contactsChecked: report.contactsChecked,
    actions: actions.length,
    issues: issues.length,
    codexPromptRequired: report.codexPromptRequired,
    latestReport: path.resolve("runtime", "ollama-watchdog-latest.json"),
    codexPrompt: path.resolve("runtime", "ollama-watchdog-codex-prompt.md")
  }, null, 2));
} finally {
  await pool.end();
}

async function loadRecentContacts(client, maxContacts, staleMinutes, failureMinutes) {
  const { rows } = await client.query(
    `
      with recent_clients as (
        select c.id
        from public.clients c
        join public.messages m on m.client_id = c.id
        group by c.id
        order by max(m.created_at) desc
        limit $1
      )
      select
        c.id,
        c.phone,
        c.name,
        c.status::text as status,
        c.bot_paused,
        c.tags,
        c.next_follow_up_at,
        c.service_interest as client_service_interest,
        s.name as seller_name,
        b.stage,
        b.athlete_age,
        b.age_group,
        b.service_interest as bot_service_interest,
        b.metadata,
        b.updated_at as state_updated_at,
        li.body as last_inbound_body,
        li.media_type as last_inbound_media_type,
        li.created_at as last_inbound_at,
        lo.body as last_outbound_body,
        lo.media_path as last_outbound_media_path,
        lo.created_at as last_outbound_at,
        ow.last_watchdog_at,
        oq.queued_total,
        oq.overdue_total,
        oq.followup_queued,
        oq.followup_overdue,
        oq.recent_failed_total,
        oq.outbound_sample
      from recent_clients rc
      join public.clients c on c.id = rc.id
      left join public.sellers s on s.id = c.assigned_seller_id
      left join public.bot_conversation_states b on b.client_id = c.id
      left join lateral (
        select body, media_type, created_at
        from public.messages
        where client_id = c.id and direction = 'inbound'
        order by created_at desc
        limit 1
      ) li on true
      left join lateral (
        select body, media_path, created_at
        from public.messages
        where client_id = c.id and direction = 'outbound'
        order by created_at desc
        limit 1
      ) lo on true
      left join lateral (
        select max(created_at) as last_watchdog_at
        from public.outbound_messages
        where client_id = c.id
          and status in ('queued', 'sent')
          and media_path like 'ollama_watchdog:%'
      ) ow on true
      left join lateral (
        select
          count(*) filter (where status = 'queued')::int as queued_total,
          count(*) filter (
            where status = 'queued'
              and coalesce(scheduled_at, created_at) <= now() - make_interval(mins => $2::int)
          )::int as overdue_total,
          count(*) filter (where status = 'queued' and media_path like 'ec10_followup:%')::int as followup_queued,
          count(*) filter (
            where status = 'queued'
              and media_path like 'ec10_followup:%'
              and coalesce(scheduled_at, created_at) <= now() - make_interval(mins => $2::int)
          )::int as followup_overdue,
          count(*) filter (
            where status = 'failed'
              and created_at >= now() - make_interval(mins => $3::int)
          )::int as recent_failed_total,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', id,
                'status', status,
                'mediaPath', media_path,
                'mediaType', media_type,
                'scheduledAt', scheduled_at,
                'createdAt', created_at,
                'error', left(coalesce(error_message, ''), 220)
              )
              order by created_at desc
            ) filter (
              where status = 'queued'
                 or (status = 'failed' and created_at >= now() - make_interval(mins => $3::int))
            ),
            '[]'::jsonb
          ) as outbound_sample
        from public.outbound_messages
        where client_id = c.id
      ) oq on true
      order by li.created_at desc nulls last
    `,
    [maxContacts, staleMinutes, failureMinutes]
  );

  return rows.map(normalizeContact);
}

function normalizeContact(row) {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    status: row.status,
    botPaused: Boolean(row.bot_paused),
    tags: Array.isArray(row.tags) ? row.tags : [],
    nextFollowUpAt: row.next_follow_up_at,
    clientServiceInterest: row.client_service_interest,
    sellerName: row.seller_name,
    stage: row.stage,
    athleteAge: row.athlete_age,
    ageGroup: row.age_group,
    botServiceInterest: row.bot_service_interest,
    metadata: objectValue(row.metadata),
    stateUpdatedAt: row.state_updated_at,
    lastInboundBody: row.last_inbound_body || "",
    lastInboundMediaType: row.last_inbound_media_type || "text",
    lastInboundAt: row.last_inbound_at,
    lastOutboundBody: row.last_outbound_body || "",
    lastOutboundMediaPath: row.last_outbound_media_path || "",
    lastOutboundAt: row.last_outbound_at,
    lastWatchdogAt: row.last_watchdog_at,
    queuedTotal: Number(row.queued_total || 0),
    overdueTotal: Number(row.overdue_total || 0),
    followupQueued: Number(row.followup_queued || 0),
    followupOverdue: Number(row.followup_overdue || 0),
    failedTotal: Number(row.recent_failed_total || 0),
    outboundSample: Array.isArray(row.outbound_sample) ? row.outbound_sample : []
  };
}

function inspectContact(contact) {
  const stuckQueue = contact.overdueTotal > 0;
  const stuckFollowup = contact.followupOverdue > 0;

  if (stuckQueue) {
    issues.push({
      type: "queued_message_overdue",
      severity: stuckFollowup ? "high" : "medium",
      needsCodeReview: !stuckFollowup,
      clientId: contact.id,
      phone: maskPhone(contact.phone),
      detail: `${contact.overdueTotal} mensagem(ns) em fila ha mais de ${staleQueueMinutes} minutos`,
      sample: contact.outboundSample.slice(0, 5)
    });
  }

  const followupReason = unwantedFollowupReason(contact);
  if (followupReason) {
    issues.push({
      type: "indefinite_or_invalid_followup",
      severity: "high",
      clientId: contact.id,
      phone: maskPhone(contact.phone),
      detail: followupReason
    });
  }

  if (contact.failedTotal > 0) {
    issues.push({
      type: "outbound_failure",
      severity: "medium",
      needsCodeReview: true,
      clientId: contact.id,
      phone: maskPhone(contact.phone),
      detail: `${contact.failedTotal} falha(s) de envio nos ultimos 7 dias`,
      sample: contact.outboundSample.filter((item) => item.status === "failed").slice(0, 5)
    });
  }
}

async function applyFollowupCancellations(client, contacts) {
  for (const contact of contacts) {
    const reason = unwantedFollowupReason(contact);
    if (!reason) continue;

    const { rows } = await client.query(
      `
        update public.outbound_messages
        set status = 'cancelled',
            error_message = $2
        where client_id = $1
          and status = 'queued'
          and media_path like 'ec10_followup:%'
        returning id, media_path, scheduled_at, created_at
      `,
      [contact.id, `Ollama watchdog cancelou follow-up indevido: ${reason}`]
    );

    if (rows.length) {
      actions.push({
        type: "followup_cancelled",
        clientId: contact.id,
        phone: maskPhone(contact.phone),
        reason,
        count: rows.length,
        outboundIds: rows.map((row) => row.id)
      });
    }
  }
}

function unwantedFollowupReason(contact) {
  if (!contact.followupQueued) return null;
  const tags = new Set(contact.tags);
  const metadata = contact.metadata;
  const hasMeeting = Boolean(metadata?.meeting?.startsAt || metadata?.meetingStartsAt);

  if (contact.botPaused) return "bot pausado";
  if (["fechado", "perdido", "arquivado"].includes(contact.status || "")) return `status ${contact.status}`;
  if (tags.has("ec10_followup_encerrado")) return "tag ec10_followup_encerrado";
  if (tags.has("reuniao_recusada")) return "tag reuniao_recusada";
  if (tags.has("ec10_reuniao_agendada")) return "tag ec10_reuniao_agendada";
  if (hasMeeting) return "reuniao ja registrada no estado do bot";
  if (contact.stage === "completed" && contact.followupOverdue) return "fluxo concluido com follow-up atrasado";
  return null;
}

function shouldClassifyForReply(contact) {
  if (!contact.lastInboundAt) return false;
  if (contact.botPaused) return false;
  if (["fechado", "perdido", "arquivado"].includes(contact.status || "")) return false;
  if (contact.queuedTotal > 0) return false;

  const inboundAt = new Date(contact.lastInboundAt).getTime();
  const outboundAt = contact.lastOutboundAt ? new Date(contact.lastOutboundAt).getTime() : 0;
  if (inboundAt <= outboundAt) return false;

  const ageMinutes = (Date.now() - inboundAt) / 60_000;
  if (ageMinutes < replyDelayMinutes) return false;
  if (wasRecentDate(contact.lastWatchdogAt, watchdogReplyCooldownMinutes)) return false;
  return Boolean(short(contact.lastInboundBody, 5));
}

async function classifyMessageWithOllama(contact) {
  const prompt = [
    "Voce e um supervisor de bot WhatsApp da EC10 Talentos.",
    "Classifique a ultima mensagem do cliente para destravar o fluxo sem inventar informacoes.",
    "Acoes permitidas:",
    "- ask_age: precisa pedir idade do atleta.",
    "- ask_foundation_status: precisa perguntar se joga em base de clube ou escolinha/projeto.",
    "- ask_interest: precisa confirmar se quer saber mais e marcar reuniao.",
    "- ask_guardian: atleta menor de 18 anos; precisa confirmar se quem fala e pai, mae ou responsavel legal antes da agenda.",
    "- ask_meeting_date: precisa pedir data comercial para reuniao.",
    "- ask_meeting_time: precisa pedir horario comercial entre 8h e 18h.",
    "- answer_price_safe: perguntou preco/valor/custo; responder sem inventar preco e levar para reuniao.",
    "- handoff_human: pediu humano, atendente, vendedor ou suporte humano claramente.",
    "- no_reply: mensagem ja respondida, ambigua, ou nao exige acao segura.",
    "Retorne somente JSON valido: {\"action\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}.",
    `Contexto: ${JSON.stringify({
      stage: contact.stage,
      status: contact.status,
      serviceInterest: contact.botServiceInterest || contact.clientServiceInterest,
      athleteAge: contact.athleteAge,
      ageGroup: contact.ageGroup,
      lastOutbound: short(contact.lastOutboundBody, 240)
    })}`,
    `Mensagem do cliente: ${JSON.stringify(short(contact.lastInboundBody, 600))}`
  ].join("\n");

  const parsed = await callOllamaJson(prompt);
  const action = [
    "ask_age",
    "ask_foundation_status",
    "ask_interest",
    "ask_guardian",
    "ask_meeting_date",
    "ask_meeting_time",
    "answer_price_safe",
    "handoff_human",
    "no_reply"
  ].includes(parsed?.action) ? parsed.action : "no_reply";

  const confidence = typeof parsed?.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;

  return {
    action,
    confidence,
    reason: typeof parsed?.reason === "string" ? parsed.reason : ""
  };
}

function replyForDecision(contact, decision) {
  if (decision.action === "no_reply") return null;
  if (decision.confidence < minReplyConfidence) return null;
  if (!isActionAllowedForStage(contact.stage, decision.action)) return null;

  const action = decision.action;
  const body = {
    ask_age: "Para eu te direcionar certo, me manda a idade do atleta em numero. Exemplo: 15.",
    ask_foundation_status: "Para eu seguir no caminho certo, ele joga na base de algum clube ou ainda esta em escolinha/projeto? Responde 1 para base ou 2 para escolinha/projeto.",
    ask_interest: "Entendi. Voce tem interesse em saber mais e marcar uma reuniao rapida? Responde 1 para sim ou 2 para nao.",
    ask_guardian: "Como o atleta e menor de 18 anos, preciso confirmar: voce e o pai, a mae ou o responsavel legal? Responde 1 para sim ou 2 para nao.",
    ask_meeting_date: "Vamos marcar certinho. Me manda a melhor data em dia comercial. Exemplo: segunda ou 30/06.",
    ask_meeting_time: "Perfeito. Me manda o melhor horario comercial entre 8h e 18h. Exemplo: 14h.",
    answer_price_safe: "Te explico sim. O valor depende do plano e do momento do atleta, entao para eu nao te passar informacao errada o ideal e uma conversa rapida. Quer marcar um horario?",
    handoff_human: "Recebi sua mensagem e vou te direcionar para um consultor. Se puder, me manda a duvida em uma frase para ele ja te atender melhor."
  }[action];

  if (!body) return null;
  return {
    action,
    body,
    marker: `ollama_watchdog:${action}:${new Date().toISOString().slice(0, 16)}`
  };
}

function isActionAllowedForStage(stage, action) {
  if (action === "answer_price_safe" || action === "handoff_human") return true;
  if (stage === "awaiting_age") return action === "ask_age";
  if (stage === "awaiting_foundation_status") return action === "ask_foundation_status";
  if (stage === "awaiting_interest") return action === "ask_interest";
  if (stage === "awaiting_guardian_confirmation") return action === "ask_guardian";
  if (stage === "awaiting_meeting_date") return action === "ask_meeting_date";
  if (stage === "awaiting_meeting_time") return action === "ask_meeting_time";
  return false;
}

async function enqueueWatchdogReply(client, contact, reply) {
  const { rows } = await client.query(
    `
      insert into public.outbound_messages (client_id, phone, body, media_type, media_path, status)
      select $1, $2, $3, 'text', $4, 'queued'
      where not exists (
        select 1
        from public.outbound_messages
        where client_id = $1
          and media_path like 'ollama_watchdog:%'
          and created_at >= now() - make_interval(mins => $5::int)
      )
      and not exists (
        select 1
        from public.outbound_messages
        where client_id = $1
          and status in ('queued', 'sent')
          and (
            media_path like $6
            or body = $3
          )
          and created_at >= now() - make_interval(mins => $5::int)
      )
      returning id
    `,
    [contact.id, contact.phone, reply.body, reply.marker, watchdogReplyCooldownMinutes, `ollama_watchdog:${reply.action}:%`]
  );

  return rows[0] || null;
}

async function pauseBotForHumanHandoff(client, contact) {
  const { rowCount } = await client.query(
    `
      update public.clients
      set bot_paused = true,
          tags = array(select distinct unnest(coalesce(tags, '{}') || array['watchdog_handoff_humano']::text[])),
          updated_at = now()
      where id = $1
        and bot_paused = false
    `,
    [contact.id]
  );
  return rowCount > 0;
}

async function checkOllama() {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, httpStatus: response.status };
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models.map((item) => item.name) : [];
    return { ok: models.includes(model) || models.some((name) => name?.startsWith(model)), model, models };
  } catch (error) {
    return { ok: false, model, error: errorMessage(error) };
  }
}

async function callOllamaJson(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
          { role: "system", content: "Retorne somente JSON valido, sem markdown." },
          { role: "user", content: `/no_think\n${prompt}` }
        ],
        options: {
          temperature: 0,
          num_predict: 180,
          num_ctx: numCtx
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`Ollama API ${response.status}: ${message.slice(0, 180)}`);
    }

    const payload = await response.json();
    return parseJson(String(payload.message?.content || ""));
  } catch (error) {
    issues.push({ type: "ollama_classification_failed", severity: "high", detail: errorMessage(error) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function writeRuntimeReports(report) {
  await fs.mkdir(path.resolve("runtime"), { recursive: true });
  await fs.writeFile(path.resolve("runtime", "ollama-watchdog-latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.resolve("runtime", "ollama-watchdog-codex-prompt.md"), buildCodexPrompt(report));
  await fs.writeFile(path.resolve("runtime", "ollama-watchdog-live.html"), buildHtmlReport(report));
}

function buildHtmlReport(report) {
  const title = report.issues.length || report.actions.length
    ? "Ollama Watchdog - atencao"
    : "Ollama Watchdog - OK";
  const statusClass = report.issues.length ? "warn" : "ok";
  const decisions = report.ollamaDecisions.slice(0, 20).map((decision) => `
          <tr>
            <td>${escapeHtml(decision.phone)}</td>
            <td>${escapeHtml(decision.stage || "")}</td>
            <td>${escapeHtml(decision.action)}</td>
            <td>${Math.round(Number(decision.confidence || 0) * 100)}%</td>
            <td>${escapeHtml(decision.reason || "")}</td>
          </tr>`).join("");
  const issues = report.issues.slice(0, 30).map((issue) => `
          <tr>
            <td>${escapeHtml(issue.severity || "")}</td>
            <td>${escapeHtml(issue.type || "")}</td>
            <td>${escapeHtml(issue.phone || "")}</td>
            <td>${escapeHtml(issue.detail || "")}</td>
          </tr>`).join("");
  const actionsRows = report.actions.slice(0, 30).map((action) => `
          <tr>
            <td>${escapeHtml(action.type || "")}</td>
            <td>${escapeHtml(action.phone || "")}</td>
            <td>${escapeHtml(action.action || action.reason || "")}</td>
          </tr>`).join("");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="30" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2933; background: #f6f8fa; }
      main { max-width: 1180px; margin: 0 auto; }
      .status { padding: 16px 18px; border-radius: 8px; margin-bottom: 18px; border: 1px solid #d8dee4; background: #fff; }
      .ok { border-left: 6px solid #1f9d55; }
      .warn { border-left: 6px solid #d97706; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
      .metric { background: #fff; border: 1px solid #d8dee4; border-radius: 8px; padding: 14px; }
      .metric strong { display: block; font-size: 24px; margin-top: 6px; }
      section { background: #fff; border: 1px solid #d8dee4; border-radius: 8px; padding: 16px; margin-bottom: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
      th { color: #52606d; font-weight: 600; }
      code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; }
      .muted { color: #697386; }
      @media (max-width: 800px) { .grid { grid-template-columns: 1fr 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <div class="status ${statusClass}">
        <h1>${escapeHtml(title)}</h1>
        <div class="muted">Ultima verificacao: ${escapeHtml(report.finishedAt)} | Modelo: <code>${escapeHtml(report.config.model)}</code> | Modo: ${report.dryRun ? "dry-run" : "apply"}</div>
      </div>
      <div class="grid">
        <div class="metric">Contatos checados<strong>${report.contactsChecked}</strong></div>
        <div class="metric">Acoes executadas<strong>${report.actions.length}</strong></div>
        <div class="metric">Alertas<strong>${report.issues.length}</strong></div>
        <div class="metric">Ollama<strong>${report.ollama?.ok ? "OK" : "falha"}</strong></div>
      </div>
      <section>
        <h2>Alertas</h2>
        <table>
          <thead><tr><th>Severidade</th><th>Tipo</th><th>Telefone</th><th>Detalhe</th></tr></thead>
          <tbody>${issues || '<tr><td colspan="4" class="muted">Nenhum alerta ativo.</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h2>Acoes</h2>
        <table>
          <thead><tr><th>Tipo</th><th>Telefone</th><th>Detalhe</th></tr></thead>
          <tbody>${actionsRows || '<tr><td colspan="3" class="muted">Nenhuma acao executada.</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h2>Decisoes do Ollama</h2>
        <table>
          <thead><tr><th>Telefone</th><th>Etapa</th><th>Acao</th><th>Confianca</th><th>Motivo</th></tr></thead>
          <tbody>${decisions || '<tr><td colspan="5" class="muted">Nenhuma conversa precisou de classificacao nesta rodada.</td></tr>'}</tbody>
        </table>
      </section>
      <section>
        <h2>Arquivos</h2>
        <p>JSON completo: <code>runtime/ollama-watchdog-latest.json</code></p>
        <p>Prompt para Codex quando houver anomalia: <code>runtime/ollama-watchdog-codex-prompt.md</code></p>
      </section>
    </main>
  </body>
</html>
`;
}

function buildCodexPrompt(report) {
  const highIssues = report.issues.filter((issue) => issue.severity === "high" || issue.needsCodeReview);
  return [
    "# Prompt automatico do Ollama Watchdog",
    "",
    `Data: ${report.finishedAt}`,
    `Contatos checados: ${report.contactsChecked}`,
    `Modo: ${report.dryRun ? "dry-run" : "apply"}`,
    "",
    "Objetivo: verificar as anomalias abaixo no codigo do bot/CRM, corrigir bugs com escopo minimo, rodar build e testes relevantes. Nao imprimir segredos.",
    "",
    "Anomalias:",
    JSON.stringify(highIssues.slice(0, 20), null, 2),
    "",
    "Arquivos provaveis:",
    "- apps/bot/src/index.ts",
    "- apps/bot/src/store.ts",
    "- scripts/ollama-whatsapp-watchdog.mjs",
    "- api/bot-status.ts",
    "",
    "Se a causa for operacional e nao de codigo, registrar no resumo sem editar arquivos."
  ].join("\n");
}

async function upsertRuntime(client, report) {
  try {
    await client.query(
      `
        insert into public.bot_runtime (key, payload, updated_at)
        values ('ollama_watchdog', $1::jsonb, now())
        on conflict (key) do update
        set payload = excluded.payload,
            updated_at = now()
      `,
      [JSON.stringify(report)]
    );
  } catch (error) {
    issues.push({ type: "bot_runtime_upsert_failed", severity: "medium", detail: errorMessage(error) });
  }
}

function objectValue(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input;
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

function short(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function maskPhone(phone) {
  const text = String(phone || "").replace(/\D/g, "");
  if (text.length <= 4) return "****";
  return `${text.slice(0, 4)}****${text.slice(-2)}`;
}

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "nao"].includes(value.toLowerCase());
}

function readNumericArg(name) {
  const prefix = `${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function wasRecentDate(value, minutes) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < minutes * 60_000;
}

function runSelfTest() {
  const baseContact = {
    id: "00000000-0000-0000-0000-000000000001",
    phone: "5511999999999",
    status: "aguardando_cliente",
    botPaused: false,
    tags: [],
    stage: "awaiting_meeting_time",
    athleteAge: 15,
    ageGroup: "13-17",
    botServiceInterest: "plano_carreira",
    clientServiceInterest: "plano_carreira",
    metadata: {},
    lastInboundBody: "20h",
    lastInboundAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    lastOutboundBody: "Perfeito. Me manda o melhor horario comercial entre 8h e 18h. Exemplo: 14h.",
    lastOutboundAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    lastWatchdogAt: null,
    queuedTotal: 0,
    overdueTotal: 0,
    followupQueued: 0,
    followupOverdue: 0,
    failedTotal: 0,
    outboundSample: []
  };

  assertSelfTest("allows stale inbound with no watchdog reply", shouldClassifyForReply(baseContact) === true);
  assertSelfTest("blocks recent watchdog reply", shouldClassifyForReply({
    ...baseContact,
    lastWatchdogAt: new Date(Date.now() - 30 * 60_000).toISOString()
  }) === false);
  assertSelfTest("allows after watchdog cooldown", shouldClassifyForReply({
    ...baseContact,
    lastWatchdogAt: new Date(Date.now() - 13 * 60 * 60_000).toISOString()
  }) === true);
  assertSelfTest("blocks queued messages", shouldClassifyForReply({ ...baseContact, queuedTotal: 1 }) === false);
  assertSelfTest("blocks when bot is paused", shouldClassifyForReply({ ...baseContact, botPaused: true }) === false);
  assertSelfTest("blocks when outbound is newer", shouldClassifyForReply({
    ...baseContact,
    lastOutboundAt: new Date(Date.now() - 1 * 60_000).toISOString()
  }) === false);

  const reply = replyForDecision(baseContact, {
    action: "ask_meeting_time",
    confidence: 0.99,
    reason: "horario fora do comercial"
  });
  assertSelfTest("builds meeting time reply for matching stage", reply?.marker?.startsWith("ollama_watchdog:ask_meeting_time:"));
  assertSelfTest("blocks low confidence reply", replyForDecision(baseContact, {
    action: "ask_meeting_time",
    confidence: 0.2,
    reason: ""
  }) === null);
  assertSelfTest("blocks action mismatch", replyForDecision({ ...baseContact, stage: "awaiting_interest" }, {
    action: "ask_meeting_time",
    confidence: 0.99,
    reason: ""
  }) === null);
  assertSelfTest("builds guardian reply only for guardian stage", replyForDecision({
    ...baseContact,
    stage: "awaiting_guardian_confirmation"
  }, {
    action: "ask_guardian",
    confidence: 0.99,
    reason: "responsavel ainda nao confirmado"
  })?.marker?.startsWith("ollama_watchdog:ask_guardian:"));

  console.log(JSON.stringify({
    ok: true,
    checks: 10,
    watchdogReplyCooldownMinutes
  }, null, 2));
}

function assertSelfTest(name, ok) {
  if (!ok) {
    throw new Error(`watchdog self-test failed: ${name}`);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
