from __future__ import annotations

import re
import unicodedata
from copy import deepcopy
from typing import Optional
from .models import Decision


FORBIDDEN_VISIBLE = re.compile(r"```|\b(?:json|update_qualification|api_call|function_call|arguments)\b", re.I)


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.lower())
    return " ".join("".join(ch for ch in normalized if not unicodedata.combining(ch)).split())


def _clean_person_name(value: str) -> Optional[str]:
    value = " ".join(value.strip(" .,!?-").split())
    value = re.split(
        r"\s+(?:e\s+)?(?:enviei|vim|cheguei|tenho|sou|falei|ja\s+falei|j[aá]\s+falei|"
        r"falei\s+acima|quero|gostaria|vi|conheci|estou|t[oô]|pela|pelo)\b",
        value,
        maxsplit=1,
        flags=re.I,
    )[0]
    value = re.sub(r"\s+(?:j[aá]\s+falei|falei\s+acima(?:\s+meu\s+nome)?)$", "", value, flags=re.I)
    value = " ".join(value.strip(" .,!?-").split())
    plain = _plain(value)
    if not value or len(value) > 60:
        return None
    if plain in {"atleta", "pai", "mae", "responsavel", "interessado"}:
        return None
    if re.match(r"^(?:atleta|pai|mae|responsavel)(?:\s|$)", plain):
        return None
    if any(phrase in plain for phrase in {"como voce", "quero saber", "ja falei", "falei acima"}):
        return None
    tokens = value.split()
    if not 1 <= len(tokens) <= 6:
        return None
    return value.title()


def _natural_name(match: Optional[re.Match]) -> Optional[str]:
    return _clean_person_name(match.group(1)) if match else None


def _extract_deterministic_facts(previous: dict, inbound: str) -> dict:
    """Recover high-value facts even when the model omits them from its JSON."""
    facts: dict = {}
    compact = " ".join(inbound.split()).strip()
    lower = _plain(compact)

    contact_name = _natural_name(re.search(
        r"(?:meu nome (?:e|é)|me chamo|aqui (?:e|é)|eu sou|\bsou)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,80})",
        compact,
        re.I,
    ))
    if contact_name:
        facts["contact_name"] = contact_name

    athlete_name = _natural_name(re.search(
        r"(?:meu|minha)\s+(?:filho|filha)(?:\s+(?:se chama|é|e))?\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,45}?)(?=\s+(?:(?:que\s+)?tem|est[aá]|joga|e\s+tem)\b|[,.;!?]|$)",
        compact,
        re.I,
    ))
    if not athlete_name:
        athlete_name = _natural_name(re.search(
            r"(?:nome d[oa] atleta (?:é|e)|atleta se chama)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,45}?)(?=\s+(?:tem|est[aá]|joga)\b|[,.;!?]|$)",
            compact,
            re.I,
        ))
    if not athlete_name:
        athlete_name = _natural_name(re.search(
            r"(?:sou|eu sou)\s+(?:o |a )?(?:pai|m[aã]e|respons[aá]vel)\s+d[oa]\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,60})",
            compact,
            re.I,
        ))
    if athlete_name:
        facts["athlete_name"] = athlete_name

    if re.search(r"\b(?:sou|aqui (?:e|é))\s+(?:o |a )?(?:pai|mãe|mae|responsavel)\b|\b(?:pai|mãe|mae|responsavel)\s+d[oea]\b", lower):
        facts["contact_role"] = "responsavel"
        facts["guardian_confirmed"] = True
        guardian = facts.get("contact_name") or previous.get("contact_name")
        if guardian:
            facts["guardian_name"] = guardian
    elif re.search(r"\b(?:sou|eu sou)\s+(?:o |a )?atleta\b|\b(?:e|é)\s+pra mim(?: mesmo)?\b", lower):
        facts["contact_role"] = "atleta"

    age_match = re.search(r"\b([6-9]|[12][0-9]|3[0-9]|40)\s*anos?\b", lower)
    if not age_match and not previous.get("athlete_age"):
        age_match = re.fullmatch(r"\s*([6-9]|[12][0-9]|3[0-9]|40)\s*", lower)
    if age_match:
        facts["athlete_age"] = int(age_match.group(1))

    if "plano de carreira" in lower:
        facts["service_interest"] = "plano_carreira"
    elif "plano internacional" in lower:
        facts["service_interest"] = "plano_internacional"
    elif "eurocamp" in lower or "eurokids" in lower:
        facts["service_interest"] = "eurocamp"
    if "instagram" in lower or "pagina da campanha" in lower or "lead page" in lower:
        facts["lead_source"] = "instagram_campanha"

    if re.search(r"\b(?:jogador|jogadora) profissional\b|\brealizar (?:o |seu )?sonho\b", lower):
        facts["goal"] = "tornar-se jogador profissional e realizar o sonho no futebol"
    elif re.search(r"\b(?:estamos perdidos|familia (?:esta )?perdida|nunca fomos desse mundo|nao conhecemos o futebol)\b", lower):
        facts["goal"] = "organizar a carreira do atleta com orientação para toda a família"

    if previous.get("company_intro_sent") and previous.get("knows_company") is None:
        if re.fullmatch(r"(?:sim|s|conheco|ja conheco|conheco sim)[!. ]*", lower):
            facts["knows_company"] = True
        elif re.fullmatch(r"(?:nao|n|nao conheco|ainda nao|nunca ouvi falar)[!. ]*", lower):
            facts["knows_company"] = False

    audio_sent = set(previous.get("audio_sent") or [])
    positive_meeting = re.search(
        r"\b(?:quero|vamos|pode|podemos|tenho interesse|gostaria|bora)\b.*\b(?:agendar|marcar|reuniao|conversar)\b",
        lower,
    )
    # A short yes may acknowledge audio, company knowledge or a meeting.
    # Only the AI with conversation context can interpret that intent.
    if audio_sent and positive_meeting:
        facts["meeting_interest"] = True

    return facts


