export const SELLERS = Object.freeze({
  augustin: Object.freeze({ name: "Augustin", phone: "5493513804731", routeKey: "es" }),
  pablo: Object.freeze({ name: "Pablo", phone: "351914945252", routeKey: "international" }),
  igor: Object.freeze({ name: "Igor Jardins", phone: "553182331411", routeKey: "career" })
});

const SPANISH_WORDS = /\b(?:hola|buenas|quiero|quisiera|tengo|años|anos|hijo|hija|padre|madre|responsable|jugador|futbol|fútbol|reuni[oó]n|agendar|horario|vos|usted|puedo|puede)\b/i;

export function digits(value = "") {
  return String(value).replace(/\D/g, "");
}

export function detectLanguage(messages = [], phone = "") {
  const sample = messages.slice(-8).filter(item => item.direction === "inbound").map(item => item.text).join(" ");
  if (SPANISH_WORDS.test(sample)) return "es";
  const number = digits(phone);
  if (/^(?:54|595|56|57|598|591|593|51|52)/.test(number)) return "es";
  return "pt";
}

export function inferService({ language = "pt", athleteAge = null, explicitService = null } = {}) {
  if (language === "es") {
    if (explicitService === "eurocamp") return "eurocamp";
    if (Number.isInteger(athleteAge) && athleteAge >= 18) return "plano_internacional";
    return explicitService === "plano_internacional" ? explicitService : "plano_carreira";
  }
  if (Number.isInteger(athleteAge) && athleteAge >= 18) return "plano_internacional";
  if (["plano_carreira", "plano_internacional", "eurocamp"].includes(explicitService)) return explicitService;
  return "plano_carreira";
}

export function selectSeller({ language = "pt", athleteAge = null, serviceInterest = null } = {}) {
  if (language === "es") return SELLERS.augustin;
  const service = inferService({ language, athleteAge, explicitService: serviceInterest });
  return service === "plano_internacional" ? SELLERS.pablo : SELLERS.igor;
}

export function inferCampaignService(messages = []) {
  const text = messages.map(item => item.text).join(" ").toLowerCase();
  if (/eurocamp|eurokids/.test(text)) return "eurocamp";
  if (/plano internacional|plan internacional/.test(text)) return "plano_internacional";
  if (/plano de carreira|plan de carrera/.test(text)) return "plano_carreira";
  return null;
}

export function buildSellerNotification({ seller, contactName, athleteName, athleteAge, phone, booking }) {
  const startsAt = new Date(booking.starts_at);
  const local = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(startsAt);
  return [
    `📅 Nova reunião EC10 — ${booking.service_label || "atendimento comercial"}`,
    `Data: ${local} (horário de Brasília)`,
    `Contato: ${contactName || "não informado"}`,
    athleteName ? `Atleta: ${athleteName}` : null,
    Number.isInteger(athleteAge) ? `Idade: ${athleteAge} anos` : null,
    `WhatsApp do lead: +${digits(phone)}`,
    `Vendedor: ${seller.name}`,
    "Agendamento confirmado e salvo na agenda do CRM."
  ].filter(Boolean).join("\n");
}
