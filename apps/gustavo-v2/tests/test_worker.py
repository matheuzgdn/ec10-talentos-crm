import pytest
from unittest.mock import AsyncMock
from app.config import Settings
from app.models import DEFAULT_STATE, Decision
from app.worker import Worker


class DeliveryDB:
    def __init__(self, schedule_fails=False):
        self.finished = []
        self.scheduled = []
        self.schedule_fails = schedule_fails

    async def claim_outbox(self):
        return {"id": "test", "phone": "5511999990000", "message_type": "audio",
                "payload": {"media_id": "test-audio", "followup_delay_seconds": 60}}

    async def finish_outbox(self, item_id, **kwargs):
        self.finished.append((item_id, kwargs))

    async def schedule_audio_followup(self, item, delay):
        if self.schedule_fails:
            raise RuntimeError("transient DB failure")
        self.scheduled.append((item, delay))


class DeliveryMeta:
    async def send_audio(self, *_):
        return "wamid.test"


def delivery_worker(schedule_fails=False):
    worker = object.__new__(Worker)
    worker.settings = Settings(database_url="postgresql://test", gemini_api_key="test")
    worker.db = DeliveryDB(schedule_fails)
    worker.meta = DeliveryMeta()
    worker.loop_errors = {}
    return worker


@pytest.mark.asyncio
async def test_followup_is_requested_only_after_the_audio_send_succeeds():
    worker = delivery_worker()
    await worker.send_once()
    assert worker.db.finished == [("test", {"meta_id": "wamid.test"})]
    assert len(worker.db.scheduled) == 1
    assert worker.db.scheduled[0][1] == 60


@pytest.mark.asyncio
async def test_followup_db_failure_never_requeues_an_already_sent_audio():
    worker = delivery_worker(schedule_fails=True)
    await worker.send_once()
    assert worker.db.finished == [("test", {"meta_id": "wamid.test"})]
    assert worker.loop_errors["audio_followup"] == "RuntimeError"


@pytest.mark.asyncio
async def test_style_warning_does_not_block_a_genuine_ai_response():
    worker = object.__new__(Worker)
    worker.settings = Settings(database_url="postgresql://test", gemini_api_key="test", gustavo_v2_enabled=True,
                               gustavo_v2_allowed_phones="5511999990000")
    worker.db = AsyncMock()
    worker.db.claim_conversation.return_value = {"phone": "5511999990000", "rows": [
        {"id": 1, "body": "Quero conhecer vocês", "raw_message": {}, "message_type": "text"}
    ]}
    worker.db.conversation_context.return_value = (DEFAULT_STATE, [], "test-client", [])
    worker.db.has_newer_inbound.return_value = False
    worker.ai = AsyncMock()
    worker.ai.decide.return_value = (Decision(reply="Entendi, vamos conversar sobre a carreira."), 1200,
                                   ["ai_route:test", "style:abertura_engessada"])
    await worker.converse_once()
    worker.db.retry_conversation.assert_not_awaited()
    assert worker.db.finish_turn.await_args.kwargs["message_specs"][0]["payload"]["text"] == "Entendi, vamos conversar sobre a carreira."
    assert worker.db.finish_turn.await_args.args[4] == "test"
    worker.db.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_oracle_turn_uses_v2_ai_and_persists_without_meta_outbox():
    worker = object.__new__(Worker)
    worker.settings = Settings(database_url="postgresql://test", gemini_api_key="test", gustavo_v2_enabled=True)
    worker.oracle_locks = {}
    worker.db = AsyncMock()
    worker.db.oracle_turn_result.return_value = None
    worker.db.conversation_context.return_value = (DEFAULT_STATE.copy(), [], "test-client", [])
    worker.ai = AsyncMock()
    worker.ai.decide.return_value = (
        Decision(reply="Sou o Gustavo, da EC10. Você já conhece nosso trabalho?", stage="discovery"),
        800,
        ["ai_route:gemini-test"],
    )
    result = await worker.oracle_turn(
        "5531999990000", "wamid.oracle-1", "Boa noite", "test-client", lead_source="ec10_campaign_lp",
    )
    assert result["reply"].startswith("Sou o Gustavo")
    assert result["model"] == "gemini-test"
    worker.db.ensure_oracle_contact.assert_awaited_once()
    worker.db.finish_oracle_turn.assert_awaited_once()
    worker.db.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_oracle_turn_is_idempotent_for_same_whatsapp_message():
    worker = object.__new__(Worker)
    worker.settings = Settings(database_url="postgresql://test", gemini_api_key="test", gustavo_v2_enabled=True)
    worker.oracle_locks = {}
    worker.db = AsyncMock()
    worker.db.oracle_turn_result.return_value = {
        "reply": "Resposta já gerada.", "audio_key": None, "booking_url": None,
        "athlete_age": None, "stage": "discovery", "model": "gemini-test",
    }
    worker.ai = AsyncMock()
    result = await worker.oracle_turn("5531999990000", "wamid.same", "Oi", "test-client")
    assert result["reply"] == "Resposta já gerada."
    worker.ai.decide.assert_not_awaited()
    worker.db.ensure_oracle_contact.assert_not_awaited()
