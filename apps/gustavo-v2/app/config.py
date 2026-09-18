from __future__ import annotations

from functools import lru_cache
from typing import Optional
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    gemini_api_key: str
    gemini_model: str = "gemini-3.5-flash"
    gemini_secondary_model: str = "gemini-3.5-flash-lite"
    gemini_thinking_level: Literal["minimal", "low", "medium", "high"] = "low"
    gemini_timeout_seconds: float = 5
    meta_graph_version: str = "v25.0"
    meta_phone_number_id: str = ""
    meta_waba_id: str = ""
    meta_whatsapp_access_token: str = ""
    meta_app_secret: str = ""
    meta_whatsapp_verify_token: str = ""
    gustavo_v2_enabled: bool = False
    gustavo_v2_allowed_phones: str = ""
    gustavo_v2_recipient_aliases: str = ""
    gustavo_v2_poll_seconds: float = 1.0
    gustavo_v2_debounce_seconds: float = 1.2
    gustavo_v2_http_host: str = "127.0.0.1"
    gustavo_v2_http_port: int = 8781
    eric_audio_8_13_media_id: str = ""
    eric_audio_14_18_media_id: str = ""
    eric_audio_20_25_media_id: str = ""

    @property
    def allowed_phones(self) -> set[str]:
        return {"".join(filter(str.isdigit, item)) for item in self.gustavo_v2_allowed_phones.split(",") if item.strip()}

    def media_id(self, audio_key: Optional[str]) -> str:
        return {
            "eric_8_13": self.eric_audio_8_13_media_id,
            "eric_14_18": self.eric_audio_14_18_media_id,
            "eric_20_25": self.eric_audio_20_25_media_id,
        }.get(audio_key or "", "")

    def recipient_phone(self, phone: str) -> str:
        for entry in self.gustavo_v2_recipient_aliases.split(","):
            source, separator, target = entry.partition("=")
            if separator and source.strip() == phone and target.strip().isdigit():
                return target.strip()
        return phone


@lru_cache
def get_settings() -> Settings:
    return Settings()
