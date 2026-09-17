import pg from "pg";

let database: pg.Pool | null = null;

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
      return getPool().query<T>(text as any, params as any);
    });
  },

  async connect(): Promise<pg.PoolClient> {
    return retryConnectionLimit(async () => {
      return getPool().connect();
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
