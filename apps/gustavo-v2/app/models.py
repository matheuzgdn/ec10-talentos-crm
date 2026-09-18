from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


class Facts(BaseModel):
    contact_name: Optional[str] = None
    contact_role: Optional[Literal["atleta", "responsavel", "outro", "desconhecido"]] = None
    athlete_name: Optional[str] = None
    athlete_age: Optional[int] = Field(default=None, ge=6, le=40)
    current_club: Optional[str] = None
    goal: Optional[str] = None
    knows_company: Optional[bool] = None
    service_interest: Optional[Literal["plano_carreira", "eurocamp", "plano_internacional", "nao_definido"]] = None
    guardian_name: Optional[str] = None
    guardian_confirmed: Optional[bool] = None
    meeting_interest: Optional[bool] = None


class Decision(BaseModel):
    reply: str = Field(min_length=2, max_length=900)
    facts: Facts = Field(default_factory=Facts)
    stage: Literal[
        "rapport", "discovery", "fit", "guardian", "offer", "booking", "waiting_booking", "human"
    ] = "discovery"
    audio_key: Optional[Literal["eric_8_13", "eric_14_18", "eric_20_25"]] = None
    booking_ready: bool = False
    handoff: bool = False
    handoff_reason: Optional[str] = None


DEFAULT_STATE = {
    "contact_name": None,
    "contact_role": "desconhecido",
    "athlete_name": None,
    "athlete_age": None,
    "current_club": None,
    "goal": None,
    "knows_company": None,
    "company_intro_sent": False,
    "service_interest": "nao_definido",
    "guardian_name": None,
    "guardian_confirmed": False,
    "meeting_interest": False,
    "stage": "rapport",
    "audio_sent": [],
    "booking_url": None,
}
