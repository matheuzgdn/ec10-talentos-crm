from app.database import extract_messages, message_text
from app.models import Decision, Facts, DEFAULT_STATE
from app.safety import booking_gate, merge_state, validate_reply


def test_booking_minor_requires_guardian():
    state = {**DEFAULT_STATE, "contact_name": "João", "athlete_age": 15, "meeting_interest": True}
    allowed, reason = booking_gate(state, True)
    assert not allowed
    assert reason == "responsavel_nao_confirmado"


def test_booking_minor_with_guardian():
    state = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_age": 15, "meeting_interest": True, "guardian_confirmed": True}
    assert booking_gate(state, True) == (True, None)


def test_never_ask_two_questions():
    errors = validate_reply("Qual a idade? Ele joga em clube?", DEFAULT_STATE)
    assert "mais_de_uma_pergunta" in errors


def test_preserves_known_name_and_age():
    previous = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_name": "Marcelo", "athlete_age": 14}
    decision = Decision(reply="Boa, Bruno.", facts=Facts(goal="organizar a carreira"))
    merged = merge_state(previous, decision)
    assert merged["contact_name"] == "Bruno"
    assert merged["athlete_name"] == "Marcelo"
    assert merged["athlete_age"] == 14


def test_extracts_cloud_api_message_once():
    payload = {"entry": [{"changes": [{"value": {"messages": [{"id": "wamid.1", "from": "5531999999999", "type": "text", "text": {"body": "Oi"}}]}}]}]}
    messages, statuses = extract_messages(payload)
    assert len(messages) == 1
    assert not statuses
    assert message_text(messages[0]) == "Oi"


def test_blocks_internal_code():
    errors = validate_reply('update_qualification(reply="oi")', DEFAULT_STATE)
    assert "conteudo_tecnico_visivel" in errors
