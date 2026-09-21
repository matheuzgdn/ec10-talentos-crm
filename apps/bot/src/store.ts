import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, type LeadStatus, type ServiceInterest } from "@crm/shared";
import { Pool, type PoolClient } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { config, hasDirectDatabaseConfig, hasServerSupabaseConfig, runtimeKeyForInstance } from "./config.js";

export type OutboundMessage = {
  id: string;
  client_id: string;
  bot_instance_id: string;
  phone: string;
  body: string | null;
  media_type: "text" | "audio" | "audio_file" | "image" | "video" | "document" | "poll";
  media_path: string | null;
  media_mime_type: string | null;
  media_file_name: string | null;
  media_size_bytes: number | null;
  whatsapp_message_id: string | null;
  whatsapp_ack: number | null;
  whatsapp_send_attempts: number;
};

type WhatsAppDeliveryInfo = {
  whatsappMessageId?: string | null;
  whatsappChatId?: string | null;
  whatsappAck?: number | null;
};

export type ClientAutomationState = {
  id: string;
  bot_instance_id: string;
  phone: string;
  name: string | null;
  bot_paused: boolean;
  tags: string[];
  source: "whatsapp" | "manual" | "indicacao" | "site";
  service_interest: ServiceInterest;
  athlete_age?: number | null;
  traffic_source: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  fbclid: string | null;
  attribution_metadata: Record<string, unknown> | null;
};

export type BotRule = {
  id: string;
  name: string;
  trigger: string;
  response_text: string | null;
  response_audio_path: string | null;
  priority: number;
  once_per_client: boolean;
  cooldown_minutes: number;
};

export type BotConversationStage =
  | "awaiting_interest"
  | "awaiting_role"
  | "awaiting_age"
  | "awaiting_foundation_status"
  | "awaiting_guardian_confirmation"
  | "awaiting_meeting_date"
  | "awaiting_meeting_time"
  | "awaiting_booking_completion"
  | "completed";

export type BotConversationState = {
  id: string;
  client_id: string;
  phone: string;
  stage: BotConversationStage;
  role_answer: string | null;
  athlete_age: number | null;
  age_group: string | null;
  service_interest: ServiceInterest | null;
  lead_page_url: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
};

export type Ec10MeetingRoute = "plano_internacional" | "plano_carreira";

export type ClientTrafficAttribution = {
  id: string;
  phone: string;
  service_interest: ServiceInterest | null;
  lead_score: number | null;
  fbclid: string | null;
  attribution_metadata: Record<string, unknown>;
};

export type RecentClientMessage = {
  direction: "inbound" | "outbound";
  body: string | null;
  mediaType: string | null;
  createdAt: string;
};

export type IncomingWhatsAppCall = {
  whatsappCallId: string;
  phone: string;
  callType: "voice" | "video";
  startedAt: string;
  canHandleLocally?: boolean;
  webClientShouldHandle?: boolean;
};

export type BotLabWhatsappTester = {
  id: string;
  profile_id: string;
  phone: string;
  display_name: string | null;
  active: boolean;
  expires_at: string;
  metadata: Record<string, unknown>;
};

export type BotLabWhatsappSession = {
  id: string;
  created_by: string;
  current_stage: string;
  athlete_age: number | null;
  speaker_role: "responsavel" | "atleta" | "outro";
  service_interest: ServiceInterest | null;
  metadata: Record<string, unknown>;
};

export type BotLabWhatsappMessage = {
  direction: "user" | "assistant";
  body: string;
  stage: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

let client: SupabaseClient<any, any, any, any, any> | null = null;
let pool: Pool | null = null;
let botDedupeTableReady = false;
// BOT_DB_SCHEMA is validated as an SQL identifier in config.ts. Quoting it
// keeps the direct PostgreSQL path aligned with the PostgREST schema.
const botDbSchema = `"${config.BOT_DB_SCHEMA}"`;
let persistenceHealthCache: {
  expiresAt: number;
  value: { ok: boolean; backend: "postgres" | "supabase" | "unconfigured"; error?: string };
} | null = null;

function currentBotInstanceId() {
  return config.BOT_INSTANCE_ID;
}

function currentBotInstancePayload() {
  return {
    botInstanceId: config.BOT_INSTANCE_ID,
    botInstanceLabel: config.BOT_INSTANCE_LABEL
  };
}

export function getSupabase() {
  if (!hasServerSupabaseConfig) return null;
  if (!client) {
    client = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      db: { schema: config.BOT_DB_SCHEMA }
    });
  }
  return client;
}

const whatsappMediaPrefix = "storage:whatsapp-media/";

function whatsappMediaExtension(mimeType: string, fileName?: string | null) {
  const namedExtension = fileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  if (namedExtension) return namedExtension;
  const extensions: Record<string, string> = {
    "audio/aac": "aac", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "audio/webm": "webm",
    "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv"
  };
  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
  return extensions[normalizedMimeType] || "bin";
}

