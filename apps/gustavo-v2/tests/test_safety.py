from app.database import extract_messages, message_text
from app.models import Decision, Facts, DEFAULT_STATE
from app.safety import booking_gate, merge_state, sanitize_ai_reply, validate_reply


def test_booking_minor_requires_guardian():
    state = {**DEFAULT_STATE, "contact_name": "João", "athlete_age": 15, "meeting_interest": True}
    assert booking_gate(state, True) == (False, "responsavel_nao_confirmado")


def test_booking_minor_with_guardian_and_audio():
    state = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_age": 15, "meeting_interest": True,
             "contact_role": "responsavel", "guardian_confirmed": True, "audio_sent": ["eric_14_18"]}
    assert booking_gate(state, True) == (True, None)


def test_plan_career_booking_waits_for_eric_audio():
    state = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_age": 15,
             "contact_role": "responsavel", "meeting_interest": True, "guardian_confirmed": True}
    assert booking_gate(state, True) == (False, "audio_eric_nao_enviado")


def test_reply_has_only_one_question():
    assert "mais_de_uma_pergunta" in validate_reply("Qual a idade? Ele joga em clube?", DEFAULT_STATE)


def test_single_question_mark_cannot_hide_name_and_age_as_two_questions():
    reply = "Qual é o nome do seu atleta e quantos anos ele tem?"
    assert "mais_de_uma_pergunta" in validate_reply(reply, DEFAULT_STATE)


def test_reply_stays_short():
    assert "mensagem_longa" in validate_reply("A" * 481, DEFAULT_STATE)


def test_internal_code_is_blocked():
    assert "conteudo_tecnico_visivel" in validate_reply('update_qualification(reply="oi")', DEFAULT_STATE)


def test_known_age_and_name_are_not_asked_again():
    state = {**DEFAULT_STATE, "athlete_age": 15, "contact_name": "Sandra"}
    assert "repete_idade" in validate_reply("Qual é a idade do atleta?", state)
    assert "repete_nome" in validate_reply("Como você se chama?", state)


def test_repetitive_greeting_is_a_style_issue():
    state = {**DEFAULT_STATE, "company_intro_sent": True, "contact_name": "Sandra"}
    assert "saudacao_repetida" in validate_reply("Oi, Sandra! Vamos continuar.", state)


def test_preserves_known_name_and_age():
    previous = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_name": "Marcelo", "athlete_age": 14}
    merged = merge_state(previous, Decision(reply="Vamos seguir.", facts=Facts(goal="organizar a carreira")))
    assert (merged["contact_name"], merged["athlete_name"], merged["athlete_age"]) == ("Bruno", "Marcelo", 14)


def test_cloud_api_text_is_extracted_once():
    payload = {"entry": [{"changes": [{"value": {"messages": [{
        "id": "wamid.1", "from": "5531999999999", "type": "text", "text": {"body": "Oi"}
    }]}}]}]}
    messages, statuses = extract_messages(payload)
    assert len(messages) == 1
    assert statuses == []
    assert message_text(messages[0]) == "Oi"


def test_without_club_is_saved_from_natural_language():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), "Ele tem 14 anos e está sem clube no momento.")
    assert merged["current_club"] == "sem clube"


def test_parent_and_athlete_names_are_separated_without_model_help():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."),
                         "Eu sou Bruno, pai do meu filho Marcelo, que tem 14 anos.")
    assert merged["contact_name"] == "Bruno"
    assert merged["athlete_name"] == "Marcelo"
    assert merged["athlete_age"] == 14
    assert merged["contact_role"] == "responsavel"
    assert merged["guardian_confirmed"] is True
    assert merged["guardian_name"] == "Bruno"


def test_bare_age_is_saved_when_missing():
    assert merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), "15")["athlete_age"] == 15


def test_short_yes_is_interpreted_by_ai_not_a_word_trigger():
    previous = {**DEFAULT_STATE, "contact_name": "Bruno", "athlete_name": "Marcelo", "athlete_age": 14,
                "guardian_confirmed": True, "audio_sent": ["eric_14_18"]}
    assert merge_state(previous, Decision(reply="Vamos seguir."), "ss")["meeting_interest"] is False
    assert merge_state(previous, Decision(reply="Vamos seguir.", facts=Facts(meeting_interest=True)), "ss")["meeting_interest"] is True


def test_short_confirmation_is_not_saved_as_a_person_name():
    for text in ("ss", "pode mandar", "pode sim", "sim"):
        assert merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), text)["contact_name"] is None


def test_audio_memory_does_not_mutate_the_previous_turn():
    before = {**DEFAULT_STATE, "audio_sent": []}
    after = merge_state(before, Decision(reply="Vamos seguir."))
    after["audio_sent"].append("eric_14_18")
    assert before["audio_sent"] == []


def test_minor_cannot_inherit_guardian_confirmation_from_old_state():
    before = {**DEFAULT_STATE, "contact_role": "responsavel", "guardian_confirmed": True,
              "athlete_age": 15, "contact_name": "João", "audio_sent": ["eric_14_18"],
              "meeting_interest": True}
    after = merge_state(before, Decision(reply="Vamos conversar com seu responsável."), "sou o atleta")
    assert after["guardian_confirmed"] is False
    assert booking_gate(after, True) == (False, "responsavel_nao_confirmado")


def test_ai_can_record_withdrawn_meeting_interest():
    before = {**DEFAULT_STATE, "meeting_interest": True}
    after = merge_state(before, Decision(reply="Sem problema.", facts=Facts(meeting_interest=False)), "não quero agendar")
    assert after["meeting_interest"] is False


