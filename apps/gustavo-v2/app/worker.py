import asyncio
import logging
import re
from .config import Settings
from .database import Database
from .gemini import GeminiSDR
from .meta import MetaWhatsApp
from .safety import (
    booking_gate,
    merge_state,
    validate_reply,
)
from .models import Decision


class Worker:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Database(settings.database_url, settings.gustavo_v2_debounce_seconds)
        self.ai = GeminiSDR(settings.gemini_api_key, settings.gemini_model, settings.gemini_secondary_model,
                            settings.gemini_thinking_level, settings.gemini_timeout_seconds)
        self.meta = MetaWhatsApp(settings.meta_graph_version, settings.meta_phone_number_id, settings.meta_whatsapp_access_token)
        self.stop_event = asyncio.Event()
        self.loop_errors: dict[str, str] = {}

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
            internal = [row for row in rows if row.get("message_type") == "internal_followup"]
            event_context = None
            if internal and not inbound:
                event_context = internal[-1]["raw_message"]
                if before.get("booking_url") or before.get("stage") == "human":
                    await self.db.finish_turn(phone, ids, "", "", self.settings.gemini_model, 0,
                                              before, before, {"followup_cancelled": True})
                    return True
                if not await self.db.followup_audio_delivered(event_context["source_outbox_id"]):
                    await self.db.defer_audio_followup(ids)
                    return True
            stage = before.get("stage")
            if stage not in {"rapport", "discovery", "fit", "guardian", "offer", "booking", "waiting_booking", "human"}:
                stage = "discovery"
            observed = merge_state(before, Decision(reply="Estado atualizado.", stage=stage), inbound)
            decision, latency, generation_errors = await self.ai.decide(observed, history, inbound,
                                                                      event_context=event_context)
            route_model = next((entry.split(":", 1)[1] for entry in generation_errors if entry.startswith("ai_route:")),
                               self.settings.gemini_model)
            after = merge_state(observed, decision, inbound)
            if not before.get("company_intro_sent"):
                after["company_intro_sent"] = True
            reply = decision.reply.strip()
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
            if "conteudo_tecnico_visivel" in errors:
                raise RuntimeError("resposta_da_ia_rejeitada:" + ",".join(errors))
            if await self.db.has_newer_inbound(phone, ids[-1]):
                # Preserve newly learned facts, but don't send an outdated question
                # or create an unsent booking link for an already answered turn.
                await self.db.finish_turn(phone, ids, inbound, "", route_model,
                                          latency, before, after,
                                          {"superseded_by_new_inbound": True})
                return True
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
            messages = [{"key": f"reply:{ids[0]}-{ids[-1]}", "message_type": "text", "payload": {"text": reply}}]
            if audio_key and media_id:
                messages.append({"key": f"audio:{audio_key}:{ids[0]}", "message_type": "audio", "payload": {
                    "media_id": media_id, "followup_delay_seconds": decision.followup_delay_seconds,
                }})
                after.setdefault("audio_sent", []).append(audio_key)
            await self.db.finish_turn(phone, ids, inbound, reply, route_model, latency, before, after,
                                      {"errors": errors + generation_errors, "booking_gate": gate_reason},
                                      message_specs=messages)
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
            delay = payload.get("followup_delay_seconds")
            if item["message_type"] == "audio" and isinstance(delay, int) and 15 <= delay <= 300:
                try:
                    await self.db.schedule_audio_followup(item, delay)
                except Exception as exc:
                    # The successful WhatsApp send must never be marked failed or resent.
                    self.loop_errors["audio_followup"] = type(exc).__name__
        except Exception as exc:
            await self.db.finish_outbox(item["id"], error=f"{type(exc).__name__}: {exc}")
        return True

    async def _loop(self, name, operation):
        while not self.stop_event.is_set():
            worked = False
            try:
                if name == "events" or self.settings.gustavo_v2_enabled:
                    worked = await operation()
                    self.loop_errors.pop(name, None)
            except Exception as exc:
                self.loop_errors[name] = type(exc).__name__
                logging.getLogger(__name__).error("%s loop failed: %s", name, type(exc).__name__)
            if not worked:
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=self.settings.gustavo_v2_poll_seconds)
                except asyncio.TimeoutError:
                    pass

    async def run(self):
        # One conversation processor preserves contact ordering. Event ACKs and
        # outgoing messages no longer wait for model generation or DB handshakes.
        await asyncio.gather(
            self._loop("events", self.ingest_once),
            self._loop("conversation", self.converse_once),
            self._loop("outbox", self.send_once),
        )

    async def stop(self):
        self.stop_event.set()

    async def close(self):
        await self.meta.close()
        await self.ai.close()
        await self.db.close()
