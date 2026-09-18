import pytest

from app.gemini import GeminiSDR
from app.models import DEFAULT_STATE


class BrokenModels:
    async def generate_content(self, **_):
        raise RuntimeError("temporary provider failure")


class BrokenClient:
    def __init__(self):
        self.aio = type("Aio", (), {"models": BrokenModels()})()


@pytest.mark.asyncio
async def test_provider_failure_returns_local_fallback(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.gemini.asyncio.sleep", no_sleep)
    agent = object.__new__(GeminiSDR)
    agent.client = BrokenClient()
    agent.model = "broken-model"

    decision, _, errors = await agent.decide(DEFAULT_STATE, [], "Oi")

    assert decision.reply == "Vamos seguir por aqui."
    assert "gemini_fallback_local" in errors