def merge_state(previous: dict, decision: Decision, inbound: str = "") -> dict:
    state = deepcopy(previous)
    for key in ("contact_name", "guardian_name", "athlete_name"):
        if state.get(key):
            cleaned = _clean_person_name(str(state[key]))
            if cleaned:
                state[key] = cleaned
    immutable_when_known = {"contact_name", "athlete_name", "athlete_age", "guardian_name"}
    for key, value in decision.facts.model_dump().items():
        if value is not None and value != "":
            if key in immutable_when_known and state.get(key) not in (None, "") and value != state.get(key):
                incoming_name = _clean_person_name(str(value)) if key != "athlete_age" else None
                current_name = _clean_person_name(str(state[key])) if key != "athlete_age" else None
                if key == "athlete_age" or not incoming_name or (current_name and len(incoming_name.split()) <= len(current_name.split())):
                    continue
                value = incoming_name
            state[key] = value
    for key, value in _extract_deterministic_facts(previous, inbound).items():
        if key in {"contact_name", "guardian_name", "athlete_name"} and state.get(key):
            incoming_name = _clean_person_name(str(value))
            current_name = _clean_person_name(str(state[key]))
            if not incoming_name or (current_name and len(incoming_name.split()) < len(current_name.split())):
                continue
            value = incoming_name
        state[key] = value
    if state.get("contact_role") == "atleta" and state.get("contact_name") and not state.get("athlete_name"):
        state["athlete_name"] = state["contact_name"]
    if isinstance(state.get("athlete_age"), int):
        if state["athlete_age"] >= 18:
            state["service_interest"] = "plano_internacional"
            if state.get("language") != "es":
                state["route_key"] = "international"
        elif 8 <= state["athlete_age"] < 18:
            state["service_interest"] = "plano_carreira"
            if state.get("language") != "es":
                state["route_key"] = "career"
    if state.get("language") == "es":
        state["route_key"] = "es"
    if state.get("contact_role") == "atleta" and isinstance(state.get("athlete_age"), int) and state["athlete_age"] < 18:
        state["guardian_confirmed"] = False
    state["stage"] = "waiting_booking" if previous.get("stage") == "waiting_booking" else decision.stage
    lower = " ".join(inbound.lower().split())
    if re.search(r"\b(?:sem clube|n[aã]o (?:est[aá]|joga) (?:em|no) clube|est[aá] sem clube)\b", lower):
        state["current_club"] = "sem clube"
    if re.search(r"\b(?:n[aã]o conhe(?:ço|co)|conhe(?:ço|co) n[aã]o|ainda n[aã]o conhe(?:ço|co)|nunca ouvi falar)\b", lower):
        state["knows_company"] = False
    elif re.search(r"\b(?:j[aá] conhe(?:ço|co)|conhe(?:ço|co) sim|sim,? conhe(?:ço|co))\b", lower):
        state["knows_company"] = True
    return state


def booking_gate(state: dict, requested: bool) -> tuple[bool, Optional[str]]:
    if not requested:
        return False, None
    age = state.get("athlete_age")
    if not isinstance(age, int):
        return False, "idade_ausente"
    if not state.get("contact_name"):
        return False, "nome_contato_ausente"
    if age < 18 and (not state.get("guardian_confirmed") or state.get("contact_role") != "responsavel"):
        return False, "responsavel_nao_confirmado"
    expected_audio = "eric_20_25" if age >= 18 else ("eric_14_18" if age >= 14 else "eric_8_13")
    if 8 <= age <= 25 and expected_audio not in set(state.get("audio_sent") or []):
        return False, "audio_eric_nao_enviado"
    if not state.get("meeting_interest"):
        return False, "interesse_reuniao_ausente"
    return True, None


