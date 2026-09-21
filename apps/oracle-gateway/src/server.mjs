import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";

const required = ["DATABASE_URL", "JWT_SECRET", "GATEWAY_PUBLIC_ORIGIN"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}

const port = Number(process.env.PORT || 3200);
const postgrestOrigin = process.env.POSTGREST_ORIGIN || "http://127.0.0.1:3201";
const publicOrigin = process.env.GATEWAY_PUBLIC_ORIGIN.replace(/\/$/, "");
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "https://ec10talentos.com")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const jwtSecret = process.env.JWT_SECRET;
const jwtIssuer = process.env.JWT_ISSUER || "ec10-crm-oracle";
const accessTtlSeconds = Math.max(900, Number(process.env.ACCESS_TTL_SECONDS || 43200));
const refreshTtlDays = Math.max(1, Number(process.env.REFRESH_TTL_DAYS || 30));
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Math.max(2, Number(process.env.DB_POOL_MAX || 5)),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

const loginAttempts = new Map();
const maxLoginAttempts = Math.max(3, Number(process.env.MAX_LOGIN_ATTEMPTS || 7));
const loginWindowMs = Math.max(60_000, Number(process.env.LOGIN_WINDOW_MS || 900_000));
const maxLoginKeys = 10_000;

function base64url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("invalid_token");
  const expected = createHmac("sha256", jwtSecret).update(`${parts[0]}.${parts[1]}`).digest();
  const received = decodeBase64url(parts[2]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error("invalid_token");
  }
  const payload = JSON.parse(decodeBase64url(parts[1]).toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== jwtIssuer || payload.aud !== "authenticated" || payload.exp <= now) {
    throw new Error("expired_or_invalid_token");
  }
  return payload;
}

function unsafeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    return part ? JSON.parse(decodeBase64url(part).toString("utf8")) : null;
  } catch {
    return null;
  }
}

function accessTokenFor(user, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    exp: now + accessTtlSeconds,
    iat: now,
    iss: jwtIssuer,
    sub: user.id,
    email: user.email,
    phone: user.phone || "",
    role: "authenticated",
    aal: "aal1",
    session_id: sessionId,
    is_anonymous: false,
  };
  return { token: signJwt(payload), expiresAt: payload.exp };
}

