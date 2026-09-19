from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Literal, Optional
from fastapi import FastAPI
from pydantic import BaseModel, Field
from .config import get_settings
from .worker import Worker


settings = get_settings()
worker = Worker(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await worker.db.open()
    task = asyncio.create_task(worker.run(), name="gustavo-v2-worker")
    yield
    await worker.stop()
    await task
    await worker.close()


app = FastAPI(title="Gustavo V2", version="2.0.0", lifespan=lifespan)


class OracleTurnRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=20)
    message_id: str = Field(min_length=3, max_length=300)
    inbound: str = Field(min_length=1, max_length=5000)
    client_id: str = Field(min_length=8, max_length=100)
    known_name: Optional[str] = Field(default=None, max_length=100)
    known_age: Optional[int] = Field(default=None, ge=6, le=40)
    lead_source: Optional[str] = Field(default=None, max_length=120)
    service_interest: Optional[str] = Field(default=None, max_length=80)


class OracleAudioDeliveredRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=20)
    audio_key: Literal["eric_8_13", "eric_14_18", "eric_20_25"]


@app.get("/health")
async def health():
    database = await worker.db.health()
    return {
        "ok": True,
        "enabled": settings.gustavo_v2_enabled,
        "meta_configured": bool(settings.meta_phone_number_id and settings.meta_whatsapp_access_token),
        "model": settings.gemini_model,
        "thinking_level": settings.gemini_thinking_level,
        "database": database,
        "loop_errors": dict(worker.loop_errors),
    }


@app.post("/oracle/respond")
async def oracle_respond(turn: OracleTurnRequest):
    return await worker.oracle_turn(**turn.model_dump())


@app.post("/oracle/audio-delivered")
async def oracle_audio_delivered(delivery: OracleAudioDeliveredRequest):
    return await worker.confirm_oracle_audio_delivery(**delivery.model_dump())
