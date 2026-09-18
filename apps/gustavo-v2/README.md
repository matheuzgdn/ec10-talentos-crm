# Gustavo V2 — WhatsApp Cloud API

Serviço isolado do bot antigo. O webhook público é recebido por `api/meta-whatsapp-webhook.ts`, gravado no PostgreSQL e consumido por este worker Python no Oracle.

Garantias de desenho:

- idempotência no webhook, inbox e outbox;
- nenhuma enquete;
- uma pergunta por mensagem;
- memória persistente de nome, atleta, idade e responsável;
- menor de idade não recebe agenda sem adulto confirmado;
- Gemini responde em formato estruturado e a saída passa por validação;
- retentativas com espera progressiva e fila de falhas;
- link de agenda individual e clicável;
- ativação gradual por lista de telefones antes da liberação geral.

O serviço deve iniciar com `GUSTAVO_V2_ENABLED=false`. Depois da Cloud API configurada, use primeiro `GUSTAVO_V2_ALLOWED_PHONES` com números de teste.

## Execução

```text
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8781
```

## Testes

```text
PYTHONPATH=. .venv/bin/pytest -q
```
