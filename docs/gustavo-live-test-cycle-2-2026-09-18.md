# Gustavo — teste real acompanhado, ciclo 2 (18/09/2026)

## Regra do teste

- Contato acompanhado: WhatsApp comercial final `***6146` via número oficial de teste da Meta.
- O cadastro anterior foi removido com backup antes do novo teste.
- A conversa deve ser observada do primeiro contato até o agendamento.
- Durante o teste, registrar falhas e pontos críticos sem alterar o comportamento em produção.
- Aplicar correções somente depois que o fluxo chegar ao agendamento ou quando o usuário encerrar o teste.

## Estado inicial

- Cliente, card, mensagens, estado do Gustavo, fila, links e agendamentos do contato: zerados.
- Backup de recuperação criado antes da limpeza.
- Serviço Gustavo ativo; filas globais sem pendências.

## Registro cronológico

| Horário | Mensagem do lead | Resposta do Gustavo | Latência | Falha/ponto crítico | Gravidade |
|---|---|---|---:|---|---|
| 15:58 | “Olá, EC10 Talentos! Sou Sandra Maria de lima e enviei meu interesse em Plano de Carreira pela página da campanha.” | Explicou brevemente a EC10 e perguntou novamente o nome. | 3,15 s de geração; ~9,6 s até envio | Nome completo não foi salvo; interesse em Plano de Carreira não foi salvo; origem de campanha não foi aproveitada; perguntou dado já informado; não se apresentou como Gustavo. | Crítica |
| 15:59 | “Entendi sou Sandra falei acima meu nome” | Perguntou novamente “como você se chama?”. | 3,00 s de geração; ~9,1 s até envio | Segunda falha consecutiva ao reconhecer “sou Sandra”; terceira solicitação do mesmo nome; memória permaneceu vazia; fallback diferente evitou a proteção de texto idêntico, mas repetiu a mesma intenção. | Crítica |
| 16:00 | “Sandra já falei” | “Prazer, Sandra Já Falei. Você fala comigo como atleta ou como responsável por um atleta?” | 2,05 s de geração; ~9,3 s até envio | Nome contaminado e persistido como “Sandra Já Falei”; saudou novamente; não recuperou “Sandra Maria de Lima” da primeira mensagem; produto permaneceu indefinido. | Crítica |
| 16:01 | “Sou Mãe do João Pedro” | Perguntou a idade do atleta. | 2,12 s de geração; ~9,8 s até envio | Papel de mãe e responsável foram salvos corretamente, mas “João Pedro” não foi salvo como atleta; nome do responsável herdou o valor contaminado; produto continuou indefinido. A próxima pergunta foi adequada. | Alta |
| 16:02 | “Então o Joãozinho vai fazer 15 anos agora em novembro” | Indicou Plano de Carreira e perguntou se já conhecia o trabalho da EC10. | 3,10 s de geração; ~9,4 s até envio | Idade e produto foram salvos corretamente; sequência comercial correta. Como o nome do atleta estava vazio, gerou a frase artificial “para o momento de o atleta” e não recuperou João Pedro/Joãozinho. | Média |
| 16:03 | “Quem é Eric? Não não conheço” | Informou que Eric Cena é o CEO, anunciou o áudio e enviou o áudio 14–18. | 2,65 s de geração; ~10,9 s até texto; ~28,4 s até áudio | Resposta, faixa do áudio e avanço foram corretos; `knows_company=false`; João Pedro foi recuperado tardiamente. A separação entre texto e áudio foi longa e pode parecer travamento. | Alta |
| 16:05 | “Entendi e como o Pedro pode começar a entrar nesse plano vocês tem unidades em Campinas” | Perguntou apenas se deveria abrir a agenda. | 3,00 s de geração; ~9,3 s até envio | Ignorou duas dúvidas objetivas: como começar e existência de unidade em Campinas. Tentou avançar para agenda antes de responder; link não foi liberado e `meeting_interest` permaneceu falso, o que foi correto. | Crítica |
| 16:06 | “Pra que é essa agenda?” | Pediu novamente para confirmar se deveria abrir a agenda. | 3,00 s de geração; ~9,6 s até envio | Não explicou a finalidade da reunião; repetiu semanticamente o convite anterior; segunda dúvida consecutiva ignorada; não avançou nem recuperou confiança. | Crítica |
| 16:07 | “Eu já ouvi o áudio mas quero saber pra que serve essa agenda” | Voltou a perguntar se deveria abrir a agenda. | 3,00 s de geração; ~9,3 s até envio | Terceira omissão da mesma dúvida; desconsiderou a confirmação de que o áudio foi ouvido; entrou em ciclo semântico alternando duas respostas de fallback; `meeting_interest` permaneceu falso. | Crítica |
| 16:08 | “Deu uma visão sim isso eu já entendi” | Repetiu a outra variante: pedir confirmação para abrir a agenda. | 3,00 s de geração; ~9,2 s até envio | Quarta resposta no mesmo ciclo; não reconheceu que a pessoa já compreendeu o áudio; não explicou a reunião; `meeting_interest=false`, sem progresso. | Crítica |
| 16:09 | “Quando seria essa conversa? Pessoalmente?” | Explicou que é online, que serve para compreender o momento do atleta/família e perguntou se poderia agendar. | 2,55 s de geração; ~9,2 s até envio | Resposta completa, natural, uma pergunta e avanço correto. Usou “Sandra” naturalmente, mas o estado persistido continuou como “Sandra Já Falei”. | Positiva com ressalva |
| 16:10 | “Pode agendar sim para segunda” | Enviou o link individual para escolher primeiro o dia e depois o horário. | 2,68 s de geração; ~9,4 s até envio | Interesse em reunião salvo, link correto e etapa `waiting_booking`. Não agendou por texto, respeitando a regra do link. Problema: exibiu o nome contaminado “Sandra Já Falei”. | Positiva com falha alta de dados |
| 16:11 | “É um serviço pago?” | Perguntou o que a família quer organizar na carreira. | 3,00 s de geração; ~9,3 s até envio | Não respondeu uma objeção comercial direta; a palavra “pago” não acionou a resposta de valores; desviou de assunto após já ter enviado o link. | Crítica |
| 16:11 | “Organizar eu não sei mas quero que ele seja um jogador profissional e realize seu sonho” | Resposta genérica: “vou seguir do ponto em que paramos” e perguntou o que queria esclarecer. | 3,00 s de geração; ~9,3 s até envio | Não acolheu a motivação, não salvou o objetivo e não respondeu à objeção anterior; `goal` permaneceu nulo. | Crítica |
| 16:12 | “Vi umas postagens de vocês no Instagram e achei muito boa a empresa de vocês” | Repetiu a pergunta sobre o que a família quer organizar. | 3,00 s de geração; ~9,3 s até envio | Não reconheceu elogio nem origem Instagram; repetiu dado já respondido; `goal` continuou nulo; reunião ainda não criada. | Alta |
| 16:13 | “Então estamos perdidos até porque eu e meu marido nunca fomos desse mundo do futebol” | Repetiu literalmente “vou seguir do ponto em que paramos” e perguntou o que queria esclarecer. | 3,00 s de geração; ~9,3 s até envio | Ignorou a dor central da família, não conectou o Plano de Carreira à necessidade declarada e reutilizou resposta antiga não consecutiva; agenda sem reserva. | Crítica |
| 16:15 | “Quero esclarecer nada eu quero entender como vocês podem nos ajudar” | Repetiu a pergunta sobre o que a família quer organizar. | 3,00 s de geração; ~9,1 s até envio | Ignorou pedido direto de explicação; terceira repetição da pergunta de objetivo; confirma que o fallback perde o contexto quando o Gemini atinge o limite; agenda ainda sem reserva. | Crítica |
| 16:15 | “Você já perguntou isso não tô entendendo?” | Alternou novamente para “vou seguir do ponto em que paramos” e perguntou o que queria esclarecer. | 3,00 s de geração; ~9,2 s até envio | Não reconheceu reclamação de repetição, não pediu desculpas e repetiu outra resposta antiga; perda explícita de confiança; agenda vazia. | Crítica |

