import pg from "pg";

let database: pg.Pool | null = null;
const routedClients = new WeakSet<pg.PoolClient>();

const ec10OperationalTables = [
  "bot_conversation_states",
  "bot_dedupe_locks",
  "bot_instances",
  "bot_rules",
  "bot_runtime",
  "calls",
  "clients",
  "crm_auth_sessions",
  "crm_auth_users",
  "ec10_booking_slots",
  "ec10_bookings",
  "ec10_bot_booking_links",
  "ec10_campaign_registrations",
  "ec10_chat_booking_schedule",
  "ec10_default_agenda",
  "ec10_default_agenda_windows",
  "gustavo_v2_contacts",
  "gustavo_v2_inbox",
  "gustavo_v2_outbox",
  "gustavo_v2_turns",
  "lead_attribution",
  "messages",
  "meta_webhook_events",
  "outbound_messages",
  "sellers",
  "traffic_agent_recommendations",
  "traffic_campaign_drafts",
  "traffic_campaign_snapshots",
  "traffic_events"
] as const;

const ec10PublicSchemaPattern = new RegExp(
  `\\bpublic\\.(${ec10OperationalTables.join("|")})\\b`,
  "g"
);

export function routeEc10OperationalSql(sql: string) {
  return sql.replace(ec10PublicSchemaPattern, 'whatsapp_bot.$1');
}

function routeQueryInput(input: unknown) {
  if (typeof input === "string") return routeEc10OperationalSql(input);
  if (input && typeof input === "object" && "text" in input && typeof (input as any).text === "string") {
    return { ...(input as any), text: routeEc10OperationalSql((input as any).text) };
  }
  return input;
}

function getPool() {
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error("SUPABASE_DB_URL nao configurada.");
  }

  if (!database) {
    database = new pg.Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true
    });

    database.on("error", () => {
      database = null;
    });
  }

  return database;
}

function isConnectionLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("EMAXCONNSESSION")
    || message.includes("max clients reached")
    || message.includes("remaining connection slots are reserved")
    || message.includes("too many connections");
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function retryConnectionLimit<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isConnectionLimitError(error) || attempt === 2) break;
      await sleep(300 * (attempt + 1));
    }
  }

  throw lastError;
}

export const pool = {
  async query<T extends pg.QueryResultRow = any>(
    text: string | pg.QueryConfig<any[]>,
    params?: any[]
  ): Promise<pg.QueryResult<T>> {
    return retryConnectionLimit(async () => {
      return getPool().query<T>(routeQueryInput(text) as any, params as any);
    });
  },

  async connect(): Promise<pg.PoolClient> {
    return retryConnectionLimit(async () => {
      const client = await getPool().connect();
      if (!routedClients.has(client)) {
        const query = client.query.bind(client);
        client.query = ((...args: any[]) => {
          args[0] = routeQueryInput(args[0]);
          return (query as any)(...args);
        }) as typeof client.query;
        routedClients.add(client);
      }
      return client;
    });
  }
};

export function mapSeller(row: any) {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    region: row.region,
    role: row.role,
    active: row.active,
    approvedAt: row.approved_at,
    createdAt: row.created_at
  };
}

export function mapClient(row: any) {
  const attributionMetadata = row.attribution_metadata ?? {};
  const videoUrls = Array.isArray(attributionMetadata.athleteVideoUrls)
    ? attributionMetadata.athleteVideoUrls.filter((item: unknown) => typeof item === "string" && item.trim()).slice(0, 8)
    : [];

  return {
    id: row.id,
    botInstanceId: row.bot_instance_id ?? "main",
    phone: row.phone,
    name: row.name,
    status: row.status,
    region: row.region,
    serviceInterest: row.service_interest ?? "nao_definido",
    campaignKey: row.campaign_key ?? undefined,
    source: row.source ?? "whatsapp",
    assignedSellerId: row.assigned_seller_id,
    botPaused: row.bot_paused,
    notes: row.notes,
    tags: row.tags ?? [],
    nextFollowUpAt: row.next_follow_up_at,
    leadScore: row.lead_score ?? 0,
    trafficSource: row.traffic_source ?? null,
    trafficCampaignId: row.traffic_campaign_id ?? null,
    trafficCampaignName: row.traffic_campaign_name ?? null,
    trafficAdsetId: row.traffic_adset_id ?? null,
    trafficAdId: row.traffic_ad_id ?? null,
    utmSource: row.utm_source ?? null,
    utmMedium: row.utm_medium ?? null,
    utmCampaign: row.utm_campaign ?? null,
    utmContent: row.utm_content ?? null,
    utmTerm: row.utm_term ?? null,
    fbclid: row.fbclid ?? null,
    gclid: row.gclid ?? null,
    attributionMetadata,
    athleteName: attributionMetadata.athleteName ?? null,
    athleteVideoUrls: videoUrls,
    meetingStartsAt: row.meeting_starts_at ?? null,
    meetingEndsAt: row.meeting_ends_at ?? null,
    meetingSellerName: row.meeting_seller_name ?? null,
    meetingMeetUrl: row.meeting_meet_url ?? null,
    adhesionConfirmedAt: attributionMetadata.adhesionConfirmedAt ?? null,
    archivedAt: attributionMetadata.archivedAt ?? null,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at
  };
}
