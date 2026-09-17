# Mapa técnico do ecossistema EC10

Este documento evita publicar ou alterar o projeto errado. Há duas fontes principais e um artefato legado do painel atual.

## Repositórios

| Repositório | Responsabilidade | Produção |
|---|---|---|
| `matheuzgdn/ec10-manager` | Site institucional, landing pages, `/instagram`, páginas Eurocamp, formulários públicos, roteamento do domínio e cópia estática do CRM v2 | `https://ec10talentos.com` |
| `matheuzgdn/ec10-talentos-crm` | APIs, agenda, CRM React/Vite, bot WhatsApp, SDR Gustavo, integrações Meta, migrations Supabase e arquivos de operação do Oracle | `https://cliente-whatsapp-crm.vercel.app` e servidor Oracle |

## Rotas principais

| Rota | Dono técnico |
|---|---|
| `/`, `/instagram`, `/lp/*`, `/eurocamp/*`, `/eur/*` | `ec10-manager` |
| `/agendar` | redirecionada por `ec10-manager` para `cliente-whatsapp-crm` |
| APIs de agenda, leads, tráfego e atendimento | `ec10-talentos-crm/api` |
| Bot e SDR WhatsApp | `ec10-talentos-crm/apps/bot` |
| Agenda e banco | `ec10-talentos-crm/api/booking.ts` e `supabase/migrations` |
| `/crm` | shell estático versionado em `ec10-manager/public/crm` e `public/crm-v2-assets`; dados e integrações vêm do Supabase/CRM |

## Observação sobre o CRM v2

O frontend atualmente servido em `/crm` chegou ao workspace como bundle compilado. A cópia implantada está versionada no `ec10-manager`, mas o projeto-fonte original desse bundle não está disponível neste workspace. Não edite o JavaScript minificado manualmente. As fontes editáveis do painel, agenda, APIs, bot e banco permanecem neste repositório. Quando a fonte original do CRM v2 for recuperada, ela deve substituir o artefato compilado em um diretório próprio e passar pelo mesmo fluxo de revisão.

## Fluxo de alteração

1. Crie uma branch no repositório responsável pela rota.
2. Não misture alterações de site com bot/banco no mesmo pull request.
3. Execute `npm ci`, `npm run typecheck` e `npm run build`.
4. Alterações no Gustavo também executam os testes de falha e simulação.
5. Alterações de banco entram como uma migration nova; migrations aplicadas não são reescritas.
6. Abra pull request e valide em preview antes de produção.

## Acessos que não ficam no GitHub

- `.env` e variáveis Vercel/Oracle;
- service role e URL privada do Supabase;
- chaves Gemini, Groq, Meta e Google;
- sessão, QR e cache do WhatsApp;
- chaves SSH, dumps, backups e dados de leads.

Cada colaborador deve usar conta própria no GitHub, Vercel e Supabase. O acesso ao Oracle deve ser concedido por chave SSH pública individual e removível.
