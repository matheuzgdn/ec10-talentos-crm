#!/usr/bin/env python3
"""Create Gustavo V2's private environment without exposing secret values."""

import json
import os
from pathlib import Path


ROOT = Path("/home/opc/ec10-gustavo-v2")
BOOTSTRAP = ROOT / ".bootstrap.json"
OUTPUT = ROOT / ".env"


def read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def env_line(key: str, value: str) -> str:
    encoded = json.dumps(value, ensure_ascii=False)
    return f"{key}={encoded}"


def main() -> None:
    payload = json.loads(BOOTSTRAP.read_text(encoding="utf-8"))
    database_url = str(payload.get("databaseUrl", "")).strip()
    if not database_url.startswith(("postgres://", "postgresql://")):
        raise SystemExit("Bootstrap recusado: DATABASE_URL inválida")

    service_data = os.popen(
        "systemctl show cliente-whatsapp-crm-bot.service -p WorkingDirectory --value"
    ).read().strip()
    existing_path = Path(service_data) / ".env"
    existing = read_dotenv(existing_path)
    gemini_key = existing.get("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        raise SystemExit("Bootstrap recusado: GEMINI_API_KEY não encontrada")

    values = {
        "DATABASE_URL": database_url,
        "GEMINI_API_KEY": gemini_key,
        "GEMINI_MODEL": "gemini-2.5-flash",
        "META_GRAPH_VERSION": "v25.0",
        "META_PHONE_NUMBER_ID": "",
        "META_WABA_ID": "",
        "META_WHATSAPP_ACCESS_TOKEN": "",
        "META_APP_SECRET": "",
        "META_WHATSAPP_VERIFY_TOKEN": "",
        "GUSTAVO_V2_ENABLED": "false",
        "GUSTAVO_V2_ALLOWED_PHONES": "",
        "GUSTAVO_V2_POLL_SECONDS": "1.0",
        "GUSTAVO_V2_DEBOUNCE_SECONDS": "3",
        "ERIC_AUDIO_8_13_MEDIA_ID": "",
        "ERIC_AUDIO_14_18_MEDIA_ID": "",
        "ERIC_AUDIO_20_25_MEDIA_ID": "",
    }

    temporary = OUTPUT.with_name(".env.tmp")
    temporary.write_text("\n".join(env_line(k, v) for k, v in values.items()) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(OUTPUT)
    BOOTSTRAP.unlink(missing_ok=True)
    print("Ambiente privado criado; segredos não foram exibidos.")


if __name__ == "__main__":
    main()
