from __future__ import annotations

import hashlib
import json
import secrets
from copy import deepcopy
from datetime import datetime, timezone
from typing import Optional
import psycopg
from psycopg.rows import dict_row
from .models import DEFAULT_STATE


def digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def extract_messages(payload: dict) -> tuple[list[dict], list[dict]]:
    messages: list[dict] = []
    statuses: list[dict] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            messages.extend(value.get("messages", []))
            statuses.extend(value.get("statuses", []))
    return messages, statuses


def message_text(message: dict) -> str:
    kind = message.get("type", "unknown")
    if kind == "text":
        return str(message.get("text", {}).get("body", "")).strip()
    if kind == "button":
        return str(message.get("button", {}).get("text", "")).strip()
    if kind == "interactive":
        data = message.get("interactive", {})
        selected = data.get("button_reply") or data.get("list_reply") or {}
        return str(selected.get("title") or selected.get("id") or "").strip()
    if kind in {"audio", "image", "video", "document"}:
        caption = str(message.get(kind, {}).get("caption", "")).strip()
        return caption or f"[O lead enviou {kind}.]"
    return f"[Mensagem do tipo {kind}.]"


class Database:
    def __init__(self, url: str, debounce_seconds: float = 1.2):
        self.url = url
        self.debounce_seconds = debounce_seconds

    async def connect(self):
        return await psycopg.AsyncConnection.connect(self.url, row_factory=dict_row)

    async def claim_event(self) -> Optional[dict]:
        async with await self.connect() as conn:
            async with conn.transaction():
                row = await (await conn.execute("""
                    select id,payload from whatsapp_bot.meta_webhook_events
                    where (status='pending' or (status='processing' and locked_at<now()-interval '2 minutes'))
                      and available_at<=now() order by id for update skip locked limit 1
                """)).fetchone()
                if not row:
                    return None
                await conn.execute("update whatsapp_bot.meta_webhook_events set status='processing',locked_at=now(),attempts=attempts+1 where id=%s", (row["id"],))
                return row

    async def complete_event(self, event_id: int, error: Optional[str] = None):
        async with await self.connect() as conn:
            if error:
                await conn.execute("""
                    update whatsapp_bot.meta_webhook_events set status=case when attempts>=8 then 'dead' else 'pending' end,
                      available_at=now()+least(interval '10 minutes',interval '5 seconds'*power(2,least(attempts,7))),
                      error_message=%s,locked_at=null where id=%s
                """, (error[:1000], event_id))
            else:
                await conn.execute("update whatsapp_bot.meta_webhook_events set status='done',processed_at=now(),locked_at=null,error_message=null where id=%s", (event_id,))

    async def ingest_event(self, payload: dict):
        messages, statuses = extract_messages(payload)
        async with await self.connect() as conn:
            async with conn.transaction():
                for item in messages:
                    phone = digits(str(item.get("from", "")))
                    message_id = str(item.get("id", ""))
                    if not phone or not message_id:
                        continue
                    body = message_text(item)
                    client = await (await conn.execute("""
                        insert into whatsapp_bot.clients(phone,name,status,bot_instance_id,last_message_at)
                        values(%s,null,'novo','main',now()) on conflict(phone) do update set last_message_at=now(),updated_at=now()
                        returning id
                    """, (phone,))).fetchone()
                    await conn.execute("""
                        insert into whatsapp_bot.gustavo_v2_contacts(phone,client_id,last_inbound_at)
                        values(%s,%s,now()) on conflict(phone) do update set client_id=excluded.client_id,last_inbound_at=now(),updated_at=now()
                    """, (phone, client["id"]))
                    inserted = await (await conn.execute("""
                        insert into whatsapp_bot.gustavo_v2_inbox(meta_message_id,phone,message_type,body,raw_message,due_at)
                        values(%s,%s,%s,%s,%s::jsonb,now()+(%s*interval '1 second'))
                        on conflict(meta_message_id) do nothing returning id
                    """, (message_id, phone, str(item.get("type", "unknown")), body, json.dumps(item), self.debounce_seconds))).fetchone()
                    if inserted:
                        await conn.execute("""
                            insert into whatsapp_bot.messages(client_id,direction,body,media_type,whatsapp_message_id,bot_instance_id,whatsapp_chat_id)
                            values(%s,'inbound',%s,%s,%s,'main',%s) on conflict do nothing
                        """, (client["id"], body, str(item.get("type", "text")), message_id, f"{phone}@c.us"))
                for status in statuses:
                    meta_id = str(status.get("id", ""))
                    value = str(status.get("status", ""))
                    column = {"sent": "sent_at", "delivered": "delivered_at", "read": "read_at"}.get(value)
                    if meta_id and column:
                        await conn.execute(f"update whatsapp_bot.gustavo_v2_outbox set status=%s,{column}=now() where meta_message_id=%s", (value, meta_id))

    async def claim_conversation(self) -> Optional[dict]:
        async with await self.connect() as conn:
            async with conn.transaction():
                phone_row = await (await conn.execute("""
                    select phone,id first_id from whatsapp_bot.gustavo_v2_inbox
                    where status='pending' and due_at<=now()
                    order by id for update skip locked limit 1
                """)).fetchone()
                if not phone_row:
                    return None
                rows = await (await conn.execute("""
                    select id,meta_message_id,body,raw_message from whatsapp_bot.gustavo_v2_inbox
                    where phone=%s and status='pending' and due_at<=now() order by id for update skip locked
                """, (phone_row["phone"],))).fetchall()
                ids = [row["id"] for row in rows]
                await conn.execute("update whatsapp_bot.gustavo_v2_inbox set status='processing',attempts=attempts+1 where id=any(%s)", (ids,))
                return {"phone": phone_row["phone"], "rows": rows}

    async def conversation_context(self, phone: str) -> tuple[dict, list[dict], Optional[str], list[str]]:
        async with await self.connect() as conn:
            contact = await (await conn.execute("select client_id,state,status from whatsapp_bot.gustavo_v2_contacts where phone=%s", (phone,))).fetchone()
            state = {**deepcopy(DEFAULT_STATE), **(contact["state"] or {})}
            state["audio_sent"] = list(state.get("audio_sent") or [])
            turn_rows = await (await conn.execute("""
                select inbound_text,response_text,created_at
                from whatsapp_bot.gustavo_v2_turns
                where phone=%s and status='ok'
                order by created_at desc limit 8
            """, (phone,))).fetchall()
            history: list[dict] = []
            for row in reversed(turn_rows):
                if row.get("inbound_text"):
                    history.append({"role": "user", "text": row["inbound_text"]})
                if row.get("response_text"):
                    history.append({"role": "assistant", "text": row["response_text"]})
            if not history:
                history_rows = await (await conn.execute("""
                    select direction,body,created_at from whatsapp_bot.messages m
                    where m.client_id=%s and body is not null order by created_at desc limit 20
                """, (contact["client_id"],))).fetchall()
                history = [{"role": row["direction"], "text": row["body"]} for row in reversed(history_rows)]
            recent_replies = [str(row["response_text"]) for row in turn_rows if row.get("response_text")]
            return (
                state,
                history,
                str(contact["client_id"]) if contact["client_id"] else None,
                recent_replies,
            )

    async def finish_turn(self, phone: str, inbox_ids: list[int], inbound: str, reply: str, model: str,
                          latency_ms: int, before: dict, after: dict, validation: dict, error: Optional[str] = None):
        async with await self.connect() as conn:
            async with conn.transaction():
                status = "dead" if error else "done"
                await conn.execute("update whatsapp_bot.gustavo_v2_inbox set status=%s,processed_at=now(),error_message=%s where id=any(%s)", (status, error, inbox_ids))
                await conn.execute("""
                    update whatsapp_bot.gustavo_v2_contacts set state=%s::jsonb,status=%s,last_error=%s,updated_at=now() where phone=%s
                """, (json.dumps(after), "human" if after.get("stage") == "human" else "active", error, phone))
                await conn.execute("""
                    insert into whatsapp_bot.gustavo_v2_turns(phone,inbound_ids,inbound_text,response_text,model,latency_ms,state_before,state_after,validation,status,error_message)
                    values(%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)
                """, (phone, inbox_ids, inbound, reply, model, latency_ms, json.dumps(before), json.dumps(after), json.dumps(validation), "error" if error else "ok", error))

    async def retry_conversation(self, inbox_ids: list[int], error: str):
        async with await self.connect() as conn:
            await conn.execute("""
                update whatsapp_bot.gustavo_v2_inbox set status='pending',
                due_at=now()+least(interval '5 minutes',interval '5 seconds'*power(2,least(attempts,6))),error_message=%s
                where id=any(%s)
            """, (error[:1000], inbox_ids))

    async def defer_conversation(self, inbox_ids: list[int], reason: str):
        """Return a claimed batch to the queue without consuming its retry budget."""
        async with await self.connect() as conn:
            await conn.execute("""
                update whatsapp_bot.gustavo_v2_inbox
                set status='pending',due_at=now()+interval '1 day',
                    attempts=greatest(attempts-1,0),error_message=%s
                where id=any(%s)
            """, (reason[:1000], inbox_ids))

    async def create_booking_url(self, client_id: str, service: str, name: str, role: str) -> str:
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        async with await self.connect() as conn:
            await conn.execute("""
                insert into whatsapp_bot.ec10_bot_booking_links(access_token_hash,client_id,service,contact_name,contact_role)
                values(%s,%s,%s,%s,%s)
            """, (digest, client_id, service, name, role))
        return f"https://ec10talentos.com/agendar?servico={service}&cadastro={token}"

    async def enqueue(self, phone: str, key: str, message_type: str, payload: dict):
        async with await self.connect() as conn:
            await conn.execute("""
                insert into whatsapp_bot.gustavo_v2_outbox(idempotency_key,phone,message_type,payload)
                values(%s,%s,%s,%s::jsonb) on conflict(idempotency_key) do nothing
            """, (key, phone, message_type, json.dumps(payload)))

    async def supersede_pending_outbox(self, phone: str):
        """Discard obsolete replies when the lead has already sent a newer message."""
        async with await self.connect() as conn:
            await conn.execute("""
                update whatsapp_bot.gustavo_v2_outbox
                   set status='dead',error_message='superseded_by_new_inbound'
                 where phone=%s
                   and (status in ('queued','failed')
                     or (status='sending' and created_at<now()-interval '2 minutes'))
            """, (phone,))

    async def claim_outbox(self) -> Optional[dict]:
        async with await self.connect() as conn:
            async with conn.transaction():
                row = await (await conn.execute("""
                    select * from whatsapp_bot.gustavo_v2_outbox
                    where status in ('queued','failed') and available_at<=now() and attempts<8
                    order by created_at for update skip locked limit 1
                """)).fetchone()
                if not row:
                    return None
                await conn.execute("update whatsapp_bot.gustavo_v2_outbox set status='sending',attempts=attempts+1 where id=%s", (row["id"],))
                return row

    async def finish_outbox(self, outbox_id, meta_id: Optional[str] = None, error: Optional[str] = None):
        async with await self.connect() as conn:
            if error:
                await conn.execute("""
                    update whatsapp_bot.gustavo_v2_outbox set status=case when attempts>=8 then 'dead' else 'failed' end,
                    available_at=now()+least(interval '10 minutes',interval '5 seconds'*power(2,least(attempts,7))),error_message=%s where id=%s
                """, (error[:1000], outbox_id))
            else:
                await conn.execute("update whatsapp_bot.gustavo_v2_outbox set status='sent',meta_message_id=%s,sent_at=now(),error_message=null where id=%s", (meta_id, outbox_id))

    async def health(self) -> dict:
        async with await self.connect() as conn:
            row = await (await conn.execute("""
                select
                  count(*) filter(where status='pending') pending_events,
                  count(*) filter(where status='dead') dead_events
                from whatsapp_bot.meta_webhook_events
            """)).fetchone()
            outbox = await (await conn.execute("select count(*) filter(where status in ('queued','failed')) pending_outbox,count(*) filter(where status='dead') dead_outbox from whatsapp_bot.gustavo_v2_outbox")).fetchone()
            return {**row, **outbox, "time": datetime.now(timezone.utc).isoformat()}
