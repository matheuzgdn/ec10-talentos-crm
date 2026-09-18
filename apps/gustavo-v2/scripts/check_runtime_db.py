"""Check queue SQL inside a rolled-back transaction; never send WhatsApp."""
from __future__ import annotations

import asyncio
import json
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings
from app.database import Database


async def main():
    db = Database(get_settings().database_url)
    await db.open()
    timings = []
    try:
        for _ in range(3):
            started = time.monotonic()
            await db.health()
            timings.append(round((time.monotonic() - started) * 1000))
        async with await db.connect() as conn:
            async with conn.transaction(force_rollback=True):
                original_connect = db.connect

                @asynccontextmanager
                async def pinned_context():
                    yield conn

                async def pinned_connect():
                    return pinned_context()

                db.connect = pinned_connect
                try:
                    suffix = uuid.uuid4().hex
                    phone = f"queue-contract-{suffix}"
                    row = await (await conn.execute("""
                        insert into whatsapp_bot.gustavo_v2_outbox
                          (idempotency_key,phone,message_type,payload,status,available_at,meta_message_id)
                        values(%s,%s,'audio','{}'::jsonb,'sent',now()+interval '1 day',%s)
                        returning *
                    """, (suffix, phone, f"contract-meta-{suffix}"))).fetchone()
                    await db.schedule_audio_followup(row, 90)
                    followup = await (await conn.execute(
                        "select * from whatsapp_bot.gustavo_v2_inbox where phone=%s", (phone,)
                    )).fetchone()
                    assert followup["message_type"] == "internal_followup" and followup["body"] == ""
                    assert not await db.followup_audio_delivered(str(row["id"]))
                    for status in ("delivered", "sent", "read", "sent"):
                        await db.ingest_event({"entry": [{"changes": [{"value": {"statuses": [
                            {"id": row["meta_message_id"], "status": status}
                        ]}}]}]})
                    saved = await (await conn.execute(
                        "select status,delivered_at,read_at from whatsapp_bot.gustavo_v2_outbox where id=%s", (row["id"],)
                    )).fetchone()
                    assert saved["status"] == "read"
                    assert await db.followup_audio_delivered(str(row["id"]))
                    assert not await db.has_newer_inbound(phone, followup["id"])
                    await conn.execute("""
                        insert into whatsapp_bot.gustavo_v2_inbox
                          (meta_message_id,phone,message_type,body,raw_message,due_at)
                        values(%s,%s,'text','test','{}'::jsonb,now()+interval '1 day')
                    """, (f"contract-inbound-{suffix}", phone))
                    assert await db.has_newer_inbound(phone, followup["id"])
                    await db.defer_audio_followup([followup["id"]])
                    await conn.execute("insert into whatsapp_bot.gustavo_v2_contacts(phone,state) values(%s,'{}'::jsonb)", (phone,))
                    await db.finish_turn(phone, [followup["id"]], "test", "AI reply", "test-gemini", 100,
                                         {}, {"stage": "offer"}, {}, message_specs=[
                                             {"key": f"atomic-reply-{suffix}", "message_type": "text", "payload": {"text": "AI reply"}}
                                         ])
                    committed = await (await conn.execute(
                        "select response_text from whatsapp_bot.gustavo_v2_turns where phone=%s", (phone,)
                    )).fetchone()
                    assert committed["response_text"] == "AI reply"
                finally:
                    db.connect = original_connect
        print(json.dumps({"passed": True, "all_test_data_rolled_back": True,
                          "pooled_health_query_ms": timings, "monotonic_delivery_status": True,
                          "ai_followup_queue_sql": True, "newer_inbound_detection": True}))
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
