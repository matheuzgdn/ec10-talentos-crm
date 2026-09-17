# EC10 Talentos: estudo internacional de mercado, persona e aprendizado para Meta Ads

**Publico:** direcao comercial e gestao de trafego EC10  
**Data-base:** 29 de agosto de 2026  
**Escopo:** Brasil, America Latina e expansoes seletivas; produtos B2C para atletas/familias e B2B para escolas/projetos de futebol.

## Resposta executiva

A EC10 ja possui volume suficiente para aprender sobre qualificacao e agendamento, mas ainda nao possui rastreamento suficiente para afirmar qual pais, persona ou interesse compra mais. No periodo de 29/08/2025 a 29/08/2026, a conta Meta registrou R$ 3.971,59 em gasto, 409.184 impressoes, 7.770 cliques de link e 1.080 eventos do tipo lead. O CRM possui 708 contatos, 134 clientes unicos com sinal de qualificacao, 73 com sinal de agendamento e apenas 2 compradores unicos identificaveis no mesmo recorte.

O gargalo principal nao e falta de publico. E a perda de identidade entre anuncio, pais, produto, CRM e receita: apenas 248 dos 708 contatos possuem nome de campanha, nenhum possui `traffic_campaign_id`, e o pais nao acompanha de forma confiavel a qualificacao e a compra. Portanto, qualquer afirmacao de que Chile, Colombia ou outro pais “aceita mais” seria prematura.

A recomendacao central e transformar a skill EC10 em um sistema de aprendizado auditavel, com playbooks por produto, preco validado, comprador separado do beneficiario, retorno de sinais comerciais e cotas internacionais tratadas como experimentos. A Meta deve aprender com `QualifiedLead`, `Schedule`, comparecimento, proposta e `Purchase`, nunca apenas com clique ou formulario.

## Metodo e qualidade da evidencia

O estudo cruza quatro classes de dados:

1. Marketing API da conta EC10, por campanha e pais.
2. CRM/Supabase, com contatos e eventos comerciais agregados sem exposicao de dados pessoais.
3. Indicadores do Banco Mundial para renda, poder de compra, internet, populacao, juventude e inflacao.
4. Documentacao oficial Meta, Google, FIFA e CONMEBOL, complementada por estudos de caso e foruns.

As fontes foram classificadas em: Nivel A, oficial ou dado EC10; Nivel B, estudo de caso setorial; Nivel C, relato de forum. Numeros de agencias e foruns nao foram usados como benchmark universal.

O indice de oportunidade por pais atribui 25 pontos a poder de compra, 15 a acesso digital, 15 a escala populacional, 10 a proporcao de 0-14 anos, 15 a estabilidade de precos e 20 a evidencia bruta EC10 na Meta. Ele mede potencial de teste, nao aceitacao comercial. A aceitacao so podera ser estimada quando pais estiver ligado a qualificado, comparecimento, proposta, compra e receita no CRM.

## O que o historico EC10 realmente ensina

### Funil observado

| Camada | Quantidade | Leitura correta |
|---|---:|---|
| Gasto Meta | R$ 3.971,59 | Investimento no periodo; nao representa preco de produto |
| Impressoes | 409.184 | Entrega total, com sobreposicao entre pessoas |
| Cliques de link | 7.770 | Interesse inicial; nao prova conversa |
| Eventos Meta de lead | 1.080 | Soma de acoes configuradas como lead; nao equivale a contatos unicos |
| Contatos no CRM | 708 | Base unica operacional |
| Qualificados unicos | 134 | Sinal com volume operacional |
| Agendados unicos | 73 | Sinal com volume operacional |
| Compradores unicos | 2 | Amostra insuficiente para cliente ideal por pais/produto |

### Produtos reconhecidos no CRM