function safeWhatsappFileName(value: string | null | undefined, fallback: string) {
  const normalized = String(value || fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

export async function storeInboundWhatsappMedia(input: {
  clientId: string;
  whatsappMessageId: string;
  mediaType: string;
  mimeType: string;
  base64Data: string;
  fileName?: string | null;
}) {
  const supabase = getSupabase();
  if (!supabase || !input.base64Data) return null;

  const normalizedMimeType = input.mimeType.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
  const extension = whatsappMediaExtension(normalizedMimeType, input.fileName);
  const fileName = safeWhatsappFileName(input.fileName, `whatsapp-${Date.now()}.${extension}`);
  const storagePath = `${input.clientId}/inbound/${Date.now()}-${randomUUID()}-${fileName}`;
  const buffer = Buffer.from(input.base64Data, "base64");
  const { error: uploadError } = await supabase.storage
    .from("whatsapp-media")
    .upload(storagePath, buffer, { contentType: normalizedMimeType, upsert: false });
  if (uploadError) throw uploadError;

  const mediaPath = `${whatsappMediaPrefix}${storagePath}`;
  const { error: updateError } = await supabase
    .from("messages")
    .update({
      media_path: mediaPath,
      media_mime_type: normalizedMimeType,
      media_file_name: fileName,
      media_size_bytes: buffer.byteLength
    })
    .eq("client_id", input.clientId)
    .eq("direction", "inbound")
    .eq("whatsapp_message_id", input.whatsappMessageId);
  if (updateError) throw updateError;

  return { mediaPath, mimeType: normalizedMimeType, fileName, sizeBytes: buffer.byteLength };
}

export async function downloadWhatsappMedia(mediaPath: string, fallbackMimeType?: string | null, fallbackFileName?: string | null) {
  if (!mediaPath.startsWith(whatsappMediaPrefix)) return null;
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase Storage is not configured.");

  const storagePath = mediaPath.slice(whatsappMediaPrefix.length);
  const { data, error } = await supabase.storage.from("whatsapp-media").download(storagePath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  const fileName = safeWhatsappFileName(fallbackFileName, storagePath.split("/").at(-1) || "whatsapp-file");
  return {
    base64Data: Buffer.from(arrayBuffer).toString("base64"),
    mimeType: fallbackMimeType || data.type || "application/octet-stream",
    fileName
  };
}

function getDatabase() {
  if (!hasDirectDatabaseConfig) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: config.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

export async function checkBotPersistenceHealth(force = false) {
  const now = Date.now();
  if (!force && persistenceHealthCache && persistenceHealthCache.expiresAt > now) {
    return persistenceHealthCache.value;
  }

  let value: { ok: boolean; backend: "postgres" | "supabase" | "unconfigured"; error?: string };
  try {
    const database = getDatabase();
    if (database) {
      await database.query(`select 1 from ${botDbSchema}.clients limit 1`);
      value = { ok: true, backend: "postgres" };
    } else {
      const supabase = getSupabase();
      if (!supabase) {
        value = { ok: false, backend: "unconfigured", error: "persistence_unconfigured" };
      } else {
        const { error } = await supabase.from("clients").select("id", { head: true, count: "estimated" });
        if (error) throw error;
        value = { ok: true, backend: "supabase" };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    value = {
      ok: false,
      backend: hasDirectDatabaseConfig ? "postgres" : (hasServerSupabaseConfig ? "supabase" : "unconfigured"),
      error: /exceed_egress_quota/i.test(message) ? "exceed_egress_quota" : "persistence_unavailable",
    };
  }
  persistenceHealthCache = { expiresAt: now + 10_000, value };
  return value;
}

export async function fetchEc10LearningBase() {
  const database = getDatabase();
  const supabase = getSupabase();
  if (database) {
    const reviewers = await database.query("select id from public.profiles where is_active=true and (lower(email)=$1 or role in ('admin','superadmin'))", ['matheusgdn94@gmail.com']);
    const ids = reviewers.rows.map((item) => item.id).filter(Boolean);
    if (!ids.length) throw new Error('EC10 learning reviewers unavailable');
    const examples = await database.query("select * from public.bot_training_examples where reviewed_by = any($1::text[]) and rating in ('approved','corrected') order by updated_at desc limit 1000", [ids]);
    const materials = await database.query("select title,summary,raw_content,analysis,status from public.bot_lab_materials where created_by = any($1::text[]) and status='active' order by updated_at desc limit 100", [ids]);
    return { examples: examples.rows, materials: materials.rows };
  }
  if (!supabase) throw new Error('EC10 learning storage unavailable');
  const reviewers = await supabase.schema('public').from('profiles').select('id,role,email').eq('is_active', true).or('role.in.(admin,superadmin),email.ilike.matheusgdn94@gmail.com');
  const ids = (reviewers.data ?? []).map((item) => item.id).filter(Boolean);
  if (reviewers.error || !ids.length) throw new Error('EC10 learning reviewers unavailable');
  const [examples, materials] = await Promise.all([
    supabase.schema('public').from('bot_training_examples').select('*').in('reviewed_by', ids).in('rating', ['approved','corrected']).order('updated_at', {ascending:false}).limit(1000),
    supabase.schema('public').from('bot_lab_materials').select('title,summary,raw_content,analysis,status').in('created_by', ids).eq('status','active').order('updated_at',{ascending:false}).limit(100),
  ]);
  if (examples.error || materials.error) throw new Error('EC10 learning read failed');
  return { examples: examples.data || [], materials: materials.data || [] };
}

export async function findActiveBotLabWhatsappTester(phoneInput: string): Promise<BotLabWhatsappTester | null> {
  const phone = normalizePhone(phoneInput, config.BOT_DEFAULT_COUNTRY_CODE);
  const candidates = phoneLookupCandidates(phone);
  const database = getDatabase();
  const supabase = getSupabase();
  if (!phone || (!database && !supabase)) return null;

  if (database) {
    try {
      const { rows } = await database.query<BotLabWhatsappTester>(`
        select id, profile_id, phone, display_name, active, expires_at, metadata
        from public.bot_lab_whatsapp_testers
        where phone = any($1::text[])
          and active = true
          and expires_at > now()
        order by updated_at desc
        limit 1
      `, [candidates]);
      return rows[0] ?? null;
    } catch (error) {
      if ((error as { code?: string })?.code === "42P01") return null;
      throw error;
    }
  }

  const { data, error } = await supabase!.schema("public")
    .from("bot_lab_whatsapp_testers")
    .select("id, profile_id, phone, display_name, active, expires_at, metadata")
    .in("phone", candidates)
    .eq("active", true)
    .gt("expires_at", new Date().toISOString())
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    if (error.code === "42P01") return null;
    throw error;
  }
  return (data?.[0] as BotLabWhatsappTester | undefined) ?? null;
}

export async function getOrCreateBotLabWhatsappSession(
  tester: BotLabWhatsappTester
): Promise<BotLabWhatsappSession> {
  const database = getDatabase();
  const supabase = getSupabase();
  if (!database && !supabase) throw new Error("WhatsApp test storage unavailable");

  if (database) {
    const existing = await database.query<BotLabWhatsappSession>(`
      select id, created_by, current_stage, athlete_age, speaker_role, service_interest, metadata
      from public.bot_lab_sessions
      where created_by = $1
        and status = 'active'
        and metadata->>'channel' = 'whatsapp'
        and metadata->>'testerId' = $2
      order by updated_at desc
      limit 1
    `, [tester.profile_id, tester.id]);
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await database.query<BotLabWhatsappSession>(`
      insert into public.bot_lab_sessions
        (created_by, name, status, current_stage, speaker_role, system_version, metadata)
      values
        ($1, $2, 'active', 'discovery', 'outro', 'gustavo-whatsapp-test-v1', $3::jsonb)
      returning id, created_by, current_stage, athlete_age, speaker_role, service_interest, metadata
    `, [
      tester.profile_id,
      `Teste WhatsApp - ${tester.display_name || tester.phone.slice(-4)}`,
      JSON.stringify({ channel: "whatsapp", testerId: tester.id, isolated: true, realActions: 0, aiProfile: {} })
    ]);
    return inserted.rows[0];
  }

  const recent = await supabase!.schema("public").from("bot_lab_sessions")
    .select("id, created_by, current_stage, athlete_age, speaker_role, service_interest, metadata")
    .eq("created_by", tester.profile_id)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(20);
  if (recent.error) throw recent.error;
  const existing = (recent.data ?? []).find((item: any) => (
    item.metadata?.channel === "whatsapp" && item.metadata?.testerId === tester.id
  ));
  if (existing) return existing as BotLabWhatsappSession;
  const created = await supabase!.schema("public").from("bot_lab_sessions").insert({
    created_by: tester.profile_id,
    name: `Teste WhatsApp - ${tester.display_name || tester.phone.slice(-4)}`,
    status: "active",
    current_stage: "discovery",
    speaker_role: "outro",
    system_version: "gustavo-whatsapp-test-v1",
    metadata: { channel: "whatsapp", testerId: tester.id, isolated: true, realActions: 0, aiProfile: {} }
  }).select("id, created_by, current_stage, athlete_age, speaker_role, service_interest, metadata").single();
  if (created.error) throw created.error;
  return created.data as BotLabWhatsappSession;
}

export async function fetchBotLabWhatsappMessages(sessionId: string, limit = 24): Promise<BotLabWhatsappMessage[]> {
  const database = getDatabase();
  const supabase = getSupabase();
  const safeLimit = Math.max(1, Math.min(60, Math.round(limit)));
  if (!database && !supabase) return [];
  if (database) {
    const { rows } = await database.query<BotLabWhatsappMessage>(`
      select direction, body, stage, created_at, metadata
      from public.bot_lab_messages
      where session_id = $1
      order by created_at desc
      limit $2
    `, [sessionId, safeLimit]);
    return rows.reverse();
  }
  const result = await supabase!.schema("public").from("bot_lab_messages")
    .select("direction, body, stage, created_at, metadata")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (result.error) throw result.error;
  return ((result.data ?? []) as BotLabWhatsappMessage[]).reverse();
}

export async function recordBotLabWhatsappMessage(input: {
  sessionId: string;
  direction: "user" | "assistant";
  body: string;
  stage: string;
  whatsappMessageId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const database = getDatabase();
  const supabase = getSupabase();
  if (!database && !supabase) return false;
  const whatsappMessageId = input.whatsappMessageId?.trim() || null;
  const metadata = {
    isolated: true,
    channel: "whatsapp",
    realActions: 0,
    ...(whatsappMessageId ? { whatsappMessageId } : {}),
    ...(input.metadata ?? {})
  };

  if (database) {
    if (whatsappMessageId) {
      const duplicate = await database.query(`
        select id from public.bot_lab_messages
        where session_id = $1
          and direction = $2
          and metadata->>'whatsappMessageId' = $3
        limit 1
      `, [input.sessionId, input.direction, whatsappMessageId]);
      if (duplicate.rowCount) return false;
    }
    await database.query(`
      insert into public.bot_lab_messages
        (session_id, direction, body, stage, metadata)
      values ($1, $2, $3, $4, $5::jsonb)
    `, [input.sessionId, input.direction, input.body, input.stage, JSON.stringify(metadata)]);
    return true;
  }

  if (whatsappMessageId) {
    const duplicate = await supabase!.schema("public").from("bot_lab_messages")
      .select("id")
      .eq("session_id", input.sessionId)
      .eq("direction", input.direction)
      .contains("metadata", { whatsappMessageId })
      .limit(1);
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data?.length) return false;
  }
  const inserted = await supabase!.schema("public").from("bot_lab_messages").insert({
    session_id: input.sessionId,
    direction: input.direction,
    body: input.body,
    stage: input.stage,
    metadata
  });
  if (inserted.error) throw inserted.error;
  return true;
}

export async function updateBotLabWhatsappSession(input: {
  sessionId: string;
  stage: string;
  athleteAge?: number | null;
  speakerRole?: "responsavel" | "atleta" | "outro";
  serviceInterest?: ServiceInterest | null;
  metadata: Record<string, unknown>;
}) {
  const database = getDatabase();
  const supabase = getSupabase();
  if (!database && !supabase) return;
  if (database) {
    await database.query(`
      update public.bot_lab_sessions
      set current_stage = $2,
          athlete_age = $3,
          speaker_role = $4,
          service_interest = $5,
          metadata = $6::jsonb,
          updated_at = now()
      where id = $1
    `, [input.sessionId, input.stage, input.athleteAge ?? null, input.speakerRole ?? "outro", input.serviceInterest ?? null, JSON.stringify(input.metadata)]);
    return;
  }
  const result = await supabase!.schema("public").from("bot_lab_sessions").update({
    current_stage: input.stage,
    athlete_age: input.athleteAge ?? null,
    speaker_role: input.speakerRole ?? "outro",
    service_interest: input.serviceInterest ?? null,
    metadata: input.metadata,
    updated_at: new Date().toISOString()
  }).eq("id", input.sessionId);
  if (result.error) throw result.error;
}

export async function touchBotLabWhatsappTester(testerId: string, result: string) {
  const database = getDatabase();
  const supabase = getSupabase();
  if (!database && !supabase) return;
  if (database) {
    await database.query(`
      update public.bot_lab_whatsapp_testers
      set last_message_at = now(), last_result = $2, updated_at = now()
      where id = $1
    `, [testerId, result.slice(0, 120)]);
    return;
  }
  const update = await supabase!.schema("public").from("bot_lab_whatsapp_testers").update({
    last_message_at: new Date().toISOString(),
    last_result: result.slice(0, 120),
    updated_at: new Date().toISOString()
  }).eq("id", testerId);
  if (update.error) throw update.error;
}

function phoneLookupCandidates(phone: string) {
  const candidates = new Set<string>();
  if (phone) candidates.add(phone);

  if (phone.startsWith(config.BOT_DEFAULT_COUNTRY_CODE)) {
    const countryLength = config.BOT_DEFAULT_COUNTRY_CODE.length;
    const national = phone.slice(countryLength);
    if (national.length === 11 && national[2] === "9") {
      candidates.add(`${config.BOT_DEFAULT_COUNTRY_CODE}${national.slice(0, 2)}${national.slice(3)}`);
    }
    if (national.length === 10) {
      candidates.add(`${config.BOT_DEFAULT_COUNTRY_CODE}${national.slice(0, 2)}9${national.slice(2)}`);
    }
  }

  return [...candidates];
}

function testAllowedPhoneCandidates() {
  return [...new Set(config.BOT_TEST_ALLOWED_PHONES.split(',')
    .map(phone=>normalizePhone(phone.trim(),config.BOT_DEFAULT_COUNTRY_CODE))
    .filter(Boolean).flatMap(phone=>phoneLookupCandidates(phone)))];
}

function normalizeMessageDedupeBody(body?: string | null) {
  return body?.trim().replace(/\s+/g, " ").toLowerCase() || null;
}

async function ensureBotDedupeTable(database: Pool | PoolClient) {
  if (botDedupeTableReady) return;

  await database.query(`
    create table if not exists ${botDbSchema}.bot_dedupe_locks (
      key text primary key,
      scope text not null,
      client_id uuid null,
      phone text null,
      expires_at timestamptz not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await database.query(`
    create index if not exists bot_dedupe_locks_expires_at_idx
      on ${botDbSchema}.bot_dedupe_locks (expires_at)
  `);
  await database.query(`
    with ranked as (
      select id,
             row_number() over (
               partition by whatsapp_message_id
               order by created_at asc, id asc
             ) as rn
      from ${botDbSchema}.messages
      where direction = 'inbound'
        and nullif(whatsapp_message_id, '') is not null
        and whatsapp_message_id not like '%:duplicate:%'
    )
    update ${botDbSchema}.messages m
    set whatsapp_message_id = concat(m.whatsapp_message_id, ':duplicate:', m.id::text)
    from ranked
    where ranked.id = m.id
      and ranked.rn > 1
  `);
  await database.query(`
    create unique index if not exists messages_inbound_whatsapp_message_id_unique
      on ${botDbSchema}.messages (whatsapp_message_id)
      where direction = 'inbound'
        and nullif(whatsapp_message_id, '') is not null
  `);
  botDedupeTableReady = true;
}

async function tryAcquireDatabaseDedupeLock(
  database: Pool | PoolClient,
  input: {
    key: string;
    scope: string;
    clientId?: string | null;
    phone?: string | null;
    ttlSeconds: number;
    metadata?: Record<string, unknown>;
  }
) {
  await ensureBotDedupeTable(database);
  await database.query(`delete from ${botDbSchema}.bot_dedupe_locks where expires_at < now()`);
  const ttlSeconds = Math.max(1, Math.round(input.ttlSeconds));
  const { rowCount } = await database.query(
    `
      insert into ${botDbSchema}.bot_dedupe_locks
        (key, scope, client_id, phone, expires_at, metadata, updated_at)
      values
        ($1, $2, $3, $4, now() + make_interval(secs => $5::int), $6::jsonb, now())
      on conflict (key)
      do update set
        scope = excluded.scope,
        client_id = excluded.client_id,
        phone = excluded.phone,
        expires_at = excluded.expires_at,
        metadata = excluded.metadata,
        updated_at = now()
      where ${botDbSchema}.bot_dedupe_locks.expires_at < now()
    `,
    [
      input.key,
      input.scope,
      input.clientId ?? null,
      input.phone ?? null,
      ttlSeconds,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return Number(rowCount ?? 0) > 0;
}

export async function tryAcquireBotDedupeLock(input: {
  key: string;
  scope: string;
  clientId?: string | null;
  phone?: string | null;
  ttlSeconds: number;
  metadata?: Record<string, unknown>;
}) {
  const database = getDatabase();
  if (!database) return true;
  return tryAcquireDatabaseDedupeLock(database, input);
}

async function findClientByPhoneCandidates(database: Pool, phone: string) {
  const candidates = phoneLookupCandidates(phone);
  const { rows } = await database.query<ClientAutomationState>(
    `
      select id, bot_instance_id, phone, name, bot_paused, tags,
             source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata
      from ${botDbSchema}.clients
      where phone = any($1::text[])
      order by
        case when bot_instance_id = $3 then 0 else 1 end,
        case when coalesce(tags, '{}') @> array['campanha_revela_prioritario']::text[] then 0 else 1 end,
        case when phone = $2 then 0 else 1 end,
        updated_at desc nulls last,
        created_at desc
      limit 1
    `,
    [candidates, phone, currentBotInstanceId()]
  );
  return rows[0] ?? null;
}

export async function recordTrafficEvent(input: {
  clientId?: string | null;
  phone?: string | null;
  eventType: string;
  channel?: string;
  platform?: string;
  serviceInterest?: ServiceInterest | null;
  athleteAge?: number | null;
  ageGroup?: string | null;
  leadStatus?: string | null;
  qualityScore?: number | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;

  const payload = {
    client_id: input.clientId ?? null,
    bot_instance_id: currentBotInstanceId(),
    phone: input.phone ?? null,
    event_type: input.eventType,
    channel: input.channel ?? "whatsapp",
    platform: input.platform ?? "meta_ads",
    service_interest: input.serviceInterest ?? null,
    athlete_age: input.athleteAge ?? null,
    age_group: input.ageGroup ?? null,
    lead_status: input.leadStatus ?? null,
    quality_score: input.qualityScore ?? null,
    campaign_id: input.campaignId ?? null,
    campaign_name: input.campaignName ?? null,
    adset_id: input.adsetId ?? null,
    ad_id: input.adId ?? null,
    metadata: input.metadata ?? {}
  };

  try {
    if (database) {
      await database.query(
        `
          insert into ${botDbSchema}.traffic_events
            (client_id, bot_instance_id, phone, event_type, channel, platform, service_interest,
             athlete_age, age_group, lead_status, quality_score, campaign_id,
             campaign_name, adset_id, ad_id, metadata)
          values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
        `,
        [
          payload.client_id,
          payload.bot_instance_id,
          payload.phone,
          payload.event_type,
          payload.channel,
          payload.platform,
          payload.service_interest,
          payload.athlete_age,
          payload.age_group,
          payload.lead_status,
          payload.quality_score,
          payload.campaign_id,
          payload.campaign_name,
          payload.adset_id,
          payload.ad_id,
          JSON.stringify(payload.metadata)
        ]
      );
      return;
    }

    if (!supabase) return;

    const { error } = await supabase.from("traffic_events").insert(payload);
    if (error) throw error;
  } catch (error) {
    console.warn("Failed to record traffic event", error instanceof Error ? error.message : String(error));
  }
}

export async function getClientTrafficAttribution(clientId: string): Promise<ClientTrafficAttribution | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return null;

  if (database) {
    const { rows } = await database.query<ClientTrafficAttribution>(
      `
        select id, phone, service_interest, lead_score, fbclid, attribution_metadata
        from ${botDbSchema}.clients
        where id = $1
        limit 1
      `,
      [clientId]
    );
    return rows[0] ?? null;
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("id, phone, service_interest, lead_score, fbclid, attribution_metadata")
    .eq("id", clientId)
    .limit(1)
    .single();

  if (error) throw error;
  return data as ClientTrafficAttribution;
}

export async function upsertInboundMessage(input: {
  phone: string;
  name?: string | null;
  body?: string | null;
  mediaType: string;
  whatsappMessageId: string;
}): Promise<ClientAutomationState | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  const phone = normalizePhone(input.phone, config.BOT_DEFAULT_COUNTRY_CODE);
  const botInstanceId = currentBotInstanceId();
  const whatsappMessageId = input.whatsappMessageId?.trim() ?? "";
  const inboundBody = input.body?.trim() || null;
  const inboundDedupeBody = normalizeMessageDedupeBody(inboundBody);

  if (!supabase && !database) {
    console.log("[dry-run] inbound", { ...input, phone });
    return null;
  }

  if (database) {
    await ensureBotDedupeTable(database);
    const connection = await database.connect();
    try {
      await connection.query("begin");
      const candidates = phoneLookupCandidates(phone);
      if (whatsappMessageId) {
        const acquired = await tryAcquireDatabaseDedupeLock(connection, {
          key: `whatsapp:${botInstanceId}:inbound:id:${whatsappMessageId}`,
          scope: "whatsapp_inbound",
          phone,
          ttlSeconds: 7 * 24 * 60 * 60,
          metadata: { botInstanceId, mediaType: input.mediaType, whatsappMessageId }
        });
        if (!acquired) {
          await connection.query(
            `
              insert into ${botDbSchema}.traffic_events
                (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
              values
                (null, $1, $2, 'whatsapp_inbound_duplicate_suppressed', 'whatsapp', 'whatsapp', $3::jsonb)
            `,
            [
              botInstanceId,
              phone,
              JSON.stringify({
                botInstanceId,
                mediaType: input.mediaType,
                whatsappMessageId,
                hasText: Boolean(inboundBody),
                reason: "dedupe_lock_whatsapp_message_id"
              })
            ]
          );
          await connection.query("commit");
          return null;
        }
        await connection.query("select pg_advisory_xact_lock(hashtext($1))", [`${botInstanceId}:${whatsappMessageId}`]);
      }
      if (inboundDedupeBody) {
        const acquired = await tryAcquireDatabaseDedupeLock(connection, {
          key: `whatsapp:${botInstanceId}:inbound:body:${phone}:${input.mediaType}:${inboundDedupeBody}`,
          scope: "whatsapp_inbound",
          phone,
          ttlSeconds: 90,
          metadata: {
            botInstanceId,
            mediaType: input.mediaType,
            whatsappMessageId: whatsappMessageId || null,
            body: inboundBody
          }
        });
        if (!acquired) {
          await connection.query(
            `
              insert into ${botDbSchema}.traffic_events
                (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
              values
                (null, $1, $2, 'whatsapp_inbound_duplicate_suppressed', 'whatsapp', 'whatsapp', $3::jsonb)
            `,
            [
              botInstanceId,
              phone,
              JSON.stringify({
                botInstanceId,
                mediaType: input.mediaType,
                whatsappMessageId: whatsappMessageId || null,
                hasText: Boolean(inboundBody),
                reason: "dedupe_lock_recent_same_body"
              })
            ]
          );
          await connection.query("commit");
          return null;
        }
        await connection.query("select pg_advisory_xact_lock(hashtext($1))", [
          `inbound:${botInstanceId}:${phone}:${input.mediaType}:${inboundDedupeBody}`
        ]);
      }

      if (whatsappMessageId || inboundDedupeBody) {
        const duplicate = await connection.query<{
          id: string;
          client_id: string;
          body: string | null;
          same_whatsapp_id: boolean;
        }>(
          `
            select m.id, m.client_id, m.body,
                   ($1::text <> '' and m.whatsapp_message_id = $1::text) as same_whatsapp_id
            from ${botDbSchema}.messages m
            join ${botDbSchema}.clients c on c.id = m.client_id
            where m.direction = 'inbound'
              and m.bot_instance_id = $5
              and (
                ($1::text <> '' and m.whatsapp_message_id = $1::text)
                or (
                  $2::text is not null
                  and c.phone = any($3::text[])
                  and m.media_type = $4::text
                  and regexp_replace(lower(trim(coalesce(m.body, ''))), '[[:space:]]+', ' ', 'g') = $2::text
                  and m.created_at >= now() - interval '90 seconds'
                )
              )
            order by
              case when $1::text <> '' and m.whatsapp_message_id = $1::text then 0 else 1 end,
              m.created_at asc
            limit 1
          `,
          [whatsappMessageId, inboundDedupeBody, candidates, input.mediaType, botInstanceId]
        );

        const existingMessage = duplicate.rows[0];
        if (existingMessage) {
          if (existingMessage.same_whatsapp_id && inboundBody && !(existingMessage.body ?? "").trim()) {
            await connection.query(
              `
                update ${botDbSchema}.messages
                set body = $2,
                    media_type = $3
                where id = $1
              `,
              [existingMessage.id, inboundBody, input.mediaType]
            );
            const clientRow = await connection.query<ClientAutomationState>(
              `
                update ${botDbSchema}.clients
                set name = coalesce($2, ${botDbSchema}.clients.name),
                    last_message_at = now(),
                    updated_at = now()
                where id = $1
                returning id, bot_instance_id, phone, name, bot_paused, tags,
                          source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata
              `,
              [existingMessage.client_id, input.name ?? null]
            );
            await connection.query(
              `
                insert into ${botDbSchema}.traffic_events
                  (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
                values
                  ($1, $2, $3, 'whatsapp_inbound_transcript_updated', 'whatsapp', 'whatsapp', $4::jsonb)
              `,
              [
                existingMessage.client_id,
                botInstanceId,
                phone,
                JSON.stringify({ botInstanceId, mediaType: input.mediaType, whatsappMessageId })
              ]
            );
            await connection.query("commit");
            return clientRow.rows[0] ?? null;
          }

          await connection.query(
            `
              insert into ${botDbSchema}.traffic_events
                (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
              values
                ($1, $2, $3, 'whatsapp_inbound_duplicate_suppressed', 'whatsapp', 'whatsapp', $4::jsonb)
            `,
            [
              existingMessage.client_id,
              botInstanceId,
              phone,
              JSON.stringify({
                botInstanceId,
                mediaType: input.mediaType,
                whatsappMessageId: whatsappMessageId || null,
                hasText: Boolean(inboundBody),
                reason: existingMessage.same_whatsapp_id ? "same_whatsapp_message_id" : "recent_same_body"
              })
            ]
          );
          await connection.query("commit");
          return null;
        }
      }

      const existingClient = await connection.query<ClientAutomationState>(
        `
          select id, bot_instance_id, phone, name, bot_paused, tags,
                 source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata
          from ${botDbSchema}.clients
          where phone = any($1::text[])
          order by
            case when bot_instance_id = $3 then 0 else 1 end,
            case when coalesce(tags, '{}') @> array['campanha_revela_prioritario']::text[] then 0 else 1 end,
            case when phone = $2 then 0 else 1 end,
            updated_at desc nulls last,
            created_at desc
          limit 1
        `,
        [candidates, phone, botInstanceId]
      );

      const clientRow = existingClient.rows[0]
        ? await connection.query<ClientAutomationState>(
            `
              update ${botDbSchema}.clients
              set name = coalesce($2, ${botDbSchema}.clients.name),
                  last_message_at = now(),
                  updated_at = now()
              where id = $1
              returning id, bot_instance_id, phone, name, bot_paused, tags,
                        source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata
            `,
            [existingClient.rows[0].id, input.name ?? null]
          )
        : await connection.query<ClientAutomationState>(
            `
              insert into ${botDbSchema}.clients (bot_instance_id, phone, name, last_message_at, updated_at, status, source, service_interest, tags)
              values ($3, $1, $2, now(), now(), 'novo', 'whatsapp', 'plano_carreira', array['entrada_direta_whatsapp']::text[])
              on conflict (phone)
              do update set
                name = coalesce(excluded.name, ${botDbSchema}.clients.name),
                last_message_at = excluded.last_message_at,
                updated_at = now()
              returning id, bot_instance_id, phone, name, bot_paused, tags,
                        source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata
            `,
            [phone, input.name ?? null, botInstanceId]
          );

      const insertedMessage = await connection.query<{ id: string }>(
        `
          insert into ${botDbSchema}.messages
            (client_id, bot_instance_id, direction, body, media_type, whatsapp_message_id)
          values ($1, $5, 'inbound', $2, $3, $4)
          on conflict do nothing
          returning id
        `,
        [clientRow.rows[0].id, inboundBody, input.mediaType, whatsappMessageId || null, botInstanceId]
      );
      if (!insertedMessage.rows.length) {
        await connection.query(
          `
            insert into ${botDbSchema}.traffic_events
              (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
            values
              ($1, $2, $3, 'whatsapp_inbound_duplicate_suppressed', 'whatsapp', 'whatsapp', $4::jsonb)
          `,
          [
            clientRow.rows[0].id,
            botInstanceId,
            phone,
            JSON.stringify({
              botInstanceId,
              mediaType: input.mediaType,
              whatsappMessageId: whatsappMessageId || null,
              hasText: Boolean(inboundBody),
              reason: "messages_unique_conflict"
            })
          ]
        );
        await connection.query("commit");
        return null;
      }
      await connection.query(
        `
          insert into ${botDbSchema}.traffic_events
            (client_id, bot_instance_id, phone, event_type, channel, platform, metadata)
          values
            ($1, $2, $3, 'whatsapp_inbound', 'whatsapp', 'whatsapp', $4::jsonb)
        `,
        [
          clientRow.rows[0].id,
          botInstanceId,
          phone,
          JSON.stringify({ botInstanceId, mediaType: input.mediaType, hasText: Boolean(inboundBody), whatsappMessageId: whatsappMessageId || null })
        ]
      );
      await connection.query("commit");
      return clientRow.rows[0];
    } catch (error) {
      await connection.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  if (!supabase) return null;

  const candidates = phoneLookupCandidates(phone);
  const clientSelect = "id, bot_instance_id, phone, name, bot_paused, tags, source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata";
  const { data: matchingClients, error: matchingClientsError } = await supabase
    .from("clients")
    .select(clientSelect)
    .in("phone", candidates)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (matchingClientsError) throw matchingClientsError;

  let clientRow: ClientAutomationState;
  const existingClient = matchingClients?.[0] as ClientAutomationState | undefined;
  if (existingClient) {
    const existingUpdate: Record<string, unknown> = {
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (input.name) existingUpdate.name = input.name;
    const { data, error } = await supabase
      .from("clients")
      .update(existingUpdate)
      .eq("id", existingClient.id)
      .select(clientSelect)
      .single();
    if (error) throw error;
    clientRow = data as ClientAutomationState;
  } else {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        bot_instance_id: botInstanceId,
        phone,
        name: input.name ?? null,
        source: "whatsapp",
        service_interest: "nao_definido",
        tags: ["entrada_direta_whatsapp"],
        last_message_at: new Date().toISOString()
      })
      .select(clientSelect)
      .single();
    if (error) throw error;
    clientRow = data as ClientAutomationState;
  }

  if (whatsappMessageId) {
    const { data: existingMessage, error: duplicateReadError } = await supabase
      .from("messages")
      .select("id, body")
      .eq("direction", "inbound")
      .eq("bot_instance_id", botInstanceId)
      .eq("whatsapp_message_id", whatsappMessageId)
      .limit(1);

    if (duplicateReadError) throw duplicateReadError;
    const duplicate = existingMessage?.[0];
    if (duplicate) {
      if (inboundBody && !String((duplicate as any).body ?? "").trim()) {
        const { error: updateDuplicateError } = await supabase
          .from("messages")
          .update({ body: inboundBody, media_type: input.mediaType })
          .eq("id", (duplicate as any).id);
        if (updateDuplicateError) throw updateDuplicateError;
        return clientRow as ClientAutomationState;
      }
      await recordTrafficEvent({
        clientId: clientRow.id,
        phone,
        eventType: "whatsapp_inbound_duplicate_suppressed",
        channel: "whatsapp",
        platform: "whatsapp",
        metadata: { botInstanceId, mediaType: input.mediaType, whatsappMessageId, hasText: Boolean(inboundBody) }
      });
      return null;
    }
  }

  if (inboundDedupeBody) {
    const { data: recentSameBody, error: recentSameBodyError } = await supabase
      .from("messages")
      .select("id")
      .eq("client_id", clientRow.id)
      .eq("bot_instance_id", botInstanceId)
      .eq("direction", "inbound")
      .eq("media_type", input.mediaType)
      .eq("body", inboundBody)
      .gte("created_at", new Date(Date.now() - 90_000).toISOString())
      .limit(1);

    if (recentSameBodyError) throw recentSameBodyError;
    if (recentSameBody?.length) {
      await recordTrafficEvent({
        clientId: clientRow.id,
        phone,
        eventType: "whatsapp_inbound_duplicate_suppressed",
        channel: "whatsapp",
        platform: "whatsapp",
        metadata: {
          botInstanceId,
          mediaType: input.mediaType,
          whatsappMessageId: whatsappMessageId || null,
          hasText: Boolean(inboundBody),
          reason: "recent_same_body"
        }
      });
      return null;
    }
  }

  const { error: messageError } = await supabase.from("messages").insert({
    client_id: clientRow.id,
    bot_instance_id: botInstanceId,
    direction: "inbound",
    body: inboundBody,
    media_type: input.mediaType,
    whatsapp_message_id: whatsappMessageId || null
  });

  if (messageError) throw messageError;

  await recordTrafficEvent({
    clientId: clientRow.id,
    phone,
    eventType: "whatsapp_inbound",
    channel: "whatsapp",
    platform: "whatsapp",
    metadata: {
      mediaType: input.mediaType,
      hasText: Boolean(inboundBody),
      whatsappMessageId: whatsappMessageId || null
    }
  });

  return clientRow;
}

export async function recordIncomingWhatsAppCall(input: IncomingWhatsAppCall) {
  const supabase = getSupabase();
  const database = getDatabase();
  const phone = normalizePhone(input.phone, config.BOT_DEFAULT_COUNTRY_CODE);
  const botInstanceId = currentBotInstanceId();
  if (!supabase && !database) {
    console.log("[dry-run] incoming WhatsApp call", { ...input, phone, botInstanceId });
    return;
  }

  const metadata = {
    canHandleLocally: Boolean(input.canHandleLocally),
    webClientShouldHandle: Boolean(input.webClientShouldHandle),
  };

  if (database) {
    const connection = await database.connect();
    try {
      await connection.query("begin");
      const candidates = phoneLookupCandidates(phone);
      const existing = await connection.query<{ id: string }>(
        `select id from ${botDbSchema}.clients where phone = any($1::text[]) order by updated_at desc limit 1`,
        [candidates]
      );
      const clientId = existing.rows[0]?.id ?? (
        await connection.query<{ id: string }>(
          `insert into ${botDbSchema}.clients (bot_instance_id, phone, name, status, source, service_interest, tags, updated_at)
           values ($2, $1, $3, 'novo', 'whatsapp', 'plano_carreira', array['chamada_whatsapp'], now())
           on conflict (phone) do update set updated_at = now()
           returning id`,
          [phone, botInstanceId, `Contato WhatsApp ${phone.slice(-4)}`]
        )
      ).rows[0].id;
      await connection.query(
        `insert into ${botDbSchema}.calls
          (client_id, bot_instance_id, whatsapp_call_id, phone, direction, call_type, status, started_at, metadata)
         values ($1, $2, $3, $4, 'inbound', $5, 'received', $6::timestamptz, $7::jsonb)
         on conflict (bot_instance_id, whatsapp_call_id)
         do update set status = excluded.status, metadata = ${botDbSchema}.calls.metadata || excluded.metadata`,
        [clientId, botInstanceId, input.whatsappCallId, phone, input.callType, input.startedAt, JSON.stringify(metadata)]
      );
      await connection.query("commit");
      return;
    } catch (error) {
      await connection.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  if (!supabase) return;
  const candidates = phoneLookupCandidates(phone);
  const { data: existingClients, error: readError } = await supabase
    .from("clients")
    .select("id")
    .in("phone", candidates)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (readError) throw readError;

  let clientId = existingClients?.[0]?.id as string | undefined;
  if (!clientId) {
    const { data: inserted, error: insertError } = await supabase
      .from("clients")
      .upsert({
        bot_instance_id: botInstanceId,
        phone,
        name: `Contato WhatsApp ${phone.slice(-4)}`,
        status: "novo",
        source: "whatsapp",
        service_interest: "plano_carreira",
        tags: ["chamada_whatsapp"],
        updated_at: new Date().toISOString(),
      }, { onConflict: "phone" })
      .select("id")
      .single();
    if (insertError) throw insertError;
    clientId = inserted.id;
  }

  const { error } = await supabase.from("calls").upsert({
    client_id: clientId,
    bot_instance_id: botInstanceId,
    whatsapp_call_id: input.whatsappCallId,
    phone,
    direction: "inbound",
    call_type: input.callType,
    status: "received",
    started_at: input.startedAt,
    metadata,
  }, { onConflict: "bot_instance_id,whatsapp_call_id" });
  if (error) throw error;
}

export type PendingWhatsAppPoll = { client_id: string; phone: string; whatsapp_message_id: string; created_at: string };

export async function createBotBookingLink(input:{clientId:string;service:string;name:string;role:'responsavel'|'atleta';existingUrl?:string}) {
  const database=getDatabase();
  if(input.existingUrl)try {
    const url=new URL(input.existingUrl),savedToken=url.searchParams.get('cadastro')||'';
    if(url.protocol==='https:'&&url.hostname==='ec10talentos.com'&&url.pathname==='/agendar'
      &&url.searchParams.get('servico')===input.service&&/^[A-Za-z0-9_-]{43}$/.test(savedToken)) {
      const savedHash=createHash('sha256').update(savedToken).digest('hex');
      const row=database
        ?(await database.query(`select expires_at,booking_id from ${botDbSchema}.ec10_bot_booking_links where access_token_hash=$1 and client_id=$2 and service=$3`,[savedHash,input.clientId,input.service])).rows[0]
        :(await getSupabase()!.from('ec10_bot_booking_links').select('expires_at,booking_id').eq('access_token_hash',savedHash).eq('client_id',input.clientId).eq('service',input.service).maybeSingle()).data;
      if(row&&(row.booking_id||new Date(row.expires_at).getTime()>Date.now()))return url.href;
    }
  }catch{ /* An unverifiable legacy link must never choose the confirmation destination. */ }
  const token=randomBytes(32).toString('base64url');
  const hash=createHash('sha256').update(token).digest('hex');
  if(database) await database.query(`insert into ${botDbSchema}.ec10_bot_booking_links(access_token_hash,client_id,service,contact_name,contact_role) values($1,$2,$3,$4,$5)`,[hash,input.clientId,input.service,input.name,input.role]);
  else {
    const supabase=getSupabase();
    if(!supabase)throw new Error('Booking link storage unavailable');
    const {error}=await supabase.from('ec10_bot_booking_links').insert({access_token_hash:hash,client_id:input.clientId,service:input.service,contact_name:input.name,contact_role:input.role});
    if(error)throw error;
  }
  return `https://ec10talentos.com/agendar?servico=${input.service}&cadastro=${token}`;
}

export async function fetchPendingWhatsAppPolls(limit = 200, clientId?: string): Promise<PendingWhatsAppPoll[]> {
  const allowedPhones=testAllowedPhoneCandidates();
  const database = getDatabase();
  if (database) {
    const { rows } = await database.query<PendingWhatsAppPoll>(`
      select c.id as client_id, c.phone, p.whatsapp_message_id, p.created_at
      from ${botDbSchema}.clients c
      join lateral (
        select m.whatsapp_message_id, m.created_at
        from ${botDbSchema}.messages m
        where m.client_id=c.id and m.bot_instance_id=$1
          and m.direction='outbound' and m.media_type='poll'
          and m.whatsapp_message_id is not null
        order by m.created_at desc limit 1
      ) p on true
      where c.bot_instance_id=$1 and not c.bot_paused
        and ($3::uuid is null or c.id=$3::uuid)
        and (cardinality($4::text[])=0 or c.phone=any($4::text[]))
        and p.created_at > now()-interval '7 days'
        and not exists (select 1 from ${botDbSchema}.messages newer
          where newer.client_id=c.id and newer.bot_instance_id=$1
            and newer.direction='inbound' and newer.created_at>p.created_at)
      order by p.created_at desc limit $2
    `, [currentBotInstanceId(), limit, clientId ?? null,allowedPhones]);
    return rows;
  }
  const supabase = getSupabase();
  if (!supabase) return [];
  let query = supabase.from('messages')
    .select('client_id,whatsapp_message_id,created_at,clients!inner(phone,bot_paused,last_message_at)')
    .eq('bot_instance_id', currentBotInstanceId()).eq('direction','outbound').eq('media_type','poll')
    .eq('clients.bot_paused', false)
    .not('whatsapp_message_id','is',null).gt('created_at',new Date(Date.now()-7*86400_000).toISOString())
    .order('created_at',{ascending:false}).limit(limit);
  if (clientId) query=query.eq('client_id',clientId);
  if(allowedPhones.length)query=query.in('clients.phone',allowedPhones);
  const { data, error } = await query;
  if (error) throw error;
  const pending: PendingWhatsAppPoll[] = [];
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.client_id)) continue;
    seen.add(row.client_id);
    const contact = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as any;
    // last_message_at is updated only by inbound messages; avoid N+1 requests.
    if (!contact || contact.bot_paused || (contact.last_message_at && Date.parse(contact.last_message_at)>Date.parse(row.created_at))) continue;
    pending.push({client_id:row.client_id,whatsapp_message_id:row.whatsapp_message_id!,created_at:row.created_at,phone:contact.phone});
  }
  return pending;
}

export async function fetchQueuedOutboundMessages(limit = 1): Promise<OutboundMessage[]> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return [];
  const allowedPrefixes = getOutboundAllowedPrefixes();
  const allowedPhones=testAllowedPhoneCandidates();
  const botInstanceId = currentBotInstanceId();

  if (database) {
    const { rows } = await database.query<OutboundMessage>(
      `
        select id, client_id, bot_instance_id, phone, body, media_type, media_path,
               media_mime_type, media_file_name, media_size_bytes,
               whatsapp_message_id, whatsapp_ack, whatsapp_send_attempts
        from ${botDbSchema}.outbound_messages
        where status = 'queued'
          and bot_instance_id = $3
          and (cardinality($4::text[]) = 0 or phone=any($4::text[]))
          and coalesce(scheduled_at, created_at) <= now()
          and (
            cardinality($2::text[]) = 0
            or media_path is null
            or exists (
              select 1
              from unnest($2::text[]) as allowed(prefix)
              where media_path like allowed.prefix || '%'
            )
          )
        order by coalesce(scheduled_at, created_at) asc, created_at asc
        limit $1
      `,
      [limit, allowedPrefixes, botInstanceId,allowedPhones]
    );
    return rows;
  }

  if (!supabase) return [];

  let query = supabase
    .from("outbound_messages")
    .select("id, client_id, bot_instance_id, phone, body, media_type, media_path, media_mime_type, media_file_name, media_size_bytes, whatsapp_message_id, whatsapp_ack, whatsapp_send_attempts")
    .eq("status", "queued")
    .eq("bot_instance_id", botInstanceId)
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true });
  if(allowedPhones.length)query=query.in('phone',allowedPhones);

  if (allowedPrefixes.length === 1) {
    query = query.or(`media_path.is.null,media_path.like.${allowedPrefixes[0]}%`);
  } else if (allowedPrefixes.length > 1) {
    query = query.or(["media_path.is.null", ...allowedPrefixes.map((prefix) => `media_path.like.${prefix}%`)].join(","));
  }

  const { data, error } = await query.limit(limit);

  if (error) throw error;
  return (data ?? []) as OutboundMessage[];
}

function getOutboundAllowedPrefixes() {
  return config.BOT_OUTBOUND_ALLOWED_PREFIXES
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}

export async function scheduleOutboundTextMessage(input: {
  clientId: string;
  phone: string;
  body: string;
  scheduledAt: string;
  mediaPath?: string | null;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();

  if (database) {
    await database.query(
      `
        insert into ${botDbSchema}.outbound_messages
          (client_id, bot_instance_id, phone, body, media_type, media_path, status, scheduled_at)
        select $1, $6, $2, $3, 'text', $5, 'queued', $4::timestamptz
        where not exists (
          select 1
          from ${botDbSchema}.outbound_messages
          where client_id = $1
            and bot_instance_id = $6
            and phone = $2
            and (
              ($5::text is not null and coalesce(media_path, '') = $5::text)
              or ($5::text is null and body = $3 and scheduled_at = $4::timestamptz)
            )
            and status in ('queued', 'sent')
        )
      `,
      [input.clientId, input.phone, input.body, input.scheduledAt, input.mediaPath ?? null, botInstanceId]
    );
    return;
  }

  if (!supabase) return;

  const existingQuery = supabase
    .from("outbound_messages")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("phone", input.phone)
    .in("status", ["queued", "sent"])
    .limit(1);

  if (input.mediaPath) {
    existingQuery.eq("media_path", input.mediaPath);
  } else {
    existingQuery.eq("body", input.body).eq("scheduled_at", input.scheduledAt);
  }

  const { data: existing, error: readError } = await existingQuery;

  if (readError) throw readError;
  if (existing?.length) return;

  const { error } = await supabase.from("outbound_messages").insert({
    client_id: input.clientId,
    bot_instance_id: botInstanceId,
    phone: input.phone,
    body: input.body,
    media_type: "text",
    media_path: input.mediaPath ?? null,
    status: "queued",
    scheduled_at: input.scheduledAt
  });

  if (error) throw error;
}

export async function scheduleOutboundRecoveryTextMessage(input: {
  clientId: string;
  phone: string;
  body: string;
  scheduledAt: string;
  errorMessage: string;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();
  const errorMessage = input.errorMessage.slice(0, 1000);

  if (database) {
    await database.query(
      `
        insert into ${botDbSchema}.outbound_messages
          (client_id, bot_instance_id, phone, body, media_type, status, scheduled_at,
           error_message, whatsapp_send_attempts)
        select $1, $6, $2, $3, 'text', 'queued', $4::timestamptz, $5, 1
        where not exists (
          select 1
          from ${botDbSchema}.outbound_messages
          where client_id = $1
            and bot_instance_id = $6
            and phone = $2
            and body = $3
            and status in ('queued', 'sent')
        )
      `,
      [input.clientId, input.phone, input.body, input.scheduledAt, errorMessage, botInstanceId]
    );
    return;
  }

  if (!supabase) return;
  const { data: existing, error: readError } = await supabase
    .from("outbound_messages")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("phone", input.phone)
    .eq("body", input.body)
    .in("status", ["queued", "sent"])
    .limit(1);
  if (readError) throw readError;
  if (existing?.length) return;

  const { error } = await supabase.from("outbound_messages").insert({
    client_id: input.clientId,
    bot_instance_id: botInstanceId,
    phone: input.phone,
    body: input.body,
    media_type: "text",
    media_path: null,
    status: "queued",
    scheduled_at: input.scheduledAt,
    error_message: errorMessage,
    whatsapp_send_attempts: 1
  });
  if (error) throw error;
}

export async function scheduleOutboundPollMessage(input: {
  clientId: string;
  phone: string;
  body: string;
  scheduledAt: string;
  mediaPath?: string | null;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();

  if (database) {
    await database.query(
      `
        insert into ${botDbSchema}.outbound_messages
          (client_id, bot_instance_id, phone, body, media_type, media_path, status, scheduled_at)
        select $1, $6, $2, $3, 'poll', $5, 'queued', $4::timestamptz
        where not exists (
          select 1
          from ${botDbSchema}.outbound_messages
          where client_id = $1
            and bot_instance_id = $6
            and phone = $2
            and (
              ($5::text is not null and coalesce(media_path, '') = $5::text)
              or ($5::text is null and body = $3 and scheduled_at = $4::timestamptz)
            )
            and status in ('queued', 'sent')
        )
      `,
      [input.clientId, input.phone, input.body, input.scheduledAt, input.mediaPath ?? null, botInstanceId]
    );
    return;
  }

  if (!supabase) return;

  const existingQuery = supabase
    .from("outbound_messages")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("phone", input.phone)
    .in("status", ["queued", "sent"])
    .limit(1);

  if (input.mediaPath) {
    existingQuery.eq("media_path", input.mediaPath);
  } else {
    existingQuery.eq("body", input.body).eq("scheduled_at", input.scheduledAt);
  }

  const { data: existing, error: readError } = await existingQuery;
  if (readError) throw readError;
  if (existing?.length) return;

  const { error } = await supabase.from("outbound_messages").insert({
    client_id: input.clientId,
    bot_instance_id: botInstanceId,
    phone: input.phone,
    body: input.body,
    media_type: "poll",
    media_path: input.mediaPath ?? null,
    status: "queued",
    scheduled_at: input.scheduledAt
  });

  if (error) throw error;
}

export async function scheduleOutboundAudioMessage(input: {
  clientId: string;
  phone: string;
  mediaPath: string;
  scheduledAt: string;
  body?: string | null;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();

  if (database) {
    await database.query(
      `
        insert into ${botDbSchema}.outbound_messages
          (client_id, bot_instance_id, phone, body, media_type, media_path, status, scheduled_at)
        select $1, $6, $2, $3, 'audio', $5, 'queued', $4::timestamptz
        where not exists (
          select 1
          from ${botDbSchema}.outbound_messages
          where client_id = $1
            and bot_instance_id = $6
            and phone = $2
            and coalesce(media_path, '') = $5
            and status in ('queued', 'sent')
        )
      `,
      [input.clientId, input.phone, input.body ?? null, input.scheduledAt, input.mediaPath, botInstanceId]
    );
    return;
  }

  if (!supabase) return;

  const { data: existing, error: readError } = await supabase
    .from("outbound_messages")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("phone", input.phone)
    .eq("media_path", input.mediaPath)
    .in("status", ["queued", "sent"])
    .limit(1);

  if (readError) throw readError;
  if (existing?.length) return;

  const { error } = await supabase.from("outbound_messages").insert({
    client_id: input.clientId,
    bot_instance_id: botInstanceId,
    phone: input.phone,
    body: input.body ?? null,
    media_type: "audio",
    media_path: input.mediaPath,
    status: "queued",
    scheduled_at: input.scheduledAt
  });

  if (error) throw error;
}

export async function cancelQueuedFollowUpMessages(clientId: string, reason = "Follow-up cancelado.") {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = currentBotInstanceId();

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.outbound_messages
        set status = 'cancelled',
            error_message = $2
        where client_id = $1
          and bot_instance_id = $3
          and status = 'queued'
          and media_path like 'ec10_followup:%'
      `,
      [clientId, reason, botInstanceId]
    );
    return;
  }

  if (!supabase) return;

  const { error } = await supabase
    .from("outbound_messages")
    .update({ status: "cancelled", error_message: reason })
    .eq("client_id", clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("status", "queued")
    .like("media_path", "ec10_followup:%");

  if (error) throw error;
}

export async function cancelQueuedMeetingMessages(clientId: string, reason = "Mensagens de reuniao canceladas.") {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = currentBotInstanceId();

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.outbound_messages
        set status = 'cancelled',
            error_message = $2
        where client_id = $1
          and bot_instance_id = $3
          and status = 'queued'
          and (
            body like 'Lembrete EC10:%'
            or media_path like 'meeting_presence:%'
            or media_path like 'meet_timing_notice:%'
          )
      `,
      [clientId, reason, botInstanceId]
    );
    return;
  }

  if (!supabase) return;

  const { error } = await supabase
    .from("outbound_messages")
    .update({ status: "cancelled", error_message: reason })
    .eq("client_id", clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("status", "queued")
    .or("body.like.Lembrete EC10:%,media_path.like.meeting_presence:%,media_path.like.meet_timing_notice:%");

  if (error) throw error;
}

export async function getClientAutomationStateByPhone(phoneInput: string): Promise<ClientAutomationState | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  const phone = normalizePhone(phoneInput, config.BOT_DEFAULT_COUNTRY_CODE);
  if (!phone || (!supabase && !database)) return null;

  if (database) {
    return findClientByPhoneCandidates(database, phone);
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("id, bot_instance_id, phone, name, bot_paused, tags, source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata")
    .in("phone", phoneLookupCandidates(phone))
    .order("bot_instance_id", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0] as ClientAutomationState | undefined) ?? null;
}

export async function fetchRecentInboundRecoveryCandidates(hours = 24, limit = 80): Promise<ClientAutomationState[]> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return [];
  const safeHours = Math.max(1, Math.min(72, Math.round(hours)));
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit)));
  const fields = `id, bot_instance_id, phone, name, bot_paused, tags,
                  source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata`;

  if (database) {
    const { rows } = await database.query<ClientAutomationState>(
      `select ${fields}
       from ${botDbSchema}.clients
       where bot_instance_id = $1
         and created_at >= now() - make_interval(hours => $2::int)
       order by created_at desc
       limit $3`,
      [currentBotInstanceId(), safeHours, safeLimit],
    );
    return rows;
  }

  const cutoff = new Date(Date.now() - safeHours * 60 * 60_000).toISOString();
  const { data, error } = await supabase!
    .from("clients")
    .select(fields.replace(/\s+/g, " "))
    .eq("bot_instance_id", currentBotInstanceId())
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data as unknown as ClientAutomationState[] | null) ?? [];
}

export async function getClientAutomationStateById(clientId: string): Promise<ClientAutomationState | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!clientId || (!supabase && !database)) return null;

  if (database) {
    const { rows } = await database.query<ClientAutomationState>(
      `
        select id, bot_instance_id, phone, name, bot_paused, tags,
               source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata
        from ${botDbSchema}.clients
        where id = $1
        limit 1
      `,
      [clientId]
    );
    return rows[0] ?? null;
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("id, bot_instance_id, phone, name, bot_paused, tags, source, service_interest, athlete_age, traffic_source, utm_source, utm_campaign, fbclid, attribution_metadata")
    .eq("id", clientId)
    .limit(1);

  if (error) throw error;
  return (data?.[0] as ClientAutomationState | undefined) ?? null;
}

export async function appendClientTags(clientId: string, tags: string[]) {
  const nextTags = tags.filter(Boolean);
  if (!nextTags.length) return;

  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.clients
        set tags = (
              select array(
                select distinct value
                from unnest(coalesce(${botDbSchema}.clients.tags, '{}') || $2::text[]) as tags(value)
                where value is not null and value <> ''
              )
            ),
            updated_at = now()
        where id = $1
      `,
      [clientId, nextTags]
    );
    return;
  }

  if (!supabase) return;

  const { data: current, error: readError } = await supabase
    .from("clients")
    .select("tags")
    .eq("id", clientId)
    .single();

  if (readError) throw readError;

  const merged = Array.from(new Set([...(current?.tags ?? []), ...nextTags]));
  const { error } = await supabase
    .from("clients")
    .update({ tags: merged, updated_at: new Date().toISOString() })
    .eq("id", clientId);

  if (error) throw error;
}

export async function hasClientOutboundMessages(clientId:string) {
  const database=getDatabase(),supabase=getSupabase();
  if(!clientId||(!database&&!supabase))throw new Error('Welcome history unavailable');
  if(database)return Boolean((await database.query(`select id from ${botDbSchema}.messages where client_id=$1
    and bot_instance_id=$2 and direction='outbound' limit 1`,[clientId,currentBotInstanceId()])).rowCount);
  const {data,error}=await supabase!.from('messages').select('id').eq('client_id',clientId)
    .eq('bot_instance_id',currentBotInstanceId()).eq('direction','outbound').limit(1);
  if(error)throw error;
  return !!data?.length;
}

export async function fetchRecentClientMessages(clientId: string, limit = 12): Promise<RecentClientMessage[]> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!clientId || (!supabase && !database)) return [];
  const safeLimit = Math.max(1, Math.min(24, Math.round(limit)));

  if (database) {
    const { rows } = await database.query<{
      direction: "inbound" | "outbound";
      body: string | null;
      media_type: string | null;
      created_at: string;
    }>(`
      select direction, body, media_type, created_at
      from ${botDbSchema}.messages
      where client_id = $1 and bot_instance_id = $2
      order by created_at desc
      limit $3
    `, [clientId, currentBotInstanceId(), safeLimit]);
    return rows.reverse().map((row) => ({
      direction: row.direction,
      body: row.body,
      mediaType: row.media_type,
      createdAt: row.created_at,
    }));
  }

  const { data, error } = await supabase!
    .from("messages")
    .select("direction, body, media_type, created_at")
    .eq("client_id", clientId)
    .eq("bot_instance_id", currentBotInstanceId())
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return (data ?? []).reverse().map((row: any) => ({
    direction: row.direction,
    body: row.body,
    mediaType: row.media_type,
    createdAt: row.created_at,
  }));
}

export async function updateClientAiProfile(input: {
  clientId: string;
  responsibleName?: string | null;
  athleteName?: string | null;
  serviceInterest?: ServiceInterest | null;
  athleteAge?: number | null;
  leadTemperature?: "frio" | "morno" | "quente";
  handoffRequested?: boolean;
  automationPauseRequested?: boolean;
  speakerRole?: "responsavel" | "atleta" | "gestor" | "unknown";
  guardianConfirmed?: boolean;
  qualificationStatus?: "qualified" | "more_info" | "unqualified";
  qualificationReason?: string;
  objectiveConfirmed?: boolean;
  decisionMakerConfirmed?: boolean;
  mainPain?: string;
  mainDifficulty?: string;
  primaryObjective?: string;
  currentSituation?: string;
  urgency?: "baixa" | "media" | "alta";
  decisionReadiness?: "descoberta" | "consideracao" | "decisao";
  investmentReadiness?: "nao_explorado" | "precisa_se_organizar" | "aberto_se_fizer_sentido" | "pronto_para_analisar";
  journeyStage?: "inicio" | "desenvolvimento" | "pronto_para_experiencia" | "avaliacao_internacional" | "pos_experiencia" | "indefinido";
  conversationStyle?: "direto" | "detalhado" | "emocional" | "pratico" | "indefinido";
  objectionCategory?: "preco" | "confianca" | "tempo" | "garantia" | "logistica" | "decisor" | "nenhuma";
  recommendedNextStep?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const tags = [
    "ia_conversacional",
    input.leadTemperature ? `temperatura_${input.leadTemperature}` : null,
    input.athleteAge ? `idade_${input.athleteAge}` : null,
    input.serviceInterest && input.serviceInterest !== "nao_definido" ? input.serviceInterest : null,
    input.handoffRequested ? "ia_transferencia_humana" : null,
    input.qualificationStatus === "qualified" ? "ia_qualificado" : null,
  ].filter(Boolean) as string[];
  const aiContext = Object.fromEntries(Object.entries({
    responsibleName: input.responsibleName || undefined,
    athleteName: input.athleteName || undefined,
    speakerRole: input.speakerRole && input.speakerRole !== "unknown" ? input.speakerRole : undefined,
    guardianConfirmed: input.guardianConfirmed,
    qualificationStatus: input.qualificationStatus,
    qualificationReason: input.qualificationReason || undefined,
    objectiveConfirmed: input.objectiveConfirmed,
    decisionMakerConfirmed: input.decisionMakerConfirmed,
    mainPain: input.mainPain || undefined,
    mainDifficulty: input.mainDifficulty || undefined,
    primaryObjective: input.primaryObjective || undefined,
    currentSituation: input.currentSituation || undefined,
    urgency: input.urgency,
    decisionReadiness: input.decisionReadiness,
    investmentReadiness: input.investmentReadiness,
    journeyStage: input.journeyStage,
    conversationStyle: input.conversationStyle,
    objectionCategory: input.objectionCategory,
    recommendedNextStep: input.recommendedNextStep || undefined,
  }).filter(([, value]) => value !== undefined));

  if (database) {
    await database.query(`
      update ${botDbSchema}.clients
      set status = case
            when $5::boolean or $4::text = 'quente' then 'quente'::${botDbSchema}.lead_status
            when status = 'novo' then 'triagem'::${botDbSchema}.lead_status
            else status
          end,
          service_interest = coalesce($2::text, service_interest),
          athlete_age = coalesce($3::int, athlete_age),
          bot_paused = case when $8::boolean then true else bot_paused end,
          tags = (select array(select distinct value from unnest(coalesce(${botDbSchema}.clients.tags, '{}') || $6::text[]) tags(value) where value <> '')),
          attribution_metadata = coalesce(attribution_metadata, '{}'::jsonb)
            || jsonb_build_object('ai_sdr', coalesce(attribution_metadata->'ai_sdr', '{}'::jsonb) || $7::jsonb),
          updated_at = now()
      where id = $1
    `, [input.clientId, input.serviceInterest || null, input.athleteAge || null, input.leadTemperature || "morno", Boolean(input.handoffRequested), tags, JSON.stringify(aiContext),Boolean(input.handoffRequested||input.automationPauseRequested)]);
    return;
  }

  const { data: current, error: readError } = await supabase!
    .from("clients")
    .select("status, tags, attribution_metadata")
    .eq("id", input.clientId)
    .single();
  if (readError) throw readError;
  const update: Record<string, unknown> = {
    status: input.handoffRequested || input.leadTemperature === "quente" ? "quente" : current.status === "novo" ? "triagem" : current.status,
    tags: Array.from(new Set([...(current.tags ?? []), ...tags])),
    attribution_metadata: {
      ...(current.attribution_metadata ?? {}),
      ai_sdr: {
        ...((current.attribution_metadata?.ai_sdr as Record<string, unknown> | undefined) ?? {}),
        ...aiContext,
      },
    },
    updated_at: new Date().toISOString(),
  };
  if (input.serviceInterest && input.serviceInterest !== "nao_definido") update.service_interest = input.serviceInterest;
  if (input.athleteAge) update.athlete_age = input.athleteAge;
  if (input.handoffRequested||input.automationPauseRequested) update.bot_paused = true;
  const { error } = await supabase!.from("clients").update(update).eq("id", input.clientId);
  if (error) throw error;
}

export async function markClientForFollowUp(input: {
  clientId: string;
  status: LeadStatus;
  nextFollowUpAt: string;
  tags?: string[];
  note?: string | null;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  const tags = (input.tags ?? []).filter(Boolean);
  const note = input.note?.trim() || null;
  if (!supabase && !database) return;

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.clients
        set status = $2::${botDbSchema}.lead_status,
            next_follow_up_at = $3::timestamptz,
            tags = (
              select array(
                select distinct value
                from unnest(coalesce(${botDbSchema}.clients.tags, '{}') || $4::text[]) as tags(value)
                where value is not null and value <> ''
              )
            ),
            notes = trim(both E'\n' from concat_ws(E'\n\n', nullif(${botDbSchema}.clients.notes, ''), $5::text)),
            updated_at = now()
        where id = $1
      `,
      [input.clientId, input.status, input.nextFollowUpAt, tags, note]
    );
    return;
  }

  if (!supabase) return;

  const { data: current, error: readError } = await supabase
    .from("clients")
    .select("tags, notes")
    .eq("id", input.clientId)
    .single();

  if (readError) throw readError;

  const mergedTags = Array.from(new Set([...(current?.tags ?? []), ...tags].filter(Boolean)));
  const mergedNotes = [current?.notes, note].filter(Boolean).join("\n\n");
  const { error } = await supabase
    .from("clients")
    .update({
      status: input.status,
      next_follow_up_at: input.nextFollowUpAt,
      tags: mergedTags,
      notes: mergedNotes,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.clientId);

  if (error) throw error;
}

