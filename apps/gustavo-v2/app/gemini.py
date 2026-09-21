from __future__ import annotations

import asyncio
import json
import re
import time
from .gemini_transport import GeminiClient
from .knowledge import SYSTEM_INSTRUCTION
from .models import Decision
from .safety import merge_state, validate_reply


class AIUnavailableError(RuntimeError):
    """All configured AI routes failed before a customer-safe answer existed."""


class GeminiSDR:
    def __init__(self, api_key: str, model: str, secondary_model: str = "gemini-2.5-flash-lite",
                 thinking_level: str = "low", timeout_seconds: float = 5):
        self.client = GeminiClient(api_key, thinking_level)
        self.models = list(dict.fromkeys([model, secondary_model]))
        self.timeout_seconds = timeout_seconds

    async def close(self):
        await self.client.close()

    @staticmethod
    def _policy_errors(decision: Decision, state: dict, history: list[dict]) -> list[str]:
        candidate = merge_state(state, decision)
        errors = validate_reply(decision.reply, candidate)
        recent_assistant = [
            " ".join(str(item.get("text", "")).lower().split())
            for item in history[-8:]
            if item.get("role") in {"assistant", "outbound"}
        ]
        if " ".join(decision.reply.lower().split()) in recent_assistant:
            errors.append("resposta_repetida")
        if "?" in decision.reply and (decision.audio_key or re.search(
            r"(?:posso|quer que|gostaria que).{0,60}(?:enviar|mandar).{0,60}[aá]udio|"
            r"conseguiu (?:ouvir|escutar)|consegue (?:ouvir|escutar)|o que (?:voc[eê] )?achou|gostou do [aá]udio",
            decision.reply, re.I,
        )):
            errors.append("pergunta_desnecessaria_sobre_audio")
        if "?" in decision.reply and re.search(
            r"(?:qual|quais|que).{0,60}(?:dia|data|hor[aá]rio|disponibilidade)|"
            r"(?:quando|a que horas).{0,60}(?:reuni[aã]o|conversar|livre)", decision.reply, re.I,
        ):
            errors.append("coleta_horario_fora_do_fluxo_controlado")
        if decision.booking_ready and "?" in decision.reply:
            errors.append("pergunta_apos_aceite_da_reuniao")
        if re.search(r"\b\d+\s*(?:minutos|min)\b", decision.reply, re.I):
            errors.append("duracao_reuniao_nao_verificada")

        age = candidate.get("athlete_age")
        audio_sent = set(candidate.get("audio_sent") or [])
        if decision.audio_key:
            expected = None
            if isinstance(age, int) and 8 <= age <= 13:
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
            if isinstance(age, int) and age < 18 and (not candidate.get("guardian_confirmed") or candidate.get("contact_role") != "responsavel"):
                errors.append("agenda_sem_responsavel")
            if isinstance(age, int) and 8 <= age <= 18 and not audio_sent:
                errors.append("agenda_antes_do_audio")
            if not candidate.get("meeting_interest"):
                errors.append("agenda_sem_interesse")
        return errors

    async def decide(self, state: dict, history: list[dict], inbound: str,
                     event_context: dict | None = None) -> tuple[Decision, int, list[str]]:
        started = time.monotonic()
        safe_state = dict(state)
        if safe_state.get("booking_url"):
            safe_state["booking_url"] = "[LINK_JA_ENVIADO]"
        prompt = json.dumps({
            "estado_confirmado": safe_state,
            "historico_recente": [
                {**item, "text": re.sub(r"https://ec10talentos\.com/agendar\S+", "[LINK_JA_ENVIADO]",
                                        str(item.get("text", "")))}
                for item in history[-16:]
            ],
            "nova_mensagem": inbound,
            "evento_interno": event_context,
            "instrucao": (
                "Responda primeiro ao que a pessoa acabou de dizer ou perguntar e avance somente um passo natural. "
                "Não repita uma pergunta já feita, não invente nem copie links e extraia fatos novos sem apagar os anteriores."
            ),
        }, ensure_ascii=False)
        correction = ""
        last_errors: list[str] = []
        safe_candidate = None
        soft_style = {
            "abertura_engessada", "saudacao_repetida", "mais_de_uma_pergunta", "mensagem_longa",
            "repete_idade", "repete_nome", "resposta_repetida", "tom_de_bot",
            "pergunta_desnecessaria_sobre_audio",
            "coleta_horario_fora_do_fluxo_controlado", "pergunta_apos_aceite_da_reuniao",
        }
        for model in self.models:
            for revision in range(2):
                try:
                    generation = asyncio.create_task(
                        self.client.aio.models.generate_content(
                            model=model,
                            contents=prompt + correction,
                            config={
                                "system_instruction": SYSTEM_INSTRUCTION,
                                "max_output_tokens": 1200,
                                "response_schema": Decision,
                            },
                        )
                    )
                    done, _ = await asyncio.wait({generation}, timeout=getattr(self, "timeout_seconds", 5))
                    if not done:
                        generation.cancel()
                        generation.add_done_callback(
                            lambda task: task.exception() if not task.cancelled() else None
                        )
                        raise asyncio.TimeoutError()
                    result = generation.result()
                    decision = Decision.model_validate_json(result.text)
                    last_errors = self._policy_errors(decision, state, history)
                    hard_errors = [error for error in last_errors if error not in soft_style]
                    if not hard_errors:
                        safe_candidate = (decision, model, list(last_errors))
                    if not last_errors or (revision and safe_candidate and not hard_errors):
                        diagnostics = [f"ai_route:{model}"] + [f"style:{error}" for error in last_errors]
                        return decision, int((time.monotonic() - started) * 1000), diagnostics
                    correction = (
                        "\nRevise sua própria resposta: " + json.dumps(decision.model_dump(), ensure_ascii=False) +
                        "\nProblemas encontrados: " + ", ".join(last_errors) +
                        ". Gere uma nova resposta natural usando o histórico. Não use frase pronta. "
                        "Se o áudio já foi enviado, não prometa reenviar; convide para a reunião. "
                        "Um sim para escutar áudio não confirma reunião."
                    )
                except Exception as exc:
                    last_errors.append(f"{model}:{type(exc).__name__}")
                    break
        if safe_candidate:
            decision, model, style_errors = safe_candidate
            return decision, int((time.monotonic() - started) * 1000), [
                f"ai_route:{model}", *[f"style:{error}" for error in style_errors],
            ]
        raise AIUnavailableError(";".join(last_errors[-6:]) or "no_valid_ai_response")
