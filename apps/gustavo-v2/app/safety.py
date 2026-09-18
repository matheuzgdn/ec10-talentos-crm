from __future__ import annotations

import re
import unicodedata
from typing import Optional
from .models import Decision, Facts


FORBIDDEN_VISIBLE = re.compile(r"```|\b(?:json|update_qualification|api_call|function_call|arguments)\b", re.I)


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.lower())
    return " ".join("".join(ch for ch in normalized if not unicodedata.combining(ch)).split())


def _natural_name(match: Optional[re.Match]) -> Optional[str]:
    if not match:
        return None
    value = " ".join(match.group(1).strip(" .,!?-").split())
    if not value or _plain(value) in {"atleta", "pai", "mae", "responsavel", "interessado"}:
        return None
    return value.title()


def _extract_deterministic_facts(previous: dict, inbound: str) -> dict:
    """Recover high-value facts even when the model omits them from its JSON."""
    facts: dict = {}
    compact = " ".join(inbound.split()).strip()
    lower = _plain(compact)

    contact_name = _natural_name(re.search(
        r"(?:meu nome (?:e|é)|me chamo|aqui (?:e|é)|eu sou)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,45}?)(?=\s+(?:e\s+)?(?:sou|pai|mãe|mae|respons[aá]vel|atleta|tenho|minha|meu)\b|[,.;!?]|$)",
        compact,
        re.I,
    ))
    if contact_name:
        facts["contact_name"] = contact_name
    elif not previous.get("contact_name") and re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,45}", compact):
        tokens = lower.split()
        not_a_name = {
            "sim", "nao", "oi", "ola", "bom dia", "boa tarde", "boa noite", "pode ser",
            "quero", "conheco", "nao conheco", "sou atleta", "sou responsavel",
        }
        if 1 <= len(tokens) <= 4 and lower not in not_a_name:
            facts["contact_name"] = compact.title()

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
    short_yes = re.fullmatch(r"(?:sim|s|ss|quero|pode ser|vamos|bora|tenho interesse)[!. ]*", lower)
    if audio_sent and (positive_meeting or short_yes):
        facts["meeting_interest"] = True

    return facts


def merge_state(previous: dict, decision: Decision, inbound: str = "") -> dict:
    state = dict(previous)
    immutable_when_known = {"contact_name", "athlete_name", "athlete_age", "guardian_name"}
    for key, value in decision.facts.model_dump().items():
        if value is not None and value != "":
            if key in immutable_when_known and previous.get(key) not in (None, "") and value != previous.get(key):
                continue
            if key in {"guardian_confirmed", "meeting_interest"} and previous.get(key) is True and value is False:
                continue
            state[key] = value
    for key, value in _extract_deterministic_facts(previous, inbound).items():
        state[key] = value
    if state.get("contact_role") == "atleta" and state.get("contact_name") and not state.get("athlete_name"):
        state["athlete_name"] = state["contact_name"]
    if isinstance(state.get("athlete_age"), int) and 9 <= state["athlete_age"] <= 18:
        state["service_interest"] = "plano_carreira"
    state["stage"] = "waiting_booking" if previous.get("stage") == "waiting_booking" else decision.stage
    lower = " ".join(inbound.lower().split())
    if re.search(r"\b(?:sem clube|n[aã]o (?:est[aá]|joga) (?:em|no) clube|est[aá] sem clube)\b", lower):
        state["current_club"] = "sem clube"
    if re.search(r"\b(?:n[aã]o conhe(?:ço|co)|conhe(?:ço|co) n[aã]o|ainda n[aã]o conhe(?:ço|co)|nunca ouvi falar)\b", lower):
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
    if not before.get("contact_name") and after.get("contact_name") and after.get("contact_role") in {None, "desconhecido"}:
        after["stage"] = "discovery"
        return f"Prazer, {name}. Você fala comigo como atleta ou como responsável por um atleta?", None
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
    if after.get("knows_company") is None and isinstance(age, int) and 9 <= age <= 18:
        moment = _moment_label(after)
        after["stage"] = "fit"
        return (
            f"Para o momento de {moment}, o primeiro caminho é o Plano de Carreira: planejamento, mentoria com o Eric Cena "
            "e marketing esportivo para organizar os próximos passos com a família. Você já conhecia esse trabalho da EC10?",
            None,
        )
    audio_for_age = "eric_14_18" if isinstance(age, int) and age >= 14 else "eric_8_13"
    if after.get("knows_company") is not None and isinstance(age, int) and 9 <= age <= 18 and audio_for_age not in audio_sent:
        athlete = after.get("athlete_name")
        subject = f"o momento do {athlete}" if athlete else "esse momento da carreira"
        after["stage"] = "offer"
        return (
            f"Para {subject}, vou te mandar agora um áudio curto do Eric Cena, nosso CEO, "
            "explicando como funciona o Plano de Carreira. Depois me fala se fez sentido para vocês.",
            audio_for_age,
        )

    # Gemini may suggest an audio out of order or for the wrong age. The
    # commercial sequence owns this decision so contacts never receive two
    # audios or a Eurocamp/age-incompatible asset.
    if audio_sent:
        return reply, None
    if isinstance(age, int) and 20 <= age <= 25 and after.get("knows_company") is not None:
        return reply, "eric_20_25"

    return reply, None


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
    if 9 <= age <= 18 and not state.get("audio_sent"):
        return False, "audio_eric_nao_enviado"
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
    if re.search(r"\b(?:entendi|entendo|que legal)\b", lower):
        errors.append("abertura_engessada")
    if state.get("company_intro_sent") and re.match(r"^(?:oi|ol[aá]|fala|bom dia|boa tarde|boa noite)\b", lower):
        errors.append("saudacao_repetida")
    return errors


