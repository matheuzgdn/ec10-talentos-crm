from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import unquote_plus

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Repair known Gustavo contact facts without resetting history")
    parser.add_argument("phone")
    parser.add_argument("--contact-name")
    parser.add_argument("--guardian-name")
    parser.add_argument("--athlete-name")
    parser.add_argument("--athlete-age", type=int)
    parser.add_argument("--goal")
    parser.add_argument("--lead-source")
    parser.add_argument("--current-club")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    phone = "".join(filter(str.isdigit, args.phone))
    if not phone:
        raise SystemExit("phone is required")

    patch = {
        key: value
        for key, value in {
            "contact_name": args.contact_name,
            "guardian_name": args.guardian_name,
            "athlete_name": args.athlete_name,
            "athlete_age": args.athlete_age,
            "goal": args.goal,
            "lead_source": args.lead_source,
            "current_club": args.current_club,
        }.items()
        if value is not None
    }
    patch = {key: unquote_plus(value) if isinstance(value, str) else value for key, value in patch.items()}
    if not patch:
        raise SystemExit("at least one fact is required")

    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        with conn.transaction():
            row = conn.execute(
                "select * from whatsapp_bot.gustavo_v2_contacts where phone=%s for update",
                (phone,),
            ).fetchone()
            if not row:
                raise RuntimeError("contact not found")
            state = dict(row.get("state") or {})
            state.update(patch)
            backup_id = None
            if args.apply:
                backup = conn.execute(
                    """
                    insert into app_private.ec10_maintenance_backups(reason,target_id,payload)
                    values('gustavo-v2-memory-repair',%s,%s::jsonb) returning id
                    """,
                    (row["client_id"], json.dumps(row, default=str)),
                ).fetchone()
                backup_id = str(backup["id"])
                conn.execute(
                    """
                    update whatsapp_bot.gustavo_v2_contacts
                       set state=%s::jsonb,last_error=null,updated_at=now()
                     where phone=%s
                    """,
                    (json.dumps(state, ensure_ascii=False), phone),
                )
            else:
                conn.execute("rollback")
    print(json.dumps({"applied": args.apply, "backup_id": backup_id, "phone": phone, "state": state}, ensure_ascii=False))


if __name__ == "__main__":
    main()
