from app.database import extract_messages, message_text
from app.models import Decision, Facts, DEFAULT_STATE
from app.safety import booking_gate, enforce_ec10_flow, merge_state, validate_reply


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


def test_records_without_club_from_natural_language():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Boa."), "Ele tem 14 anos e está sem clube no momento.")
    assert merged["current_club"] == "sem clube"


def test_after_age_explains_path_instead_of_generic_interrogation():
    before = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_name": "Marcelo"}
    after = {**before, "athlete_age": 14, "current_club": "sem clube", "guardian_confirmed": True}
    reply, audio = enforce_ec10_flow(before, after, "Qual é o principal objetivo dele no futebol?", None)
    assert "Plano de Carreira" in reply
    assert "Você já conhecia" in reply
    assert "principal objetivo" not in reply
    assert audio is None
    assert after["company_intro_sent"] is True


def test_company_answer_advances_to_correct_eric_audio():
    before = {**DEFAULT_STATE, "company_intro_sent": True, "contact_name": "Bruno", "athlete_name": "Marcelo", "athlete_age": 14}
    after = {**before, "knows_company": False}
    reply, audio = enforce_ec10_flow(before, after, "Certo.", None)
    assert "Eric Cena" in reply
    assert audio == "eric_14_18"
