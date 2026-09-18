import asyncio
import json
import time
from google import genai
from google.genai import types
from .knowledge import SYSTEM_INSTRUCTION
from .models import Decision
from .safety import validate_reply


class AIUnavailableError(RuntimeError):
    """All configured AI routes failed before a customer-safe answer existed."""


class GeminiSDR:
    def __init__(self, api_key: str, model: str, secondary_model: str = "gemini-3.1-flash-lite"):
        self.client = genai.Client(api_key=api_key)
        self.models = list(dict.fromkeys([model, secondary_model]))

    @staticmethod
    def _policy_errors(decision: Decision, state: dict, history: list[dict]) -> list[str]:
        candidate = {**state, **{k: v for k, v in decision.facts.model_dump().items() if v is not None}}
        errors = validate_reply(decision.reply, candidate)
        recent_assistant = [
            " ".join(str(item.get("text", "")).lower().split())
            for item in history[-8:]
            if item.get("role") in {"assistant", "outbound"}
        ]
        if " ".join(decision.reply.lower().split()) in recent_assistant:
            errors.append("resposta_repetida")

        age = candidate.get("athlete_age")
        audio_sent = set(candidate.get("audio_sent") or [])
        if decision.audio_key:
            expected = None
            if isinstance(age, int) and 9 <= age <= 13:
                expected = "eric_8_13"
            elif isinstance(age, int) and 14 <= age <= 18:
                expected = "eric_14_18"
            elif isinstance(age, int) and 20 <= age <= 25:
                expected = "eric_20_25"
            if expected != decision.audio_key or decision.audio_key in audio_sent:
                errors.append("audio_inadequado_ou_repetido")

        if decision.booking_ready:
            if not isinstance(age, int):
                errors.append("agenda_sem_idade")
            if isinstance(age, int) and age < 18 and not candidate.get("guardian_confirmed"):
                errors.append("agenda_sem_responsavel")
            if isinstance(age, int) and 9 <= age <= 18 and not audio_sent:
                errors.append("agenda_antes_do_audio")
            if not candidate.get("meeting_interest"):
                errors.append("agenda_sem_interesse")
        return errors

    async def decide(self, state: dict, history: list[dict], inbound: str) -> tuple[Decision, int, list[str]]:
        started = time.monotonic()
        safe_state = dict(state)
        if safe_state.get("booking_url"):
            safe_state["booking_url"] = "[LINK_JA_ENVIADO]"
        prompt = json.dumps({
            "estado_confirmado": safe_state,
            "historico_recente": history[-16:],
            "nova_mensagem": inbound,
            "instrucao": (
                "Responda primeiro ao que a pessoa acabou de dizer ou perguntar e avance somente um passo natural. "
                "Não repita uma pergunta já feita, não invente nem copie links e extraia fatos novos sem apagar os anteriores."
            ),
        }, ensure_ascii=False)
        correction = ""
        last_errors: list[str] = []
        for model in self.models:
            try:
                generation = asyncio.create_task(
                    self.client.aio.models.generate_content(
                        model=model,
                        contents=prompt + correction,
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_INSTRUCTION,
                            temperature=0.2,
                            max_output_tokens=700,
                            response_mime_type="application/json",
                            response_schema=Decision,
                        ),
                    )
                )
                done, _ = await asyncio.wait({generation}, timeout=3.5)
                if not done:
                    generation.cancel()
                    generation.add_done_callback(
                        lambda task: task.exception() if not task.cancelled() else None
                    )
                    raise asyncio.TimeoutError()
                result = generation.result()
                decision = Decision.model_validate_json(result.text)
                last_errors = self._policy_errors(decision, state, history)
                soft_style = {"abertura_engessada", "saudacao_repetida", "audio_inadequado_ou_repetido"}
                blocking_errors = [error for error in last_errors if error not in soft_style]
                if not blocking_errors:
                    diagnostics = [f"ai_route:{model}"] + [f"style:{error}" for error in last_errors]
                    return decision, int((time.monotonic() - started) * 1000), diagnostics
                correction = (
                    "\nA resposta anterior foi rejeitada por: " + ", ".join(blocking_errors) +
                    ". Refaça de modo natural, respondendo à última mensagem sem repetir perguntas."
                )
            except Exception as exc:
                last_errors.append(f"{model}:{type(exc).__name__}")
                correction = "\nA rota anterior falhou. Responda de forma natural e continue exatamente do estado confirmado."
        raise AIUnavailableError(";".join(last_errors[-6:]) or "no_valid_ai_response")
