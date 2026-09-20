"""Live isolated E2E: day choice -> time choice -> CRM agenda, then restore test data."""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from copy import deepcopy

import psycopg
from dotenv import dotenv_values
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


parser = argparse.ArgumentParser()
parser.add_argument("--env", default="/home/opc/ec10-gustavo-v2/.env")
parser.add_argument("--phone", default="5531995391330")
parser.add_argument("--client-id")
parser.add_argument("--url", default="http://127.0.0.1:8781/oracle/respond")
args = parser.parse_args()
database_url = dotenv_values(args.env).get("DATABASE_URL")
if not database_url:
    raise SystemExit("DATABASE_URL is not configured")


def post(payload: dict) -> dict:
    request = urllib.request.Request(args.url, data=json.dumps(payload).encode(),
                                     headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read())


with psycopg.connect(database_url, row_factory=dict_row) as connection:
    client = (connection.execute("select * from whatsapp_bot.clients where id=%s", (args.client_id,)).fetchone()
              if args.client_id else
              connection.execute("select * from whatsapp_bot.clients where phone=%s", (args.phone,)).fetchone())
    if not client:
        raise SystemExit("Test contact is not registered")
    args.phone = str(client["phone"])
    if connection.execute("select 1 from whatsapp_bot.ec10_bookings where client_id=%s and status='confirmed'", (client["id"],)).fetchone():
        raise SystemExit("Test refused: contact already has a confirmed booking")
    lead = connection.execute("""
        select * from public.leads where organization_id=app_private.ec10_organization_id() and (
          data->>'whatsapp_client_id'=%s or data->>'whatsapp_crm_client_id'=%s
          or app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164',data->>'telefone'))
            =app_private.whatsapp_phone_match_key(%s))
        order by (data->>'whatsapp_client_id'=%s) desc nulls last limit 1
    """, (str(client["id"]), str(client["id"]), args.phone, str(client["id"]))).fetchone()
    if not lead:
        raise SystemExit("Test contact has no CRM lead card")
    v2 = connection.execute("select * from whatsapp_bot.gustavo_v2_contacts where phone=%s", (args.phone,)).fetchone()
    legacy = connection.execute("select * from whatsapp_bot.bot_conversation_states where client_id=%s", (client["id"],)).fetchone()
    options = [dict(row) for row in connection.execute(
        "select * from whatsapp_bot.ec10_chat_booking_options('plano_carreira',null)"
    ).fetchall()]
    if len(options) != 4:
        raise SystemExit("Expected four schedule options")
    for option in options:
        option["seller_id"] = str(option["seller_id"])
        option["starts_at"] = option["starts_at"].isoformat()
        option["ends_at"] = option["ends_at"].isoformat()
    test_state = deepcopy((v2 or {}).get("state") or {})
    test_state.update({
        "contact_name": "Contato Teste", "contact_role": "responsavel", "guardian_confirmed": True,
        "athlete_name": "Atleta Teste", "athlete_age": 14, "service_interest": "plano_carreira",
        "company_intro_sent": True, "meeting_interest": True, "audio_sent": ["eric_14_18"],
        "stage": "waiting_booking", "chat_booking_stage": "day", "chat_booking_options": options,
        "chat_booking_selected": None, "booking_url": None,
    })
    connection.execute("""
        insert into whatsapp_bot.gustavo_v2_contacts(phone,client_id,state,status,updated_at)
        values(%s,%s,%s,'active',now()) on conflict(phone) do update set
          client_id=excluded.client_id,state=excluded.state,status='active',last_error=null,updated_at=now()
    """, (args.phone, client["id"], Jsonb(test_state)))
    connection.commit()

