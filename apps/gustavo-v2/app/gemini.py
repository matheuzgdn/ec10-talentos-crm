import asyncio
import json
import time
from google import genai
from google.genai import types
from .knowledge import SYSTEM_INSTRUCTION
from .models import Decision
from .safety import validate_reply


class GeminiSDR:
    def __init__(self, api_key: str, model: str):
        self.client = genai.Client(api_key=api_key)
        self.model = model

    async def decide(self, state: dict, history: list[dict], inbound: str) -> tuple[Decision, int, list[str]]:
        started = time.monotonic()
        prompt = json.dumps({
            "estado_confirmado": state,
            "historico_recente": history[-16:],
            "nova_mensagem": inbound,
            "instrucao": "Responda a nova mensagem e avance somente um passo natural. Extraia fatos novos sem apagar os anteriores."
        }, ensure_ascii=False)
        correction = ""
        last_errors: list[str] = []
        for attempt in range(3):
            try:
                result = await self.client.aio.models.generate_content(
                    model=self.model,
                    contents=prompt + correction,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_INSTRUCTION,
                        temperature=0.35,
                        max_output_tokens=900,
                        response_mime_type="application/json",
                        response_schema=Decision,
                    ),
                )
                decision = Decision.model_validate_json(result.text)
                candidate_state = {**state, **{k: v for k, v in decision.facts.model_dump().items() if v is not None}}
                last_errors = validate_reply(decision.reply, candidate_state)
                if not last_errors:
                    return decision, int((time.monotonic() - started) * 1000), []
                correction = "\nA resposta anterior foi rejeitada por: " + ", ".join(last_errors) + ". Gere outra resposta corrigida."
            except Exception as exc:
                last_errors = [f"gemini:{type(exc).__name__}"]
                if attempt == 2:
                    raise
                await asyncio.sleep(0.7 * (attempt + 1))
        raise RuntimeError("Gemini não produziu resposta válida: " + ",".join(last_errors))
