import pytest

from app.gemini import AIUnavailableError, GeminiSDR
from app.models import DEFAULT_STATE


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
