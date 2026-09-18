# Gustavo — teste real acompanhado em 18/09/2026

## Escopo

- Canal: número oficial de teste da Meta para o WhatsApp comercial final `***6146`.
- Regra a partir desta anotação: preservar a conversa atual; não limpar nem reiniciar o contato durante o acompanhamento.
- Objetivo: conversa natural que identifica contato, atleta e responsável; explica a EC10; envia um único áudio correto do Eric; libera a agenda apenas no momento adequado.

## Correções aplicadas

1. **Memória isolada por contato** — removido o risco de a lista de áudios de um lead contaminar outro atendimento.
2. **Nome, atleta e idade preservados** — fatos já confirmados não podem ser substituídos por inferência diferente do modelo.
3. **Responsável separado do atleta** — o contato adulto e o nome do atleta ficam em campos distintos.
4. **Menor protegido** — a agenda permanece bloqueada até existir responsável adulto confirmado.
5. **Áudio por idade e sem repetição** — 9–13 recebe `eric_8_13`; 14–18 recebe `eric_14_18`; nunca são enviados dois áudios no mesmo fluxo.
6. **“Sim/ss” com contexto** — resposta curta só vira interesse em reunião depois do áudio; antes disso responde apenas à pergunta vigente.
7. **Link sem repetição** — após a agenda ser liberada, o link só reaparece quando o lead pedir agenda/link/reunião.
8. **Falha rápida do Gemini** — limite de 4 segundos; em erro ou JSON inválido, entra resposta local segura em vez de travar.
9. **Regra comercial acima da falha do modelo** — uma resposta correta criada pelo fluxo EC10 não é substituída por fallback genérico.
10. **Dúvida respondida antes da próxima pergunta** — perguntas sobre empresa, preço, clube ou garantia recebem resposta objetiva antes da qualificação.
11. **Tom menos mecânico** — bloqueadas aberturas repetitivas como “Entendi” e “Que legal”, além de código/JSON visível.
12. **Nome isolado reconhecido** — respostas como “Juan”, “JUAN” ou nome completo passam a ser salvas sem repetir a pergunta.
13. **Avanço após o nome** — depois de salvar o nome, o próximo passo identifica naturalmente atleta ou responsável.
14. **Sem saudação repetida** — “Oi/Olá/Fala + nome” só pode aparecer no início; depois a conversa segue direto.
15. **Fila substituível** — uma nova mensagem do lead cancela respostas antigas ainda não enviadas, evitando chegada tardia e duplicada.
16. **Sem repetir o nome como bordão** — depois que o contato foi identificado, as mensagens seguem direto ao assunto, sem “Oi Juan”, “Olá Juan” ou “Boa, Juan” a cada resposta.
17. **Resposta consecutiva nunca idêntica** — se a IA tentar repetir a mensagem anterior, o sistema troca por um avanço contextual; por exemplo, se o menor disser que o pai está trabalhando, pergunta por outro responsável ou combina a continuidade quando o adulto estiver disponível.
18. **Dúvida sobre ligação respondida** — perguntas como “vocês vão me ligar?” recebem explicação direta de que a conversa é agendada pelo link antes de retomar a etapa do responsável.
19. **Limite real de resposta do Gemini** — a geração é interrompida em 3 segundos sem aguardar o cancelamento lento da biblioteca; a resposta segura assume imediatamente.
20. **Memória completa do diálogo** — o Gemini passa a receber pares de mensagem do cliente e resposta do Gustavo; isso impede responder agora uma pergunta que pertencia à mensagem anterior.
21. **Menor sozinho sem interrogatório** — se o atleta disser que não há adulto disponível, o Gustavo orienta o responsável a continuar no mesmo WhatsApp depois, sem repetir a mesma pergunta.

## Achados do teste ao vivo

| Entrada do teste | Problema observado | Correção |
|---|---|---|
| “Vi vocês no Instagram” | Apresentação correta, mas ainda genérica | Preservar introdução curta e avançar pelo contexto |
| “Queria saber mais da empresa” | Em uma rodada pediu o nome antes de explicar | Resposta sobre a EC10 passou a ter prioridade |
| “Vocês são clube de futebol?” | Em uma rodada pediu o nome e ignorou a dúvida | Responder que a EC10 é assessoria, não clube, e só então perguntar o nome |
| “Juan / JUAN / Jan” | Nome isolado não entrou na memória e o fluxo repetiu a pergunta | Extração determinística de nome e avanço imediato para atleta/responsável |
| Saudações “Oi Juan / Olá Juan” | A IA se reapresentava em respostas sucessivas | Saudação bloqueada depois da introdução inicial |
| Respostas antigas chegando depois | Fila acumulada durante reinícios do laboratório | Mensagem nova invalida itens antigos ainda pendentes |

## Critérios de aprovação da conversa atual

- Uma pergunta por mensagem.
- Nenhum dado já informado é solicitado novamente.
- Dúvidas são respondidas antes da qualificação.
- Um único áudio coerente com a idade.
- Menor não recebe agenda sem adulto responsável.
- Interesse real leva ao link individual de reunião.
- Nenhuma mensagem técnica, JSON, função interna ou resposta duplicada aparece ao cliente.
