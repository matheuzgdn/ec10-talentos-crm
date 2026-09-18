"""Retry one existing test reply, never create a new message or reset memory."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.meta import MetaWhatsApp, MetaWhatsAppError


async def deliver(settings, row: dict, recipient: str) -> str:
    meta = MetaWhatsApp(settings.meta_graph_version, settings.meta_phone_number_id,
                        settings.meta_whatsapp_access_token)
    try:
        if row["message_type"] == "audio":
            return await meta.send_audio(recipient, row["payload"]["media_id"])
        return await meta.send_text(recipient, row["payload"]["text"])
    finally:
        await meta.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phone", choices=["553195391330", "5531995391330"])
    parser.add_argument("--recipient", choices=["553195391330", "5531995391330"])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    if not settings.gustavo_v2_enabled or args.phone not in settings.allowed_phones:
        raise SystemExit("isolated test contact is not enabled")
    result = {"phone_number_id": settings.meta_phone_number_id, "waba_id": settings.meta_waba_id,
              "recipient": args.recipient or settings.recipient_phone(args.phone), "applied": args.apply}
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            row = conn.execute(
                """select * from whatsapp_bot.gustavo_v2_outbox
                   where phone=%s and status in ('failed','dead')
                     and error_message like 'MetaWhatsAppError: Meta HTTP 400 code 131030:%%'
                   order by created_at desc for update skip locked limit 1""", (args.phone,)
            ).fetchone()
            result["pending_reply_found"] = bool(row)
            if args.apply and row:
                try:
                    meta_id = asyncio.run(deliver(settings, row, result["recipient"]))
                except MetaWhatsAppError as exc:
                    result.update(accepted=False, error=str(exc))
                else:
                    conn.execute(
                        """update whatsapp_bot.gustavo_v2_outbox
                           set status='sent',meta_message_id=%s,sent_at=now(),error_message=null
                           where id=%s""", (meta_id, row["id"])
                    )
                    result.update(accepted=True, message_id_saved=True)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
