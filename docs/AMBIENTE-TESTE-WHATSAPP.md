# Ambiente de teste do Gustavo no WhatsApp

## Objetivo

Permitir que cada administrador teste o Gustavo com o próprio WhatsApp, usando o transporte e a IA reais, sem misturar o teste com clientes.

O número autorizado é interceptado antes da criação do contato comercial. Durante o teste:

- não é criado lead;
- não é criado card no funil;
- não é criada reunião ou retorno;
- não são enviados follow-ups comerciais;
- o histórico fica somente nas tabelas do laboratório;
- quando a conversa chega ao momento da reunião, o sistema apenas informa que o link seria enviado.

## Uso pelo CRM

1. Entre em `https://ec10talentos.com/crm` com uma conta de administrador.
2. Abra **Ambiente de testes**.
3. Informe o seu nome e o WhatsApp com DDD e país.
4. Ative o número por 24 horas.
5. Abra o WhatsApp comercial pelo botão da tela e converse como um cliente.
6. Acompanhe as mensagens na própria tela.
7. Use **Limpar conversa** para recomeçar ou **Encerrar teste** para devolver o número ao fluxo comercial normal.

Nunca use o telefone de um cliente como número de teste.

## Desenvolvimento em outra máquina

```bash
git clone https://github.com/matheuzgdn/ec10-talentos-crm.git
cd ec10-talentos-crm
git switch -c correcao-gustavo-seu-nome
npm ci
npm run typecheck
npm run build
node scripts/test-gustavo-fault-injection.mjs
node scripts/test-gustavo-provider-failure.mjs
```

Depois dos testes locais, envie a branch e abra um Pull Request. O servidor Oracle só deve receber código aprovado na `main`.

## Arquivos principais

- `skill/gustavo/`: conhecimento, tom e regras de atendimento.
- `apps/bot/src/ai.ts`: geração, memória e critérios de qualificação.
- `apps/bot/src/index.ts`: recebimento e envio no WhatsApp.
- `apps/bot/src/store.ts`: persistência e isolamento do teste.
- `supabase/migrations/`: mudanças de banco.
- `scripts/test-gustavo-*.mjs`: bateria antifalhas.

## Segredos e acesso

O GitHub não contém credenciais. O programador deve receber contas individuais para os serviços de que realmente precisar. Nunca enviar `.env`, chave Gemini/Groq, service role do Supabase, QR/sessão do WhatsApp, token Meta ou chave SSH em commit, issue, chat ou Pull Request.

Para corrigir linguagem, regras e conhecimento, não é necessário acesso ao Oracle. Para publicar no servidor, use o fluxo de Pull Request e o deploy controlado já configurado.