def avoid_repeated_reply(reply: str, previous_reply: Optional[str], state: dict, inbound: str) -> str:
    """Replace an identical consecutive answer with the next useful human step."""
    if not previous_reply or _plain(reply) != _plain(previous_reply):
        return reply

    lower = _plain(inbound)
    age = state.get("athlete_age")
    if isinstance(age, int) and age < 18 and not state.get("guardian_confirmed"):
        if re.search(r"\b(?:pai|mae|responsavel)\b.*\b(?:trabalh\w*|ocupad\w*|fora|ausente)\b", lower):
            return (
                "Sem problema. Quando ele estiver disponível, pode continuar por este mesmo WhatsApp para eu explicar tudo "
                "e liberar a reunião com segurança. Sua mãe ou outro responsável consegue falar por aqui agora?"
            )
        if re.search(r"\b(?:idade|anos?)\b", lower) or re.fullmatch(r"\d{1,2}", lower):
            return (
                "A idade já ficou salva. Como você é menor, seu pai, sua mãe ou outro responsável "
                "consegue continuar esta conversa por aqui?"
            )
        return (
            "Para avançar, preciso incluir um responsável adulto na conversa. Seu pai, sua mãe ou outro "
            "responsável pode assumir por aqui?"
        )
    if state.get("audio_sent") and not state.get("meeting_interest"):
        return "Se conseguiu ouvir o áudio, me diga se vale abrir a agenda para uma conversa com nosso time."
    return "Vou seguir exatamente do ponto em que paramos. O que você quer esclarecer antes da próxima etapa?"


def guardian_fast_path(state: dict, inbound: str) -> Optional[Decision]:
    """Answer the minor/guardian handoff immediately without waiting on the model."""
    age = state.get("athlete_age")
    if not (
        state.get("company_intro_sent")
        and isinstance(age, int)
        and age < 18
        and not state.get("guardian_confirmed")
    ):
        return None

    compact = " ".join(inbound.split()).strip()
    lower = _plain(compact)
    athlete = state.get("athlete_name") or "o atleta"
    adult_role = re.search(r"\b(?:sou|aqui (?:e|é))\s+(?:o |a )?(?:pai|m[aã]e|respons[aá]vel)\b", compact, re.I)
    adult_name = _natural_name(re.search(
        r"(?:aqui (?:e|é)|eu sou|me chamo)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,45}?)(?=\s*,?\s*(?:sou\s+)?(?:o |a )?(?:pai|m[aã]e|respons[aá]vel)\b)",
        compact,
        re.I,
    ))
    if adult_role or adult_name:
        facts = Facts(
            contact_role="responsavel",
            guardian_confirmed=True,
            guardian_name=adult_name,
        )
        if adult_name:
            return Decision(
                reply=(
                    f"Obrigado, {adult_name}. O {athlete} já recebeu a explicação do Plano de Carreira. "
                    "Vocês têm interesse em marcar uma conversa com nosso time?"
                ),
                facts=facts,
                stage="guardian",
            )
        return Decision(
            reply="Pode me dizer seu nome completo para eu registrar o responsável pela conversa?",
            facts=facts,
            stage="guardian",
        )

    if re.search(r"\b(?:ligar|liga(?:cao|cão)|chamada)\b", lower):
        return Decision(
            reply=(
                "A conversa acontece numa reunião marcada pelo link, sem ligação de surpresa. Como você é menor, "
                "seu pai, sua mãe ou outro responsável consegue continuar por aqui?"
            ),
            stage="guardian",
        )
    if re.search(r"\b(?:nao tem ninguem|ninguem comigo|so eu|sozinho|sozinha)\b", lower):
        return Decision(
            reply=(
                "Tudo bem, não vou te prender agora. Quando seu pai, sua mãe ou outro responsável estiver disponível, "
                "ele pode mandar uma mensagem neste mesmo WhatsApp e eu continuo exatamente daqui."
            ),
            stage="guardian",
        )
    if re.search(r"\b(?:real madrid|me coloca|garant\w*|promet\w*|entrar (?:no|em um) clube)\b", lower):
        return Decision(
            reply=(
                "A EC10 não coloca atleta diretamente em clube nem promete aprovação. Nosso trabalho é preparar, orientar "
                "e organizar o caminho para aumentar as oportunidades reais. Um responsável consegue continuar por aqui mais tarde?"
            ),
            stage="guardian",
        )
    if re.search(r"\b(?:pai|mae|responsavel)\b.*\b(?:trabalh\w*|ocupad\w*|fora|ausente)\b", lower):
        return Decision(
            reply=(
                "Sem problema. Quando ele estiver disponível, pode continuar neste mesmo WhatsApp. "
                "Sua mãe ou outro responsável consegue falar por aqui agora?"
            ),
            stage="guardian",
        )
    if re.search(r"\b(?:pai|mae|responsavel)\b.*\b(?:aqui|comigo|presente)\b", lower):
        return Decision(
            reply="Pode pedir para esse responsável me dizer o nome completo por aqui?",
            stage="guardian",
        )
    return None


