import asyncio
import re
from .config import Settings
from .database import Database
from .gemini import GeminiSDR
from .meta import MetaWhatsApp
from .safety import (
    booking_gate,
    merge_state,
    sanitize_ai_reply,
    validate_reply,
)
from .models import Decision


class Worker:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Database(settings.database_url, settings.gustavo_v2_debounce_seconds)
        self.ai = GeminiSDR(settings.gemini_api_key, settings.gemini_model, settings.gemini_secondary_model)
        self.meta = MetaWhatsApp(settings.meta_graph_version, settings.meta_phone_number_id, settings.meta_whatsapp_access_token)
        self.stop_event = asyncio.Event()

    def permitted(self, phone: str) -> bool:
        allowed = self.settings.allowed_phones
        return self.settings.gustavo_v2_enabled and (not allowed or phone in allowed)

    async def ingest_once(self):
        event = await self.db.claim_event()
        if not event:
            return False
        try:
            await self.db.ingest_event(event["payload"])
            await self.db.complete_event(event["id"])
        except Exception as exc:
            await self.db.complete_event(event["id"], f"{type(exc).__name__}: {exc}")
        return True

    async def converse_once(self):
        batch = await self.db.claim_conversation()
        if not batch:
            return False
        phone = batch["phone"]
        rows = batch["rows"]
        ids = [row["id"] for row in rows]
        inbound = "\n".join(row["body"] for row in rows if row["body"]).strip()
        if not self.permitted(phone):
            await self.db.defer_conversation(ids, "V2 ainda não liberado para este contato")
            return True
        try:
            before, history, client_id, recent_replies = await self.db.conversation_context(phone)
            stage = before.get("stage")
            if stage not in {"rapport", "discovery", "fit", "guardian", "offer", "booking", "waiting_booking", "human"}:
                stage = "discovery"
            observed = merge_state(before, Decision(reply="Estado atualizado.", stage=stage), inbound)
            decision, latency, generation_errors = await self.ai.decide(observed, history, inbound)
            after = merge_state(observed, decision, inbound)
            if not before.get("company_intro_sent"):
                after["company_intro_sent"] = True
            reply = sanitize_ai_reply(decision.reply, after)
            audio_key = decision.audio_key
            age = after.get("athlete_age")
            expected_audio = None
            if isinstance(age, int) and 9 <= age <= 13:
                expected_audio = "eric_8_13"
            elif isinstance(age, int) and 14 <= age <= 18:
                expected_audio = "eric_14_18"
            elif isinstance(age, int) and 20 <= age <= 25:
                expected_audio = "eric_20_25"
            if audio_key in set(after.get("audio_sent") or []):
                audio_key = None
            elif audio_key and expected_audio:
                audio_key = expected_audio
            elif audio_key:
                audio_key = None
            errors = validate_reply(reply, after)
            if errors:
                raise RuntimeError("resposta_da_ia_rejeitada:" + ",".join(errors))
            explicit_booking_request = bool(re.search(
                r"\b(?:quero|vamos|pode|podemos|gostaria)\b.*\b(?:agendar|marcar|reuni[aã]o)\b|"
                r"\b(?:manda|envia|reenvia|cad[eê]|onde|qual)\b.*\blink\b|"
                r"\blink\b.*\b(?:manda|envia|reenvia|cad[eê]|onde)\b",
                inbound,
                re.I,
            ))
            if before.get("booking_url") and not explicit_booking_request:
                booking_requested = False
            else:
                booking_requested = bool(
                    decision.booking_ready
                    or (after.get("meeting_interest") and not before.get("meeting_interest"))
                    or (before.get("booking_url") and explicit_booking_request)
                )
            booking_allowed, gate_reason = booking_gate(after, booking_requested)
            if booking_allowed and client_id:
                service = after.get("service_interest")
                if service not in {"plano_carreira", "plano_internacional", "eurocamp"}:
                    service = "plano_carreira"
                role = "responsavel" if int(after.get("athlete_age") or 99) < 18 else ("responsavel" if after.get("contact_role") == "responsavel" else "atleta")
                booking_url = after.get("booking_url")
                if not booking_url:
                    booking_url = await self.db.create_booking_url(client_id, service, after["contact_name"], role)
                after["booking_url"] = booking_url
                after["stage"] = "waiting_booking"
                if booking_url not in reply:
                    reply = f"{reply}\n\n{booking_url}"
            elif booking_requested and gate_reason:
                after["stage"] = "guardian" if gate_reason == "responsavel_nao_confirmado" else after.get("stage", "offer")
            if before.get("booking_url") and not explicit_booking_request:
                reply = reply.replace(str(before["booking_url"]), "o link que já enviei")
                reply = re.sub(r"https://ec10talentos\.com/agendar\S+", "o link que já enviei", reply)
            media_id = self.settings.media_id(audio_key)
            if audio_key in after.get("audio_sent", []):
                audio_key = None
            await self.db.supersede_pending_outbox(phone)
            if audio_key and media_id:
                await self.db.enqueue(phone, f"reply:{ids[0]}-{ids[-1]}", "text", {"text": reply})
                await self.db.enqueue(phone, f"audio:{audio_key}:{ids[0]}", "audio", {"media_id": media_id})
                after.setdefault("audio_sent", []).append(audio_key)
            else:
                await self.db.enqueue(phone, f"reply:{ids[0]}-{ids[-1]}", "text", {"text": reply})
            await self.db.finish_turn(phone, ids, inbound, reply, self.settings.gemini_model, latency, before, after,
                                      {"errors": errors + generation_errors, "booking_gate": gate_reason})
        except Exception as exc:
            await self.db.retry_conversation(ids, f"{type(exc).__name__}: {exc}")
        return True

    async def send_once(self):
        item = await self.db.claim_outbox()
        if not item:
            return False
        try:
            payload = item["payload"]
            recipient = self.settings.recipient_phone(item["phone"])
            if item["message_type"] == "audio":
                meta_id = await self.meta.send_audio(recipient, payload["media_id"])
            else:
                meta_id = await self.meta.send_text(recipient, payload["text"])
            await self.db.finish_outbox(item["id"], meta_id=meta_id)
        except Exception as exc:
            await self.db.finish_outbox(item["id"], error=f"{type(exc).__name__}: {exc}")
        return True

    async def run(self):
        while not self.stop_event.is_set():
            worked = False
            worked = await self.ingest_once() or worked
            # While disabled, receive and persist events but never generate or send
            # a customer-facing message. This makes the production service safe to
            # install before the Meta test number and credentials are ready.
            if self.settings.gustavo_v2_enabled:
                worked = await self.converse_once() or worked
                worked = await self.send_once() or worked
            if not worked:
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=self.settings.gustavo_v2_poll_seconds)
                except asyncio.TimeoutError:
                    pass

    async def stop(self):
        self.stop_event.set()
        await self.meta.close()