def test_self_identified_minor_is_saved_as_athlete():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), "Eu sou João e sou o atleta, tenho 15 anos.")
    assert merged["contact_name"] == "João"
    assert merged["athlete_name"] == "João"
    assert merged["contact_role"] == "atleta"
    assert merged["service_interest"] == "plano_carreira"


def test_reverse_no_knowledge_phrase_is_understood():
    previous = {**DEFAULT_STATE, "company_intro_sent": True}
    assert merge_state(previous, Decision(reply="Vamos seguir."), "Conheço não")["knows_company"] is False


def test_landing_page_message_saves_name_product_and_source():
    inbound = "Sou Sandra Maria de Lima e enviei o formulário do Plano de Carreira pela página da campanha no Instagram."
    merged = merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), inbound)
    assert merged["contact_name"] == "Sandra Maria De Lima"
    assert merged["service_interest"] == "plano_carreira"
    assert merged["lead_source"] == "instagram_campanha"


def test_short_self_introduction_saves_name():
    assert merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), "sou Sandra")["contact_name"] == "Sandra"


def test_contaminated_name_is_cleaned():
    state = {**DEFAULT_STATE, "contact_name": "Sandra Já Falei", "guardian_name": "Sandra Já Falei"}
    merged = merge_state(state, Decision(reply="Vamos seguir."), "quero continuar")
    assert merged["contact_name"] == "Sandra"
    assert merged["guardian_name"] == "Sandra"


def test_mother_phrase_saves_athlete_and_guardian_role():
    state = {**DEFAULT_STATE, "contact_name": "Sandra"}
    merged = merge_state(state, Decision(reply="Vamos seguir."), "Sou mãe do João Pedro")
    assert merged["athlete_name"] == "João Pedro"
    assert merged["contact_role"] == "responsavel"
    assert merged["guardian_confirmed"] is True
    assert merged["guardian_name"] == "Sandra"


def test_professional_dream_is_saved_as_goal():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."), "O sonho dele é ser jogador profissional")
    assert "jogador profissional" in merged["goal"]


def test_family_lost_is_saved_as_goal():
    merged = merge_state(DEFAULT_STATE, Decision(reply="Vamos seguir."),
                         "Estamos perdidos porque nunca fomos desse mundo do futebol")
    assert "orientação" in merged["goal"]


def test_style_sanitizer_keeps_ai_content_and_removes_repetitive_tick():
    state = {**DEFAULT_STATE, "contact_name": "Sandra", "company_intro_sent": True}
    reply = sanitize_ai_reply(
        "Entendi, Sandra! Para atletas de 15 anos, o Plano de Carreira organiza os próximos passos.", state
    )
    assert reply == "Para atletas de 15 anos, o Plano de Carreira organiza os próximos passos."


def test_style_sanitizer_never_cuts_entendi_that_belongs_to_a_sentence():
    state = {**DEFAULT_STATE, "contact_name": "Davi", "company_intro_sent": True}
    reply = "Entendi que está nos conhecendo agora, Davi! Você fala como responsável?"
    assert sanitize_ai_reply(reply, state) == reply


def test_style_sanitizer_removes_the_whole_entendido_address_not_a_substring():
    state = {**DEFAULT_STATE, "contact_name": "Davi", "company_intro_sent": True}
    reply = sanitize_ai_reply(
        "Entendido, Davi. Como você é o responsável, qual é o nome do atleta?", state
    )
    assert reply == "Como você é o responsável, qual é o nome do atleta?"


def test_style_sanitizer_never_cuts_words_that_begin_like_a_greeting():
    state = {**DEFAULT_STATE, "contact_name": "Davi", "company_intro_sent": True}
    reply = "Oito anos é uma fase importante. O atleta já treina?"
    assert sanitize_ai_reply(reply, state) == reply


def test_style_sanitizer_removes_phatic_question_and_keeps_business_question():
    state = {**DEFAULT_STATE, "contact_name": "Davi", "company_intro_sent": True}
    reply = "Davi, beleza? Aqui é o Gustavo, da EC10. Você já conhece nosso trabalho?"
    assert sanitize_ai_reply(reply, state) == "Aqui é o Gustavo, da EC10. Você já conhece nosso trabalho?"


def test_style_sanitizer_turns_combined_name_and_age_into_one_next_fact():
    state = {**DEFAULT_STATE, "contact_name": "Davi", "company_intro_sent": True}
    reply = "Excelente objetivo, Davi. Qual é o nome do atleta e quantos anos ele tem?"
    assert sanitize_ai_reply(reply, state) == "Excelente objetivo, Davi. Qual é o nome do atleta?"


def test_style_sanitizer_asks_age_when_athlete_name_is_already_known():
    state = {**DEFAULT_STATE, "contact_name": "Davi", "athlete_name": "Juca", "company_intro_sent": True}
    reply = "Qual é o nome do atleta e quantos anos ele tem?"
    assert sanitize_ai_reply(reply, state) == "Quantos anos o atleta tem?"


def test_style_sanitizer_removes_repeated_greeting_after_intro():
    state = {**DEFAULT_STATE, "contact_name": "Sandra", "company_intro_sent": True}
    assert sanitize_ai_reply("Oi, Sandra! Vamos continuar do ponto em que paramos.", state) == (
        "Vamos continuar do ponto em que paramos."
    )
