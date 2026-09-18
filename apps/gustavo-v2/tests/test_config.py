from app.config import Settings


def test_test_recipient_alias_changes_delivery_not_contact_identity():
    settings = Settings(database_url="postgresql://test", gemini_api_key="test",
                        gustavo_v2_recipient_aliases="553195391330=5531995391330")
    assert settings.recipient_phone("553195391330") == "5531995391330"
    assert settings.recipient_phone("553198526146") == "553198526146"


def test_empty_or_invalid_alias_does_not_change_recipient():
    settings = Settings(database_url="postgresql://test", gemini_api_key="test",
                        gustavo_v2_recipient_aliases="invalid,553195391330=no")
    assert settings.recipient_phone("553195391330") == "553195391330"
