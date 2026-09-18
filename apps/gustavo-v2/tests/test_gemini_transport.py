import json
import httpx
import pytest
from app.gemini_transport import GeminiAPIError, GeminiModels
from app.models import Decision


@pytest.mark.asyncio
async def test_official_request_uses_advanced_model_thinking_and_structured_output():
    requests = []

    async def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [
            {"text": "Private reasoning", "thought": True},
            {"text": Decision(reply="Vamos conversar sobre a carreira.").model_dump_json(), "thoughtSignature": "private-signature"},
        ]}}]})

    models = GeminiModels("test-secret", transport=httpx.MockTransport(handler))
    try:
        result = await models.generate_content(model="gemini-3.5-flash", contents="message", config={
            "system_instruction": "rules", "max_output_tokens": 1200, "response_schema": Decision,
        })
        assert "Private reasoning" not in result.text
        body = json.loads(requests[0].content)
        assert body["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "LOW"}
        assert body["generationConfig"]["responseJsonSchema"]["properties"]["reply"]
        assert "temperature" not in body["generationConfig"]
        assert "test-secret" not in str(requests[0].url)
        assert requests[0].headers["x-goog-api-key"] == "test-secret"
    finally:
        await models.http.aclose()


@pytest.mark.asyncio
async def test_gemini_error_does_not_persist_credentials_or_raw_provider_output():
    models = GeminiModels("test-secret", transport=httpx.MockTransport(
        lambda _: httpx.Response(429, json={"error": {"message": "private test-secret"}})
    ))
    try:
        with pytest.raises(GeminiAPIError) as caught:
            await models.generate_content(model="gemini-3.5-flash", contents="message", config={
                "system_instruction": "rules", "max_output_tokens": 1200, "response_schema": Decision,
            })
        assert str(caught.value) == "Gemini HTTP 429"
    finally:
        await models.http.aclose()
