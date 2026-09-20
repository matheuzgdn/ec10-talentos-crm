"""Privacy-safe production audit for Gustavo's segmented chat recovery batch."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone

import psycopg
from dotenv import dotenv_values
from psycopg.rows import dict_row


RECOVERY_TAG = "gustavo_chat_recovery_20260920"
RECOVERY_STARTED_AT = datetime(2026, 9, 20, 17, 40, tzinfo=timezone.utc)


parser = argparse.ArgumentParser()
parser.add_argument("--env", default="/home/opc/ec10-gustavo-v2/.env")
args = parser.parse_args()
database_url = dotenv_values(args.env).get("DATABASE_URL")
if not database_url:
    raise SystemExit("DATABASE_URL is not configured")


def contact_key(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:10]


with psycopg.connect(database_url, row_factory=dict_row) as connection:
    clients = connection.execute("""
        select id from whatsapp_bot.clients where %s=any(coalesce(tags,'{}')) order by id
    """, (RECOVERY_TAG,)).fetchall()
    ids = [row["id"] for row in clients]
    if not ids:
        raise SystemExit("no recovered contacts found")

    queue_summary = connection.execute("""
        select status,media_type,count(*)::int total
        from whatsapp_bot.outbound_messages
        where client_id=any(%s) and created_at>=%s
        group by status,media_type order by status,media_type
    """, (ids, RECOVERY_STARTED_AT)).fetchall()
    failures = connection.execute("""
        select id,client_id,media_type,status,error_message
        from whatsapp_bot.outbound_messages
        where client_id=any(%s) and created_at>=%s and status='failed'
        order by created_at
    """, (ids, RECOVERY_STARTED_AT)).fetchall()
    duplicates = connection.execute("""
        select client_id,coalesce(body,''),coalesce(media_path,''),count(*)::int total
        from whatsapp_bot.outbound_messages
        where client_id=any(%s) and created_at>=%s and status in ('queued','sending','sent')
        group by client_id,coalesce(body,''),coalesce(media_path,'') having count(*)>1
    """, (ids, RECOVERY_STARTED_AT)).fetchall()
    transport_gaps = connection.execute("""
        select client_id,media_type,status
        from whatsapp_bot.outbound_messages
        where client_id=any(%s) and created_at>=%s and status='sent'
          and whatsapp_message_id is null
        order by created_at
    """, (ids, RECOVERY_STARTED_AT)).fetchall()
    per_contact = connection.execute("""
        select c.id,
          count(o.*) filter (where o.status='queued')::int queued,
          count(o.*) filter (where o.status='sending')::int sending,
          count(o.*) filter (where o.status='sent')::int sent,
          count(o.*) filter (where o.status='failed')::int failed,
          max(o.sent_at) last_sent_at,
          (select max(m.created_at) from whatsapp_bot.messages m
            where m.client_id=c.id and m.direction='inbound') last_inbound_at,
          exists(select 1 from whatsapp_bot.ec10_bookings b
            where b.client_id=c.id and b.status='confirmed') booked
        from whatsapp_bot.clients c
        left join whatsapp_bot.outbound_messages o on o.client_id=c.id and o.created_at>=%s
        where c.id=any(%s)
        group by c.id order by c.id
    """, (RECOVERY_STARTED_AT, ids)).fetchall()

safe_contacts = [
    {**{key: value for key, value in row.items() if key != "id"}, "contact_key": contact_key(row["id"])}
    for row in per_contact
]
safe_failures = [
    {**{key: value for key, value in row.items() if key not in {"id", "client_id"}},
     "contact_key": contact_key(row["client_id"])}
    for row in failures
]
safe_duplicates = [
    {"contact_key": contact_key(row["client_id"]), "total": row["total"]}
    for row in duplicates
]
safe_transport_gaps = [
    {"contact_key": contact_key(row["client_id"]), "media_type": row["media_type"]}
    for row in transport_gaps
]
report = {
    "ok": not failures and not duplicates and not transport_gaps,
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "recovered_contacts": len(ids),
    "queue_summary": queue_summary,
    "failures": safe_failures,
    "duplicates": safe_duplicates,
    "transport_gaps": safe_transport_gaps,
    "contacts": safe_contacts,
}
print(json.dumps(report, ensure_ascii=False, default=str))
if not report["ok"]:
    raise SystemExit(1)