| Produto | Leads | Qualificados | Agendados | Compras ligadas ao coorte | Diagnostico |
|---|---:|---:|---:|---:|---|
| Plano de Carreira | 628 | 106 | 54 | 1 | Grande volume; otimizar para qualidade e comparecimento, nao CPL |
| Plano Internacional | 71 | 28 | 19 | 1 | Menor volume e maior score medio; precisa separar atleta adulto de responsavel |
| Nao definido | 9 | 0 | 0 | 0 | Falha de taxonomia/roteamento |

O Plano Internacional apresenta, neste recorte, proporcoes mais altas de qualificacao e agendamento que o Plano de Carreira. Isso nao prova que o publico seja “melhor”: oferta, pagina, vendedor, periodo e origem sao diferentes. A skill deve ajustar por produto e etapa, nao comparar taxas brutas como se fossem um A/B test.

### Falhas que impedem aprendizado pleno

- Cobertura de nome de campanha no CRM: 35,0%.
- Cobertura de `traffic_campaign_id`: 0%.
- Pais do contato nao e uma dimensao confiavel do funil comercial.
- Eventos Meta mostram 2 compras no periodo, mas nao ha reconciliacao completa com pedido, receita e moeda.
- Cliques X1 para WhatsApp tem alto volume e, em varios eventos, `client_id` nulo; clique nao prova mensagem entregue.
- Precos de varios produtos nao estao formalizados em um catalogo vigente.

## Comprador, beneficiario e persona

### Produtos juvenis B2C

Em Plano de Carreira, Eurocamp e produtos para menores, o atleta e beneficiario e influenciador; o responsavel e comprador, consentidor e avaliador de risco. A comunicacao deve gerar aspiracao sem prometer contrato, e converter confianca: seguranca, metodo, equipe, entregaveis, datas, custo, cancelamento e prova real.

