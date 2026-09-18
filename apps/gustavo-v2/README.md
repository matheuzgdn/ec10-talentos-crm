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

## Atendimento dirigido pela IA

Gemini 3.5 Flash é a rota principal, com `thinking_level=low` para equilibrar raciocínio e tempo. A rota secundária também gera com IA; não há texto comercial fixo de fallback. Estilo imperfeito gera uma revisão pela própria IA, sem deixar a conversa indefinidamente presa em uma validação de estilo. Código interno e ações inseguras continuam bloqueados.

A IA apresenta o áudio do Eric e o envia sem pedir autorização nem opinião sobre o áudio. Pode solicitar uma continuação única entre 15 e 300 segundos: a pergunta é gerada novamente pela IA, somente após entrega do áudio, e cancelada se o lead já responder. Dia e horário são escolhidos exclusivamente no link real, após interesse na reunião e adulto responsável quando necessário.

Recepção de eventos, geração e envio têm processadores separados, mantendo apenas um processador de conversa para preservar a ordem. Conexões do banco são reutilizadas. Status antigos de envio não rebaixam entrega/leitura confirmadas. Uma interrupção de geração é recuperável; isso não garante ausência absoluta de falhas da Meta, Gemini ou infraestrutura.

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