run_id = str(int(time.time()))
booking_id = None
slot_id = None
task_id = None
try:
    chosen = options[0]
    day = post({"phone": args.phone, "message_id": f"e2e-day-{run_id}",
                "inbound": f"{chosen['weekday_label']}, {chosen['date_label']} · {chosen['display_name']}",
                "client_id": str(client["id"]), "known_name": "Contato Teste", "known_age": 14,
                "lead_source": "isolated_e2e", "service_interest": "plano_carreira"})
    if day.get("poll", {}).get("kind") != "meeting_time":
        raise RuntimeError(f"Day poll did not advance: {day}")
    confirmed = post({"phone": args.phone, "message_id": f"e2e-time-{run_id}",
                      "inbound": "20:00", "client_id": str(client["id"]),
                      "known_name": "Contato Teste", "known_age": 14,
                      "lead_source": "isolated_e2e", "service_interest": "plano_carreira"})
    if not confirmed.get("booking") or "Google Agenda:" not in confirmed.get("reply", ""):
        raise RuntimeError(f"Booking confirmation missing: {confirmed}")
    booking_id = confirmed["booking"]["id"]
    task_id = f"booking-{booking_id}"
    with psycopg.connect(database_url, row_factory=dict_row) as verification:
        booking = verification.execute("""
            select b.*,sl.source from whatsapp_bot.ec10_bookings b
            join whatsapp_bot.ec10_booking_slots sl on sl.id=b.slot_id where b.id=%s
        """, (booking_id,)).fetchone()
        task = verification.execute("select id,data from public.tarefas where id=%s", (task_id,)).fetchone()
        lead_after = verification.execute("select data from public.leads where id=%s", (lead["id"],)).fetchone()
        if not booking or not task or task["data"].get("booking_id") != booking_id:
            raise RuntimeError("Booking was not mirrored to the CRM agenda")
        if lead_after["data"].get("status") != "reuniao_agendada":
            raise RuntimeError("CRM lead was not moved to scheduled meeting")
        slot_id = booking["slot_id"]
    print(json.dumps({"ok": True, "day_poll": day["poll"]["kind"],
                      "booking_recorded": True, "crm_agenda_recorded": True,
                      "calendar_confirmation": True, "seller": confirmed["booking"]["seller_name"]},
                     ensure_ascii=False))
finally:
    with psycopg.connect(database_url, row_factory=dict_row) as cleanup:
        with cleanup.transaction():
            if task_id:
                cleanup.execute("delete from public.tarefas where id=%s", (task_id,))
            if booking_id:
                cleanup.execute("delete from whatsapp_bot.ec10_bookings where id=%s", (booking_id,))
            if slot_id:
                cleanup.execute("""
                    delete from whatsapp_bot.ec10_booking_slots where id=%s and source='gustavo_chat'
                      and not exists(select 1 from whatsapp_bot.ec10_bookings where slot_id=%s)
                """, (slot_id, slot_id))
            cleanup.execute("""
                update whatsapp_bot.clients set name=%s,status=%s,region=%s,assigned_seller_id=%s,
                  bot_paused=%s,notes=%s,tags=%s,service_interest=%s,attribution_metadata=%s,updated_at=%s
                where id=%s
            """, (client["name"], client["status"], client["region"], client["assigned_seller_id"],
                  client["bot_paused"], client["notes"], client["tags"], client["service_interest"],
                  Jsonb(client["attribution_metadata"] or {}), client["updated_at"], client["id"]))
            cleanup.execute("update public.leads set data=%s,updated_date=%s,updated_by=%s where id=%s",
                            (Jsonb(lead["data"]), lead["updated_date"], lead["updated_by"], lead["id"]))
            if v2:
                cleanup.execute("""
                    update whatsapp_bot.gustavo_v2_contacts set client_id=%s,state=%s,status=%s,version=%s,
                      last_inbound_at=%s,last_outbound_at=%s,last_error=%s,updated_at=%s where phone=%s
                """, (v2["client_id"], Jsonb(v2["state"]), v2["status"], v2["version"], v2["last_inbound_at"],
                      v2["last_outbound_at"], v2["last_error"], v2["updated_at"], args.phone))
            else:
                cleanup.execute("delete from whatsapp_bot.gustavo_v2_contacts where phone=%s", (args.phone,))
            if legacy:
                cleanup.execute("""
                    update whatsapp_bot.bot_conversation_states set stage=%s,role_answer=%s,athlete_age=%s,
                      age_group=%s,service_interest=%s,lead_page_url=%s,completed_at=%s,metadata=%s,
                      last_inbound_at=%s,last_outbound_at=%s,updated_at=%s where id=%s
                """, (legacy["stage"], legacy["role_answer"], legacy["athlete_age"], legacy["age_group"],
                      legacy["service_interest"], legacy["lead_page_url"], legacy["completed_at"],
                      Jsonb(legacy["metadata"]), legacy["last_inbound_at"], legacy["last_outbound_at"],
                      legacy["updated_at"], legacy["id"]))
            cleanup.execute("""
                delete from whatsapp_bot.gustavo_v2_turns
                where phone=%s and validation->>'oracle_message_id' like %s
            """, (args.phone, f"e2e-%%-{run_id}"))
