"""Official GenerateContent REST transport with reusable HTTP and safe errors."""
from __future__ import annotations

import re
from types import SimpleNamespace

import httpx


class GeminiAPIError(RuntimeError):
    pass


class GeminiModels:
    def __init__(self, api_key: str, thinking_level: str = "low", transport=None):
        self.http = httpx.AsyncClient(
            base_url="https://generativelanguage.googleapis.com/v1beta/",
            headers={"x-goog-api-key": api_key}, timeout=8, transport=transport,
        )
        self.thinking_level = thinking_level

    async def generate_content(self, *, model: str, contents: str, config: dict):
        if not re.fullmatch(r"gemini-[A-Za-z0-9_.-]+", model):
            raise GeminiAPIError("invalid Gemini model identifier")
        generation = {
            "maxOutputTokens": config["max_output_tokens"],
            "responseMimeType": "application/json",
            "responseJsonSchema": config["response_schema"].model_json_schema(),
        }
        if model.startswith("gemini-3"):
            generation["thinkingConfig"] = {"thinkingLevel": self.thinking_level.upper()}
        response = await self.http.post(f"models/{model}:generateContent", json={
            "systemInstruction": {"parts": [{"text": config["system_instruction"]}]},
            "contents": [{"role": "user", "parts": [{"text": contents}]}],
            "generationConfig": generation,
        })
        if response.is_error:
            # Never persist a request URL, API key, raw error payload or user data.
            raise GeminiAPIError(f"Gemini HTTP {response.status_code}")
        data = response.json()
        candidates = data.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        text = "".join(str(part["text"]) for part in parts if "text" in part and not part.get("thought"))
        if not text:
            raise GeminiAPIError("Gemini returned no customer decision")
        return SimpleNamespace(text=text)


class GeminiClient:
    def __init__(self, api_key: str, thinking_level: str = "low"):
        self.models = GeminiModels(api_key, thinking_level)
        self.aio = SimpleNamespace(models=self.models)

    async def close(self):
        await self.models.http.aclose()
