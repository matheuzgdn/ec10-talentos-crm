# Reconfiguração segura — Meta Argentina — R$175

Auditoria somente leitura realizada em 13/07/2026, na conta `Conta 01 - EC10`.
Nenhuma chamada `POST` foi executada durante a preparação deste plano.

## Estado confirmado

- Conta ativa, em BRL e fuso `America/Sao_Paulo`.
- Limite de gastos: R$6.293,25.
- Total consumido na conta: R$6.117,57.
- Margem restante no limite: R$175,68.
- Campanha do grupo `120247606270090601`: ativa, orçamento vitalício R$70, gasto R$0,00.
- Campanha de pagamento `120247606271030601`: ativa, orçamento vitalício R$105, gasto R$0,03.
- Ambas terminam em 17/07/2026 às 10:00, horário de Buenos Aires/São Paulo.
- Ambas usam moradores de Buenos Aires, raio de 40 km, 18–55 anos, Facebook e Instagram.
- `Advantage Audience` está desligado (`advantage_audience = 0`).
- Campanhas, conjuntos e anúncios não possuem erros em `issues_info`.
- Os textos atuais dos dois anúncios estão em espanhol argentino.
- Página confirmada: `EC10` (`100627363090555`).
- Instagram confirmado: `@ec10_talentos_agencia` (`17841444199647209`).
- Pixel confirmado: `EC10 Pixel Lead Page` (`834310425674029`).

## Públicos confirmados

- Instagram EC10 365D: `120247605987190601`, pronto, estimativa total de 43,4 mil a 51,1 mil antes do filtro geográfico.
- Visitantes da landing 30D: `120247605983790601`, pronto, estimativa total de 20 pessoas.
- Leads 180D: `120247605984170601`, pronto, estimativa total de 20 pessoas.
- Instagram EC10 90D: ainda não existe e deverá ser criado/reutilizado com o nome `RMK | EC10 Instagram | Engajamento | 90D`.

## Configuração a aplicar

### Grupo oficial — R$25 vitalícios

- Reutilizar a campanha de tráfego atual.
- Público incluído: somente `Leads 180D`.
- Sem público excluído.
- Buenos Aires + 40 km, somente moradores, 18–55.
- Facebook e Instagram; expansão automática desligada.
- Otimização: cliques no link.
- Destino: redirecionamento rastreado para o grupo oficial.
- Status final de campanha, conjunto e anúncio: `ACTIVE`.

### Pagamento — R$150 vitalícios

- Reutilizar a campanha de leads atual.
- Públicos incluídos em união: `Instagram EC10 90D` e `Visitantes LP 30D`.
- Público excluído: `Leads 180D`.
- Buenos Aires + 40 km, somente moradores, 18–55.
- Facebook e Instagram; expansão automática desligada.
- Otimização: evento `Lead` no pixel `EC10 Pixel Lead Page`.
- Destino: `https://www.revelatalentos.com/argentina` com UTMs.
- Status final de campanha, conjunto e anúncio: `ACTIVE`.

Essa separação evita sobreposição: quem já virou Lead recebe o anúncio do grupo; quem ainda não virou Lead recebe o anúncio de inscrição e pagamento.

## Estratégia de proporção por posicionamento

Recomendação para o público pequeno e o prazo curto: **manter Feed + Stories/Reels e usar uma arte própria para cada proporção**. Restringir tudo a Stories/Reels reduziria demais o inventário disponível, principalmente na campanha do grupo, cujo público já é muito pequeno.

- Stories e Reels: imagem 9:16, 1080×1920.
- Feed do Facebook e Feed/Explorar do Instagram: imagem 4:5, preferencialmente 1080×1350.
- Não usar recorte automático da peça 9:16 para produzir 4:5; isso removeria partes importantes do título ou do CTA.
- Posicionamentos principais mantidos: Facebook Feed, Facebook Stories, Facebook Reels, Instagram Feed, Instagram Explorar, Instagram Stories e Instagram Reels.

O Graph v25 expõe `asset_feed_spec`, `asset_customization_rules`, rótulos de imagem e `optimization_type`. O script usa `ASSET_CUSTOMIZATION`, que fixa cada imagem ao posicionamento correspondente e não transforma os conjuntos em Dynamic Creative. Os conjuntos atuais foram confirmados com `is_dynamic_creative = false`.

