from app.chat_booking import day_poll, parse_day_choice, parse_time_choice, time_poll


OPTIONS = [
    {"weekday_label": "Segunda-feira", "date_label": "21/09", "display_name": "Sandro",
     "iso_date": "2026-09-21", "seller_id": "seller-1", "starts_at": "2026-09-21T23:00:00+00:00"},
    {"weekday_label": "Terça-feira", "date_label": "22/09", "display_name": "Ericson",
     "iso_date": "2026-09-22", "seller_id": "seller-2", "starts_at": "2026-09-22T23:00:00+00:00"},
]


def test_day_poll_is_short_and_has_next_week_escape():
    poll = day_poll(OPTIONS)
    assert poll["kind"] == "meeting_day"
    assert poll["options"] == [
        "Segunda-feira, 21/09 · Sandro",
        "Terça-feira, 22/09 · Ericson",
        "Prefiro as datas da semana seguinte",
    ]


def test_day_choice_accepts_poll_text_number_and_seller_name():
    assert parse_day_choice("Terça-feira, 22/09 · Ericson", OPTIONS)[1] == OPTIONS[1]
    assert parse_day_choice("2", OPTIONS)[1] == OPTIONS[1]
    assert parse_day_choice("pode ser com o Sandro", OPTIONS)[1] == OPTIONS[0]
    assert parse_day_choice("semana seguinte", OPTIONS)[0] == "next_week"


def test_time_poll_and_typed_fallback_are_deterministic():
    assert time_poll(OPTIONS[0])["options"] == ["20:00", "Voltar e escolher outro dia"]
    assert parse_time_choice("20:00") == "confirm"
    assert parse_time_choice("1") == "confirm"
    assert parse_time_choice("outro dia") == "back"
    assert parse_time_choice("quero saber o valor") == "unknown"
