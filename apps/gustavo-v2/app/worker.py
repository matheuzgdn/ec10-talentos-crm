import asyncio
import hashlib
import json
from .config import Settings
from .database import Database
from .gemini import GeminiSDR
from .meta import MetaWhatsApp
from .safety import booking_gate, fallback_reply, merge_state, validate_reply


class Worker:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Database(settings.database_url)
        self.ai = GeminiSDR(settings.gemini_api_key, settings.gemini_model)
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
            before, history, client_id = await self.db.conversation_context(phone)
            decision, latency, generation_errors = await self.ai.decide(before, history, inbound)
            after = merge_state(before, decision)
            reply = " ".join(decision.reply.split()).strip()
            errors = validate_reply(reply, after)
            if errors:
                reply = fallback_reply(after)
            booking_allowed, gate_reason = booking_gate(after, decision.booking_ready)
            if booking_allowed and client_id:
                service = after.get("service_interest")
                if service not in {"plano_carreira", "plano_internacional", "eurocamp"}:
                    service = "plano_carreira"
                role = "responsavel" if int(after.get("athlete_age") or 99) < 18 else ("responsavel" if after.get("contact_role") == "responsavel" else "atleta")
                booking_url = await self.db.create_booking_url(client_id, service, after["contact_name"], role)
                after["booking_url"] = booking_url
                after["stage"] = "waiting_booking"
                reply = reply.rstrip(" .") + ".\n\nEscolha primeiro o dia e depois o horário disponível:\n" + booking_url
            audio_key = decision.audio_key
            media_id = self.settings.media_id(audio_key)
            if audio_key in after.get("audio_sent", []):
                audio_key = None
            if audio_key and media_id:
                await self.db.enqueue(phone, f"audio:{audio_key}:{ids[0]}", "audio", {"media_id": media_id})
                after.setdefault("audio_sent", []).append(audio_key)
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
            if item["message_type"] == "audio":
                meta_id = await self.meta.send_audio(item["phone"], payload["media_id"])
            else:
                meta_id = await self.meta.send_text(item["phone"], payload["text"])
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
