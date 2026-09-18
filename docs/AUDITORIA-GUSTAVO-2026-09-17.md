# Auditoria do Gustavo — 17/09/2026

## Escopo

Leitura de todas as conversas registradas no WhatsApp comercial entre 00:00 e 22:10 (America/Sao_Paulo), cruzada com estado do funil, eventos do bot, código em produção e logs do Oracle.

## Volume e tempo de resposta

- 18 conversas.
- 203 mensagens: 103 recebidas e 100 enviadas automaticamente.
- 96 pares em que uma resposta automática veio depois de uma mensagem do cliente.
- Mediana: 9,0 segundos.
- 90% das respostas: até 16,2 segundos.
- 12 respostas demoraram mais de 15 segundos.
- 4 respostas demoraram mais de 1 minuto.
- Maior espera: 8.960 segundos, causada por indisponibilidade/reinício, não por “tempo de pensar” da IA.

## Falhas observadas por conversa

| Conversa | O que aconteceu | Gravidade |
|---|---|---|
| João Pedro | Um comando interno em JSON foi enviado ao cliente. A idade ficou registrada, mas a etapa não avançou corretamente. | Crítica |
| Marcelo | Reunião concluída; depois de “Ok”, o bot respondeu uma frase desnecessária. | Baixa |
| Gildevan | Atleta de 17 anos informou que os responsáveis estavam trabalhando. O bot não ofereceu um próximo passo e a automação foi pausada após tentativas internas. | Alta |
| Fabio/Matheus | Fluxo chegou corretamente à agenda, mas o serviço e a etapa ficaram inconsistentes no banco. | Média |
| Analista financeira | Contato comercial alheio à EC10 recebeu duas respostas e virou ruído no CRM. | Média |
| Elias | O bot repetiu a pergunta sobre responsável, aceitou um “sim” sem validar identidade/nome e enviou a agenda prematuramente. | Crítica |
| Janaina/Bernardo | Lead de 13 anos respondeu “Ss”; o fluxo travou e foi pausado sem uma resposta útil. | Crítica |
| Ricardo | Atleta de 18 anos foi tratado como menor e recebeu pergunta repetida sobre responsável. | Alta |
| Deise/Maria Luísa | A dúvida sobre Campinas foi ignorada; a agenda foi liberada sem nome completo do responsável e o link foi repetido. | Crítica |
| Roberto | Repetição da confirmação de responsável; após agendar e responder “Ok”, recebeu nova apresentação de produto. | Média |
| Diély | Atleta de 20 anos recebeu condução inconsistente, pergunta de responsável indevida, afirmação inventada sobre vídeo externo e dois links de agenda, um deles antigo. | Crítica |
| Jorge | Fluxo correto: responsável, atleta, idade, clube, consentimento e agendamento. Serve como referência positiva. | Sem falha relevante |
| Bernardo Henrique | Menor sem responsável recebeu agenda; perguntas de localização, cancelamento e reagendamento não foram tratadas; o mesmo link foi repetido várias vezes; o bot afirmou ser pessoa. | Crítica |
| Veri | Recebeu somente uma frase genérica, sem pergunta ou próximo passo. | Alta |
| Gustavo Henrique | Quatro mensagens diferentes receberam exatamente a mesma frase genérica; o estado ficou parado. | Crítica |
| Christian | Apresentou-se, informou nome, idade de 15 anos, posição e pediu explicação. As três entradas receberam a mesma frase genérica e nenhum dado avançou no estado. | Crítica |
| Denisvan/Albertina | Seis entradas diferentes, incluindo objetivo profissional, dúvida e pedido de esclarecimento, receberam exatamente a mesma frase genérica. | Crítica |
| Guilherme/Rosilene | Lead de campanha se apresentou, mas recebeu somente a frase genérica e permaneceu aguardando idade. | Alta |

## Causas comprovadas

1. **Filtro aplicado no lugar errado.** O filtro que deveria impedir duas perguntas modificava também mensagens determinísticas corretas. Quando encontrava papel ou idade já conhecidos, descartava a resposta inteira e colocava uma frase genérica.
2. **Dois condutores no mesmo atendimento.** Parte da conversa era conduzida pelo fluxo determinístico e parte pela IA, escolhidos por uma etapa mutável. Estado incompleto fazia o contato alternar entre os dois comportamentos.
3. **Estado gravado depois da resposta.** Em algumas rotas, a mensagem era enviada antes da memória. Uma falha de gravação ou reinício fazia o próximo turno esquecer idade, papel ou nome e repetir perguntas.
4. **Confirmação de responsável permissiva.** “s”, “ss” ou “sim” podiam transformar um atleta menor em responsável mesmo depois de ele dizer que o adulto não estava presente.
5. **Nome do cadastro confundido com participante.** O nome principal do lead podia ser usado como responsável, mesmo quando era o nome do atleta.
6. **Agenda salva como interesse.** Depois de enviar o link, o estado voltava para “aguardando interesse”. Assim, cancelar, reagendar ou perguntar onde ficava era interpretado como nova etapa de venda.
7. **Antirrepetição limitada ao texto exato e ao turno.** Pequenas mudanças de frase permitiam reenviar o mesmo link várias vezes.
8. **Saída da IA sem barreira final completa.** Um retorno com JSON/comando interno conseguiu atravessar até o WhatsApp.
9. **Links e conteúdo externo sem validação.** A IA podia comentar um vídeo que não havia lido e reproduzir um endereço antigo aprendido no histórico.
10. **Áudio com MIME completo.** O WhatsApp entregou `audio/ogg; codecs=opus`, mas o armazenamento aceitava apenas `audio/ogg`, gerando falhas de gravação e transcrição.
11. **Reinício de produção instável.** Houve ciclo de reinício por permissão do diretório de release, além de encerramento da sessão do navegador do WhatsApp durante atualização.
12. **Pausa automática sem encerramento útil.** Algumas tentativas de recuperação terminaram em pausa/handoff antes de uma mensagem final adequada ao cliente.