export async function markOutboundMessage(
  id: string,
  status: "sent" | "failed" | "cancelled",
  errorMessage?: string,
  delivery: WhatsAppDeliveryInfo = {}
) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;

  const whatsappMessageId = delivery.whatsappMessageId?.trim() || null;
  const whatsappChatId = delivery.whatsappChatId?.trim() || null;
  const whatsappAck = typeof delivery.whatsappAck === "number" ? delivery.whatsappAck : null;

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.outbound_messages
        set status = $2,
            error_message = $3,
            sent_at = case when $2 = 'sent' then now() else null end,
            whatsapp_message_id = coalesce($4::text, whatsapp_message_id),
            whatsapp_chat_id = coalesce($5::text, whatsapp_chat_id),
            whatsapp_ack = coalesce($6::int, whatsapp_ack),
            whatsapp_ack_at = case when $6::int is not null then now() else whatsapp_ack_at end,
            whatsapp_send_attempts = case
              when $2 in ('sent', 'failed') then coalesce(whatsapp_send_attempts, 0) + 1
              else whatsapp_send_attempts
            end
        where id = $1
      `,
      [id, status, errorMessage ?? null, whatsappMessageId, whatsappChatId, whatsappAck]
    );
    return;
  }

  if (!supabase) return;

  const { error } = await supabase
    .from("outbound_messages")
    .update({
      status,
      error_message: errorMessage ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      ...(whatsappMessageId ? { whatsapp_message_id: whatsappMessageId } : {}),
      ...(whatsappChatId ? { whatsapp_chat_id: whatsappChatId } : {}),
      ...(whatsappAck !== null ? { whatsapp_ack: whatsappAck, whatsapp_ack_at: new Date().toISOString() } : {})
    })
    .eq("id", id);

  if (error) throw error;
}

export async function requeueOutboundMessage(
  id: string,
  errorMessage: string,
  scheduledAt: string,
  delivery: WhatsAppDeliveryInfo = {}
) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;

  const whatsappMessageId = delivery.whatsappMessageId?.trim() || null;
  const whatsappChatId = delivery.whatsappChatId?.trim() || null;
  const whatsappAck = typeof delivery.whatsappAck === "number" ? delivery.whatsappAck : null;

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.outbound_messages
        set status = 'queued',
            error_message = $2,
            sent_at = null,
            scheduled_at = $3::timestamptz,
            whatsapp_message_id = coalesce($4::text, whatsapp_message_id),
            whatsapp_chat_id = coalesce($5::text, whatsapp_chat_id),
            whatsapp_ack = coalesce($6::int, whatsapp_ack),
            whatsapp_ack_at = case when $6::int is not null then now() else whatsapp_ack_at end,
            whatsapp_send_attempts = coalesce(whatsapp_send_attempts, 0) + 1
        where id = $1
      `,
      [id, errorMessage, scheduledAt, whatsappMessageId, whatsappChatId, whatsappAck]
    );
    return;
  }

  if (!supabase) return;

  const { data, error: readError } = await supabase
    .from("outbound_messages")
    .select("whatsapp_send_attempts")
    .eq("id", id)
    .single();
  if (readError) throw readError;

  const { error } = await supabase
    .from("outbound_messages")
    .update({
      status: "queued",
      error_message: errorMessage,
      sent_at: null,
      scheduled_at: scheduledAt,
      whatsapp_send_attempts: Number(data?.whatsapp_send_attempts ?? 0) + 1,
      ...(whatsappMessageId ? { whatsapp_message_id: whatsappMessageId } : {}),
      ...(whatsappChatId ? { whatsapp_chat_id: whatsappChatId } : {}),
      ...(whatsappAck !== null ? { whatsapp_ack: whatsappAck, whatsapp_ack_at: new Date().toISOString() } : {})
    })
    .eq("id", id);

  if (error) throw error;
}

