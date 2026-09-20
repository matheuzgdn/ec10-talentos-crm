"""Read-only production audit for Gustavo's deterministic chat agenda."""
from __future__ import annotations

import argparse
import json

import psycopg
from dotenv import dotenv_values
from psycopg.rows import dict_row


parser = argparse.ArgumentParser()
parser.add_argument("--env", default="/home/opc/ec10-gustavo-v2/.env")
args = parser.parse_args()
database_url = dotenv_values(args.env).get("DATABASE_URL")
if not database_url:
    raise SystemExit("DATABASE_URL is not configured")

with psycopg.connect(database_url, row_factory=dict_row) as connection:
    schedule = connection.execute("""
        select r.iso_weekday,r.local_time::text,r.display_name,s.name seller_name,s.active
        from whatsapp_bot.ec10_chat_booking_schedule r
        join whatsapp_bot.sellers s on s.id=r.seller_id
        where r.service='plano_carreira' and r.enabled order by r.iso_weekday
    """).fetchall()
    options = connection.execute("""
        select display_name,iso_date,weekday_label,date_label,
          to_char(starts_at at time zone 'America/Sao_Paulo','HH24:MI') local_time
        from whatsapp_bot.ec10_chat_booking_options('plano_carreira',null)
    """).fetchall()
    duplicates = connection.execute("""
        select seller_id,starts_at,count(*)::int total from whatsapp_bot.ec10_bookings
        where status='confirmed' group by seller_id,starts_at having count(*)>1
    """).fetchall()

expected = [(1, "20:00:00", "Sandro"), (2, "20:00:00", "Ericson"),
            (3, "20:00:00", "Pablo"), (4, "20:00:00", "Cenoura")]
actual = [(row["iso_weekday"], row["local_time"], row["display_name"]) for row in schedule]
if actual != expected:
    raise SystemExit(f"schedule mismatch:{actual}")
if len(options) != 4 or any(row["local_time"] != "20:00" for row in options):
    raise SystemExit(f"availability mismatch:{options}")
if duplicates:
    raise SystemExit("duplicate confirmed bookings detected")
print(json.dumps({"ok": True, "schedule": schedule, "available_options": options},
                 ensure_ascii=False, default=str))
