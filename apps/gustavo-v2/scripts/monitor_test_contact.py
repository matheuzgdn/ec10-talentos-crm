"""Read-only observation of one test contact. No retries, messages or resets."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings


def safe_text(value):
    return re.sub(r"https?://\S+", "[link]", str(value or ""))[:400]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phone", help="Número de teste com país e DDD, somente dígitos")
    parser.add_argument("--minutes", type=int, default=30, choices=range(1, 61))
    args = parser.parse_args()
    deadline = time.monotonic() + args.minutes * 60
    settings = get_settings()
    if not re.fullmatch(r"\d{10,15}", args.phone):
        parser.error("Informe um número válido com país e DDD.")
    if not settings.allowed_phones or args.phone not in settings.allowed_phones:
        parser.error("O monitor só pode observar um número explicitamente liberado no ambiente de teste.")
    previous = None
    conn = None
    print(json.dumps({"event": "monitor_started", "duration_minutes": args.minutes,
                      "read_only": True, "phone_suffix": args.phone[-4:]}), flush=True)
    try:
        while time.monotonic() < deadline:
            try:
                if conn is None or conn.closed:
                    conn = psycopg.connect(settings.database_url, row_factory=dict_row,
                                           connect_timeout=10, prepare_threshold=None)
                with conn.transaction(force_rollback=True):
                    conn.execute("set transaction read only")
                    conn.execute("set local statement_timeout='10s'")
                    contact = conn.execute("""
                        select state,status,last_error from whatsapp_bot.gustavo_v2_contacts where phone=%s
                    """, (args.phone,)).fetchone()
                    inbox = conn.execute("""
                        select id,body,status,attempts,error_message,created_at,processed_at
                          from whatsapp_bot.gustavo_v2_inbox
                         where phone=%s and message_type<>'internal_followup' order by id desc limit 3
                    """, (args.phone,)).fetchall()
                    turns = conn.execute("""
                        select id,response_text,latency_ms,validation,created_at
                          from whatsapp_bot.gustavo_v2_turns
                         where phone=%s order by id desc limit 3
                    """, (args.phone,)).fetchall()
                    outbox = conn.execute("""
                        select id,message_type,status,attempts,error_message,created_at,delivered_at
                          from whatsapp_bot.gustavo_v2_outbox
                         where phone=%s order by created_at desc limit 3
                    """, (args.phone,)).fetchall()
                state = contact["state"] if contact else {}
                alerts = []
                now = datetime.now(timezone.utc)
                for row in inbox:
                    if row["status"] in {"pending", "processing"} and (now-row["created_at"]).total_seconds() > 20:
                        alerts.append("customer_message_waiting_over_20s")
                    if row["error_message"]:
                        alerts.append("inbox_error")
                if any(row["status"] in {"failed", "dead"} for row in outbox):
                    alerts.append("delivery_failure")
                replies = [safe_text(row["response_text"]).lower() for row in turns if row["response_text"]]
                if len(replies) != len(set(replies)):
                    alerts.append("repeated_reply")
                if isinstance(state.get("athlete_age"), int) and state["athlete_age"] < 18 and state.get("booking_url") and (
                    not state.get("guardian_confirmed") or state.get("contact_role") != "responsavel"
                ):
                    alerts.append("minor_booking_without_verified_guardian")
                snapshot = {"stage": state.get("stage"), "audio_requested": state.get("audio_sent", []),
                            "booking_link_created": bool(state.get("booking_url")), "alerts": sorted(set(alerts)),
                            "inbox": [{**row, "body": safe_text(row["body"])} for row in inbox],
                            "turns": [{**row, "response_text": safe_text(row["response_text"])} for row in turns],
                            "outbox": outbox}
                encoded = json.dumps(snapshot, ensure_ascii=False, default=str, sort_keys=True)
                if encoded != previous:
                    print(json.dumps({"observed_at": now.isoformat(), **snapshot}, ensure_ascii=False,
                                     default=str), flush=True)
                    previous = encoded
            except psycopg.Error as exc:
                print(json.dumps({"event": "monitor_db_error", "type": type(exc).__name__}), flush=True)
                if conn:
                    conn.close()
                conn = None
            time.sleep(4)
    finally:
        if conn:
            conn.close()
        print(json.dumps({"event": "monitor_finished", "read_only": True}), flush=True)


if __name__ == "__main__":
    main()
