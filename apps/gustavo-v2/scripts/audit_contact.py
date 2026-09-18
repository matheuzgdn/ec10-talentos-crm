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
    parser = argparse.ArgumentParser(description="Read-only Gustavo contact audit")
    parser.add_argument("phone")
    args = parser.parse_args()
    phone = "".join(filter(str.isdigit, args.phone))
    if not phone:
        raise SystemExit("phone is required")

    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        contact = conn.execute(
            """
            select phone,state,status,last_error,updated_at
              from whatsapp_bot.gustavo_v2_contacts
             where phone=%s
            """,
            (phone,),
        ).fetchone()
        turns = conn.execute(
            """
            select inbound_text,response_text,latency_ms,validation,status,error_message,created_at
              from whatsapp_bot.gustavo_v2_turns
             where phone=%s
             order by created_at desc limit 8
            """,
            (phone,),
        ).fetchall()
        queues = conn.execute(
            """
            select status,count(*) total
              from whatsapp_bot.gustavo_v2_outbox
             where phone=%s
             group by status order by status
            """,
            (phone,),
        ).fetchall()
        recent_outbox = conn.execute(
            """
            select message_type,status,attempts,error_message,created_at,sent_at,delivered_at
              from whatsapp_bot.gustavo_v2_outbox
             where phone=%s order by created_at desc limit 5
            """,
            (phone,),
        ).fetchall()
        recent_inbox = conn.execute(
            """
            select id,body,message_type,status,attempts,error_message,created_at,due_at,processed_at
              from whatsapp_bot.gustavo_v2_inbox
             where phone=%s order by id desc limit 8
            """,
            (phone,),
        ).fetchall()
    print(json.dumps({"contact": contact, "turns": turns, "outbox": queues,
                     "recent_outbox": recent_outbox, "recent_inbox": recent_inbox},
                     ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