Fallback: se a Meta rejeitar a personalização durante a validação real, manter temporariamente apenas Stories/Reels com as peças 9:16. Esse fallback evita corte, mas tem maior risco de pouca entrega.

## Criativos e textos preparados

O script exige quatro `image_hash` diferentes. Eles ficaram intencionalmente como placeholders para impedir publicação acidental com proporção errada:

- Grupo Stories/Reels 9:16: `{{GROUP_STORY_9X16_IMAGE_HASH}}`.
- Grupo Feed 4:5: `{{GROUP_FEED_4X5_IMAGE_HASH}}`.
- Pagamento Stories/Reels 9:16: `{{PAYMENT_STORY_9X16_IMAGE_HASH}}`.
- Pagamento Feed 4:5: `{{PAYMENT_FEED_4X5_IMAGE_HASH}}`.

Peças verticais já encontradas e confirmadas em 1080×1920:

- `RT_BA_20260717_grupo_story_reels_9x16_v2.png`.
- `RT_BA_20260717_pagamento_story_reels_9x16_v2.png`.

A antiga `RT_BA_20260717_story_reels_9x16_v1.png` mede 864×1821 e não deve ser reutilizada como 9:16.

Texto do grupo, em espanhol argentino:

> ¿Ya completaste tu inscripción? Sumate al grupo oficial de WhatsApp de la convocatoria en Buenos Aires. Ahí vas a recibir horarios, ubicación y avisos para el 17 y 18 de julio. Entrá ahora para no perder ninguna novedad de EC10 Talentos.

Título: `Ingresá al grupo oficial`

Texto do pagamento, em espanhol argentino:

> ¿Seguís a EC10 Talentos o ya viste la convocatoria? Buenos Aires recibe la selectiva internacional el 17 y 18 de julio. Completá tu inscripción, aboná la reserva de USD 50 y subí el comprobante para validar tu cupo. Después, sumate al grupo oficial de WhatsApp.

Título: `Reservá tu cupo por USD 50`

## Execução idempotente preparada

Script: `scripts/meta-argentina-r175-reconfigure.mjs`.

O modo padrão é somente leitura:

```powershell
. C:\Users\Admin\.codex\shared-access\scripts\load-codex-profile.ps1 -Profile ec10-manager
node scripts\meta-argentina-r175-reconfigure.mjs
```

A aplicação externa fica bloqueada até que sejam fornecidos quatro hashes distintos e a confirmação explícita. O script:

1. Reutiliza objetos por ID ou nome para não duplicar campanhas.
2. Cria o público Instagram 90D somente se ele não existir.
3. Pausa temporariamente os objetos durante a troca.
4. Atualiza públicos, orçamento, nomes e criativos.
5. Aplica a peça 9:16 somente em Stories/Reels e a 4:5 somente em Feed/Explorar.
6. Só ativa campanhas, conjuntos e anúncios depois que toda a estrutura estiver pronta.
7. Bloqueia aplicação após a data final ou se o gasto já impedir reduzir o orçamento com segurança.

## Riscos antes da aplicação

- O público `Leads 180D` tem apenas cerca de 20 pessoas antes do filtro de Buenos Aires; a campanha de R$25 pode ter pouca ou nenhuma entrega.
- O tamanho do público Instagram 90D só ficará disponível depois de sua criação e preenchimento. A estimativa de 365D não garante alcance suficiente em Buenos Aires.
- A troca de criativo envia os anúncios novamente para análise da Meta e pode atrasar a entrega.
- A criação com `asset_feed_spec` foi preparada conforme os campos disponíveis na Graph v25, mas não foi validada com POST nesta etapa. Se houver erro, usar o fallback Stories/Reels e não deixar a campanha em estado parcialmente alterado.
- A API não expôs a regra interna do público Instagram 365D com a permissão atual. O script usa o padrão de regra de engajamento da conta e o Instagram profissional confirmado, mas a criação do 90D deve ser validada logo após a aplicação.
- O limite restante da conta é apenas R$0,68 superior ao orçamento vitalício total; qualquer outra campanha ativa pode consumir essa margem. Antes de aplicar, é obrigatório reconfirmar que somente estas duas campanhas concorrem pelo limite.
