# Ponte local do WhatsApp Web EC10

Esta ponte é a contingência local para o WhatsApp Web comercial. O navegador continua sendo o transporte; o Gustavo e a memória ficam no serviço isolado e no CRM.

## Regras ativas

- somente mensagens novas por padrão; o modo de pendências é opt-in;
- uma resposta por mensagem recebida, com idempotência persistida;
- uma pergunta por vez, idioma do contato e memória reaproveitada;
- espanhol: agenda com Augustin;
- português e atleta com 18 anos ou mais: Plano Internacional, áudio aprovado do Eric e agenda com Pablo;
- Plano de Carreira em português: agenda com Igor Jardins;
- todos os dias às 20h, por uma hora, com bloqueio transacional de conflito;
- menor de idade só recebe agenda com adulto responsável confirmado;
- o vendedor só é avisado depois de a reserva existir no CRM.

## Operação

O Agendador de Tarefas inicia `scripts/run-whatsapp-web-bridge.ps1` no logon. O painel local fica em `http://127.0.0.1:3219/` e há um atalho na área de trabalho.

A extensão não toca em conversas antigas até o operador marcar **Incluir conversas não lidas antigas**. Esse modo processa uma conversa por vez, preservando histórico e as mesmas travas de segurança.

## Limite importante

WhatsApp Web é um transporte não oficial e pode mudar a interface. A ponte interrompe o envio quando não reconhece a conversa; não tenta adivinhar contato nem horário. A Cloud API oficial continua sendo a rota de longo prazo.