function userShape(row) {
  return {
    id: row.id,
    aud: row.aud || "authenticated",
    role: row.role || "authenticated",
    email: row.email,
    phone: row.phone || "",
    email_confirmed_at: row.email_confirmed_at,
    phone_confirmed_at: row.phone_confirmed_at,
    confirmed_at: row.email_confirmed_at || row.phone_confirmed_at,
    last_sign_in_at: row.last_sign_in_at,
    app_metadata: row.raw_app_meta_data || { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data || {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: false,
  };
}

async function findUserByEmail(email) {
  const result = await pool.query(
    `select id, aud, role, email, phone, encrypted_password, email_confirmed_at,
            phone_confirmed_at, last_sign_in_at, raw_app_meta_data,
            raw_user_meta_data, created_at, updated_at
       from auth.users
      where lower(email) = lower($1)
        and deleted_at is null
      limit 1`,
    [email],
  );
  return result.rows[0] || null;
}

async function findUserById(id) {
  const result = await pool.query(
    `select id, aud, role, email, phone, encrypted_password, email_confirmed_at,
            phone_confirmed_at, last_sign_in_at, raw_app_meta_data,
            raw_user_meta_data, created_at, updated_at
       from auth.users
      where id = $1
        and deleted_at is null
      limit 1`,
    [id],
  );
  return result.rows[0] || null;
}

async function isProfileActive(user) {
  const result = await pool.query(
    `select is_active
       from public.profiles
      where auth_user_id = $1 or lower(email) = lower($2)
      order by (auth_user_id = $1) desc
      limit 1`,
    [user.id, user.email],
  );
  return result.rowCount > 0 && result.rows[0].is_active !== false;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function issueSession(user, request) {
  const sessionId = randomUUID();
  const refreshToken = base64url(randomBytes(48));
  const refreshExpiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);
  const agentHash = request.headers["user-agent"]
    ? createHash("sha256").update(request.headers["user-agent"]).digest("hex")
    : null;
  await pool.query(
    `insert into ec10_gateway_private.auth_sessions
       (token_hash, user_id, session_id, expires_at, user_agent_hash)
     values ($1, $2, $3, $4, $5)`,
    [tokenHash(refreshToken), user.id, sessionId, refreshExpiresAt, agentHash],
  );
  const access = accessTokenFor(user, sessionId);
  return {
    access_token: access.token,
    token_type: "bearer",
    expires_in: accessTtlSeconds,
    expires_at: access.expiresAt,
    refresh_token: refreshToken,
    user: userShape(user),
  };
}

async function rotateSession(refreshToken, request) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const session = await client.query(
      `select token_hash, user_id
         from ec10_gateway_private.auth_sessions
        where token_hash = $1
          and revoked_at is null
          and expires_at > now()
        for update`,
      [tokenHash(refreshToken)],
    );
    if (!session.rowCount) throw new Error("invalid_refresh_token");
    const userResult = await client.query(
      `select id, aud, role, email, phone, encrypted_password, email_confirmed_at,
              phone_confirmed_at, last_sign_in_at, raw_app_meta_data,
              raw_user_meta_data, created_at, updated_at
         from auth.users where id = $1 and deleted_at is null`,
      [session.rows[0].user_id],
    );
    const user = userResult.rows[0];
    if (!user || !(await isProfileActive(user))) throw new Error("invalid_refresh_token");
    const nextRefresh = base64url(randomBytes(48));
    const nextSessionId = randomUUID();
    const nextExpiry = new Date(Date.now() + refreshTtlDays * 86_400_000);
    const agentHash = request.headers["user-agent"]
      ? createHash("sha256").update(request.headers["user-agent"]).digest("hex")
      : null;
    await client.query(
      `update ec10_gateway_private.auth_sessions
          set revoked_at = now(), rotated_to_hash = $2
        where token_hash = $1`,
      [tokenHash(refreshToken), tokenHash(nextRefresh)],
    );
    await client.query(
      `insert into ec10_gateway_private.auth_sessions
         (token_hash, user_id, session_id, expires_at, user_agent_hash)
       values ($1, $2, $3, $4, $5)`,
      [tokenHash(nextRefresh), user.id, nextSessionId, nextExpiry, agentHash],
    );
    await client.query("commit");
    const access = accessTokenFor(user, nextSessionId);
    return {
      access_token: access.token,
      token_type: "bearer",
      expires_in: accessTtlSeconds,
      expires_at: access.expiresAt,
      refresh_token: nextRefresh,
      user: userShape(user),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, apikey, content-type, accept-profile, content-profile, prefer, range, x-client-info",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Expose-Headers", "Content-Range, Range-Unit, X-Request-Id");
}

function sendJson(request, response, status, payload, extraHeaders = {}) {
  setCors(request, response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(status === 204 ? undefined : JSON.stringify(payload));
}

async function readJson(request, limit = 65_536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearer(request) {
  const header = request.headers.authorization || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function loginRateKey(request, email) {
  return `${clientIp(request)}:${String(email || "").trim().toLowerCase()}`;
}

function canAttemptLogin(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < loginWindowMs);
  if (attempts.length) loginAttempts.set(key, attempts);
  else loginAttempts.delete(key);
  return attempts.length < maxLoginAttempts;
}

function recordLoginFailure(key) {
  if (loginAttempts.size >= maxLoginKeys) {
    for (const [entryKey, times] of loginAttempts) {
      if (times.every((time) => Date.now() - time >= loginWindowMs)) loginAttempts.delete(entryKey);
    }
    while (loginAttempts.size >= maxLoginKeys) loginAttempts.delete(loginAttempts.keys().next().value);
  }
  const attempts = (loginAttempts.get(key) || []).filter((time) => Date.now() - time < loginWindowMs);
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

async function handleAuth(request, response, url) {
  if (request.method === "GET" && url.pathname === "/auth/v1/settings") {
    return sendJson(request, response, 200, {
      external: {},
      disable_signup: true,
      mailer_autoconfirm: false,
      phone_autoconfirm: false,
    });
  }

  if (request.method === "GET" && url.pathname === "/auth/v1/health") {
    return sendJson(request, response, 200, { version: "ec10-oracle-1", name: "GoTrue-compatible" });
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/token") {
    const grantType = url.searchParams.get("grant_type");
    const body = await readJson(request);
    if (grantType === "password") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const rateKey = loginRateKey(request, email);
      if (!canAttemptLogin(rateKey)) {
        return sendJson(request, response, 429, {
          code: "over_request_rate_limit",
          message: "Muitas tentativas. Aguarde alguns minutos.",
        });
      }
      const user = email && password ? await findUserByEmail(email) : null;
      const valid = user?.encrypted_password
        ? await bcrypt.compare(password, user.encrypted_password).catch(() => false)
        : false;
      if (!valid || !(await isProfileActive(user))) {
        recordLoginFailure(rateKey);
        return sendJson(request, response, 400, {
          code: "invalid_credentials",
          message: "E-mail ou senha inválidos.",
        });
      }
      loginAttempts.delete(rateKey);
      await pool.query("update auth.users set last_sign_in_at = now() where id = $1", [user.id]);
      user.last_sign_in_at = new Date().toISOString();
      return sendJson(request, response, 200, await issueSession(user, request));
    }
    if (grantType === "refresh_token") {
      try {
        const result = await rotateSession(String(body.refresh_token || ""), request);
        return sendJson(request, response, 200, result);
      } catch {
        return sendJson(request, response, 400, {
          code: "refresh_token_not_found",
          message: "Sessão expirada. Entre novamente.",
        });
      }
    }
    return sendJson(request, response, 400, { code: "unsupported_grant_type", message: "Fluxo não suportado." });
  }

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    try {
      const claims = verifyJwt(bearer(request));
      const user = await findUserById(claims.sub);
      if (!user || !(await isProfileActive(user))) throw new Error("inactive_user");
      return sendJson(request, response, 200, userShape(user));
    } catch {
      return sendJson(request, response, 401, { code: "bad_jwt", message: "Sessão inválida." });
    }
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/logout") {
    try {
      const claims = verifyJwt(bearer(request));
      await pool.query(
        "update ec10_gateway_private.auth_sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1",
        [claims.sub],
      );
    } catch {
      // Logout remains idempotent even when the access token has expired.
    }
    return sendJson(request, response, 204, null);
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/signup") {
    return sendJson(request, response, 403, {
      code: "signup_disabled",
      message: "Novos acessos são criados somente pelo superadministrador.",
    });
  }

  return sendJson(request, response, 404, { code: "not_found", message: "Rota de autenticação inexistente." });
}

function proxyToPostgrest(request, response, url, requestId) {
  const upstreamPath = url.pathname.replace(/^\/rest\/v1/, "") || "/";
  const headers = { ...request.headers, host: new URL(postgrestOrigin).host, "x-request-id": requestId };
  delete headers["content-length"];
  const incomingToken = bearer(request);
  const incomingClaims = unsafeJwtPayload(incomingToken);
  if (!incomingToken || (incomingClaims?.role === "anon" && incomingClaims?.iss !== jwtIssuer)) {
    delete headers.authorization;
  }
  delete headers.apikey;
  const upstream = http.request(
    `${postgrestOrigin}${upstreamPath}${url.search}`,
    { method: request.method, headers },
    (upstreamResponse) => {
      setCors(request, response);
      const responseHeaders = { ...upstreamResponse.headers, "x-request-id": requestId };
      delete responseHeaders["access-control-allow-origin"];
      response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );
  upstream.setTimeout(20_000, () => upstream.destroy(new Error("upstream_timeout")));
  upstream.on("error", (error) => {
    if (!response.headersSent) {
      sendJson(request, response, 503, {
        code: "database_gateway_unavailable",
        message: "CRM temporariamente indisponível. Tente novamente em instantes.",
        request_id: requestId,
      });
    } else {
      response.destroy(error);
    }
  });
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      requestId,
      method: request.method,
      path: request.url?.split("?")[0],
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    }));
  });

  try {
    const url = new URL(request.url || "/", publicOrigin);
    if (request.method === "OPTIONS") {
      setCors(request, response);
      response.writeHead(204);
      return response.end();
    }
    if (url.pathname === "/health/live") {
      return sendJson(request, response, 200, { ok: true, service: "ec10-crm-gateway" });
    }
    if (url.pathname === "/health/ready") {
      await pool.query("select 1");
      const postgrest = await fetch(`${postgrestOrigin}/profiles?select=id&limit=0`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (!postgrest.ok) throw new Error(`postgrest_not_ready_${postgrest.status}`);
      return sendJson(request, response, 200, { ok: true, database: "ready", postgrest: "ready" });
    }
    if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(request, response, url);
    if (url.pathname.startsWith("/rest/v1/")) return proxyToPostgrest(request, response, url, requestId);
    if (url.pathname.startsWith("/storage/v1/") || url.pathname.startsWith("/functions/v1/")) {
      return sendJson(request, response, 503, {
        code: "module_in_maintenance",
        message: "Este módulo está em migração para o ambiente antifalhas.",
      });
    }
    return sendJson(request, response, 404, { code: "not_found", message: "Rota inexistente." });
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), requestId, error: error.message }));
    return sendJson(request, response, error.message === "payload_too_large" ? 413 : 500, {
      code: "gateway_error",
      message: "Não foi possível concluir a operação.",
      request_id: requestId,
    });
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "started", port }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "shutdown", signal }));
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
