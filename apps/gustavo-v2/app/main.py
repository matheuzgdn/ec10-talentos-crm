import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
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
