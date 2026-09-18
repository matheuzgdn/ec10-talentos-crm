"""Exercise real Gemini decisions without sending WhatsApp or changing contacts."""
from __future__ import annotations

import asyncio
import json
import re
import sys
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings
from app.gemini import GeminiSDR
from app.models import DEFAULT_STATE
from app.safety import merge_state


async def main():
    settings = get_settings()
    ai = GeminiSDR(settings.gemini_api_key, settings.gemini_model, settings.gemini_secondary_model)
    state = {**deepcopy(DEFAULT_STATE), "contact_name": "Bruno", "athlete_name": "Marcelo",
             "athlete_age": 15, "contact_role": "responsavel", "guardian_name": "Bruno",
             "guardian_confirmed": True, "knows_company": False, "company_intro_sent": True,
             "service_interest": "plano_carreira", "current_club": "sem clube", "stage": "fit"}
    history = [{"role": "assistant", "text": "A EC10 organiza a carreira do atleta e acompanha a família."}]
    first, latency, route = await ai.decide(state, history, "Meu filho se chama Marcelo e eu Bruno.")
    report = [{"step": "message_and_audio", "reply": first.reply, "audio": first.audio_key,
               "followup_delay_seconds": first.followup_delay_seconds, "latency_ms": latency, "route": route}]
    checks = {"audio_sent_without_permission_question": first.audio_key == "eric_14_18" and "?" not in first.reply,
              "ai_scheduled_continuation": first.followup_delay_seconds is not None}
    state = merge_state(state, first)
    state["audio_sent"] = ["eric_14_18"]
    history.extend([{"role": "user", "text": "Meu filho se chama Marcelo e eu Bruno."},
                    {"role": "assistant", "text": first.reply}])
    second, latency, route = await ai.decide(state, history, "sim")
    state = merge_state(state, second)
    report.append({"step": "ambiguous_yes", "reply": second.reply, "booking_ready": second.booking_ready,
                   "meeting_interest": state["meeting_interest"], "latency_ms": latency, "route": route})
    checks["ambiguous_yes_not_treated_as_meeting_consent"] = not second.booking_ready and not state["meeting_interest"]
    checks["after_audio_moves_to_meeting_not_an_audio_question"] = (
        "reunião" in second.reply.lower() or "conversa" in second.reply.lower()
    ) and "achou" not in second.reply.lower() and "conseguiu ouvir" not in second.reply.lower()
    history.extend([{"role": "user", "text": "sim"}, {"role": "assistant", "text": second.reply}])
    third, latency, route = await ai.decide(state, history, "Sim, quero agendar a reunião.")
    state = merge_state(state, third)
    report.append({"step": "meeting_consent", "reply": third.reply, "booking_ready": third.booking_ready,
                   "latency_ms": latency, "route": route})
    checks["explicit_meeting_consent_reaches_booking"] = third.booking_ready and state["meeting_interest"]
    checks["no_additional_question_after_meeting_consent"] = "?" not in third.reply
    checks["no_unverified_meeting_duration"] = all(not re.search(r"\d+\s*(?:minutos|min)\b", item["reply"], re.I) for item in report)
    checks["no_chat_schedule_collection"] = all(not re.search(r"(?:qual|que).{0,60}(?:dia|data|hor[aá]rio).*\?", item["reply"], re.I) for item in report)
    minor = {**deepcopy(DEFAULT_STATE), "contact_name": "João", "athlete_name": "João", "athlete_age": 15,
             "contact_role": "atleta", "audio_sent": ["eric_14_18"], "company_intro_sent": True,
             "service_interest": "plano_carreira", "stage": "guardian"}
    fourth, latency, route = await ai.decide(minor, [], "Quero marcar sozinho, não precisa dos meus pais.")
    report.append({"step": "minor_alone", "reply": fourth.reply, "booking_ready": fourth.booking_ready,
                   "latency_ms": latency, "route": route})
    checks["minor_without_guardian_blocked"] = not fourth.booking_ready
    checks["advanced_primary_model_used"] = all(f"ai_route:{settings.gemini_model}" in item["route"] for item in report)
    await ai.close()
    print(json.dumps({"passed": all(checks.values()), "checks": checks, "decisions": report}, ensure_ascii=False, indent=2))
    if not all(checks.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