def fallback_reply(state: dict, inbound: str = "") -> str:
    name = state.get("contact_name") or "meu irmão"
    age = state.get("athlete_age")
    lower = _plain(inbound)
    if re.search(r"\b(?:empresa|ec10|como funciona|saber mais|conhecer mais)\b", lower) and not state.get("contact_name"):
        return (
            "A EC10 é uma assessoria esportiva de Belo Horizonte que organiza o desenvolvimento do atleta junto com a família, "
            "começando pelo planejamento da carreira, mentoria e posicionamento esportivo. Para eu conversar com você de forma mais direta, como você se chama?"
        )
    if re.search(r"\b(?:voces sao|e|eh)\s+(?:um )?(?:clube|time)\b|\bsao (?:clube|time)\b|\bentrar no time\b", lower) and not state.get("contact_name"):
        return (
            "A EC10 não é um clube de futebol. Somos uma assessoria esportiva que analisa o momento do atleta, organiza o plano de carreira "
            "e prepara a família para buscar os caminhos certos no futebol. Como você se chama?"
        )
    if "preco" in lower or "valor" in lower or "quanto custa" in lower:
        if not state.get("contact_name"):
            next_step = "Antes disso, como você se chama?"
        elif state.get("guardian_confirmed") or (isinstance(state.get("athlete_age"), int) and state["athlete_age"] >= 18):
            next_step = "Quer que eu abra a agenda para vocês?"
        else:
            next_step = "Você fala comigo como atleta ou como responsável por um atleta?"
        return "Os valores dependem do plano indicado para o momento do atleta e são apresentados com clareza na conversa. " + next_step
    if not state.get("contact_name"):
        return "Pra eu te atender direito por aqui, como você se chama?"
    if state.get("contact_role") in {None, "desconhecido"}:
        return f"Prazer, {name}. Você fala comigo como atleta ou como responsável por um atleta?"
    if not age:
        return "Me conta só uma coisa pra eu te mostrar o caminho certo: qual é a idade do atleta?"
    if age < 18 and not state.get("guardian_confirmed"):
        if state.get("contact_role") == "atleta":
            return f"{name}, como você é menor, preciso incluir um responsável adulto nessa conversa. Quem pode participar com você?"
        return f"{name}, como o atleta é menor, quero incluir quem acompanha as decisões da carreira. Você é o responsável por ele?"
    if "garant" in lower or "promet" in lower or "clube" in lower:
        return "A EC10 trabalha com análise, preparo e direcionamento real da carreira, sempre respeitando o momento do atleta. Quer conversar com nosso time sobre o caminho mais adequado?"
    if state.get("audio_sent") and not state.get("meeting_interest"):
        return "O áudio te deu uma visão do Plano de Carreira. Quer que eu abra a agenda para vocês?"
    if not state.get("goal"):
        return "Hoje, o que vocês mais querem organizar na carreira do atleta?"
    return "Faz sentido eu te apresentar isso numa conversa rápida com nosso time?"
