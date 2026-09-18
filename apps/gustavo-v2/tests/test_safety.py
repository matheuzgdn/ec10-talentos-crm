from app.database import extract_messages, message_text
from app.models import Decision, Facts, DEFAULT_STATE
from app.safety import avoid_repeated_reply, booking_gate, enforce_ec10_flow, fallback_reply, guardian_fast_path, merge_state, validate_reply


def test_booking_minor_requires_guardian():
    state = {**DEFAULT_STATE, "contact_name": "João", "athlete_age": 15, "meeting_interest": True}
    allowed, reason = booking_gate(state, True)
    assert not allowed
    assert reason == "responsavel_nao_confirmado"


def test_booking_minor_with_guardian():
    state = {
        **DEFAULT_STATE,
        "contact_name": "Bruno",
        "athlete_age": 15,
        "meeting_interest": True,
        "guardian_confirmed": True,
        "audio_sent": ["eric_14_18"],
    }
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


def test_parent_and_athlete_names_are_recovered_without_model_help():
    inbound = "Eu sou Bruno, pai do meu filho Marcelo, que tem 14 anos."
    merged = merge_state(DEFAULT_STATE, Decision(reply="Boa."), inbound)
    assert merged["contact_name"] == "Bruno"
    assert merged["athlete_name"] == "Marcelo"
    assert merged["athlete_age"] == 14
    assert merged["contact_role"] == "responsavel"
    assert merged["guardian_confirmed"] is True
    assert merged["guardian_name"] == "Bruno"


def test_bare_age_is_saved_when_age_is_missing():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Boa."), "15")
    assert merged["athlete_age"] == 15


def test_short_yes_after_eric_audio_becomes_meeting_interest():
    previous = {
        **DEFAULT_STATE,
        "contact_name": "Bruno",
        "athlete_name": "Marcelo",
        "athlete_age": 14,
        "guardian_confirmed": True,
        "audio_sent": ["eric_14_18"],
    }
    merged = merge_state(previous, Decision(reply="Perfeito."), "ss")
    assert merged["meeting_interest"] is True


def test_age_specific_audio_is_not_announced_twice():
    before = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Ana",
        "athlete_name": "Lucas",
        "athlete_age": 12,
        "knows_company": False,
        "audio_sent": ["eric_8_13"],
    }
    after = dict(before)
    reply, audio = enforce_ec10_flow(before, after, "O áudio fez sentido para vocês.", None)
    assert reply == "O áudio fez sentido para vocês."
    assert audio is None


def test_plan_career_booking_waits_for_eric_audio():
    state = {
        **DEFAULT_STATE,
        "contact_name": "Bruno",
        "athlete_age": 15,
        "meeting_interest": True,
        "guardian_confirmed": True,
    }
    assert booking_gate(state, True) == (False, "audio_eric_nao_enviado")


def test_model_cannot_repeat_or_switch_audio_after_one_was_sent():
    before = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Bruno",
        "athlete_name": "Marcelo",
        "athlete_age": 14,
        "knows_company": False,
        "audio_sent": ["eric_14_18"],
    }
    after = dict(before)
    reply, audio = enforce_ec10_flow(before, after, "Vamos seguir.", "eric_8_13")
    assert reply == "Vamos seguir."
    assert audio is None


def test_rejects_canned_opening_from_model():
    assert "abertura_engessada" in validate_reply("Que legal! Me conta mais.", DEFAULT_STATE)


def test_self_identified_minor_becomes_athlete_and_career_lead():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Certo."), "Eu sou João e sou o atleta, tenho 15 anos.")
    assert merged["contact_name"] == "João"
    assert merged["athlete_name"] == "João"
    assert merged["contact_role"] == "atleta"
    assert merged["service_interest"] == "plano_carreira"


def test_minor_fallback_asks_for_adult_without_repeating_role_question():
    state = {**DEFAULT_STATE, "contact_name": "João", "contact_role": "atleta", "athlete_age": 15}
    reply = fallback_reply(state, "eu mesmo resolvo")
    assert "responsável adulto" in reply
    assert "Você é o responsável" not in reply


def test_price_fallback_answers_and_returns_to_agenda():
    state = {
        **DEFAULT_STATE,
        "contact_name": "Ana",
        "athlete_age": 12,
        "guardian_confirmed": True,
        "audio_sent": ["eric_8_13"],
    }
    reply = fallback_reply(state, "quanto custa?")
    assert "valores" in reply.lower()
    assert "agenda" in reply.lower()


def test_company_question_is_answered_before_asking_name():
    reply = fallback_reply(DEFAULT_STATE, "Queria saber mais sobre a empresa de vocês")
    assert "assessoria esportiva" in reply.lower()
    assert "como você se chama" in reply.lower()
    assert reply.count("?") == 1


def test_club_question_is_answered_before_asking_name():
    reply = fallback_reply(DEFAULT_STATE, "Vocês são clube de futebol?")
    assert "não é um clube" in reply.lower()
    assert "assessoria esportiva" in reply.lower()
    assert "como você se chama" in reply.lower()