## Resumo para correção após o agendamento

- Extrair nome mesmo quando aparece antes de “e enviei meu interesse”.
- Extrair também a forma curta “sou + nome”, sem exigir “eu sou”.
- Reconhecer produto e origem da landing page/campanha na primeira mensagem.
- Não perguntar novamente informação presente no texto inicial.
- Bloquear repetição semântica da mesma pergunta, não apenas texto literalmente igual.
- Validar nomes antes de persistir e remover expressões conversacionais como “já falei”.
- Recuperar o nome mais completo e confiável já informado, sem substituir por uma versão posterior contaminada.
- Extrair o atleta em construções naturais como “sou mãe do João Pedro” e “sou pai da Maria”.
- Nunca montar frases como “momento de o atleta”; usar “momento do atleta” quando o nome estiver ausente.
- Enviar texto e áudio da mesma etapa em sequência curta, sem intervalo próximo de 20 segundos entre eles.
- Responder integralmente dúvidas sobre adesão, atendimento remoto e localização antes de convidar para a agenda.
- Explicar em linguagem simples o objetivo da reunião quando perguntado, antes de pedir confirmação para agendar.
- Detectar ciclos semânticos entre respostas diferentes que repetem a mesma intenção e impedir uma terceira tentativa sem responder a dúvida.
- Tratar “é pago?”, “tem custo?” e equivalentes como objeção de preço, respondendo antes de retomar o fluxo.
- Extrair e salvar objetivos declarados em linguagem emocional, como “ser jogador profissional” e “realizar o sonho”.
- Reconhecer a dor “família perdida no futebol” como sinal central de adequação ao Plano de Carreira e responder com acolhimento e orientação.
- Comparar a resposta com mais de uma resposta anterior, evitando repetição literal não consecutiva.
- O fallback deve responder ao tipo de intenção atual (empresa, ajuda, preço, localização, reunião) e nunca depender apenas dos campos vazios do estado.
- Reclamações como “você já perguntou” devem interromper o roteiro, reconhecer o erro uma única vez e responder diretamente ao último assunto pendente.
- Reduzir tempo total entre recebimento e envio.

