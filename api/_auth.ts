import crypto from "node:crypto";
import { pool, mapSeller } from "./_db.js";

const sessionCookieName = "crm_session";
const sessionDays = 30;

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, hash] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(request: any) {
  const cookieHeader = String(request.headers?.cookie ?? "");
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function sessionCookie(token: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createCrmSession(response: any, userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);

  await pool.query(
    `
      insert into whatsapp_bot.crm_auth_sessions (user_id, token_hash, expires_at, last_seen_at)
      values ($1, $2, $3, now())
    `,
    [userId, hashToken(token), expiresAt]
  );

  response.setHeader("set-cookie", sessionCookie(token, sessionDays * 24 * 60 * 60));
}

export async function destroyCrmSession(request: any, response: any) {
  const token = parseCookies(request)[sessionCookieName];
  if (token) {
    await pool.query("delete from whatsapp_bot.crm_auth_sessions where token_hash = $1", [hashToken(token)]);
  }
  response.setHeader("set-cookie", clearSessionCookie());
}

export async function createCrmUser(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  if (!email || !email.includes("@")) throw new HttpError(400, "E-mail invalido.");
  if (!password || password.length < 6) throw new HttpError(400, "A senha precisa ter pelo menos 6 caracteres.");

  const client = await pool.connect();
  try {
    await client.query("begin");

    const existing = await client.query("select id from whatsapp_bot.crm_auth_users where lower(email) = lower($1)", [email]);
    if (existing.rowCount) throw new HttpError(409, "Este e-mail ja tem acesso ao CRM.");

    const countResult = await client.query<{ total: string }>("select count(*)::text as total from whatsapp_bot.crm_auth_users");
    const isFirstUser = Number(countResult.rows[0]?.total ?? 0) === 0;
    const displayName = email.split("@")[0] || "Vendedor";

    const sellerResult = await client.query(
      `
        insert into whatsapp_bot.sellers
          (name, email, region, role, active, approved_at, last_login_at)
        values
          ($1, $2, 'brasil', $3, $4, case when $4 then now() else null end, now())
        returning id, auth_user_id, name, email, region, role, active, approved_at, created_at
      `,
      [displayName, email, isFirstUser ? "admin" : "seller", isFirstUser]
    );

    const userResult = await client.query(
      `
        insert into whatsapp_bot.crm_auth_users (seller_id, email, password_hash, last_login_at)
        values ($1, $2, $3, now())
        returning id, email, seller_id
      `,
      [sellerResult.rows[0].id, email, hashPassword(password)]
    );

    await client.query("commit");
    return {
      user: userResult.rows[0],
      seller: mapSeller(sellerResult.rows[0])
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function loginCrmUser(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const { rows } = await pool.query(
    `
      select
        u.id as user_id,
        u.email,
        u.password_hash,
        s.id,
        s.auth_user_id,
        s.name,
        s.region,
        s.role,
        s.active,
        s.approved_at,
        s.created_at
      from whatsapp_bot.crm_auth_users u
      join whatsapp_bot.sellers s on s.id = u.seller_id
      where lower(u.email) = lower($1)
      limit 1
    `,
    [email]
  );

  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, "E-mail ou senha invalidos.");
  }

  await pool.query(
    "update whatsapp_bot.crm_auth_users set last_login_at = now(), updated_at = now() where id = $1",
    [row.user_id]
  );
  await pool.query("update whatsapp_bot.sellers set last_login_at = now() where id = $1", [row.id]);

  return {
    user: { id: row.user_id, email: row.email },
    seller: mapSeller(row)
  };
}

export async function ensureSeller(request: any, options: { requireActive?: boolean; requireAdmin?: boolean } = {}) {
  const token = parseCookies(request)[sessionCookieName];
  if (!token) throw new HttpError(401, "Login obrigatorio.");

  const { rows } = await pool.query(
    `
      select
        u.id as user_id,
        u.email,
        s.id,
        s.auth_user_id,
        s.name,
        s.region,
        s.role,
        s.active,
        s.approved_at,
        s.created_at
      from whatsapp_bot.crm_auth_sessions sess
      join whatsapp_bot.crm_auth_users u on u.id = sess.user_id
      join whatsapp_bot.sellers s on s.id = u.seller_id
      where sess.token_hash = $1
        and sess.expires_at > now()
      limit 1
    `,
    [hashToken(token)]
  );

  const row = rows[0];
  if (!row) throw new HttpError(401, "Sessao invalida ou expirada.");

  await pool.query(
    `
      update whatsapp_bot.crm_auth_sessions
      set last_seen_at = now()
      where token_hash = $1
        and last_seen_at < now() - interval '5 minutes'
    `,
    [hashToken(token)]
  );

  const seller = mapSeller(row);

  if (options.requireActive && !seller.active) {
    throw new HttpError(403, "Seu acesso ainda precisa ser aprovado pelo administrador.");
  }

  if (options.requireAdmin && seller.role !== "admin") {
    throw new HttpError(403, "Apenas administrador pode executar esta acao.");
  }

  return {
    user: { id: row.user_id, email: row.email },
    seller
  };
}

export function handleApiError(response: any, error: unknown) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  console.error("Unhandled API error", error);
  response.status(500).json({ error: "Erro interno." });
}
