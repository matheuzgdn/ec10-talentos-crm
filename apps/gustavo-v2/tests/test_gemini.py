import pytest

from app.gemini import AIUnavailableError, GeminiSDR
from app.models import DEFAULT_STATE
from app.models import Decision
import json


class BrokenModels:
    async def generate_content(self, **_):
        raise RuntimeError("temporary provider failure")


class BrokenClient:
    def __init__(self):
        self.aio = type("Aio", (), {"models": BrokenModels()})()


@pytest.mark.asyncio
async def test_all_provider_routes_fail_without_sending_canned_reply():
    agent = object.__new__(GeminiSDR)
    agent.client = BrokenClient()
    agent.models = ["broken-primary", "broken-secondary"]

    with pytest.raises(AIUnavailableError) as captured:
        await agent.decide(DEFAULT_STATE, [], "Oi")

    assert "broken-primary" in str(captured.value)
    assert "broken-secondary" in str(captured.value)


class SequenceModels:
    def __init__(self, decisions):
        self.decisions = iter(decisions)
        self.calls = []

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return type("Result", (), {"text": next(self.decisions).model_dump_json()})()


def sequence_agent(decisions):
    models = SequenceModels(decisions)
    agent = object.__new__(GeminiSDR)
    agent.client = type("Client", (), {"aio": type("Aio", (), {"models": models})()})()
    agent.models = ["test-gemini"]
    return agent, models


@pytest.mark.asyncio
async def test_ai_revises_its_own_reply_without_a_canned_fallback():
    agent, models = sequence_agent([
        Decision(reply="Qual seu nome? Qual a idade?"),
        Decision(reply="Como você se chama?"),
    ])
    decision, _, _ = await agent.decide(DEFAULT_STATE, [], "Quero conhecer vocês")
    assert decision.reply == "Como você se chama?"
    assert len(models.calls) == 2
    assert "Problemas encontrados" in models.calls[-1]["contents"]


@pytest.mark.asyncio
async def test_ai_revises_name_and_age_combined_under_one_question_mark():
    agent, models = sequence_agent([
        Decision(reply="Qual é o nome do atleta e quantos anos ele tem?"),
        Decision(reply="Qual é o nome do atleta?"),
    ])
    decision, _, _ = await agent.decide(DEFAULT_STATE, [], "Quero desenvolver meu filho")
    assert decision.reply == "Qual é o nome do atleta?"
    assert len(models.calls) == 2


@pytest.mark.asyncio
async def test_style_imperfection_does_not_leave_the_lead_in_an_infinite_retry():
    generated = Decision(reply="Entendi, vamos conversar sobre a carreira.")
    agent, _ = sequence_agent([generated, generated])
    decision, _, diagnostic = await agent.decide(DEFAULT_STATE, [], "Quero conhecer vocês")
    assert decision.reply == generated.reply
    assert "style:abertura_engessada" in diagnostic


@pytest.mark.asyncio
async def test_internal_code_is_never_selected_as_a_customer_reply():
    agent, _ = sequence_agent([
        Decision(reply="update_qualification(reply='Oi')"),
        Decision(reply='```json {"reply":"Oi"} ```'),
    ])
    with pytest.raises(AIUnavailableError):
        await agent.decide(DEFAULT_STATE, [], "Oi")


@pytest.mark.asyncio
async def test_audio_followup_is_an_internal_event_not_a_fabricated_lead_message():
    agent, models = sequence_agent([Decision(reply="Quer marcar uma conversa online com a equipe para conhecer o caminho do atleta?")])
    event = {"internal_event": "audio_followup", "source_outbox_id": "test-id"}
    await agent.decide(DEFAULT_STATE, [], "", event_context=event)
    sent_prompt = json.loads(models.calls[0]["contents"])
    assert sent_prompt["nova_mensagem"] == ""
    assert sent_prompt["evento_interno"] == event


@pytest.mark.asyncio
async def test_repeated_audio_action_is_replanned_by_ai():
    state = {**DEFAULT_STATE, "athlete_age": 15, "audio_sent": ["eric_14_18"]}
    agent, _ = sequence_agent([
        Decision(reply="Vou enviar o áudio de novo.", audio_key="eric_14_18"),
        Decision(reply="Você gostaria de conversar com a equipe numa reunião online?"),
    ])
    decision, _, _ = await agent.decide(state, [], "Ouvi sim")
    assert decision.audio_key is None
    assert "reunião" in decision.reply


@pytest.mark.asyncio
async def test_audio_permission_question_is_rewritten_by_ai_even_when_it_says_pode_ser():
    state = {**DEFAULT_STATE, "athlete_age": 15}
    agent, _ = sequence_agent([
        Decision(reply="Vou te enviar o áudio do Eric. Pode ser?", audio_key="eric_14_18"),
        Decision(reply="Vou te enviar o áudio do Eric sobre o Plano de Carreira.", audio_key="eric_14_18", followup_delay_seconds=90),
    ])
    decision, _, _ = await agent.decide(state, [], "Meu filho tem 15 anos")
    assert "?" not in decision.reply
    assert decision.audio_key == "eric_14_18"