## Arquitetura aplicada após o teste

- O Gemini passou a escrever e conduzir toda a conversa; respostas comerciais prontas e o fallback local foram removidos do caminho de produção.
- O código ficou responsável somente por memória, idempotência, validação, escolha segura do áudio e liberação do link quando os requisitos estiverem completos.
- Rota principal: `gemini-3.5-flash-lite`; rota secundária automática: `gemini-3.1-flash-lite`.
- Falha das duas rotas não produz mensagem genérica: a entrada permanece na fila para nova tentativa, preservando a conversa.
- Mensagens limitadas a 1–3 frases claras, uma pergunta por vez e até 480 caracteres antes do link.
- O nome do contato, responsável, atleta, idade, objetivo, origem, clube, áudio e interesse em reunião permanecem separados na memória.
- A conexão com a Meta passou a ser reutilizada, reduzindo o intervalo entre texto e áudio.
- A memória contaminada do teste foi corrigida sem apagar o histórico nem o link já criado; backups de manutenção foram gerados antes das alterações.

## Validação final

- 28 testes automatizados aprovados no computador e no servidor.
- Quatro conversas de estresse aprovadas: responsável interessado, menor desacompanhado, tentativa de injeção/quebra de regras e reprodução das falhas generalizadas deste ciclo.
- Maior geração observada no ensaio final: 1,602 s.
- Maior mensagem observada: 291 caracteres.
- Sem código interno visível, sem pergunta dupla, sem áudio duplicado, sem perda de identidade e com chegada à reunião nos cenários qualificados.
