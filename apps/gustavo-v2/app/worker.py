import asyncio
import hashlib
import json
import re
from .config import Settings
from .database import Database
from .gemini import GeminiSDR
from .meta import MetaWhatsApp
from .safety import avoid_repeated_reply, booking_gate, enforce_ec10_flow, fallback_reply, guardian_fast_path, merge_state, validate_reply


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
            before, history, client_id, previous_reply = await self.db.conversation_context(phone)
            decision = guardian_fast_path(before, inbound)
            if decision:
                latency = 0
                generation_errors = []
            else:
                decision, latency, generation_errors = await self.ai.decide(before, history, inbound)
            after = merge_state(before, decision, inbound)
            model_reply = " ".join(decision.reply.split()).strip()
            reply, audio_key = enforce_ec10_flow(before, after, model_reply, decision.audio_key)
            deterministic_reply = reply != model_reply or audio_key != decision.audio_key
            errors = validate_reply(reply, after)
            if errors or ("gemini_fallback_local" in generation_errors and not deterministic_reply):
                reply = fallback_reply(after, inbound)
            explicit_booking_request = bool(re.search(
                r"\b(?:link|agenda|agendar|marcar|reuni[aã]o)\b", inbound, re.I
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
                reply = (
                    f"Perfeito, {after['contact_name']}. Agora é só escolher primeiro o dia e depois o horário "
                    f"que funciona melhor para vocês:\n\n{booking_url}"
                )
            elif booking_requested and gate_reason == "responsavel_nao_confirmado":
                athlete = after.get("athlete_name") or "o atleta"
                after["stage"] = "guardian"
                reply = (
                    f"Como {athlete} é menor de idade, a conversa precisa acontecer com quem acompanha as decisões da carreira. "
                    "Você é o responsável por ele?"
                )
            elif booking_requested and gate_reason == "audio_eric_nao_enviado":
                after["stage"] = "offer"
                audio_key = "eric_14_18" if int(after.get("athlete_age") or 0) >= 14 else "eric_8_13"
                reply = (
                    "Antes da agenda, vou te mandar o áudio curto do Eric para você conhecer a proposta do Plano de Carreira. "
                    "Depois a gente já segue para a reunião."
                )
            reply = avoid_repeated_reply(reply, previous_reply, after, inbound)
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
