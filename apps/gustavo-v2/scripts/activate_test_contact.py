from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Release deferred inbox for an isolated test phone")
    parser.add_argument("phone")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--delivery-retry", action="store_true")
    args = parser.parse_args()
    phone = "".join(filter(str.isdigit, args.phone))
    if phone not in {"553195391330", "5531995391330", "553198526146"}:
        raise SystemExit("phone is not an isolated test contact")

    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            rows = conn.execute(
                """
                select id,status,error_message from whatsapp_bot.gustavo_v2_inbox
                 where phone=%s and status='pending'
                   and error_message=%s for update
                """,
                (phone, "V2 ainda não liberado para este contato"),
            ).fetchall()
            if args.apply:
                conn.execute(
                    """
                    update whatsapp_bot.gustavo_v2_inbox
                       set due_at=now(),error_message=null
                     where id=any(%s)
                    """,
                    ([row["id"] for row in rows],),
                )
                if args.delivery_retry:
                    conn.execute(
                        """
                        update whatsapp_bot.gustavo_v2_outbox
                           set status='failed',available_at=now(),attempts=0
                         where phone=%s and status in ('failed','dead')
                           and error_message like 'MetaWhatsAppError: Meta HTTP 400 code 131030:%%'
                        """,
                        (phone,),
                    )
            else:
                conn.execute("rollback")
    print(json.dumps({"phone": phone, "released": len(rows) if args.apply else 0, "deferred": len(rows)}))


if __name__ == "__main__":
    main()
