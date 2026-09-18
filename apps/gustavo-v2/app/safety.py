from __future__ import annotations

import re
from typing import Optional
from .models import Decision


FORBIDDEN_VISIBLE = re.compile(r"```|\b(?:json|update_qualification|api_call|function_call|arguments)\b", re.I)


def merge_state(previous: dict, decision: Decision, inbound: str = "") -> dict:
    state = dict(previous)
    for key, value in decision.facts.model_dump().items():
        if value is not None and value != "":
            state[key] = value
    state["stage"] = decision.stage
    lower = " ".join(inbound.lower().split())
    if re.search(r"\b(?:sem clube|n[aã]o (?:est[aá]|joga) (?:em|no) clube|est[aá] sem clube)\b", lower):
        state["current_club"] = "sem clube"
    if re.search(r"\b(?:n[aã]o conhe(?:ço|co)|ainda n[aã]o conhe(?:ço|co)|nunca ouvi falar)\b", lower):
        state["knows_company"] = False
    elif re.search(r"\b(?:j[aá] conhe(?:ço|co)|conhe(?:ço|co) sim|sim,? conhe(?:ço|co))\b", lower):
        state["knows_company"] = True
    return state


def _moment_label(state: dict) -> str:
    athlete = state.get("athlete_name") or "o atleta"
    age = state.get("athlete_age")
    club = state.get("current_club")
    parts = [athlete]
    if isinstance(age, int):
        parts.append(f"aos {age} anos")
    if club == "sem clube":
        parts.append("e sem clube neste momento")
    return ", ".join(parts)


def enforce_ec10_flow(before: dict, after: dict, reply: str, audio_key: Optional[str]) -> tuple[str, Optional[str]]:
    """Keep the commercial sequence deterministic while Gemini handles the language around it."""
    name = after.get("contact_name") or "meu irmão"
    if not before.get("company_intro_sent"):
        after["company_intro_sent"] = True
        after["stage"] = "fit"
        age = after.get("athlete_age")
        if isinstance(age, int) and 9 <= age <= 18:
            moment = _moment_label(after)
            return (
                f"Perfeito, {name}. Para o momento de {moment}, a EC10 começa pelo Plano de Carreira: "
                "planejamento, mentoria com o Eric Cena e marketing esportivo para organizar os próximos passos com a família. "
                "Você já conhecia esse trabalho da EC10?",
                None,
            )
        return (
            "Fala! Aqui é o Gustavo, da EC10 Talentos. A gente começa organizando o momento do atleta e da família, "
            "para indicar o caminho certo sem deixar ninguém perdido no futebol. Você já conhece nosso trabalho?",
            None,
        )

    age = after.get("athlete_age")
    audio_sent = set(after.get("audio_sent") or [])
    if after.get("knows_company") is not None and isinstance(age, int) and 9 <= age <= 18 and "eric_14_18" not in audio_sent:
        athlete = after.get("athlete_name") or "o atleta"
        after["stage"] = "offer"
        return (
            f"Boa, {name}. Para a idade de {athlete}, vou te mandar agora um áudio curto do Eric Cena, nosso CEO, "
            "explicando como funciona o Plano de Carreira. Depois me fala se fez sentido para vocês.",
            "eric_14_18" if age >= 14 else "eric_8_13",
        )

    return reply, audio_key


def booking_gate(state: dict, requested: bool) -> tuple[bool, Optional[str]]:
    if not requested:
        return False, None
    age = state.get("athlete_age")
    if not isinstance(age, int):
        return False, "idade_ausente"
    if not state.get("contact_name"):
        return False, "nome_contato_ausente"
    if age < 18 and not state.get("guardian_confirmed"):
        return False, "responsavel_nao_confirmado"
    if not state.get("meeting_interest"):
        return False, "interesse_reuniao_ausente"
    return True, None


def validate_reply(reply: str, state: dict) -> list[str]:
    errors: list[str] = []
    text = " ".join(reply.split()).strip()
    if FORBIDDEN_VISIBLE.search(text):
        errors.append("conteudo_tecnico_visivel")
    if text.count("?") > 1:
        errors.append("mais_de_uma_pergunta")
    if len(text) > 900:
        errors.append("mensagem_longa")
    lower = text.lower()
    if state.get("athlete_age") and re.search(r"\b(qual|quantos).*\bidade|quantos anos", lower):
        errors.append("repete_idade")
    if state.get("contact_name") and re.search(r"qual (?:é|e) (?:o )?seu nome|como (?:você|voce) se chama", lower):
        errors.append("repete_nome")
    if "assistente virtual" in lower or "selecione uma opção" in lower:
        errors.append("tom_de_bot")
    return errors


def fallback_reply(state: dict) -> str:
    name = state.get("contact_name") or "meu irmão"
    age = state.get("athlete_age")
    if not state.get("contact_name"):
        return "Pra eu te atender direito por aqui, como você se chama?"
    if not age:
        return f"Boa, {name}. Me conta só uma coisa pra eu te mostrar o caminho certo: qual é a idade do atleta?"
    if age < 18 and not state.get("guardian_confirmed"):
        return f"{name}, como o atleta é menor, quero incluir quem acompanha as decisões da carreira. Você é o responsável por ele?"
    if not state.get("goal"):
        return f"{name}, hoje o que vocês mais querem organizar na carreira do atleta?"
    return f"{name}, faz sentido eu te apresentar isso numa conversa rápida com nosso time?"
