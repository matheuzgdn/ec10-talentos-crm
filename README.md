# EC10 Talentos CRM + Gustavo SDR

Repositorio do ecossistema comercial da EC10 Talentos: painel do CRM, APIs, bot de WhatsApp, SDR Gustavo, agenda, funil, migrations do Supabase e guardiao antifalhas.

## Componentes

- `apps/painel`: CRM React/Vite usado por administradores e vendedores.
- `api`: endpoints do CRM, leads, mensagens, agenda e trafego.
- `apps/bot`: WhatsApp Web, memoria da conversa, qualificacao e envio.
- `skill/gustavo`: conhecimento, tom de voz, regras e etapas do SDR.
- `supabase/migrations`: estrutura versionada do banco.
- `scripts`: testes, diagnosticos, reparos e guardiao antifalhas.
- `deploy`: unidades systemd e configuracoes de producao sem segredos.

O mapa completo de repositorios, rotas e ambientes esta em [docs/EC10-ECOSYSTEM-MAP.md](docs/EC10-ECOSYSTEM-MAP.md). O site institucional e as landing pages ficam no repositorio [ec10-manager](https://github.com/matheuzgdn/ec10-manager).

## Regra de seguranca

Este repositorio nao contem chaves de API, senhas, banco, sessoes do WhatsApp, QR Codes, dados de leads ou chave SSH. Esses itens ficam somente nos ambientes autorizados. Nunca envie `.env`, `whatsapp-session`, `runtime`, backups ou inventarios privados ao GitHub.

## Preparar o ambiente

Requisitos: Node.js 22+, npm e, para o guardiao, Python 3.11+.

```bash
npm ci
cp .env.example .env
npm run typecheck
npm run build
```

Painel local:

```bash
npm run dev:painel
```

Bot local, inicialmente sem conectar ao WhatsApp:

```bash
npm run dev:bot
```

Mantenha `BOT_ENABLED=false` ate usar um ambiente de teste e uma sessao propria.

## Validacao obrigatoria

```bash
npm run typecheck
npm run build
node scripts/test-gustavo-fault-injection.mjs
node scripts/test-gustavo-provider-failure.mjs
```

Os testes nao devem enviar mensagens reais. Alteracoes em fluxo, memoria, qualificacao ou agenda tambem devem passar pelas simulacoes em `scripts/`.

## Onde alterar

| Necessidade | Local principal |
|---|---|
| Tom, conhecimento e regras do Gustavo | `skill/gustavo/` |
| Decisao e validacao das respostas da IA | `apps/bot/src/gustavo-sdr.ts` e `gemini-adapter.ts` |
| Entrada, fila, deduplicacao e WhatsApp | `apps/bot/src/index.ts` e `store.ts` |
| Painel e experiencia do CRM | `apps/painel/src/` |
| APIs e integracoes | `api/` |
| Banco e agenda | `supabase/migrations/` |
| Monitor antifalhas | `scripts/guardi_o_gustavo.py` |

## Producao

O GitHub e a fonte versionada. O servidor Oracle usa credenciais externas ao repositorio e deve receber somente codigo revisado. Veja [OPERACAO-PRODUCAO.md](docs/OPERACAO-PRODUCAO.md) e [CONTRIBUTING.md](CONTRIBUTING.md).

As configuracoes reais de Supabase, Gemini/Groq, Meta, Google e Oracle ficam nos ambientes de producao. Um programador novo deve receber acesso individual aos provedores; nunca copie `.env`, token, sessao do WhatsApp ou chave SSH pelo GitHub.