## Correções implementadas nesta revisão

- O filtro de linguagem deixou de alterar mensagens determinísticas.
- Quando uma pergunta já respondida aparece na saída da IA, apenas essa pergunta é removida; a resposta útil é preservada.
- Nome, idade, papel, serviço e confirmação válida passam a ser sincronizados antes do envio ao WhatsApp.
- Menor só chega à agenda com responsável identificado, confirmação válida e nome completo de quem participará.
- Um “sim” curto não reverte a identidade quando o histórico já mostra que quem fala é o atleta ou não é o responsável.
- O nome do atleta não pode ser reutilizado como nome do responsável.
- Foi criada a etapa `awaiting_booking_completion`, exclusiva para o período entre envio do link e confirmação da reserva.
- Cancelamento, reagendamento, pedido de link, localização e confirmação curta agora têm tratamento próprio.
- Links de agenda são deduplicados pelo endereço, mesmo quando a frase ao redor muda.
- Link antigo do domínio `cliente-whatsapp-crm.vercel.app` é bloqueado na saída.
- JSON, chamadas de ferramenta e comandos internos são bloqueados por uma última barreira antes do WhatsApp.
- Ao perguntar se é robô, Gustavo responde com transparência que é atendimento virtual acompanhado pela equipe.
- Links externos não são “interpretados” pela IA; o material é encaminhado para análise sem inventar conteúdo.
- A base oficial passou a ser Gustavo também no prompt principal; o nome Anderson antigo foi removido dessa rota.
- Áudios `audio/ogg; codecs=opus` são normalizados para armazenamento e transcrição.
- Tempo de digitação da rota principal foi reduzido para uma faixa de 0,5 a 1 segundo, mantendo o processamento do provedor separado.

## Verificação

- Compilação e checagem de tipos: aprovadas.
- 29 testes de injeção de falhas: aprovados.
- 19 testes da memória supervisionada: aprovados.
- 16 regressões construídas com os erros reais do dia: aprovadas.
- 415 casos adversariais do fluxo: aprovados, sem falhas.
- Autoteste do guardião: aprovado.

## Situação de produção após a correção

- A versão corrigida ficou pronta no Oracle às 22:20 (America/Sao_Paulo).
- Serviço do WhatsApp: ativo e autenticado, com saúde `ready`.
- Fila de envio: sem mensagem falhada e sem mensagem aguardando envio.
- Instâncias incorretas: nenhuma; todos os contatos do dia pertencem à instância principal.
- Não houve nova mensagem real após a troca de versão até o fechamento deste relatório; por isso, o próximo atendimento real ainda precisa ser acompanhado como validação de campo.
- Permanecem três conversas antigas com a última mensagem do cliente posterior à última resposta: Bernardo, que pediu bloqueio e foi encaminhado; Janaina e NK7, que já estavam pausados pelo fluxo antigo. Elas não foram reativadas automaticamente para evitar uma abordagem fora de hora ou sem contexto.

## Decisão sobre n8n

Não é recomendado colocar n8n no caminho principal da conversa neste momento. Os erros encontrados estavam no estado e nas regras da aplicação. Adicionar outro executor agora criaria mais um ponto capaz de responder ao mesmo lead, aumentando risco de duplicidade e corrida. n8n pode ser usado depois para tarefas assíncronas — alertas, relatórios, acompanhamento de SLA e integração administrativa — mas não como segundo cérebro concorrendo com Gustavo no WhatsApp.

## Próximos critérios de estabilidade

- Uma mensagem recebida gera no máximo uma decisão de atendimento.
- O estado é salvo antes de qualquer mensagem que dependa dele.
- Menor nunca recebe agenda sem responsável válido.
- O sistema nunca afirma ter visto conteúdo externo que não processou.
- Um link operacional tem uma única fonte oficial.
- Reinício de versão não pode deixar o serviço sem diretório executável nem sem sessão pronta.
- Contato pausado por falha técnica precisa aparecer como incidente para o administrador, não desaparecer silenciosamente.
