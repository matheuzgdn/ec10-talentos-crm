"""Audit and safely recover stalled EC10 WhatsApp conversations.

Dry-run is the default. --apply performs one atomic, deduplicated recovery batch.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import psycopg
from dotenv import dotenv_values
from psycopg.rows import dict_row


SINCE = datetime(2026, 9, 18, 3, 0, tzinfo=timezone.utc)
RECOVERY_TAG = "gustavo_chat_recovery_20260920"
PROTECTED_PHONES = {"553198526146", "5531995391330", "5592994432962"}
PROTECTED_CLIENT_IDS = {
    "ca59c2ed-a9a1-4234-ae1d-421a204bf423",  # commercial WhatsApp
    "2decc423-7787-48f7-a662-321573631f83",  # isolated test contact
    "a383d7e6-602d-4233-b482-b8688f898d01",  # isolated test contact
}
AUDIO_PATHS = {
    "eric_8_13": "media/audio/ec10/eric-2026-09-14/02_8-13_plano-de-carreira.ogg",
    "eric_14_18": "media/audio/bot-principal/13-17-plano-carreira/02_plano_1m49.ogg",
    "eric_20_25": "media/audio/bot-principal/18-plus/02_18plus_1m54.ogg",
}


def plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "").lower())
    return " ".join("".join(ch for ch in normalized if not unicodedata.combining(ch)).split())


def first_name(value: str | None) -> str:
    clean = re.sub(r"[^\wÀ-ÿ' -]", " ", str(value or ""), flags=re.UNICODE)
    candidate = (" ".join(clean.split()).split(" ")[0][:30] or "meu irmão")
    return "meu irmão" if plain(candidate) in {"a", "o", "meu", "minha", "oi", "ola"} else candidate


def audio_key(age: int | None) -> str | None:
    if not isinstance(age, int):
        return None
    if 8 <= age <= 13:
        return "eric_8_13"
    if 14 <= age <= 18:
        return "eric_14_18"
    if 20 <= age <= 25:
        return "eric_20_25"
    return None


def age_from_conversation(value: str) -> int | None:
    matches = re.findall(r"\b(\d{1,2})\s*anos?\b|\bidade\s+(?:e|é|eh)?\s*(\d{1,2})\b", value, re.I)
    ages = [int(left or right) for left, right in matches if 8 <= int(left or right) <= 25]
    return ages[-1] if ages else None


parser = argparse.ArgumentParser()
parser.add_argument("--env", default="/home/opc/ec10-gustavo-v2/.env")
parser.add_argument("--apply", action="store_true")
parser.add_argument("--recent-minutes", type=int, default=20)
args = parser.parse_args()
database_url = dotenv_values(args.env).get("DATABASE_URL")
if not database_url:
    raise SystemExit("DATABASE_URL is not configured")

now = datetime.now(timezone.utc)
recent_cutoff = now - timedelta(minutes=max(args.recent_minutes, 10))
report: list[dict] = []
recovery_sequence = 0

with psycopg.connect(database_url, row_factory=dict_row) as connection:
    clients = connection.execute("""
        select c.* from whatsapp_bot.clients c
        where c.bot_instance_id='main' and c.last_message_at>=%s
        order by c.last_message_at
    """, (SINCE,)).fetchall()
    options = [dict(row) for row in connection.execute(
        "select * from whatsapp_bot.ec10_chat_booking_options('plano_carreira',null)"
    ).fetchall()]
    if len(options) != 4:
        raise SystemExit("Recovery refused: the four approved meeting days are not available")
    for option in options:
        for key in ("seller_id",):
            option[key] = str(option[key])
        for key in ("starts_at", "ends_at"):
            option[key] = option[key].isoformat()

    for client in clients:
        messages = connection.execute("""
            select direction,body,media_type,created_at from whatsapp_bot.messages
            where client_id=%s and created_at>=%s order by created_at
        """, (client["id"], SINCE)).fetchall()
        inbound = [row for row in messages if row["direction"] == "inbound"]
        if not inbound:
            continue
        booking = connection.execute("""
            select id from whatsapp_bot.ec10_bookings where client_id=%s and status='confirmed' limit 1
        """, (client["id"],)).fetchone()
        legacy = connection.execute("""
            select * from whatsapp_bot.bot_conversation_states where client_id=%s limit 1
        """, (client["id"],)).fetchone()
        v2 = connection.execute("""
            select state,status from whatsapp_bot.gustavo_v2_contacts where phone=%s
        """, (client["phone"],)).fetchone()
        state = deepcopy((v2 or {}).get("state") or {})
        metadata = dict((legacy or {}).get("metadata") or {})
        gustavo = dict(metadata.get("gustavo") or {})
        inbound_text = "\n".join(str(row["body"] or "") for row in inbound)
        inbound_plain = plain(inbound_text)
        outbound_text = "\n".join(str(row["body"] or "") for row in messages if row["direction"] == "outbound")
        tags = [str(tag) for tag in (client.get("tags") or [])]
        age_value = state.get("athlete_age") or client.get("athlete_age") or (legacy or {}).get("athlete_age")
        age = age_from_conversation(inbound_text)
        if age is None:
            age = int(age_value) if str(age_value or "").isdigit() else None
        if age is not None and not 8 <= age <= 25:
            age = None
        role = state.get("contact_role")
        if role not in {"atleta", "responsavel"}:
            role = (legacy or {}).get("role_answer") or gustavo.get("speakerRole")
        guardian = bool(state.get("guardian_confirmed") or metadata.get("guardianConfirmed")
                        or gustavo.get("guardianConfirmed"))
        name = state.get("contact_name") or client.get("name")
        service = state.get("service_interest") or client.get("service_interest") or (legacy or {}).get("service_interest")
        audio_sent = bool(state.get("audio_sent") or any(
            row["direction"] == "outbound" and row["media_type"] in {"audio", "audio_file"} for row in messages
        ))
        has_link = "ec10talentos.com/agendar" in outbound_text
        link_failed = bool(re.search(r"(?:n[aã]o consegui|n[aã]o funciona|travou|erro|bloquead|n[aã]o abre|n[aã]o vai)",
                                     inbound_text, re.I))
        meeting_interest = bool(state.get("meeting_interest") or metadata.get("meetingRequested")
                                or gustavo.get("meetingRequested") or has_link)
        opt_out = bool(re.search(
            r"\b(?:n[aã]o tenho interesse|n[aã]o quero|pare de|n[aã]o me chame|agrade[cç]o mas n[aã]o|"
            r"n[aã]o,? mas agrade[cç]o|sem interesse)\b", inbound_text, re.I,
        ))
        reason = None
        category = None
        if booking:
            reason = "already_booked"
        elif str(client["phone"]) in PROTECTED_PHONES or str(client["id"]) in PROTECTED_CLIENT_IDS:
            reason = "business_or_test_contact"
        elif client.get("bot_paused") or (v2 and v2.get("status") in {"human", "blocked"}):
            reason = "paused_or_human"
        elif opt_out or any(re.search(r"opt.?out|nao_contatar|bloqueado", tag, re.I) for tag in tags):
            reason = "opt_out"
        elif inbound[-1]["created_at"] >= recent_cutoff:
            reason = "active_conversation"
        elif RECOVERY_TAG in tags:
            reason = "already_recovered"
        elif service not in {None, "nao_definido", "plano_carreira"}:
            reason = "different_product"
        elif age and age < 18 and (role != "responsavel" or not guardian):
            category = "minor_needs_responsible"
        elif not age:
            category = "age_missing"
        elif role not in {"atleta", "responsavel"}:
            category = "role_missing"
        elif isinstance(age, int) and age == 19:
            category = "age_outside_career"
        elif not audio_sent and audio_key(age):
            category = "audio_missing"
        elif meeting_interest or link_failed:
            category = "open_day_poll"
        else:
            category = "meeting_invitation"

        item = {"client_id": str(client["id"]), "phone_last4": str(client["phone"])[-4:],
                "name": first_name(name), "category": category, "skip": reason,
                "age": age, "role": role, "audio_sent": audio_sent,
                "has_link": has_link, "link_failed": link_failed,
                "source": client.get("source"), "tags": tags}
        report.append(item)
        if not args.apply or reason:
            continue

        contact_name = first_name(name)
        if name and contact_name != "meu irmão":
            state["contact_name"] = " ".join(str(name).split())[:80]
        if age:
            state["athlete_age"] = age
        if role in {"atleta", "responsavel"}:
            state["contact_role"] = role
        if age and age < 18 and role == "responsavel":
            state["guardian_confirmed"] = guardian
        state["service_interest"] = "plano_carreira"
        if category == "minor_needs_responsible":
            body = (f"{contact_name}, vou retomar seu atendimento do ponto certo. Como o atleta é menor, "
                    "preciso continuar com o pai, a mãe ou o responsável legal. Ele pode se identificar por aqui?")
            state.update({"stage": "guardian", "chat_booking_stage": None})
            outbound = [(1, "text", body, None)]
        elif category == "age_missing":
            body = (f"{contact_name}, vou continuar de onde paramos, sem repetir o atendimento. "
                    "Qual é a idade do atleta?")
            state.update({"stage": "discovery", "chat_booking_stage": None})
            outbound = [(1, "text", body, None)]
        elif category == "role_missing":
            body = (f"{contact_name}, vou seguir exatamente de onde paramos. "
                    "Você fala como atleta ou como responsável por ele?")
            state.update({"stage": "discovery", "chat_booking_stage": None})
            outbound = [(1, "text", body, None)]
        elif category == "audio_missing":
            key = audio_key(age)
            body = (f"{contact_name}, desculpa: nosso atendimento anterior não concluiu seu próximo passo. "
                    "Vou te enviar agora o áudio do Eric Cena sobre o Plano de Carreira.")
            invite = "Depois do áudio, faz sentido abrir os dias da reunião por aqui?"
            state.update({"stage": "offer", "chat_booking_stage": None,
                          "service_interest": "plano_carreira"})
            outbound = [(1, "text", body, None), (4, "audio", None, AUDIO_PATHS[key]),
                        (65, "text", invite, None)]
        elif category == "age_outside_career":
            body = (f"{contact_name}, para a idade informada a EC10 precisa analisar o momento do atleta "
                    "de forma individual. Posso encaminhar seu caso para a equipe comercial continuar por aqui?")
            state.update({"stage": "human", "chat_booking_stage": None})
            outbound = [(1, "text", body, None)]
        elif category == "meeting_invitation":
            body = (f"{contact_name}, retomei seu atendimento no ponto em que ele parou. "
                    "Faz sentido abrir os dias da reunião para analisarmos o momento do atleta?")
            state.update({"stage": "booking", "chat_booking_stage": None,
                          "service_interest": "plano_carreira"})
            outbound = [(1, "text", body, None)]
        else:
            body = (f"{contact_name}, vi que o agendamento anterior não foi concluído. Desculpa por isso. "
                    "Agora você marca aqui no WhatsApp: escolha primeiro o melhor dia abaixo.")
            poll_body = "\n".join([
                "Qual é o melhor dia para nossa reunião?",
                *[f"{index}. {option['weekday_label']}, {option['date_label']} · {option['display_name']}"
                  for index, option in enumerate(options, 1)],
                f"{len(options)+1}. Prefiro as datas da semana seguinte",
            ])
            state.update({"stage": "waiting_booking", "chat_booking_stage": "day",
                          "chat_booking_options": options, "chat_booking_selected": None,
                          "booking_url": None, "meeting_interest": True,
                          "service_interest": "plano_carreira"})
            outbound = [(1, "text", body, None), (4, "poll", poll_body, None)]

        connection.execute("""
            update whatsapp_bot.outbound_messages set status='cancelled',
              error_message='superseded_by_gustavo_chat_recovery'
            where client_id=%s and status in ('queued','failed') and created_at>=%s
        """, (client["id"], SINCE))
        connection.execute("""
            update whatsapp_bot.gustavo_v2_outbox set status='dead',
              error_message='superseded_by_gustavo_chat_recovery'
            where phone=%s and status in ('queued','failed') and created_at>=%s
        """, (client["phone"], SINCE))
        connection.execute("""
            insert into whatsapp_bot.gustavo_v2_contacts(phone,client_id,state,status,updated_at)
            values(%s,%s,%s::jsonb,'active',now())
            on conflict(phone) do update set client_id=excluded.client_id,state=excluded.state,
              status='active',last_error=null,updated_at=now()
        """, (client["phone"], client["id"], json.dumps(state, ensure_ascii=False)))
        connection.execute("""
            update whatsapp_bot.clients set tags=array(select distinct unnest(coalesce(tags,'{}')||%s::text[])),
              service_interest=coalesce(service_interest,'plano_carreira'),updated_at=now() where id=%s
        """, ([RECOVERY_TAG, "plano_carreira", "aguardando_reuniao"], client["id"]))
        base_offset = 5 + recovery_sequence * 25
        recovery_sequence += 1
        for offset, media_type, body_value, media_path in outbound:
            connection.execute("""
                insert into whatsapp_bot.outbound_messages
                  (client_id,bot_instance_id,phone,body,media_type,media_path,status,scheduled_at)
                values(%s,'main',%s,%s,%s,%s,'queued',now()+(%s*interval '1 second'))
            """, (client["id"], client["phone"], body_value, media_type, media_path, base_offset + offset))

    if args.apply:
        connection.commit()
    else:
        connection.rollback()

summary: dict[str, int] = {}
for item in report:
    key = f"skip:{item['skip']}" if item["skip"] else f"recover:{item['category']}"
    summary[key] = summary.get(key, 0) + 1
print(json.dumps({"mode": "applied" if args.apply else "dry-run", "since": SINCE.isoformat(),
                  "summary": summary, "conversations": report}, ensure_ascii=False, default=str))
