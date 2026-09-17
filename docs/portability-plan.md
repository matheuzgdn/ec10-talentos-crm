# EC10 CRM - portabilidade e operacao propria

## Estado atual

- O CRM usa Supabase/Postgres como fonte principal de dados.
- A IA de trafego agora roda localmente no backend do CRM por padrao.
- Base44 fica opcional para comparacao externa pelo botao `Base44`.
- A Meta Ads e acessada diretamente pela Marketing API.
- A Conversions API recebe sinais de qualidade quando o lead muda de etapa no CRM.

## Dados ja portaveis

O endpoint administrativo abaixo exporta um JSON unico com leads, eventos, rascunhos, recomendacoes e snapshots Meta:

```text
/api/traffic?action=export&days=180
```

O arquivo exportado inclui:

- `clients`
- `trafficEvents`
- `recommendations`
- `campaignDrafts`
- `campaignSnapshots`
- contexto consolidado do funil

## Base44

O Base44 nao e mais dependencia operacional para analise. O CRM salva recomendacoes no proprio banco e consegue gerar novas recomendacoes pela IA local.

O Base44 continua disponivel apenas como consultor externo opcional enquanto a chave estiver configurada:

- `BASE44_TRAFFIC_AGENT_URL`
- `BASE44_TRAFFIC_AGENT_API_KEY`

Se essas variaveis forem removidas, o CRM continua analisando trafego, funil e campanhas.

## Meta Ads

O CRM consegue:

- validar token e permissoes;
- sincronizar campanhas e metricas;
- classificar campanhas;
- criar rascunhos de campanha;
- publicar campanha completa no Meta em `PAUSED`, com orcamento diario, sem ativar gasto automaticamente.

O fluxo de publicacao faz pre-validacao do criativo antes de criar qualquer campanha. Se a Pagina nao tiver permissao de anuncios para o usuario/app, o CRM bloqueia e grava o erro no rascunho.

Variaveis usadas:

- `META_AD_ACCOUNT_ID`
- `META_SYSTEM_USER_ACCESS_TOKEN`
- `META_PAGE_ID`
- `META_PIXEL_ID`
- `META_CAPI_ACCESS_TOKEN`
- `META_GRAPH_VERSION`

## Credenciais verificadas em 2026-05-25

- Vercel: operacional com projeto `cliente-whatsapp-crm`.
- Supabase/Postgres: operacional via `SUPABASE_DB_URL`.
- Supabase CLI: token antigo retornou `Unauthorized`; nao bloqueia o app porque o DB URL esta funcionando.
- Git local: usuario configurado.
- GitHub CLI: nao logado; usar plugin GitHub do Codex ou fazer `gh auth login` quando precisar publicar repositorio via CLI.

## Melhor caminho

1. Manter Supabase/Postgres como fonte de verdade do CRM.
2. Usar Base44 somente como opcional.
3. Usar Meta Marketing API diretamente pelo CRM.
4. Publicar campanhas sempre em `PAUSED`.
5. Ativar gasto apenas depois de revisao humana no Gerenciador de Anuncios.
6. Exportar periodicamente `/api/traffic?action=export&days=180` para backup e portabilidade.
