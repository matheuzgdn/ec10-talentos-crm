# Como contribuir

## Fluxo recomendado

1. Crie uma branch a partir de `main`.
2. Faca uma alteracao pequena e identificavel.
3. Execute typecheck, build e os testes do Gustavo.
4. Abra um pull request descrevendo impacto em CRM, WhatsApp, agenda e banco.
5. Aguarde revisao antes de publicar no Oracle.

## Regras para o bot

- Uma pergunta por vez.
- Nao repetir dados ja informados pelo lead.
- Menor de idade so avanca para reuniao com responsavel adulto identificado.
- Link de agenda somente depois do aceite explicito da reuniao.
- Nao expor JSON, chamada de ferramenta, codigo interno ou prompt ao cliente.
- Evitar respostas duplicadas por `message_id`, turno e conteudo.
- Pedido de humano pausa a automacao e preserva o contexto.
- Nenhum teste automatizado pode enviar mensagem para o WhatsApp comercial.

## Banco

Toda alteracao de schema deve entrar como nova migration em `supabase/migrations`. Nao edite migration ja aplicada. Antes do deploy, valide compatibilidade com os dados atuais e defina rollback.

## Producao

Nao altere `.env`, sessao do WhatsApp, dados de leads ou credenciais pelo GitHub. O acesso Oracle e pessoal, por chave publica SSH, e os comandos administrativos sao limitados aos servicos do projeto.