def validate_reply(reply: str, state: dict) -> list[str]:
    errors: list[str] = []
    text = " ".join(reply.split()).strip()
    lower = text.lower()
    if FORBIDDEN_VISIBLE.search(text):
        errors.append("conteudo_tecnico_visivel")
    if text.count("?") > 1:
        errors.append("mais_de_uma_pergunta")
    asks_name = bool(re.search(
        r"\b(?:qual(?:\s+é|\s+e)?\s+(?:o\s+)?nome|como\s+(?:ele|ela|o\s+atleta|a\s+atleta)\s+se\s+chama)\b",
        lower,
    ))
    asks_age = bool(re.search(r"\b(?:quantos\s+anos|qual(?:\s+é|\s+e)?\s+a\s+idade)\b", lower))
    if asks_name and asks_age and "mais_de_uma_pergunta" not in errors:
        errors.append("mais_de_uma_pergunta")
    if len(text) > 480:
        errors.append("mensagem_longa")
    if state.get("athlete_age") and re.search(r"\b(qual|quantos).*\bidade|quantos anos", lower):
        errors.append("repete_idade")
    if state.get("contact_name") and re.search(r"qual (?:é|e) (?:o )?seu nome|como (?:você|voce) se chama", lower):
        errors.append("repete_nome")
    if "assistente virtual" in lower or "selecione uma opção" in lower:
        errors.append("tom_de_bot")
    if re.search(r"\b(?:entendi|entendo|que legal)\b", lower):
        errors.append("abertura_engessada")
    if state.get("company_intro_sent") and re.match(r"^(?:oi|ol[aá]|fala|bom dia|boa tarde|boa noite)\b", lower):
        errors.append("saudacao_repetida")
    return errors


def sanitize_ai_reply(reply: str, state: dict) -> str:
    """Remove only repetitive conversational ticks without replacing AI content."""
    text = " ".join(reply.split()).strip()
    name = re.escape(str(state.get("contact_name") or ""))
    # Only remove a complete, standalone acknowledgement.  The previous
    # expression accepted no separator after the tick, so it removed the
    # ``entendi`` prefix from both ``Entendido`` and ``Entendi que``.  That
    # produced visibly broken messages such as ``Do, Davi`` and ``Que está``.
    tick = r"(?:entendi|entendid[oa]|perfeito|que legal|legal|[oó]timo)"
    separator = r"\s*[,!.:;-]\s*"
    optional_named_address = rf"(?:{name}{separator})?" if name else ""
    text = re.sub(
        rf"^{tick}\b{separator}{optional_named_address}",
        "",
        text,
        count=1,
        flags=re.I,
    ).strip()
    if state.get("company_intro_sent"):
        greeting = r"(?:oi|ol[aá]|fala|bom dia|boa tarde|boa noite)"
        greeting_separator = r"(?:\s*[,!.:;-]\s*|\s+)"
        optional_greeting_name = rf"(?:{name}\s*[,!.:;-]\s*)?" if name else ""
        text = re.sub(
            rf"^{greeting}\b{greeting_separator}{optional_greeting_name}",
            "",
            text,
            count=1,
            flags=re.I,
        ).strip()
    # Keep conversational greetings from consuming the single question that
    # must move the sale forward (for example: "Davi, beleza? ... conhece?").
    if text.count("?") > 1:
        phatic_name = rf"(?:{name}\s*[,!.]?\s*)?" if name else ""
        text = re.sub(
            rf"^{phatic_name}(?:beleza|tudo bem|como vai)\s*\?\s*",
            "",
            text,
            count=1,
            flags=re.I,
        ).strip()
    # "Qual é o nome ... e quantos anos?" has one question mark but asks for
    # two facts. Ask only the first missing fact and preserve prior context.
    lower = text.lower()
    asks_name = re.search(
        r"\b(?:qual(?:\s+é|\s+e)?\s+(?:o\s+)?nome|como\s+(?:ele|ela|o\s+atleta|a\s+atleta)\s+se\s+chama)\b",
        lower,
    )
    asks_age = re.search(r"\b(?:quantos\s+anos|qual(?:\s+é|\s+e)?\s+a\s+idade)\b", lower)
    if asks_name and asks_age:
        question_start = max(
            text.rfind(".", 0, min(asks_name.start(), asks_age.start())),
            text.rfind("!", 0, min(asks_name.start(), asks_age.start())),
            text.rfind("?", 0, min(asks_name.start(), asks_age.start())),
        ) + 1
        context = text[:question_start].strip()
        next_question = (
            "Qual é o nome do atleta?"
            if not state.get("athlete_name")
            else "Quantos anos o atleta tem?"
        )
        text = f"{context} {next_question}".strip()
    if text.count("?") > 1:
        text = text[: text.find("?") + 1].strip()
    if text:
        return text[0].upper() + text[1:]
    return reply.strip()
