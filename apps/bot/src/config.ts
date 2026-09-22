import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(currentDir, "../../../.env"), quiet: true });
loadEnv({ quiet: true });

const schema = z.object({
  BOT_ENABLED: z.string().default("false"),
  BOT_TRANSPORT_DIAGNOSTIC_ONLY: z.string().default("false"),
  BOT_INSTANCE_ID: z.string().default("main"),
  BOT_INSTANCE_LABEL: z.string().default("WhatsApp principal"),
  BOT_SESSION_PATH: z.string().default("./whatsapp-session"),
  BOT_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  BOT_STATUS_HEARTBEAT_MS: z.coerce.number().default(120_000),
  BOT_QR_RUNTIME_PERSIST_MS: z.coerce.number().default(120_000),
  BOT_DEFAULT_COUNTRY_CODE: z.string().default("55"),
  BOT_AUDIO_DIR: z.string().default("./media/audio"),
  BOT_QR_PATH: z.string().default("./runtime/whatsapp-qr.png"),
  BOT_QR_TEXT_PATH: z.string().default("./runtime/whatsapp-qr.txt"),
  BOT_STATUS_PATH: z.string().default("./runtime/bot-status.json"),
  BOT_HTTP_ENABLED: z.string().default("true"),
  BOT_HTTP_HOST: z.string().default("0.0.0.0"),
  BOT_HTTP_PORT: z.coerce.number().default(3001),
  BOT_HTTP_TOKEN: z.string().min(32).optional(),
  BOT_PROTOCOL_TIMEOUT_MS: z.coerce.number().default(300_000),
  WHATSAPP_WEB_VERSION_CACHE: z.enum(["none", "local"]).default("none"),
  WHATSAPP_WEB_USER_AGENT: z.string().default(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
  ),
  WHATSAPP_DEVICE_NAME: z.string().default("EC10 Oraculo CRM"),
  WHATSAPP_BROWSER_NAME: z.string().default("Chrome"),
  WHATSAPP_OUTBOUND_MIN_READY_MS: z.coerce.number().default(30_000),
  WHATSAPP_DELIVERY_ACK_TIMEOUT_MS: z.coerce.number().default(45_000),
  WHATSAPP_PENDING_ACK_RETRY_MS: z.coerce.number().default(10 * 60_000),
  WHATSAPP_MAX_DELIVERY_ATTEMPTS: z.coerce.number().default(3),
  WHATSAPP_HEAVY_OPS_MIN_READY_MS: z.coerce.number().default(10 * 60_000),
  WHATSAPP_HEAVY_OPS_COOLDOWN_MS: z.coerce.number().default(5 * 60_000),
  WHATSAPP_REPEATED_LOGOUT_WINDOW_MS: z.coerce.number().default(20 * 60_000),
  WHATSAPP_SAFE_MODE_AFTER_LOGOUTS: z.coerce.number().default(2),
  WHATSAPP_SAFE_MODE_MS: z.coerce.number().default(45 * 60_000),
  WHATSAPP_GROUP_AUTOMATION_ENABLED: z.string().default("false"),
  WHATSAPP_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(30),
  WHATSAPP_MAX_OUTBOUND_PER_CONTACT_WINDOW: z.coerce.number().default(8),
  WHATSAPP_AUDIO_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(24 * 60),
  WHATSAPP_MAX_AUDIO_PER_CONTACT_WINDOW: z.coerce.number().default(4),
  BOT_INBOUND_RESPONSE_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(8_000),
  BOT_OUTBOUND_ALLOWED_PREFIXES: z.string().default(""),
  BOT_TEST_ALLOWED_PHONES: z.string().default(""),
  BOT_AI_ENABLED: z.string().default("true"),
  BOT_AI_MODE: z.enum(["fallback", "primary"]).default("fallback"),
  BOT_AI_AUDIO_ENABLED: z.string().default("false"),
  BOT_AI_FALLBACK_ENABLED: z.string().default("true"),
  BOT_AI_FALLBACK_DAILY_LIMIT: z.coerce.number().default(250),
  BOT_AI_PROVIDER: z.enum(["auto", "ollama", "gemini", "groq"]).default("auto"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen3:4b"),
  OLLAMA_AUDIO_MODEL: z.string().default("gemma4:e2b"),
  OLLAMA_KEEP_ALIVE: z.string().default("5m"),
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
  OLLAMA_AUDIO_TIMEOUT_MS: z.coerce.number().default(180_000),
  OLLAMA_NUM_CTX: z.coerce.number().default(2048),
  OLLAMA_AUDIO_NUM_CTX: z.coerce.number().default(4096),
  OLLAMA_MAX_AUDIO_BYTES: z.coerce.number().default(8_000_000),
  OLLAMA_AUDIO_MAX_SECONDS: z.coerce.number().default(90),
  OLLAMA_AUDIO_MAX_OUTPUT_TOKENS: z.coerce.number().default(1600),
  GROQ_API_KEY: z.string().optional(),
  GROQ_API_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_FALLBACK_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_SECONDARY_FALLBACK_MODEL: z.string().default("qwen/qwen3.8-27b"),
  GROQ_AUDIO_MODEL: z.string().default("whisper-large-v3-turbo"),
  GROQ_REQUEST_TIMEOUT_MS: z.coerce.number().default(18_000),
  GROQ_MAX_AUDIO_BYTES: z.coerce.number().default(20_000_000),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_AUDIO_MODEL: z.string().default("gemini-2.5-flash-lite"),
  GEMINI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(2000).max(30000).default(6000),
  GEMINI_MAX_AUDIO_BYTES: z.coerce.number().default(8_000_000),
  GUSTAVO_V2_ORACLE_URL: z.string().url().optional(),
  GUSTAVO_V2_ORACLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(12000),
  EC10_GOOGLE_MEET_URL: z.string().optional(),
  EC10_BOOKING_PUBLIC_BASE_URL: z.string().url().default("https://cliente-whatsapp-crm.vercel.app"),
  EC10_SELLER_NAME: z.string().default("Igor Jardins"),
  EC10_SELLER_PHONE: z.string().default("+55 31 8233-1411"),
  EC10_INTERNATIONAL_SELLER_NAME: z.string().optional(),
  EC10_INTERNATIONAL_SELLER_PHONE: z.string().optional(),
  EC10_CAREER_SELLER_NAME: z.string().optional(),
  EC10_CAREER_SELLER_PHONE: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v25.0"),
  META_PIXEL_ID: z.string().optional(),
  META_CAPI_ACCESS_TOKEN: z.string().optional(),
  CHROME_EXECUTABLE_PATH: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),
  BOT_DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default("public")
});

