import crypto from "node:crypto";
import { bookingPool } from "./_booking-db.js";
import { ensureBookingSeller } from "./_booking-auth.js";
import { handleApiError, HttpError } from "./_auth.js";
import {bookingProgramLabel} from './_booking-label.js';

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utcStamp(value: string | Date) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function serviceLabel(service: string) {
  if (service === "plano_carreira") return "Plano de Carreira";
  if (service === "plano_internacional") return "Plano Internacional";
  return "Eurocamp";
}

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") return response.status(405).json({ error: "Metodo nao permitido." });
  try {
    const id = String(request.query?.id ?? "");
    const token = String(request.query?.t ?? "");
    const hashed = token ? crypto.createHash("sha256").update(token).digest("hex") : "";
    let sellerId: string | null = null;
    if (!token) sellerId = (await ensureBookingSeller(request)).id;
    const { rows } = await bookingPool.query(`
      select b.*, s.name as seller_name
      from whatsapp_bot.ec10_bookings b join whatsapp_bot.sellers s on s.id = b.seller_id
      where b.id = $1 and b.status = 'confirmed'
        and (b.access_token_hash = $2 or b.seller_id = $3 or exists(
          select 1 from whatsapp_bot.ec10_bot_booking_links l where l.access_token_hash=$2
            and l.booking_id=b.id and l.client_id=b.client_id and l.service=b.service))
      limit 1
    `, [id, hashed, sellerId]);
    const booking = rows[0];
    if (!booking) throw new HttpError(404, "Reserva nao encontrada.");
    const title = `EC10 | ${bookingProgramLabel(booking.service,booking.athlete_age)} | Reuniao com ${booking.seller_name}`;
    const description = `Reuniao EC10 com ${booking.contact_name}. Detalhes e link da chamada serao confirmados pelo WhatsApp.`;
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EC10 Talentos//Agendamento//PT-BR",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      `UID:${booking.id}@ec10talentos.com`, `DTSTAMP:${utcStamp(new Date())}`,
      `DTSTART:${utcStamp(booking.starts_at)}`, `DTEND:${utcStamp(booking.ends_at)}`,
      `SUMMARY:${escapeIcs(title)}`, `DESCRIPTION:${escapeIcs(description)}`,
      "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR", ""
    ].join("\r\n");
    response.setHeader("content-type", "text/calendar; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="ec10-reuniao-${booking.id}.ics"`);
    response.setHeader("cache-control", "private, no-store");
    response.status(200).send(ics);
  } catch (error) {
    handleApiError(response, error);
  }
}
