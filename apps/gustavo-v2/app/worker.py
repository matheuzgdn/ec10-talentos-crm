from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta
from .chat_booking import (
    booking_confirmation,
    day_poll,
    is_schedule_like,
    parse_day_choice,
    parse_time_choice,
    time_poll,
)
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
        self.ai = GeminiSDR(settings.gemini_api_key, settings.gemini_model, settings.gemini_secondary_model,
                            settings.gemini_thinking_level, settings.gemini_timeout_seconds)
        self.meta = MetaWhatsApp(settings.meta_graph_version, settings.meta_phone_number_id, settings.meta_whatsapp_access_token)
        self.stop_event = asyncio.Event()
        self.loop_errors: dict[str, str] = {}
        self.oracle_locks: dict[str, asyncio.Lock] = {}

    def permitted(self, phone: str) -> bool:
        allowed = self.settings.allowed_phones
        return self.settings.gustavo_v2_enabled and (not allowed or phone in allowed)

    async def _finish_oracle_schedule(self, phone: str, message_id: str, inbound: str,
                                      before: dict, after: dict, reply: str,
                                      poll: dict | None = None, booking: dict | None = None,
                                      validation: dict | None = None) -> dict:
        result = {
            "reply": reply,
            "audio_key": None,
            "booking_url": None,
            "poll": poll,
            "booking": ({
                "id": str(booking["id"]),
                "starts_at": booking["starts_at"].isoformat(),
                "seller_name": booking["display_name"],
            } if booking else None),
            "athlete_age": after.get("athlete_age"),
            "stage": after.get("stage"),
            "model": "gustavo-scheduler",
        }
        await self.db.finish_oracle_turn(
            phone, message_id, inbound, reply, "gustavo-scheduler", 0, before, after, result,
            validation or {"scheduler": True},
        )
        return result

    async def oracle_turn(self, phone: str, message_id: str, inbound: str, client_id: str,
                          known_name: str | None = None, known_age: int | None = None,
                          lead_source: str | None = None, service_interest: str | None = None) -> dict:
        """Generate one idempotent Gustavo V2 decision for the local Oracle WhatsApp transport."""
        lock = self.oracle_locks.setdefault(phone, asyncio.Lock())
        async with lock:
            cached = await self.db.oracle_turn_result(phone, message_id)
            if cached:
                return cached
            await self.db.ensure_oracle_contact(phone, client_id)
            before, history, stored_client_id, _ = await self.db.conversation_context(phone)
            if known_name and not before.get("contact_name"):
                before["contact_name"] = " ".join(known_name.split()).strip()[:80]
            if isinstance(known_age, int) and not before.get("athlete_age"):
                before["athlete_age"] = known_age
            if lead_source and not before.get("lead_source"):
                before["lead_source"] = lead_source[:120]
            if service_interest in {"plano_carreira", "plano_internacional", "eurocamp"}:
                before["service_interest"] = service_interest

            stage = before.get("stage")
            if stage not in {"rapport", "discovery", "fit", "guardian", "offer", "booking", "waiting_booking", "human"}:
                stage = "discovery"
            observed = merge_state(before, Decision(reply="Estado atualizado.", stage=stage), inbound)

            schedule_stage = before.get("chat_booking_stage")
            pending_poll = None
            if schedule_stage == "day":
                options = list(before.get("chat_booking_options") or [])
                action, selected = parse_day_choice(inbound, options)
                if action == "selected" and selected:
                    after = dict(observed)
                    after.update({
                        "stage": "waiting_booking", "chat_booking_stage": "time",
                        "chat_booking_selected": selected, "chat_booking_options": options,
                        "booking_url": None,
                    })
                    return await self._finish_oracle_schedule(
                        phone, message_id, inbound, before, after,
                        "Certo. Agora escolha o horário abaixo.", time_poll(selected),
                    )
                if action == "next_week":
                    latest = max((datetime.fromisoformat(str(item["starts_at"]).replace("Z", "+00:00"))
                                  for item in options), default=None)
                    new_options = await self.db.list_chat_booking_days(
                        "plano_carreira", latest + timedelta(seconds=1) if latest else None,
                    )
                    after = dict(observed)
                    after.update({"stage": "waiting_booking", "chat_booking_stage": "day",
                                  "chat_booking_options": new_options, "chat_booking_selected": None,
                                  "booking_url": None})
                    return await self._finish_oracle_schedule(
                        phone, message_id, inbound, before, after,
                        "Aqui estão as próximas datas disponíveis.", day_poll(new_options),
                    )
                if is_schedule_like(inbound):
                    return await self._finish_oracle_schedule(
                        phone, message_id, inbound, before, observed,
                        "Escolha uma das datas disponíveis na caixa abaixo.", day_poll(options),
                        validation={"scheduler": True, "invalid_day_choice": True},
                    )
                pending_poll = day_poll(options)
            elif schedule_stage == "time":
                selected = before.get("chat_booking_selected") or {}
                action = parse_time_choice(inbound)
                if action == "back":
                    options = await self.db.list_chat_booking_days("plano_carreira")
                    after = dict(observed)
                    after.update({"stage": "waiting_booking", "chat_booking_stage": "day",
                                  "chat_booking_options": options, "chat_booking_selected": None,
                                  "booking_url": None})
                    return await self._finish_oracle_schedule(
                        phone, message_id, inbound, before, after,
                        "Sem problema. Escolha outro dia abaixo.", day_poll(options),
                    )
                if action == "confirm":
                    try:
                        booking = await self.db.reserve_chat_booking(
                            phone, stored_client_id or client_id, observed, selected,
                        )
                    except ValueError as exc:
                        if str(exc) not in {"booking_option_taken", "booking_option_invalid"}:
                            raise
                        options = await self.db.list_chat_booking_days("plano_carreira")
                        after = dict(observed)
                        after.update({"stage": "waiting_booking", "chat_booking_stage": "day",
                                      "chat_booking_options": options, "chat_booking_selected": None})
                        return await self._finish_oracle_schedule(
                            phone, message_id, inbound, before, after,
                            "Esse horário acabou de ser ocupado. Separei as próximas datas disponíveis.",
                            day_poll(options), validation={"scheduler": True, "slot_race_recovered": True},
                        )
                    after = dict(observed)
                    after.update({
                        "stage": "waiting_booking", "chat_booking_stage": "confirmed",
                        "booking_id": str(booking["id"]),
                        "booking_starts_at": booking["starts_at"].isoformat(),
                        "booking_seller": booking["display_name"], "booking_url": None,
                    })
                    return await self._finish_oracle_schedule(
                        phone, message_id, inbound, before, after,
                        booking_confirmation(booking), booking=booking,
                    )
                if is_schedule_like(inbound):
                    return await self._finish_oracle_schedule(
                        phone, message_id, inbound, before, observed,
                        "Para confirmar sem erro, escolha uma opção abaixo.", time_poll(selected),
                        validation={"scheduler": True, "invalid_time_choice": True},
                    )
                pending_poll = time_poll(selected)

            decision, latency, generation_errors = await self.ai.decide(observed, history, inbound)
            route_model = next((entry.split(":", 1)[1] for entry in generation_errors if entry.startswith("ai_route:")),
                               self.settings.gemini_model)
            after = merge_state(observed, decision, inbound)
            if not before.get("company_intro_sent"):
                after["company_intro_sent"] = True

            reply = sanitize_ai_reply(decision.reply.strip(), after)
            audio_key = decision.audio_key
            age = after.get("athlete_age")
            expected_audio = None
            if isinstance(age, int) and 8 <= age <= 13:
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
            audio_required = bool(
                expected_audio
                and expected_audio not in set(after.get("audio_sent") or [])
                and after.get("service_interest") == "plano_carreira"
                and after.get("contact_name")
                and after.get("athlete_name")
                and (
                    not isinstance(age, int)
                    or age >= 18
                    or (after.get("contact_role") == "responsavel" and after.get("guardian_confirmed"))
                )
            )
            if audio_required and not audio_key:
                audio_key = expected_audio
                reply = (
                    "Antes da agenda, vou te enviar agora o áudio do Eric Cena "
                    "explicando o Plano de Carreira para essa fase."
                )

            explicit_booking_request = bool(re.search(
                r"\b(?:quero|vamos|pode|podemos|gostaria)\b.*\b(?:agendar|marcar|reuni[aã]o)\b|"
                r"\b(?:manda|envia|reenvia|cad[eê]|onde|qual)\b.*\blink\b|"
                r"\blink\b.*\b(?:manda|envia|reenvia|cad[eê]|onde)\b",
                inbound, re.I,
            ))
            booking_requested = bool(
                decision.booking_ready
                or (after.get("meeting_interest") and not before.get("meeting_interest"))
                or (before.get("booking_url") and explicit_booking_request)
            )
            if audio_required:
                booking_requested = False
            if before.get("booking_url") and not explicit_booking_request:
                booking_requested = False
            booking_allowed, gate_reason = booking_gate(after, booking_requested)
            booking_url = None
            poll = pending_poll
            if booking_allowed and (stored_client_id or client_id):
                service = after.get("service_interest")
                if service not in {"plano_carreira", "plano_internacional", "eurocamp"}:
                    service = "plano_carreira"
                if service == "plano_carreira":
                    options = await self.db.list_chat_booking_days(service)
                    if not options:
                        raise RuntimeError("chat_booking_no_available_days")
                    after.update({"booking_url": None, "stage": "waiting_booking",
                                  "chat_booking_stage": "day", "chat_booking_options": options,
                                  "chat_booking_selected": None})
                    poll = day_poll(options)
                    reply = "Vou deixar os dias disponíveis logo abaixo para você escolher."
            elif booking_requested and gate_reason:
                after["stage"] = "guardian" if gate_reason == "responsavel_nao_confirmado" else after.get("stage", "offer")
            if pending_poll and not booking_allowed:
                reply = re.sub(r"\s*[^.!?]*\?\s*$", "", reply).strip()
                reply = f"{reply}\n\nDepois, escolha a opção na caixa abaixo.".strip()
            errors = validate_reply(reply, after)
            if "conteudo_tecnico_visivel" in errors:
                raise RuntimeError("resposta_da_ia_rejeitada:" + ",".join(errors))
            result = {
                "reply": reply,
                "audio_key": audio_key,
                "booking_url": booking_url,
                "poll": poll,
                "booking": None,
                "athlete_age": after.get("athlete_age"),
                "stage": after.get("stage"),
                "model": route_model,
            }
            await self.db.finish_oracle_turn(
                phone, message_id, inbound, reply, route_model, latency, before, after, result,
                {"errors": errors + generation_errors, "booking_gate": gate_reason},
            )
            return result

    async def confirm_oracle_audio_delivery(self, phone: str, audio_key: str) -> dict:
        confirmed = await self.db.confirm_audio_delivery(phone, audio_key)
        if not confirmed:
            raise RuntimeError("audio_delivery_contact_not_found")
        return {"ok": True, "audio_key": audio_key}

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
            if isinstance(age, int) and 8 <= age <= 13:
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