export async function fetchActiveBotRules(): Promise<BotRule[]> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return [];

  if (database) {
    const { rows } = await database.query<BotRule>(
      `
        select id, name, trigger, response_text, response_audio_path, priority, once_per_client, cooldown_minutes
        from ${botDbSchema}.bot_rules
        where active = true
        order by priority asc, created_at asc
      `
    );
    return rows;
  }

  if (!supabase) return [];

  const { data, error } = await supabase
    .from("bot_rules")
    .select("id, name, trigger, response_text, response_audio_path, priority, once_per_client, cooldown_minutes")
    .eq("active", true)
    .order("priority", { ascending: true });

  if (error) throw error;
  return (data ?? []) as BotRule[];
}

export function findMatchingRule(rules: BotRule[], messageBody: string | null | undefined) {
  const normalizedBody = (messageBody ?? "").toLocaleLowerCase("pt-BR");
  return rules.find((rule) => {
    const trigger = rule.trigger.trim().toLocaleLowerCase("pt-BR");
    if (!trigger) return false;
    if (trigger === "*") return true;
    return normalizedBody.includes(trigger);
  });
}

export async function shouldSendRuleResponse(clientId: string, rule: BotRule) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return true;
  if (!rule.response_text && !rule.response_audio_path) return false;
  const botInstanceId = currentBotInstanceId();

  const checkAllHistory = rule.once_per_client;
  const cooldownMinutes = Math.max(0, rule.cooldown_minutes ?? 0);
  if (!checkAllHistory && cooldownMinutes === 0) return true;

  if (database) {
    const params: unknown[] = [clientId, rule.response_text, rule.response_audio_path, botInstanceId];
    let timeFilter = "";
    if (!checkAllHistory) {
      params.push(`${cooldownMinutes} minutes`);
      timeFilter = `and created_at >= now() - $${params.length}::interval`;
    }

    const { rows } = await database.query<{ exists: boolean }>(
      `
        select exists (
          select 1
          from ${botDbSchema}.messages
          where client_id = $1
            and bot_instance_id = $4
            and direction = 'outbound'
            and (
              ($2::text is not null and body = $2::text)
              or ($3::text is not null and media_path = $3::text)
            )
            ${timeFilter}
          limit 1
        ) as exists
      `,
      params
    );
    return !rows[0]?.exists;
  }

  if (!supabase) return true;

  let query = supabase
    .from("messages")
    .select("id")
    .eq("client_id", clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("direction", "outbound")
    .limit(1);

  if (rule.response_text) {
    query = query.eq("body", rule.response_text);
  } else if (rule.response_audio_path) {
    query = query.eq("media_path", rule.response_audio_path);
  }

  if (!checkAllHistory) {
    query = query.gte("created_at", new Date(Date.now() - cooldownMinutes * 60_000).toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  return !data?.length;
}

export async function recordOutboundChatMessage(input: {
  clientId: string;
  body?: string | null;
  mediaType: "text" | "audio" | "image" | "document" | "poll";
  mediaPath?: string | null;
  whatsappMessageId?: string | null;
  whatsappChatId?: string | null;
  whatsappAck?: number | null;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();
  const whatsappMessageId = input.whatsappMessageId?.trim() || null;
  const whatsappChatId = input.whatsappChatId?.trim() || null;
  const whatsappAck = typeof input.whatsappAck === "number" ? input.whatsappAck : null;

  if (database) {
    await database.query(
      `
        insert into ${botDbSchema}.messages
          (client_id, bot_instance_id, direction, body, media_type, media_path,
           whatsapp_message_id, whatsapp_chat_id, whatsapp_ack, whatsapp_ack_at)
        values ($1, $6, 'outbound', $2, $3, $4, $5, $7, $8, case when $8::int is not null then now() else null end)
      `,
      [
        input.clientId,
        input.body ?? null,
        input.mediaType,
        input.mediaPath ?? null,
        whatsappMessageId,
        botInstanceId,
        whatsappChatId,
        whatsappAck
      ]
    );
    return;
  }

  if (!supabase) return;

  const { error } = await supabase.from("messages").insert({
    client_id: input.clientId,
    bot_instance_id: botInstanceId,
    direction: "outbound",
    body: input.body ?? null,
    media_type: input.mediaType,
    media_path: input.mediaPath ?? null,
    whatsapp_message_id: whatsappMessageId,
    whatsapp_chat_id: whatsappChatId,
    whatsapp_ack: whatsappAck,
    whatsapp_ack_at: whatsappAck !== null ? new Date().toISOString() : null
  });

  if (error) throw error;
}

export async function recordQueuedOutboundDelivery(input: {
  clientId: string;
  body?: string | null;
  mediaType: OutboundMessage["media_type"];
  mediaPath?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaSizeBytes?: number | null;
  whatsappMessageId?: string | null;
  whatsappChatId?: string | null;
  whatsappAck?: number | null;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;

  const body = input.body?.trim() || null;
  const mediaPath = input.mediaPath?.trim() || null;
  const mediaMimeType = input.mediaMimeType?.trim() || null;
  const mediaFileName = input.mediaFileName?.trim() || null;
  const mediaSizeBytes = Number.isFinite(input.mediaSizeBytes) ? Number(input.mediaSizeBytes) : null;
  const whatsappMessageId = input.whatsappMessageId?.trim() || null;
  const whatsappChatId = input.whatsappChatId?.trim() || null;
  const whatsappAck = typeof input.whatsappAck === "number" ? input.whatsappAck : null;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();
  if (!body && !mediaPath) return;

  if (database) {
    await database.query(
      `
        with candidate as (
          select id
          from ${botDbSchema}.messages
          where client_id = $1
            and bot_instance_id = $6
            and direction = 'outbound'
            and media_type = $3
            and whatsapp_message_id is null
            and (
              ($4::text is not null and media_path = $4::text)
              or ($4::text is null and $2::text is not null and body = $2::text)
            )
          order by created_at desc
          limit 1
        ),
        updated as (
          update ${botDbSchema}.messages message
          set whatsapp_message_id = coalesce($5::text, message.whatsapp_message_id),
              whatsapp_chat_id = coalesce($7::text, message.whatsapp_chat_id),
              whatsapp_ack = coalesce($8::int, message.whatsapp_ack),
              whatsapp_ack_at = case when $8::int is not null then now() else message.whatsapp_ack_at end
          from candidate
          where message.id = candidate.id
          returning message.id
        )
        insert into ${botDbSchema}.messages
          (client_id, bot_instance_id, direction, body, media_type, media_path,
           whatsapp_message_id, whatsapp_chat_id, whatsapp_ack, whatsapp_ack_at)
        select $1, $6, 'outbound', $2, $3, $4, $5, $7, $8, case when $8::int is not null then now() else null end
        where not exists (select 1 from updated)
          and not exists (
            select 1
            from ${botDbSchema}.messages
            where $5::text is not null
              and whatsapp_message_id = $5::text
              and direction = 'outbound'
              and bot_instance_id = $6
          )
      `,
      [input.clientId, body, input.mediaType, mediaPath, whatsappMessageId, botInstanceId, whatsappChatId, whatsappAck]
    );
    return;
  }

  if (!supabase) return;

  let existingQuery = supabase
    .from("messages")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("direction", "outbound")
    .eq("media_type", input.mediaType)
    .is("whatsapp_message_id", null)
    .order("created_at", { ascending: false })
    .limit(1);

  existingQuery = mediaPath ? existingQuery.eq("media_path", mediaPath) : existingQuery.eq("body", body);

  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) throw existingError;

  const existingId = existingRows?.[0]?.id;
  if (existingId) {
    if (whatsappMessageId) {
      const { error } = await supabase
        .from("messages")
        .update({
          whatsapp_message_id: whatsappMessageId,
          media_mime_type: mediaMimeType,
          media_file_name: mediaFileName,
          media_size_bytes: mediaSizeBytes,
          ...(whatsappChatId ? { whatsapp_chat_id: whatsappChatId } : {}),
          ...(whatsappAck !== null ? { whatsapp_ack: whatsappAck, whatsapp_ack_at: new Date().toISOString() } : {})
        })
        .eq("id", existingId);
      if (error) throw error;
    }
    return;
  }

  if (whatsappMessageId) {
    const { data: duplicateRows, error: duplicateError } = await supabase
      .from("messages")
      .select("id")
      .eq("bot_instance_id", botInstanceId)
      .eq("direction", "outbound")
      .eq("whatsapp_message_id", whatsappMessageId)
      .limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicateRows?.length) return;
  }

  const { error } = await supabase.from("messages").insert({
    client_id: input.clientId,
    bot_instance_id: botInstanceId,
    direction: "outbound",
    body,
    media_type: input.mediaType,
    media_path: mediaPath,
    media_mime_type: mediaMimeType,
    media_file_name: mediaFileName,
    media_size_bytes: mediaSizeBytes,
    whatsapp_message_id: whatsappMessageId,
    whatsapp_chat_id: whatsappChatId,
    whatsapp_ack: whatsappAck,
    whatsapp_ack_at: whatsappAck !== null ? new Date().toISOString() : null
  });

  if (error) throw error;
}

export async function recordWhatsAppMessageAck(input: {
  whatsappMessageId: string;
  ack: number;
  whatsappChatId?: string | null;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;

  const whatsappMessageId = input.whatsappMessageId.trim();
  if (!whatsappMessageId) return;
  const whatsappChatId = input.whatsappChatId?.trim() || null;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.messages
        set whatsapp_ack = case
              when whatsapp_ack is null or $2::int > whatsapp_ack then $2::int
              else whatsapp_ack
            end,
            whatsapp_ack_at = now(),
            whatsapp_chat_id = coalesce($3::text, whatsapp_chat_id)
        where bot_instance_id = $4
          and direction = 'outbound'
          and whatsapp_message_id = $1
      `,
      [whatsappMessageId, input.ack, whatsappChatId, botInstanceId]
    );
    await database.query(
      `
        update ${botDbSchema}.outbound_messages
        set whatsapp_ack = case
              when whatsapp_ack is null or $2::int > whatsapp_ack then $2::int
              else whatsapp_ack
            end,
            whatsapp_ack_at = now(),
            whatsapp_chat_id = coalesce($3::text, whatsapp_chat_id)
        where bot_instance_id = $4
          and whatsapp_message_id = $1
      `,
      [whatsappMessageId, input.ack, whatsappChatId, botInstanceId]
    );
    return;
  }

  const patch = {
    whatsapp_ack: input.ack,
    whatsapp_ack_at: new Date().toISOString(),
    ...(whatsappChatId ? { whatsapp_chat_id: whatsappChatId } : {})
  };

  await supabase
    ?.from("messages")
    .update(patch)
    .eq("bot_instance_id", botInstanceId)
    .eq("direction", "outbound")
    .eq("whatsapp_message_id", whatsappMessageId);

  await supabase
    ?.from("outbound_messages")
    .update(patch)
    .eq("bot_instance_id", botInstanceId)
    .eq("whatsapp_message_id", whatsappMessageId);
}

export async function hasRecentOutboundChatMessage(input: {
  clientId: string;
  body?: string | null;
  mediaType: "text" | "audio" | "image" | "document" | "poll";
  mediaPath?: string | null;
  windowMinutes: number;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  const windowMinutes = Math.max(1, Math.round(input.windowMinutes));
  const body = input.body?.trim() || null;
  const mediaPath = input.mediaPath?.trim() || null;
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();
  if (!supabase && !database) return false;

  if (database) {
    const { rows } = await database.query<{ exists: boolean }>(
      `
        select exists (
          select 1
          from ${botDbSchema}.messages
          where client_id = $1
            and bot_instance_id = $6
            and direction = 'outbound'
            and media_type = $2
            and nullif(whatsapp_message_id, '') is not null
            and created_at >= now() - make_interval(mins => $5::int)
            and (
              ($3::text is not null and media_path = $3::text)
              or ($3::text is null and $4::text is not null and body = $4::text)
            )
          limit 1
        ) as exists
      `,
      [input.clientId, input.mediaType, mediaPath, body, windowMinutes, botInstanceId]
    );
    return Boolean(rows[0]?.exists);
  }

  if (!supabase) return false;

  let query = supabase
    .from("messages")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("direction", "outbound")
    .eq("media_type", input.mediaType)
    .not("whatsapp_message_id", "is", null)
    .neq("whatsapp_message_id", "")
    .gte("created_at", new Date(Date.now() - windowMinutes * 60_000).toISOString())
    .limit(1);

  if (mediaPath) {
    query = query.eq("media_path", mediaPath);
  } else if (body) {
    query = query.eq("body", body);
  } else {
    return false;
  }

  const { data, error } = await query;
  if (error) throw error;
  return Boolean(data?.length);
}

export async function countRecentOutboundChatMessages(input: {
  clientId: string;
  mediaType?: "text" | "audio" | "image" | "document" | "poll" | null;
  windowMinutes: number;
  botInstanceId?: string;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  const windowMinutes = Math.max(1, Math.round(input.windowMinutes));
  const botInstanceId = input.botInstanceId ?? currentBotInstanceId();
  if (!supabase && !database) return 0;

  if (database) {
    const params: unknown[] = [input.clientId, botInstanceId, windowMinutes];
    const mediaFilter = input.mediaType ? "and media_type = $4" : "";
    if (input.mediaType) params.push(input.mediaType);
    const { rows } = await database.query<{ count: string }>(
      `
        select count(*)::text as count
        from ${botDbSchema}.messages
        where client_id = $1
          and bot_instance_id = $2
          and direction = 'outbound'
          and created_at >= now() - make_interval(mins => $3::int)
          ${mediaFilter}
      `,
      params
    );
    return Number(rows[0]?.count ?? 0);
  }

  if (!supabase) return 0;

  let query = supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", input.clientId)
    .eq("bot_instance_id", botInstanceId)
    .eq("direction", "outbound")
    .gte("created_at", new Date(Date.now() - windowMinutes * 60_000).toISOString());

  if (input.mediaType) {
    query = query.eq("media_type", input.mediaType);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function upsertBotRuntime(key: string, payload: Record<string, unknown>) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return;
  const runtimeKey = runtimeKeyForInstance(key);
  const runtimePayload = { ...currentBotInstancePayload(), ...payload };

  if (database) {
    await database.query(
      `
        insert into ${botDbSchema}.bot_runtime (key, payload, updated_at)
        values ($1, $2::jsonb, now())
        on conflict (key)
        do update set payload = excluded.payload, updated_at = now()
      `,
      [runtimeKey, JSON.stringify(runtimePayload)]
    );
    return;
  }

  if (!supabase) return;

  const { error } = await supabase.from("bot_runtime").upsert({
    key: runtimeKey,
    payload: runtimePayload,
    updated_at: new Date().toISOString()
  });

  if (error) throw error;
}

export async function getBotRuntime(key: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) return null;
  const runtimeKey = runtimeKeyForInstance(key);

  if (database) {
    const { rows } = await database.query<{ payload: Record<string, unknown> | null }>(
      `select payload from ${botDbSchema}.bot_runtime where key = $1 limit 1`,
      [runtimeKey]
    );
    const payload = rows[0]?.payload;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from("bot_runtime")
    .select("payload")
    .eq("key", runtimeKey)
    .maybeSingle();

  if (error) throw error;
  const payload = data?.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
}

export async function getBotConversationState(phoneInput: string): Promise<BotConversationState | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  const phone = normalizePhone(phoneInput, config.BOT_DEFAULT_COUNTRY_CODE);
  const botInstanceId = currentBotInstanceId();
  if (!supabase && !database) return null;

  if (database) {
    const { rows } = await database.query<BotConversationState>(
      `
        with target_client as (
          select id
          from ${botDbSchema}.clients
          where phone = any($1::text[])
          order by
            case when bot_instance_id = $3 then 0 else 1 end,
            case when phone = $2 then 0 else 1 end,
            updated_at desc nulls last,
            created_at desc
          limit 1
        )
        select b.id, b.client_id, b.phone, b.stage, b.role_answer, b.athlete_age, b.age_group,
               b.service_interest, b.lead_page_url, b.completed_at, b.metadata
        from ${botDbSchema}.bot_conversation_states b
        left join target_client tc on true
        where (b.client_id = tc.id and b.bot_instance_id = $3)
           or (
             b.phone = any($1::text[])
             and b.bot_instance_id = $3
             and not exists (select 1 from target_client)
           )
        order by
          case when b.client_id = tc.id then 0 else 1 end,
          case when b.phone = $2 then 0 else 1 end,
          b.updated_at desc nulls last
        limit 1
      `,
      [phoneLookupCandidates(phone), phone, botInstanceId]
    );
    return rows[0] ?? null;
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from("bot_conversation_states")
    .select("id, client_id, phone, stage, role_answer, athlete_age, age_group, service_interest, lead_page_url, completed_at, metadata")
    .in("phone", phoneLookupCandidates(phone))
    .eq("bot_instance_id", botInstanceId)
    .limit(1);

  if (error) throw error;
  return (data?.[0] as BotConversationState | undefined) ?? null;
}

export async function fetchDueGustavoRecoveryStates(limit = 20): Promise<BotConversationState[]> {
  const supabase = getSupabase();
  const database = getDatabase();
  const botInstanceId = currentBotInstanceId();
  const safeLimit = Math.min(50, Math.max(1, Math.round(limit)));
  if (!supabase && !database) return [];

  if (database) {
    const { rows } = await database.query<BotConversationState>(`
      select id, client_id, phone, stage, role_answer, athlete_age, age_group,
             service_interest, lead_page_url, completed_at, metadata
      from ${botDbSchema}.bot_conversation_states
      where bot_instance_id = $1
        and metadata->'gustavo'->>'pending' = 'true'
        and nullif(metadata->'gustavo'->>'dueAt', '')::timestamptz <= now()
      order by nullif(metadata->'gustavo'->>'dueAt', '')::timestamptz asc
      limit $2
    `, [botInstanceId, safeLimit]);
    return rows;
  }

  const { data, error } = await supabase!
    .from("bot_conversation_states")
    .select("id, client_id, phone, stage, role_answer, athlete_age, age_group, service_interest, lead_page_url, completed_at, metadata")
    .eq("bot_instance_id", botInstanceId)
    .contains("metadata", { gustavo: { pending: true } })
    .lte("metadata->gustavo->>dueAt", new Date().toISOString())
    .order("updated_at", { ascending: true })
    .limit(safeLimit);
  if (error) throw error;
  return (data ?? []) as BotConversationState[];
}

export async function fetchPendingCareerMeetingGroupStates(limit = 20): Promise<BotConversationState[]> {
  const supabase = getSupabase();
  const database = getDatabase();
  const botInstanceId = currentBotInstanceId();
  if (!supabase && !database) return [];

  if (database) {
    const { rows } = await database.query<BotConversationState>(
      `
        select id, client_id, phone, stage, role_answer, athlete_age, age_group,
               service_interest, lead_page_url, completed_at, metadata
        from ${botDbSchema}.bot_conversation_states
        where bot_instance_id = $2
          and stage = 'completed'
          and service_interest = 'plano_carreira'
          and metadata ? 'meeting'
          and nullif(metadata #>> '{meeting,startsAt}', '') is not null
          and (metadata #>> '{meeting,startsAt}')::timestamptz >= now() - interval '2 hours'
          and (metadata #>> '{meeting,startsAt}')::timestamptz <= now() + interval '15 days'
          and extract(isodow from ((metadata #>> '{meeting,startsAt}')::timestamptz at time zone 'America/Sao_Paulo')) in (2, 4)
          and extract(hour from ((metadata #>> '{meeting,startsAt}')::timestamptz at time zone 'America/Sao_Paulo')) = 20
          and extract(minute from ((metadata #>> '{meeting,startsAt}')::timestamptz at time zone 'America/Sao_Paulo')) = 0
          and coalesce(nullif(metadata #>> '{meetingWhatsAppGroup,leadAdded}', '')::boolean, false) = false
          and coalesce(nullif(metadata #>> '{meetingWhatsAppGroup,inviteSent}', '')::boolean, false) = false
          and coalesce(nullif(metadata #>> '{meetingWhatsAppGroup,inviteLinkSent}', '')::boolean, false) = false
        order by (metadata #>> '{meeting,startsAt}')::timestamptz asc
        limit $1
      `,
      [limit, botInstanceId]
    );
    return rows;
  }

  if (!supabase) return [];

  const { data, error } = await supabase
    .from("bot_conversation_states")
    .select("id, client_id, phone, stage, role_answer, athlete_age, age_group, service_interest, lead_page_url, completed_at, metadata")
    .eq("bot_instance_id", botInstanceId)
    .eq("stage", "completed")
    .eq("service_interest", "plano_carreira")
    .limit(500);

  if (error) throw error;

  const now = Date.now();
  const minTime = now - 2 * 60 * 60_000;
  const maxTime = now + 15 * 24 * 60 * 60_000;
  const saoPauloParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return ((data ?? []) as BotConversationState[])
    .filter((state) => {
      const metadata = state.metadata ?? {};
      const meeting = metadata.meeting as Record<string, unknown> | undefined;
      const startsAt = typeof meeting?.startsAt === "string" ? Date.parse(meeting.startsAt) : NaN;
      const group = metadata.meetingWhatsAppGroup as Record<string, unknown> | undefined;
      const formattedParts = Number.isFinite(startsAt)
        ? Object.fromEntries(saoPauloParts.formatToParts(new Date(startsAt)).map((part) => [part.type, part.value]))
        : {};
      const isCareerGroupSlot = ["Tue", "Thu"].includes(String(formattedParts.weekday ?? ""))
        && String(formattedParts.hour ?? "") === "20"
        && String(formattedParts.minute ?? "") === "00";
      return Number.isFinite(startsAt)
        && startsAt >= minTime
        && startsAt <= maxTime
        && isCareerGroupSlot
        && group?.leadAdded !== true
        && group?.inviteSent !== true
        && group?.inviteLinkSent !== true;
    })
    .sort((a, b) => {
      const aTime = Date.parse(String((a.metadata.meeting as Record<string, unknown> | undefined)?.startsAt ?? ""));
      const bTime = Date.parse(String((b.metadata.meeting as Record<string, unknown> | undefined)?.startsAt ?? ""));
      return aTime - bTime;
    })
    .slice(0, limit);
}

export async function saveBotConversationState(input: {
  clientId: string;
  phone: string;
  stage: BotConversationStage;
  roleAnswer?: string | null;
  athleteAge?: number | null;
  ageGroup?: string | null;
  serviceInterest?: ServiceInterest | null;
  leadPageUrl?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<BotConversationState | null> {
  const supabase = getSupabase();
  const database = getDatabase();
  const phone = normalizePhone(input.phone, config.BOT_DEFAULT_COUNTRY_CODE);
  const botInstanceId = currentBotInstanceId();
  const metadata = input.metadata ?? {};
  if (!supabase && !database) {
    console.log("[dry-run] bot conversation", { ...input, phone });
    return null;
  }

  if (database) {
    const { rows } = await database.query<BotConversationState>(
      `
        insert into ${botDbSchema}.bot_conversation_states
          (client_id, bot_instance_id, phone, stage, role_answer, athlete_age, age_group, service_interest,
           lead_page_url, completed_at, metadata, last_inbound_at, updated_at)
        values ($1, $11, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), now())
        on conflict (phone)
        do update set
          client_id = excluded.client_id,
          bot_instance_id = excluded.bot_instance_id,
          stage = excluded.stage,
          role_answer = excluded.role_answer,
          athlete_age = excluded.athlete_age,
          age_group = excluded.age_group,
          service_interest = excluded.service_interest,
          lead_page_url = excluded.lead_page_url,
          completed_at = excluded.completed_at,
          metadata = excluded.metadata,
          last_inbound_at = excluded.last_inbound_at,
          updated_at = now()
        where (
          ${botDbSchema}.bot_conversation_states.client_id,
          ${botDbSchema}.bot_conversation_states.bot_instance_id,
          ${botDbSchema}.bot_conversation_states.stage,
          ${botDbSchema}.bot_conversation_states.role_answer,
          ${botDbSchema}.bot_conversation_states.athlete_age,
          ${botDbSchema}.bot_conversation_states.age_group,
          ${botDbSchema}.bot_conversation_states.service_interest,
          ${botDbSchema}.bot_conversation_states.lead_page_url,
          ${botDbSchema}.bot_conversation_states.completed_at,
          ${botDbSchema}.bot_conversation_states.metadata
        ) is distinct from (
          excluded.client_id,
          excluded.bot_instance_id,
          excluded.stage,
          excluded.role_answer,
          excluded.athlete_age,
          excluded.age_group,
          excluded.service_interest,
          excluded.lead_page_url,
          excluded.completed_at,
          excluded.metadata
        )
        or ${botDbSchema}.bot_conversation_states.last_inbound_at < now() - interval '1 minute'
        returning id, client_id, phone, stage, role_answer, athlete_age, age_group,
                  service_interest, lead_page_url, completed_at, metadata
      `,
      [
        input.clientId,
        phone,
        input.stage,
        input.roleAnswer ?? null,
        input.athleteAge ?? null,
        input.ageGroup ?? null,
        input.serviceInterest ?? null,
        input.leadPageUrl ?? null,
        input.completedAt ?? null,
        JSON.stringify(metadata),
        botInstanceId
      ]
    );
    if (rows[0]) return rows[0];

    const existing = await database.query<BotConversationState>(
      `
        select id, client_id, phone, stage, role_answer, athlete_age, age_group,
               service_interest, lead_page_url, completed_at, metadata
        from ${botDbSchema}.bot_conversation_states
        where phone = $1
        limit 1
      `,
      [phone]
    );
    return existing.rows[0] ?? null;
  }

  if (!supabase) return null;

  const { data, error } = await supabase
    .from("bot_conversation_states")
    .upsert(
      {
        client_id: input.clientId,
        bot_instance_id: botInstanceId,
        phone,
        stage: input.stage,
        role_answer: input.roleAnswer ?? null,
        athlete_age: input.athleteAge ?? null,
        age_group: input.ageGroup ?? null,
        service_interest: input.serviceInterest ?? null,
        lead_page_url: input.leadPageUrl ?? null,
        completed_at: input.completedAt ?? null,
        metadata,
        last_inbound_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: "phone" }
    )
    .select("id, client_id, phone, stage, role_answer, athlete_age, age_group, service_interest, lead_page_url, completed_at, metadata")
    .single();

  if (error) throw error;
  return data as BotConversationState;
}

export async function fetchBookedEc10MeetingStarts(isoDate: string): Promise<string[]> {
  const database = getDatabase();
  if (database) {
    const { rows } = await database.query<{ starts_at: string }>(
      `
        select metadata #>> '{meeting,startsAt}' as starts_at
        from ${botDbSchema}.bot_conversation_states
        where metadata #>> '{meeting,startsAt}' is not null
          and ((metadata #>> '{meeting,startsAt}')::timestamptz at time zone 'America/Sao_Paulo')::date = $1::date
      `,
      [isoDate]
    );
    return rows.map((row) => row.starts_at).filter(Boolean);
  }

  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("bot_conversation_states")
    .select("metadata")
    .eq("stage", "completed")
    .limit(500);

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => row?.metadata?.meeting?.startsAt)
    .filter((startsAt: unknown): startsAt is string => typeof startsAt === "string")
    .filter((startsAt) => startsAt.slice(0, 10) === isoDate);
}

export async function fetchFutureEc10MeetingSellerCounts(
  route: Ec10MeetingRoute,
  sellerNames: string[]
): Promise<Record<string, number>> {
  const names = sellerNames.map((name) => name.trim()).filter(Boolean);
  const counts = Object.fromEntries(names.map((name) => [name, 0]));
  if (!names.length) return counts;

  const normalizedNames = names.map((name) => name.toLowerCase());
  const database = getDatabase();
  if (database) {
    const { rows } = await database.query<{ seller_name: string; total: number }>(
      `
        select
          coalesce(metadata #>> '{meetingSellerName}', '') as seller_name,
          count(*)::int as total
        from ${botDbSchema}.bot_conversation_states
        where metadata #>> '{meeting,startsAt}' is not null
          and metadata #>> '{meeting,startsAt}' ~ '^\\d{4}-\\d{2}-\\d{2}'
          and (metadata #>> '{meeting,startsAt}')::timestamptz >= now()
          and (
            coalesce(metadata #>> '{meetingSellerRoute}', service_interest::text) = $1
            or ($1 = 'plano_internacional' and service_interest::text = 'ambos')
          )
          and lower(coalesce(metadata #>> '{meetingSellerName}', '')) = any($2::text[])
        group by 1
      `,
      [route, normalizedNames]
    );

    for (const row of rows) {
      const matchedName = names.find((name) => name.toLowerCase() === String(row.seller_name ?? "").toLowerCase());
      if (matchedName) counts[matchedName] = Number(row.total) || 0;
    }

    return counts;
  }

  const supabase = getSupabase();
  if (!supabase) return counts;

  const { data, error } = await supabase
    .from("bot_conversation_states")
    .select("service_interest, metadata")
    .eq("stage", "completed")
    .limit(1000);

  if (error) throw error;

  const now = Date.now();
  for (const row of data ?? []) {
    const metadata = (row as any)?.metadata ?? {};
    const startsAt = metadata?.meeting?.startsAt;
    const startsAtTime = typeof startsAt === "string" ? new Date(startsAt).getTime() : NaN;
    if (!Number.isFinite(startsAtTime) || startsAtTime < now) continue;

    const sellerName = typeof metadata?.meetingSellerName === "string" ? metadata.meetingSellerName : "";
    const sellerRoute = metadata?.meetingSellerRoute ?? (row as any)?.service_interest;
    const routeMatches = sellerRoute === route || (route === "plano_internacional" && (row as any)?.service_interest === "ambos");
    if (!routeMatches) continue;

    const matchedName = names.find((name) => name.toLowerCase() === sellerName.toLowerCase());
    if (matchedName) counts[matchedName] += 1;
  }

  return counts;
}

export async function updateClientEc10Profile(input: {
  clientId: string;
  serviceInterest: ServiceInterest;
  athleteAge: number;
  ageGroup: string;
  roleAnswer?: string | null;
  leadPageUrl: string;
  leadPageSection: string;
  leadScore: number;
}) {
  const supabase = getSupabase();
  const database = getDatabase();
  const tags = [
    "whatsapp_bot",
    `idade_${input.athleteAge}`,
    `faixa_${input.ageGroup}`,
    input.serviceInterest
  ];
  const note = [
    `Bot EC10: atleta com ${input.athleteAge} anos.`,
    input.roleAnswer ? `Perfil informado: ${input.roleAnswer}.` : null,
    `Oferta enviada: ${input.leadPageSection}.`,
    input.leadPageUrl ? `Link enviado: ${input.leadPageUrl}` : null
  ].filter(Boolean).join("\n");

  if (!supabase && !database) {
    console.log("[dry-run] client EC10 profile", input);
    return;
  }

  if (database) {
    await database.query(
      `
        update ${botDbSchema}.clients
        set status = case when status = 'novo' then 'triagem'::${botDbSchema}.lead_status else status end,
            service_interest = $2,
            lead_score = greatest(coalesce(lead_score, 0), $3),
            tags = (
              select array(
                select distinct value
                from unnest(coalesce(${botDbSchema}.clients.tags, '{}') || $4::text[]) as tags(value)
                where value is not null and value <> ''
              )
            ),
            notes = trim(both E'\n' from concat_ws(E'\n\n', nullif(${botDbSchema}.clients.notes, ''), $5::text)),
            updated_at = now()
        where id = $1
      `,
      [input.clientId, input.serviceInterest, input.leadScore, tags, note]
    );
    return;
  }

  if (!supabase) return;

  const { data: current, error: readError } = await supabase
    .from("clients")
    .select("tags, notes, lead_score, status")
    .eq("id", input.clientId)
    .single();

  if (readError) throw readError;

  const mergedTags = Array.from(new Set([...(current?.tags ?? []), ...tags].filter(Boolean)));
  const mergedNotes = [current?.notes, note].filter(Boolean).join("\n\n");
  const { error } = await supabase
    .from("clients")
    .update({
      status: current?.status === "novo" ? "triagem" : current?.status,
      service_interest: input.serviceInterest,
      lead_score: Math.max(current?.lead_score ?? 0, input.leadScore),
      tags: mergedTags,
      notes: mergedNotes,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.clientId);

  if (error) throw error;
}

export async function updateClientFoundationStatus(input: {
  clientId: string;
  foundationStatus: 'base' | 'escolinha';
  answer: string;
}) {
  const database = getDatabase();
  const supabase = getSupabase();
  const tag = input.foundationStatus === 'base' ? 'clube_federado' : 'escolinha_projeto';
  const note = `Bot EC10: situacao do atleta: ${tag.replace('_', ' ')}. Resposta: ${input.answer.slice(0, 160)}.`;

  if (database) {
    await database.query(
      `update ${botDbSchema}.clients
       set tags = array(select distinct value from unnest(coalesce(tags, '{}'::text[]) || $2::text[]) as values(value)),
           attribution_metadata = coalesce(attribution_metadata, '{}'::jsonb) || $3::jsonb,
           notes = trim(both E'\n' from concat_ws(E'\n\n', nullif(notes, ''), $4)),
           updated_at = now()
       where id = $1`,
      [input.clientId, [tag], JSON.stringify({ foundationStatus: input.foundationStatus, foundationAnswer: input.answer.slice(0, 160) }), note]
    );
    return;
  }

  if (!supabase) return;
  const { data: current, error: readError } = await supabase
    .from('clients')
    .select('tags, notes, attribution_metadata')
    .eq('id', input.clientId)
    .single();
  if (readError) throw readError;
  const { error } = await supabase.from('clients').update({
    tags: Array.from(new Set([...(current.tags || []), tag])),
    notes: [current.notes, note].filter(Boolean).join('\n\n'),
    attribution_metadata: {
      ...(current.attribution_metadata || {}),
      foundationStatus: input.foundationStatus,
      foundationAnswer: input.answer.slice(0, 160),
    },
    updated_at: new Date().toISOString(),
  }).eq('id', input.clientId);
  if (error) throw error;
}

export async function assignClientToSellerByName(clientId: string, sellerName: string) {
  const supabase = getSupabase();
  const database = getDatabase();
  if (!supabase && !database) {
    console.log("[dry-run] assign client seller", { clientId, sellerName });
    return;
  }

  if (database) {
    await database.query(
      `
        with seller as (
          select id
          from ${botDbSchema}.sellers
          where lower(name) = lower($2)
            and active = true
          order by created_at asc
          limit 1
        )
        update ${botDbSchema}.clients
        set assigned_seller_id = seller.id,
            updated_at = now()
        from seller
        where ${botDbSchema}.clients.id = $1
      `,
      [clientId, sellerName]
    );
    return;
  }

  if (!supabase) return;

  const { data: sellers, error: sellerError } = await supabase
    .from("sellers")
    .select("id")
    .ilike("name", sellerName)
    .eq("active", true)
    .limit(1);
  if (sellerError) throw sellerError;
  const sellerId = sellers?.[0]?.id;
  if (!sellerId) return;

  const { error } = await supabase
    .from("clients")
    .update({ assigned_seller_id: sellerId, updated_at: new Date().toISOString() })
    .eq("id", clientId);
  if (error) throw error;
}