const parsedConfig = schema.parse(process.env);

function normalizeBotInstanceId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "main";
}

const botInstanceId = normalizeBotInstanceId(parsedConfig.BOT_INSTANCE_ID);

export const config = {
  ...parsedConfig,
  BOT_INSTANCE_ID: botInstanceId,
  BOT_INSTANCE_LABEL: parsedConfig.BOT_INSTANCE_LABEL.trim() || (
    botInstanceId === "main" ? "WhatsApp principal" : botInstanceId
  ),
  EC10_INTERNATIONAL_SELLER_NAME: parsedConfig.EC10_INTERNATIONAL_SELLER_NAME || parsedConfig.EC10_SELLER_NAME,
  EC10_INTERNATIONAL_SELLER_PHONE: parsedConfig.EC10_INTERNATIONAL_SELLER_PHONE || parsedConfig.EC10_SELLER_PHONE,
  EC10_CAREER_SELLER_NAME: parsedConfig.EC10_CAREER_SELLER_NAME || "Sandro",
  EC10_CAREER_SELLER_PHONE: parsedConfig.EC10_CAREER_SELLER_PHONE || "+55 31 8876-4692"
};

export const mainBotInstanceId = "main";

export function runtimeKeyForInstance(key: string, instanceId = config.BOT_INSTANCE_ID) {
  return instanceId === mainBotInstanceId ? key : `${key}:${instanceId}`;
}

export const hasServerSupabaseConfig = Boolean(
  config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
);

export const hasDirectDatabaseConfig = Boolean(config.SUPABASE_DB_URL);
