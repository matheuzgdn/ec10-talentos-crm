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
    parser = argparse.ArgumentParser(description="Purge isolated Gustavo V2 test memory")
    parser.add_argument("phone")
    parser.add_argument("--commercial-test", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    phone = "".join(filter(str.isdigit, args.phone))
    allowed = {"5531995391330"}
    if args.commercial_test:
        allowed.add("553198526146")
    if phone not in allowed:
        raise SystemExit("purge refused: phone is not an isolated Gustavo test contact")

    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            contact = conn.execute(
                "select * from whatsapp_bot.gustavo_v2_contacts where phone=%s for update",
                (phone,),
            ).fetchone()
            snapshot = {
                "contact": contact,
                "inbox": conn.execute(
                    "select * from whatsapp_bot.gustavo_v2_inbox where phone=%s for update", (phone,)
                ).fetchall(),
                "outbox": conn.execute(
                    "select * from whatsapp_bot.gustavo_v2_outbox where phone=%s for update", (phone,)
                ).fetchall(),
                "turns": conn.execute(
                    "select * from whatsapp_bot.gustavo_v2_turns where phone=%s for update", (phone,)
                ).fetchall(),
            }
            counts = {key: (1 if value and key == "contact" else len(value or [])) for key, value in snapshot.items()}
            backup_id = None
            if args.apply and contact:
                backup = conn.execute(
                    """
                    insert into app_private.ec10_maintenance_backups(reason,target_id,payload)
                    values('user-requested-gustavo-v2-memory-purge',%s,%s::jsonb) returning id
                    """,
                    (contact["client_id"], json.dumps(snapshot, default=str)),
                ).fetchone()
                backup_id = str(backup["id"])
                conn.execute("delete from whatsapp_bot.gustavo_v2_outbox where phone=%s", (phone,))
                conn.execute("delete from whatsapp_bot.gustavo_v2_inbox where phone=%s", (phone,))
                conn.execute("delete from whatsapp_bot.gustavo_v2_turns where phone=%s", (phone,))
                conn.execute("delete from whatsapp_bot.gustavo_v2_contacts where phone=%s", (phone,))
            elif not args.apply:
                conn.execute("rollback")

    print(json.dumps({"applied": args.apply, "phone": phone, "counts": counts, "backup_id": backup_id}))


if __name__ == "__main__":
    main()
