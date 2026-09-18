from __future__ import annotations

import re
from typing import Optional
from .models import Decision


FORBIDDEN_VISIBLE = re.compile(r"```|\b(?:json|update_qualification|api_call|function_call|arguments)\b", re.I)


def merge_state(previous: dict, decision: Decision) -> dict:
    state = dict(previous)
    for key, value in decision.facts.model_dump().items():
        if value is not None and value != "":
            state[key] = value
    state["stage"] = decision.stage
    return state


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
