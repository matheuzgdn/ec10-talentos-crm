import crypto from "node:crypto";
import { bookingPool } from "./_booking-db.js";
import { HttpError, verifyPassword } from "./_auth.js";

const cookieName = "ec10_booking_session";

function parseCookies(request: any) {
  return Object.fromEntries(String(request.headers?.cookie ?? "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return index < 0 ? [item, ""] : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
  }));
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function loginBookingSeller(response: any, emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const { rows } = await bookingPool.query(`
    select u.id as user_id, u.password_hash, s.id, s.name, s.email, s.active, s.role
    from whatsapp_bot.crm_auth_users u
    join whatsapp_bot.sellers s on s.id = u.seller_id
    where lower(u.email) = lower($1) limit 1
  `, [email]);
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(401, "E-mail ou senha invalidos.");
  if (!row.active) throw new HttpError(403, "Seu acesso ainda precisa ser aprovado.");
  const token = crypto.randomBytes(32).toString("base64url");
  await bookingPool.query(`insert into whatsapp_bot.crm_auth_sessions (user_id, token_hash, expires_at, last_seen_at) values ($1,$2,now()+interval '30 days',now())`, [row.user_id, hash(token)]);
  response.setHeader("set-cookie", `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`);
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export async function ensureBookingSeller(request: any) {
  const token = parseCookies(request)[cookieName];
  if (!token) throw new HttpError(401, "Login obrigatorio.");
  const { rows } = await bookingPool.query(`
    select s.id, s.name, s.email, s.active, s.role
    from whatsapp_bot.crm_auth_sessions sess
    join whatsapp_bot.crm_auth_users u on u.id = sess.user_id
    join whatsapp_bot.sellers s on s.id = u.seller_id
    where sess.token_hash = $1 and sess.expires_at > now() limit 1
  `, [hash(token)]);
  const seller = rows[0];
  if (!seller || !seller.active) throw new HttpError(401, "Sessao invalida ou acesso inativo.");
  return { id: seller.id, name: seller.name, email: seller.email, role: seller.role };
}
