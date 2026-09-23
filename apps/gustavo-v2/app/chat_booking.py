from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Optional


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.lower())
    return " ".join("".join(ch for ch in normalized if not unicodedata.combining(ch)).split())


def _choice_number(value: str) -> Optional[int]:
    match = re.match(r"\s*(\d{1,2})(?:\s*[.)-]|\s|$)", value)
    return int(match.group(1)) if match else None


def day_poll(options: list[dict], language: str = "pt") -> dict:
    poll_options = [
        f"{option['weekday_label']}, {option['date_label']} · {option['display_name']}"
        for option in options
    ]
    poll_options.append("Prefiero fechas de la semana siguiente" if language == "es" else "Prefiro as datas da semana seguinte")
    return {
        "kind": "meeting_day",
        "question": "¿Qué día es mejor para nuestra reunión?" if language == "es" else "Qual é o melhor dia para nossa reunião?",
        "options": poll_options,
    }


def time_poll(option: dict, language: str = "pt") -> dict:
    return {
        "kind": "meeting_time",
        "question": (f"Para el {option['date_label']}, ¿qué opción te queda mejor?" if language == "es"
                     else f"Para {option['weekday_label']}, {option['date_label']}, qual opção fica melhor?"),
        "options": ["20:00", "Volver y elegir otro día" if language == "es" else "Voltar e escolher outro dia"],
    }


def parse_day_choice(inbound: str, options: list[dict]) -> tuple[str, Optional[dict]]:
    """Return selected, next_week or unknown without trusting model output."""
    text = _plain(inbound)
    number = _choice_number(inbound)
    if number == len(options) + 1 or any(
        phrase in text for phrase in ("semana seguinte", "outra semana", "proxima semana", "nenhuma dessas",
                                    "semana siguiente", "otra semana", "ninguna de esas")
    ):
        return "next_week", None
    if number and 1 <= number <= len(options):
        return "selected", options[number - 1]

    for option in options:
        aliases = {
            _plain(str(option.get("weekday_label", ""))),
            _plain(str(option.get("display_name", ""))),
            _plain(str(option.get("date_label", ""))),
            _plain(str(option.get("iso_date", ""))),
        }
        if any(alias and alias in text for alias in aliases):
            return "selected", option
    return "unknown", None


def parse_time_choice(inbound: str) -> str:
    text = _plain(inbound)
    number = _choice_number(inbound)
    if number == 2 or any(phrase in text for phrase in ("voltar", "outro dia", "mudar dia", "volver", "otro dia", "cambiar dia")):
        return "back"
    if number == 1 or re.search(r"(?:^|\b)20(?::?00|h)?(?:\b|$)", text):
        return "confirm"
    return "unknown"


def is_schedule_like(inbound: str) -> bool:
    text = _plain(inbound)
    return bool(
        _choice_number(inbound)
        or re.search(r"\b(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|20h|20:00)\b", text)
        or any(phrase in text for phrase in ("outra semana", "semana seguinte", "outro dia", "voltar",
                                             "otra semana", "semana siguiente", "otro dia", "volver"))
    )


def booking_confirmation(booking: dict, language: str = "pt") -> str:
    starts_at = booking.get("starts_at")
    local_value = str(booking.get("local_label") or "")
    if not local_value and isinstance(starts_at, datetime):
        local_value = starts_at.strftime("%d/%m/%Y às %H:%M")
    if not local_value:
        local_value = "horário confirmado"
    seller = str(booking.get("display_name") or booking.get("seller_name") or "equipe EC10")
    service = str(booking.get("service") or "plano_carreira")
    label = {"plano_carreira": "Plano de Carreira", "plano_internacional": "Plano Internacional", "eurocamp": "Eurocamp"}.get(service, "EC10")
    lines = ([f"Tu reunión de {label} quedó confirmada para el {local_value}, con {seller}.",
              "El horario corresponde a Brasilia y la confirmación ya está guardada en la agenda de EC10."]
             if language == "es" else
             [f"Sua reunião de {label} ficou confirmada para {local_value}, com {seller}.",
              "O horário é o de Brasília e a confirmação já está salva na agenda da EC10."])
    if booking.get("google_calendar_url"):
        lines.extend(["", f"Google Agenda: {booking['google_calendar_url']}"])
    if booking.get("apple_calendar_url"):
        lines.append(f"iPhone / Apple Calendar: {booking['apple_calendar_url']}")
    return "\n".join(lines)
