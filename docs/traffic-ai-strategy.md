# Estrategia CRM + Trafego IA EC10

Este CRM passa a ser o centro operacional entre WhatsApp, bot, vendedores, IA Base44 e Meta Ads. A regra de seguranca e simples: a IA pode analisar, recomendar, montar rascunhos e sincronizar dados, mas publicacao de campanha e gasto real exigem aprovacao humana.

## Fluxo completo

1. Lead cai do trafego no WhatsApp.
2. Bot registra `whatsapp_inbound` e inicia a conversa com boas-vindas.
3. Bot pergunta se fala com atleta ou responsavel.
4. Bot pergunta idade do atleta.
5. CRM registra idade, faixa, servico indicado e score.
6. Bot envia audio certo por faixa.
7. Bot envia a pagina certa:
   - 8 a 17 anos: Plano de Carreira em `https://ec10talentos.com/instagram`
   - 18+: Plano profissional/internacional em `https://ec10talentos.com/`
8. Vendedor assume quando o lead responde, pede detalhes ou demonstra interesse.
9. Mudancas no pipeline geram sinais de qualidade:
   - `triagem` -> `lead_triage`
   - `orcamento` -> `proposal_requested`
   - `quente` -> `qualified_lead`
   - `fechado` -> `purchase`
   - `perdido` -> `lost_lead`
10. A aba Trafego IA cruza bot, vendedores e Meta para recomendar proximas acoes.

## Segmentos que o CRM coordena

- Primeiro contato sem idade: chamou no WhatsApp, mas nao completou a triagem.
- Idade capturada sem pagina: lead travado antes do audio/link.
- Pagina enviada sem vendedor: recebeu valores, mas ainda nao recebeu atendimento humano.
- Meio de funil: recebeu pagina, respondeu ou pediu informacao, mas nao virou quente.
- Lead quente: vendedor marcou como `quente`.
- Orcamento: chegou em negociacao.
- Fechado: deve virar sinal de cliente ideal.
- Perdido: deve alimentar exclusao, aprendizado de objecoes e campanhas de recuperacao.

## Trafego frio

Para primeiro trafego, o CRM monta rascunhos com:

- objetivo `OUTCOME_LEADS`
- destino WhatsApp/lead page
- status Meta sempre `PAUSED` no payload
- faixa de decisor conforme idade do atleta
- interesses ligados a futebol, base, alto rendimento e plano internacional
- UTMs padronizadas para atribuicao
- copy e observacao criativa por servico

## Remarketing

Prioridade de remarketing:

1. Quem recebeu pagina e nao virou conversa com vendedor.
2. Quem virou quente e nao chegou em orcamento.
3. Quem pediu orcamento e ficou aguardando cliente.
4. Quem perdeu por tempo, preco ou falta de resposta.
5. Visitantes/leads por idade e servico quando o Meta sync estiver alimentado.

## IA local com Ollama

O Trafego IA usa Ollama local quando `TRAFFIC_AI_PROVIDER=ollama`. O modelo recomendado neste PC e:

- `TRAFFIC_OLLAMA_MODEL=qwen3.5:4b`
- `TRAFFIC_OLLAMA_NUM_CTX=4096`
- `TRAFFIC_OLLAMA_MAX_OUTPUT_TOKENS=1200`

A rota `/api/traffic?action=recommendations` tenta gerar recomendacoes com Ollama e, se a resposta falhar ou vier fora do formato esperado, volta para a heuristica local para nao parar a operacao.

## IA Base44 opcional

A API da Base44 pode ser chamada pela rota `/api/traffic?action=recommendations` quando `TRAFFIC_AI_PROVIDER=base44` e as variaveis abaixo existem no ambiente:

- `BASE44_TRAFFIC_AGENT_URL`
- `BASE44_TRAFFIC_AGENT_API_KEY`

O CRM usa o fluxo de Superagent do Base44: cria/recupera a conversa em `/conversations` e envia o prompt em `/conversations/{id}/messages`. Se o Base44 mudar o formato ou a URL for informada ja com `/conversations`, o backend normaliza o caminho antes da chamada.

Se a API nao estiver configurada ou falhar, o CRM usa uma IA heuristica local para nao deixar a operacao parada.

## Meta Ads

A rota `/api/traffic?action=meta-sync` faz leitura dos insights Meta e salva snapshots em `traffic_campaign_snapshots`.

Variaveis necessarias:

- `META_AD_ACCOUNT_ID`
- `META_SYSTEM_USER_ACCESS_TOKEN`
- `META_GRAPH_VERSION`

A sincronizacao e somente leitura. O sistema ainda nao publica campanhas nem altera orcamento automaticamente.

Quando o vendedor muda um lead para `triagem`, `orcamento`, `quente` ou `fechado`, o CRM tenta enviar um evento de qualidade para a Conversions API usando `META_PIXEL_ID` e `META_CAPI_ACCESS_TOKEN`. Se a Meta recusar, o CRM nao bloqueia a venda; o erro fica apenas no log da API.

### Pre-flight EC10 antes de investir

- BM recomendado: `ec10_talentos`.
- Conta recomendada: `Conta 01 - EC10`.
- Pixel/dataset recomendado: `EC10 Pixel Lead Page`.
- Dominio principal para trafego: `https://ec10talentos.com`.
- Nao usar pixels duplicados/inativos para novas campanhas.
- Nao usar publicos salvos antigos sem revisao, pois havia alertas de segmentacao detalhada descontinuada.
- Resolver antes de ativar campanha: pagamento/fundos, limite de gasto, verificacao do negocio, dominio do BM, seguranca do portfolio e token Meta expirado.

### Padrao tecnico de sinais

O Oraculo envia sinais para a Meta com foco em qualidade, nao apenas volume:

- `Lead`: cadastro vindo da landing ou lead em triagem.
- `QualifiedLead`: lead marcado como quente no CRM.
- `Schedule`: lead em orcamento/agendamento.
- `Purchase`: lead fechado.
- `DisqualifiedLead`: lead perdido, para analise e exclusao futura.

Os eventos usam `event_id` deterministico por lead/status, telefone com hash quando existir, `external_id` com hash do cliente, `fbclid`/`fbc`/`fbp` quando a landing enviar e `event_source_url` do dominio `ec10talentos.com`.

### Padrao de campanhas novas

- Criar rascunhos sempre pausados.
- Usar publico amplo com idade/regiao necessaria e Advantage+ Audience ligado.
- Evitar fragmentar por muitos interesses ou paises na fase inicial.
- Otimizar primeiro para `Lead` no Pixel da EC10 e migrar para `QualifiedLead` quando houver volume consistente.
- Manter UTMs obrigatorias: `utm_source=meta`, `utm_medium=paid_social`, `utm_campaign`, `utm_content`, `utm_term`.
- Escalar somente depois de sinal estavel de lead qualificado no CRM.

## Proximos niveis

- Criar publicos personalizados e exclusoes depois que os volumes estiverem consistentes.
- Transformar rascunhos aprovados em campanhas pausadas no Meta, ainda sem ativar gasto.
- Liberar publicacao ativa somente com confirmacao explicita do administrador.