def test_bare_name_is_saved_after_intro():
    previous = {**DEFAULT_STATE, "company_intro_sent": True}
    merged = merge_state(previous, Decision(reply="Certo."), "JUAN")
    assert merged["contact_name"] == "Juan"


def test_reverse_no_knowledge_phrase_is_understood():
    previous = {**DEFAULT_STATE, "company_intro_sent": True}
    merged = merge_state(previous, Decision(reply="Certo."), "Conheço não")
    assert merged["knows_company"] is False


def test_team_question_is_answered_as_assessory():
    reply = fallback_reply(DEFAULT_STATE, "Como faço pra entrar no time de vocês?")
    assert "não é um clube" in reply.lower()


def test_new_bare_name_advances_to_role_once():
    before = {**DEFAULT_STATE, "company_intro_sent": True}
    after = merge_state(before, Decision(reply="Como você se chama?"), "Juan")
    reply, audio = enforce_ec10_flow(before, after, "Como você se chama?", None)
    assert reply == "Prazer, Juan. Você fala comigo como atleta ou como responsável por um atleta?"
    assert audio is None


def test_rejects_repeated_greeting_after_intro():
    state = {**DEFAULT_STATE, "company_intro_sent": True, "contact_name": "Juan"}
    assert "saudacao_repetida" in validate_reply("Oi, Juan! Vamos continuar.", state)
    assert "saudacao_repetida" in validate_reply("Olá! Quantos anos você tem?", state)


def test_post_intro_audio_transition_has_no_new_greeting_or_name_repetition():
    before = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Juan",
        "athlete_name": "Juan",
        "athlete_age": 11,
    }
    after = {**before, "knows_company": False}
    reply, audio = enforce_ec10_flow(before, after, "Oi, Juan!", None)
    assert not reply.lower().startswith(("oi", "olá", "ola", "fala", "boa"))
    assert not reply.lower().startswith(("juan", "juan,"))
    assert audio == "eric_8_13"


def test_post_intro_fallback_goes_directly_to_next_step():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Juan",
        "contact_role": "atleta",
        "athlete_name": "Juan",
        "athlete_age": 11,
        "guardian_confirmed": True,
        "audio_sent": ["eric_8_13"],
    }
    reply = fallback_reply(state, "escutei")
    assert not reply.lower().startswith(("oi", "olá", "ola", "fala", "boa"))
    assert "Juan" not in reply


def test_identical_guardian_reply_is_replaced_by_contextual_next_step():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Juan",
        "contact_role": "atleta",
        "athlete_name": "Juan",
        "athlete_age": 11,
        "guardian_confirmed": False,
    }
    previous = "Juan, como você é menor, preciso incluir um responsável adulto nessa conversa. Quem pode participar com você?"
    reply = avoid_repeated_reply(previous, previous, state, "Oi? Meu pai tá trabalhando")
    assert reply != previous
    assert "outro responsável" in reply
    assert reply.count("?") == 1


def test_repeated_age_does_not_repeat_guardian_script():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Juan",
        "contact_role": "atleta",
        "athlete_age": 11,
    }
    previous = "Juan, como você é menor, preciso incluir um responsável adulto nessa conversa. Quem pode participar com você?"
    reply = avoid_repeated_reply(previous, previous, state, "Já falei tenho 11 anos")
    assert "idade já ficou salva" in reply.lower()
    assert reply != previous


def test_minor_call_question_is_answered_before_guardian_step():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_name": "Juan",
        "contact_role": "atleta",
        "athlete_name": "Juan",
        "athlete_age": 11,
    }
    decision = guardian_fast_path(state, "Mas o senhor vai me ligar?")
    assert decision is not None
    assert "sem ligação de surpresa" in decision.reply
    assert decision.reply.count("?") == 1


def test_busy_parent_gets_contextual_guardian_option():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_role": "atleta",
        "athlete_age": 11,
    }
    decision = guardian_fast_path(state, "Meu pai tá trabalhando")
    assert decision is not None
    assert "outro responsável" in decision.reply


def test_identified_mother_is_saved_as_guardian():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_role": "atleta",
        "athlete_name": "Juan",
        "athlete_age": 11,
    }
    decision = guardian_fast_path(state, "Aqui é Maria, mãe do Juan")
    assert decision is not None
    assert decision.facts.guardian_confirmed is True
    assert decision.facts.guardian_name == "Maria"
    assert "interesse em marcar" in decision.reply


def test_minor_alone_is_not_interrogated_again():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_role": "atleta",
        "athlete_age": 11,
    }
    decision = guardian_fast_path(state, "Já falei que não tem ninguém comigo agora tio")
    assert decision is not None
    assert "não vou te prender" in decision.reply
    assert "?" not in decision.reply


def test_minor_club_promise_question_is_answered_directly():
    state = {
        **DEFAULT_STATE,
        "company_intro_sent": True,
        "contact_role": "atleta",
        "athlete_age": 11,
    }
    decision = guardian_fast_path(state, "Quero jogar no Real Madrid, o senhor me coloca lá?")
    assert decision is not None
    assert "não coloca atleta diretamente" in decision.reply
    assert decision.reply.count("?") == 1
