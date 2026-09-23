#!/usr/bin/env python3
"""Guardião do SDR Gustavo.

Monitora o WhatsApp comercial e recoloca na fila apenas conversas elegíveis que
ficaram sem resposta. Não envia mensagens diretamente e não expõe conteúdo nos
logs. O próprio bot continua responsável por validar e enviar a resposta.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # REST continua como rota de contingência.
    psycopg = None
    dict_row = None


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
LOCK_FILE = Path("/tmp/guardi-o-gustavo.lock")
STATE_FILE = ROOT / ".runtime" / "guardi-o-gustavo-state.json"
STALE_SECONDS = int(os.getenv("GUSTAVO_GUARDIAN_STALE_SECONDS", "180"))
LOOKBACK_HOURS = int(os.getenv("GUSTAVO_GUARDIAN_LOOKBACK_HOURS", "24"))
MAX_RECOVERIES = int(os.getenv("GUSTAVO_GUARDIAN_MAX_RECOVERIES", "3"))
HEALTH_URL = os.getenv("GUSTAVO_GUARDIAN_HEALTH_URL", "http://127.0.0.1:3001/health")
RESTART_COOLDOWN_SECONDS = int(os.getenv("GUSTAVO_GUARDIAN_RESTART_COOLDOWN_SECONDS", "900"))
RECOVERY_ENABLED = os.getenv("GUSTAVO_GUARDIAN_RECOVERY_ENABLED", "false").strip().lower() in {
    "1", "true", "yes", "on"
}
DEPLOY_STATUS_FILE = Path(os.getenv(
    "GUSTAVO_GUARDIAN_DEPLOY_STATUS_FILE",
    "/home/opc/ec10-github-sync/status.json",
))


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env(ENV_FILE)
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
DATABASE_URL = os.getenv("SUPABASE_DB_URL", "") or os.getenv("DATABASE_URL", "")
DATABASE = None
if DATABASE_URL and psycopg:
    try:
        DATABASE = psycopg.connect(DATABASE_URL, connect_timeout=10, autocommit=True, row_factory=dict_row)
    except Exception:  # REST pode assumir se a conexão SQL estiver temporariamente indisponível.
        DATABASE = None
if DATABASE is None and (not SUPABASE_URL or not SERVICE_KEY):
    raise SystemExit("Configuração de banco ausente")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: str | datetime | None) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def rest(table: str, query: dict[str, str] | None = None, *, method: str = "GET", payload=None):
    encoded = urllib.parse.urlencode(query or {}, safe=",.*()!:'")
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if encoded:
        url = f"{url}?{encoded}"
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept-Profile": "whatsapp_bot",
        "Content-Profile": "whatsapp_bot",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else []
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Supabase {table} HTTP {error.code}: {detail}") from error


def bot_health() -> dict:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - guardião precisa registrar qualquer indisponibilidade
        return {"ok": False, "status": "unreachable", "reason": type(error).__name__}


def active_deployment(now: datetime) -> str | None:
    try:
        payload = json.loads(DEPLOY_STATUS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    state = str(payload.get("state") or "").strip().lower()
    updated_at = parse_time(payload.get("updatedAt"))
    if state not in {"validating", "restarting"} or not updated_at:
        return None
    if (now - updated_at).total_seconds() > 30 * 60:
        return None
    return state


def latest_message(client_id: str, direction: str, since: str):
    if DATABASE is not None:
        with DATABASE.cursor() as cursor:
            cursor.execute(
                """select body,created_at from whatsapp_bot.messages
                   where client_id=%s and direction=%s and created_at >= %s::timestamptz
                   order by created_at desc limit 1""",
                (client_id, direction, since),
            )
            return cursor.fetchone()
    rows = rest("messages", {
        "select": "body,created_at",
        "client_id": f"eq.{client_id}",
        "direction": f"eq.{direction}",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
        "limit": "1",
    })
    return rows[0] if rows else None


def recent_messages(client_id: str, direction: str, since: str, limit: int = 12):
    if DATABASE is not None:
        with DATABASE.cursor() as cursor:
            cursor.execute(
                """select body,media_type,created_at,whatsapp_message_id
                   from whatsapp_bot.messages
                   where client_id=%s and direction=%s and created_at >= %s::timestamptz
                   order by created_at desc limit %s""",
                (client_id, direction, since, limit),
            )
            return list(cursor.fetchall())
    return rest("messages", {
        "select": "body,media_type,created_at,whatsapp_message_id",
        "client_id": f"eq.{client_id}",
        "direction": f"eq.{direction}",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
        "limit": str(limit),
    })


def load_guardian_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_guardian_state(value: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(STATE_FILE)


def maybe_restart_bot(state: dict, reason: str, now: datetime) -> bool:
    last_restart = parse_time(state.get("lastRestartAt"))
    if last_restart and (now - last_restart).total_seconds() < RESTART_COOLDOWN_SECONDS:
        return False
    result = subprocess.run(
        ["sudo", "-n", "systemctl", "restart", "cliente-whatsapp-crm-bot.service"],
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )
    if result.returncode != 0:
        return False
    state["lastRestartAt"] = iso(now)
    state["lastRestartReason"] = reason
    return True


def normalized_body(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def unsafe_outbound_reasons(value: str | None) -> list[str]:
    text = str(value or "").strip()
    reasons: list[str] = []
    if not text:
        return ["empty_text"]
    if re.search(r"```|\"api_call\"|(?:default_api\.)?(?:update_qualification|get_booking_link|handoff_to_seller)\s*\(", text, re.I):
        reasons.append("internal_code")
    if text.count("?") > 1:
        reasons.append("multiple_questions")
    if re.search(r"(?:R\$|US\$|€)\s*\d", text, re.I):
        reasons.append("price_exposed")
    return reasons


def active_clients(since: str):
    if DATABASE is not None:
        with DATABASE.cursor() as cursor:
            cursor.execute(
                """select id::text,phone,bot_instance_id,bot_paused,tags,last_message_at
                   from whatsapp_bot.clients
                   where bot_instance_id='main' and bot_paused=false
                     and last_message_at >= %s::timestamptz
                   order by last_message_at desc limit 100""",
                (since,),
            )
            return list(cursor.fetchall())
    return rest("clients", {
        "select": "id,phone,bot_instance_id,bot_paused,tags,last_message_at",
        "bot_instance_id": "eq.main",
        "bot_paused": "is.false",
        "last_message_at": f"gte.{since}",
        "order": "last_message_at.desc",
        "limit": "100",
    })


def conversation_state(client_id: str):
    if DATABASE is not None:
        with DATABASE.cursor() as cursor:
            cursor.execute(
                """select id::text,stage,metadata from whatsapp_bot.bot_conversation_states
                   where client_id=%s order by updated_at desc limit 1""",
                (client_id,),
            )
            return cursor.fetchone()
    states = rest("bot_conversation_states", {
        "select": "id,stage,metadata", "client_id": f"eq.{client_id}", "limit": "1",
    })
    return states[0] if states else None


def save_recovery_state(client: dict, state: dict | None, metadata: dict, inbound_at) -> None:
    if DATABASE is not None:
        with DATABASE.cursor() as cursor:
            if state:
                cursor.execute(
                    """update whatsapp_bot.bot_conversation_states
                       set metadata=%s::jsonb,last_inbound_at=%s::timestamptz,updated_at=now()
                       where id=%s::uuid""",
                    (json.dumps(metadata, ensure_ascii=False), inbound_at, state["id"]),
                )
            else:
                cursor.execute(
                    """insert into whatsapp_bot.bot_conversation_states
                       (client_id,bot_instance_id,phone,stage,last_inbound_at,metadata)
                       values (%s::uuid,'main',%s,'awaiting_interest',%s::timestamptz,%s::jsonb)""",
                    (client["id"], client["phone"], inbound_at, json.dumps(metadata, ensure_ascii=False)),
                )
        return
    if state:
        rest("bot_conversation_states", {"id": f"eq.{state['id']}"}, method="PATCH", payload={
            "metadata": metadata, "last_inbound_at": str(inbound_at),
        })
    else:
        rest("bot_conversation_states", method="POST", payload={
            "client_id": client["id"], "bot_instance_id": "main", "phone": client["phone"],
            "stage": "awaiting_interest", "last_inbound_at": str(inbound_at), "metadata": metadata,
        })


def main() -> int:
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "skipped", "reason": "already_running"}))
            return 0

        health = bot_health()
        guardian_state = load_guardian_state()
        now = utcnow()
        if health.get("status") != "ready":
            failures = int(guardian_state.get("consecutiveHealthFailures") or 0) + 1
            guardian_state["consecutiveHealthFailures"] = failures
            bot_status = str(health.get("status") or "unknown")
            deploy_state = active_deployment(now)
            # QR/auth states require a human scan. Restarting here invalidates the
            # visible QR and can keep the commercial number offline indefinitely.
            manual_reconnect = bot_status in {
                "waiting_qr_scan", "auth_failure", "authenticated", "loading", "reconnecting"
            }
            restartable = bot_status in {"unreachable", "degraded", "not_ready"} and not deploy_state
            restartable_failures = (
                int(guardian_state.get("consecutiveRestartableFailures") or 0) + 1
                if restartable else 0
            )
            guardian_state["consecutiveRestartableFailures"] = restartable_failures
            restarted = restartable and restartable_failures >= 3 and maybe_restart_bot(
                guardian_state, "health_not_ready", now
            )
            save_guardian_state(guardian_state)
            print(json.dumps({
                "status": "attention",
                "reason": "deployment_in_progress" if deploy_state else "bot_not_ready",
                "botStatus": bot_status,
                "consecutiveFailures": failures,
                "consecutiveRestartableFailures": restartable_failures,
                "restartTriggered": restarted,
                "manualReconnectRequired": manual_reconnect,
                "deployState": deploy_state,
                "recoveryEnabled": RECOVERY_ENABLED,
            }))
            return 2

        guardian_state["consecutiveHealthFailures"] = 0
        guardian_state["consecutiveRestartableFailures"] = 0
        monitor_since = parse_time(guardian_state.get("monitorSince"))
        if not monitor_since:
            monitor_since = now
            guardian_state["monitorSince"] = iso(now)
        since = iso(now - timedelta(hours=LOOKBACK_HOURS))
        clients = active_clients(since)

        recovered = 0
        pending = 0
        attention = 0
        eligible = 0
        stale_pending = 0
        duplicate_outbound = 0
        unsafe_output = 0
        unsafe_breakdown: dict[str, int] = {}
        for client in clients:
            tags = [str(tag) for tag in (client.get("tags") or [])]
            blocked = any(
                marker in tag.lower().replace("_", "")
                for tag in tags
                for marker in ("optout", "naocontatar", "bloqueado", "iatransferenciahumana")
            )
            if blocked:
                continue

            inbound = latest_message(client["id"], "inbound", since)
            if not inbound or not str(inbound.get("body") or "").strip():
                continue
            inbound_at = parse_time(inbound.get("created_at"))
            if not inbound_at or (now - inbound_at).total_seconds() < STALE_SECONDS:
                continue

            recent_outbound = recent_messages(client["id"], "outbound", since)
            outbound = recent_outbound[0] if recent_outbound else None
            outbound_at = parse_time(outbound.get("created_at")) if outbound else None
            monitored_outbound = [
                message for message in recent_outbound
                if (parse_time(message.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)) >= monitor_since
            ]
            for newer, older in zip(monitored_outbound, monitored_outbound[1:]):
                newer_at = parse_time(newer.get("created_at"))
                older_at = parse_time(older.get("created_at"))
                if (
                    newer_at and older_at
                    and (newer_at - older_at).total_seconds() <= 120
                    and normalized_body(newer.get("body"))
                    and normalized_body(newer.get("body")) == normalized_body(older.get("body"))
                ):
                    duplicate_outbound += 1
                    break
            contact_unsafe = set()
            for message in monitored_outbound[:5]:
                if message.get("media_type") not in (None, "text", "poll"):
                    continue
                contact_unsafe.update(unsafe_outbound_reasons(message.get("body")))
            if contact_unsafe:
                unsafe_output += 1
                for reason in contact_unsafe:
                    unsafe_breakdown[reason] = unsafe_breakdown.get(reason, 0) + 1
            if outbound_at and outbound_at >= inbound_at:
                continue

            state = conversation_state(client["id"])
            metadata = dict((state or {}).get("metadata") or {})
            gustavo = dict(metadata.get("gustavo") or {})
            if gustavo.get("pending") is True:
                pending += 1
                due_at = parse_time(gustavo.get("dueAt"))
                if due_at and (now - due_at).total_seconds() >= 300:
                    stale_pending += 1
                    count = int(gustavo.get("guardianRecoveryCount") or 0)
                    if not RECOVERY_ENABLED:
                        attention += 1
                    elif count < MAX_RECOVERIES:
                        timestamp = iso(now)
                        millis = int(now.timestamp() * 1000)
                        next_metadata = {
                            **metadata,
                            "gustavo": {
                                **gustavo,
                                "pending": True,
                                "dueAt": timestamp,
                                "batchStartedAt": millis,
                                "contentStartedAt": millis,
                                "retryCount": 0,
                                "guardianRecoveryCount": count + 1,
                                "guardianRecoveredAt": timestamp,
                            },
                            "sdrActiveEngine": "gustavo",
                            "guardianLastCheckAt": timestamp,
                        }
                        save_recovery_state(client, state, next_metadata, inbound["created_at"])
                        recovered += 1
                    else:
                        attention += 1
                continue
            if gustavo.get("handoff") is True or gustavo.get("disqualified") is True:
                continue

            count = int(gustavo.get("guardianRecoveryCount") or 0)
            if count >= MAX_RECOVERIES:
                attention += 1
                continue

            eligible += 1
            if not RECOVERY_ENABLED:
                attention += 1
                continue
            timestamp = iso(now)
            millis = int(now.timestamp() * 1000)
            next_gustavo = {
                **gustavo,
                "pending": True,
                "dueAt": timestamp,
                "startedAt": gustavo.get("startedAt") or timestamp,
                "batchStartedAt": millis,
                "contentStartedAt": millis,
                "chatId": gustavo.get("chatId") or f"{client['phone']}@c.us",
                "pendingText": str(inbound["body"]),
                "retryCount": 0,
                "guardianRecoveryCount": count + 1,
                "guardianRecoveredAt": timestamp,
            }
            next_metadata = {
                **metadata,
                "gustavo": next_gustavo,
                "sdrActiveEngine": "gustavo",
                "guardianLastCheckAt": timestamp,
            }

            save_recovery_state(client, state, next_metadata, inbound["created_at"])
            recovered += 1

        consecutive_stale = int(guardian_state.get("consecutiveStalePending") or 0) + 1 if stale_pending else 0
        guardian_state["consecutiveStalePending"] = consecutive_stale
        # Never restart a connected WhatsApp session for an application-level
        # backlog. The stale states were safely re-queued above instead.
        restart_triggered = False
        guardian_state["lastCheckAt"] = iso(now)
        guardian_state["lastSummary"] = {
            "checked": len(clients),
            "pending": pending,
            "stalePending": stale_pending,
            "duplicateOutbound": duplicate_outbound,
            "unsafeOutput": unsafe_output,
            "unsafeBreakdown": unsafe_breakdown,
            "attentionRequired": attention,
        }
        save_guardian_state(guardian_state)

        has_attention = attention > 0 or stale_pending > 0 or duplicate_outbound > 0 or unsafe_output > 0
        print(json.dumps({
            "status": "attention" if has_attention else "healthy",
            "checked": len(clients),
            "eligible": eligible,
            "recovered": recovered,
            "alreadyPending": pending,
            "stalePending": stale_pending,
            "duplicateOutbound": duplicate_outbound,
            "unsafeOutput": unsafe_output,
            "unsafeBreakdown": unsafe_breakdown,
            "attentionRequired": attention,
            "botStatus": health.get("status"),
            "restartTriggered": restart_triggered,
            "recoveryEnabled": RECOVERY_ENABLED,
        }))
        return 0 if not has_attention else 3


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - falha precisa aparecer no journal
        print(json.dumps({"status": "error", "reason": str(error)[:300]}), file=sys.stderr)
        raise