A FIFA publicou orientacao para familias sobre riscos de promessas, cobrancas indevidas e representacao de menores. A EC10 deve usar consentimento do responsavel, linguagem verificavel e ausencia de garantia esportiva ([FIFA, 2026](https://legal.fifa.com/legal/news/fifa-launches-parental-handbook-to-support-families-navigating-agent)).

### Atleta adulto B2C

Nos Planos Internacionais e seletivas 18+, o proprio atleta pode comprar. A persona precisa incluir nivel atual, documentacao, video, idioma, disponibilidade de viagem, prazo e capacidade financeira. Interesses de futebol identificam afinidade, nao prontidao.

### Torneios e experiencias B2B

Em Libertacademy e Academy Sudamerica, o comprador e dono, diretor ou gestor de escola/projeto com poder para mobilizar delegacao. O atleta e o usuario final, e a familia influencia a adesao. O anuncio deve filtrar pelo cargo e pela organizacao; o formulario deve pedir escola, cidade, categorias, atletas estimados, historico de viagem e prazo de decisao.

Casos internacionais de camps mostram que local, programa, prazo e capacidade precisam de criativos e funis separados; publico generico de pais tende a esconder qual unidade realmente encheu ([iExcel](https://iexcel.co/case-studies/brains-and-motion)). Torneios latino-americanos bem apresentados tornam concreto o formato, categorias, arbitragem, fixture, cobertura e gestao da equipe ([Bufaloscup](https://bufaloscup.com/)).

## Playbook por produto e preco

| Produto | Comprador | Beneficiario | Preco observado | Acao de conversao |
|---|---|---|---|---|
| Plano de Carreira | Responsavel | Atleta juvenil, pagina atual 14-17 | Nao confirmado | Qualificado, reuniao, adesao |
| Planos Internacionais | Atleta 18+ ou responsavel | Atleta | Nao confirmado | Comparecimento, proposta, compra |
| Revela Talentos anual | Atleta adulto ou responsavel | Atleta | R$ 297 anual; referencia R$ 1.197,99, confirmar vigencia | Checkout e compra com valor |
| Eurocamp Kids | Responsavel/familia | Atleta 9-13 | Nao confirmado | Reuniao familiar, deposito, contrato |
| Eurocamp | Responsavel/familia | Atleta por faixa da edicao | Nao confirmado | Deposito e contrato |
| Argentina Camp Premium | Atleta adulto ou responsavel | Atleta | R$ 4.000 historico informado | Reserva/contrato |
| Argentina Camp Gold | Atleta adulto ou responsavel | Atleta | R$ 7.000 historico; escopo a confirmar | Reserva/contrato |
| Seletiva Argentina | Atleta adulto ou responsavel | Atleta | USD 50 na edicao auditada | Inscricao paga USD |
| Libertacademy | Gestor de escola/projeto | Delegacao | Nao confirmado | Gestor qualificado, reuniao, inscricao |
| Academy Sudamerica | Gestor de escola/projeto | Organizacao/delegacao | Nao confirmado | Gestor qualificado, reuniao, inscricao |
| Mentoria Prime | Atleta adulto ou responsavel | Atleta/familia | Nao confirmado | Sessao comparecida e adesao |

Preco desconhecido e um bloqueio de copy, nao um espaco para suposicao. A oferta deve registrar moeda, total, parcelas, inclusoes, adicionais e validade. Para produtos premium, uma faixa honesta pode reduzir volume e elevar a proporcao de contatos viaveis.

## Estudo de paises

### Indicadores e potencial de piloto

| Pais | Renda Banco Mundial | Internet | Inflacao mais recente | Sinal Meta EC10 | Indice | Conclusao |
|---|---|---:|---:|---|---:|---|
| Brasil | Media-alta | 84,5% | 5,0% | 2.656 cliques; 629 leads brutos | 76,3 | Mercado principal e unico com operacao madura; ainda sem compra por pais |
| Chile | Alta | 95,6% | 4,2% | 629 cliques; 4 leads | 73,9 | Alto potencial economico, baixa aceitacao observada; piloto localizado |
| Mexico | Media-alta | 83,1% | 3,8% | 288 cliques; 0 leads | 70,2 | Escala grande, mas nenhuma validacao EC10; nao escalar |
| Argentina | Media-alta | 89,7% | 219,9% em 2024 | 1.592 cliques; 435 leads | 67,6 | Forte resposta em oferta local de USD 50; volatilidade e produto confundem comparacao |
| Panama | Alta | 72,8% | -0,2% | 74 cliques; 1 lead | 66,7 | Poder de compra e mercado pequeno; teste premium controlado |
| Uruguai | Alta | 92,0% | 4,7% | 263 cliques; 1 lead | 65,1 | Bom poder de compra e proximidade; mercado pequeno |
| Peru | Media-alta | 82,0% | 1,5% | 384 cliques; 4 leads | 61,4 | Mercado jovem; validar ticket e logistica |
| Costa Rica | Alta | 87,2% | -0,1% | 54 cliques; 0 leads | 60,5 | Potencial premium pequeno; sem evidencia EC10 |
| Colombia | Media-alta | 79,3% | 5,1% | 546 cliques; 3 leads | 60,2 | Cultura e escala; distancia/logistica elevam custo de camp |
| Paraguai | Media-alta | 81,6% | 4,0% | 700 cliques; 1 lead | 57,9 | Mercado jovem e proximo; menor renda exige oferta compativel |
| Equador | Media-alta | 77,2% | 0,7% | Sem teste util | 46,0 | Hipotese, nao prioridade |
| Bolivia | Media-baixa | 79,7% | 19,5% | Sem teste util | 31,5 | Ticket premium de maior risco; testar somente oferta adequada |

O Banco Mundial classifica Chile, Uruguai, Panama e Costa Rica como alta renda; Brasil, Argentina, Colombia, Mexico, Paraguai e Peru como media-alta; Bolivia como media-baixa ([World Bank Country Groups](https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups)). A classificacao nao substitui renda do publico dentro de cada cidade.

### Cotas recomendadas de primeira rodada

| Produto | Distribuicao inicial |
|---|---|
| Plano de Carreira/Revela em portugues | Brasil 85%; Portugal/diaspora 15% apenas com pagina e atendimento localizados |
| Plano Internacional em espanhol | Argentina 25%; Colombia 20%; Chile 15%; Uruguai 10%; Peru 10%; Mexico/Panama/Costa Rica 15%; Paraguai 5% |
| Camps premium com viagem | Brasil 55%; Chile 12%; Uruguai 10%; Argentina 8%; Colombia 5%; Paraguai 4%; Peru 3%; Panama/Costa Rica 3% |
| Libertacademy B2B | Brasil 55%; Argentina 15%; Paraguai 10%; Uruguai 8%; Chile 7%; Colombia 5% |
| Sudamerica B2B | Brasil 50%; Argentina 15%; Chile 10%; Uruguai 10%; Paraguai 10%; Colombia 5% |
| Seletiva Argentina USD 50 | Argentina 80%; Uruguai 7%; Paraguai 7%; Chile 3%; fronteira Brasil 3% |

Essas cotas sao limites de aprendizagem. Nao devem ser copiadas para uma campanha pequena com muitos conjuntos. Para verba baixa, agregue paises por idioma/logistica e use UTMs/pais para leitura. Redistribua somente depois de 10 qualificados por pais ou limite de perda definido.

## Aperfeicoamentos incorporados na skill

1. Novo modo `Aprendizado historico`, somente leitura, que cruza Meta, CRM e Banco Mundial.
2. Catalogo por produto com comprador, beneficiario, valor, preco, prova, qualificacao e evento correto.
3. Matriz de paises com potencial economico, digital e evidencia EC10, sempre marcada como nao validada comercialmente.
4. Regra de amostra: menos de 10 resultados e insuficiente; 10-29 e preliminar; 30+ sustenta regra operacional; semelhante exige volume, recencia e match adequados.
5. Bloqueio de preco nao confirmado, promessa esportiva, parceiro nao confirmado e compra falsa.
6. Distincao entre clique de WhatsApp, conversa, contato, qualificado, agenda, comparecimento, proposta e compra.
7. Hierarquia de fontes para impedir que relato de forum vire regra.

## Arquitetura de aprendizado recomendada

### Camada de dados

Cada contato novo deve armazenar: `country_code`, idioma, produto, papel do contato, faixa de idade, faixa de investimento, campaign/adset/ad IDs, UTMs, `fbclid`, `fbp`, `fbc`, vendedor, eventos, valor e moeda. `campaign_id` e pais devem sobreviver ate a compra.

### Camada de sinais

- `Lead`: contato valido e consentido.
- `QualifiedLead`: atende criterios do produto.
- `Schedule`: reuniao marcada.
- `MeetingAttended`: compareceu.
- `Proposal`: recebeu proposta.
- `Purchase`: transacao real, valor e moeda.
- `DisqualifiedLead`: motivo padronizado para analise, nao sinal positivo.

Meta e Google devem receber o resultado mais proximo da receita que tenha volume util. A Meta recomenda CRM + CAPI e meta de leads de conversao para qualidade ([Meta Lead Generation Guide](https://about.fb.com/ltam/wp-content/uploads/sites/14/2023/11/LeadGenerationGuide.pdf)); o Google recomenda `qualified lead` ou `converted lead` em conversoes offline ([Google Ads](https://support.google.com/google-ads/answer/10029210)).

### Camada de criativos

Criativos 9:16, com audio, legendas e elementos na safe zone devem fazer parte do teste, nao virar dogma. A Meta encontrou menor custo por resultado em testes amplos, mas o ganho EC10 precisa ser medido por qualificado e compra ([Meta Reels](https://www.facebook.com/business/ads/facebook-instagram-reels-ads)).

Para menores, usar cenas reais, responsavel, metodo, seguranca e entregaveis. Para B2B, usar gestor, delegacao, categorias, destino, logistica e prova de organizacao. Para alto ticket, revelar faixa/pre-requisito suficiente para o proprio anuncio repelir curiosos.

## Plano de 90 dias

### Dias 1-14: base confiavel

- Tornar `campaign_id`, `adset_id`, `ad_id`, pais, produto e papel obrigatorios na atribuicao.
- Criar catalogo comercial vigente com precos e inclusoes.
- Reconciliar os 2 compradores com receita e origem.
- Testar deduplicacao Pixel/CAPI e diagnosticos.

### Dias 15-45: testes por produto

- Plano de Carreira: responsavel + faixa do atleta + prova real; comparar formulario curto qualificado com pagina completa.
- Internacional: separar atleta 18+ de responsavel por menor.
- B2B: comparar criativo “gestor da escola” com “experiencia da delegacao”, mantendo oferta e destino.
- Camps: testar confianca/logistica contra oportunidade/experiencia, sem alterar simultaneamente publico e pagina.

### Dias 46-90: aprendizado e escala

- Promover pais/segmento somente por CPQL, comparecimento, proposta e compra.
- Construir sementes separadas: compradores, comparecidos, gestores B2B e responsaveis B2C.
- Excluir compradores quando nao houver recompra e separar remarketing por etapa/recencia.
- Revisar a cada ciclo o snapshot da skill e registrar decisao, confianca, impacto e reversao.

## Limitacoes

- Pais nao esta ligado de forma completa ao resultado comercial no CRM.
- Acoes da Meta podem incluir tipos diferentes sob “lead” e nao representam pessoas unicas.
- Estudos de caso de agencias sao autodeclarados e servem como transferencia de principio, nao benchmark.
- Indicadores macro nacionais nao descrevem renda de bairros, gestores ou familias especificas.
- Precos marcados como historicos ou desconhecidos exigem validacao comercial antes de qualquer anuncio.

## Fontes principais

- Banco Mundial. Country and Lending Groups, FY2027: https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups
- Banco Mundial. World Development Indicators API: https://api.worldbank.org/v2/
- Banco Mundial. Latin America and the Caribbean Economic Review, abril de 2026: https://documents1.worldbank.org/curated/en/099040726171531340/pdf/P514911-9105323f-4772-4a73-a4a3-9eecb1b304e1.pdf
- Meta. Campaign set up for lead generation forms: https://about.fb.com/ltam/wp-content/uploads/sites/14/2023/11/LeadGenerationGuide.pdf
- Meta. Reels Ads: https://www.facebook.com/business/ads/facebook-instagram-reels-ads
- Google Analytics. URL builders and UTM campaign data: https://support.google.com/analytics/answer/10917952
- Google Ads. Offline/enhanced conversions for leads: https://support.google.com/google-ads/answer/10029210
- FIFA. Parents' Education on Football Agents: https://legal.fifa.com/legal/news/fifa-launches-parental-handbook-to-support-families-navigating-agent
- FIFA. Playing opportunities for talents: https://publications.fifa.com/en/talent-development/playing-opportunites-for-talents/
- CONMEBOL. Modelo de formacao esportiva: https://cdn.conmebol.com/wp-content/uploads/2020/12/manual-orientador-esp.pdf
- Custom Creatives. Youth soccer academy case: https://customcreatives.com/?p=6903
- iExcel. Multi-location youth camps case: https://iexcel.co/case-studies/brains-and-motion
- Aurelius Media. Meta Ads for School Admissions: https://www.aureliusmedia.co/blog/meta-ads-for-school-admissions
- Inficon Global. Fundacion Real Madrid camps: https://inficonglobal.es/caso-de-exito/fundacion-real-madrid/
- Toque Fino. Futbol formativo no Peru: https://toquefino.com/marketing-digital-futbol-formativol-diamante/
- Bufaloscup. Torneio juvenil e proposta B2B: https://bufaloscup.com/

