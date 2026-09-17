#!/usr/bin/env python3
import os
import re
import sys
from pathlib import Path


def read_key(secret_path: Path) -> str:
    for line in secret_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("GROQ_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if re.fullmatch(r"gsk_[A-Za-z0-9_-]{20,}", key):
                return key
    raise RuntimeError("GROQ_API_KEY ausente ou invalida")


def update_env(target_path: Path, settings: dict[str, str]) -> None:
    original = target_path.read_text(encoding="utf-8").splitlines() if target_path.exists() else []
    output: list[str] = []
    pending = dict(settings)

    for line in original:
        if "=" not in line or line.lstrip().startswith("#"):
            output.append(line)
            continue
        name = line.split("=", 1)[0].strip()
        if name in pending:
            output.append(f"{name}={pending.pop(name)}")
        else:
            output.append(line)

    if pending and output and output[-1] != "":
        output.append("")
    output.extend(f"{name}={value}" for name, value in pending.items())
    target_path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")
    os.chmod(target_path, 0o600)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("uso: configure-groq-env.py CAMINHO_ENV CAMINHO_SEGREDO")
    target_path = Path(sys.argv[1]).resolve()
    secret_path = Path(sys.argv[2]).resolve()
    key = read_key(secret_path)
    update_env(target_path, {
        "BOT_AI_ENABLED": "false",
        "BOT_AI_PROVIDER": "groq",
        "GROQ_API_KEY": key,
        "GROQ_API_BASE_URL": "https://api.groq.com/openai/v1",
        "GROQ_MODEL": "openai/gpt-oss-120b",
        "GROQ_AUDIO_MODEL": "whisper-large-v3-turbo",
        "GROQ_REQUEST_TIMEOUT_MS": "18000",
        "GROQ_MAX_AUDIO_BYTES": "20000000",
    })
    print("Groq configurado com IA bloqueada ate a liberacao de privacidade.")


if __name__ == "__main__":
    main()
