import httpx
import pytest

from app.meta import MetaWhatsApp, MetaWhatsAppError


@pytest.mark.asyncio
async def test_send_text_returns_message_id():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer token-value"
        return httpx.Response(200, json={"messages": [{"id": "wamid.123"}]})

    client = MetaWhatsApp("v25.0", "phone-id", "token-value", httpx.MockTransport(handler))
    assert await client.send_text("5531999999999", "Oi") == "wamid.123"


@pytest.mark.asyncio
async def test_meta_error_keeps_actionable_code_without_token():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "Recipient not allowed", "code": 131030}})

    client = MetaWhatsApp("v25.0", "phone-id", "secret-token", httpx.MockTransport(handler))
    with pytest.raises(MetaWhatsAppError) as captured:
        await client.send_text("5531999999999", "Oi")
    assert "131030" in str(captured.value)
    assert "secret-token" not in str(captured.value)


@pytest.mark.asyncio
async def test_mark_read_accepts_success_without_message_id():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": True})

    client = MetaWhatsApp("v25.0", "phone-id", "token-value", httpx.MockTransport(handler))
    await client.mark_read("wamid.123")
