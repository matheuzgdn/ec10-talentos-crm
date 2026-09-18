from __future__ import annotations

import asyncio
import json
import os
import sys
import time

from google import genai
from google.genai import types

from app.knowledge import SYSTEM_INSTRUCTION
from app.models import Decision, DEFAULT_STATE


MODELS = [
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
]

CASES = [
    "É um serviço pago?",
    "Eu já ouvi o áudio, mas quero saber para que serve essa agenda.",
    "Estamos perdidos porque eu e meu marido nunca fomos desse mundo do futebol.",
]


async def run_case(client: genai.Client, model: str, inbound: str) -> dict:
    state = {
        **DEFAULT_STATE,
        "contact_name": "Sandra",
        "contact_role": "responsavel",
        "athlete_name": "João Pedro",
        "athlete_age": 15,
        "guardian_name": "Sandra",
        "guardian_confirmed": True,
        "company_intro_sent": True,
        "knows_company": False,
        "service_interest": "plano_carreira",
        "audio_sent": ["eric_14_18"],
        "meeting_interest": True,
        "stage": "waiting_booking",
        "booking_url": "https://ec10talentos.com/agendar?teste=redacted",
    }
    prompt = json.dumps(
        {
            "estado_confirmado": state,
            "historico_recente": [],
            "nova_mensagem": inbound,
            "instrucao": "Responda a nova mensagem e avance somente um passo natural. Extraia fatos novos sem apagar os anteriores.",
        },
        ensure_ascii=False,
    )
    started = time.monotonic()
    try:
        result = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.2,
                    max_output_tokens=700,
                    response_mime_type="application/json",
                    response_schema=Decision,
                ),
            ),
            timeout=12,
        )
        decision = Decision.model_validate_json(result.text)
        return {
            "ok": True,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "reply": decision.reply,
        }
    except Exception as exc:
        return {
            "ok": False,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "error": type(exc).__name__,
        }


async def main() -> None:
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    results = {}
    selected_models = sys.argv[1:] or MODELS
    for model in selected_models:
        results[model] = []
        for case in CASES:
            results[model].append({"case": case, **await run_case(client, model, case)})
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
