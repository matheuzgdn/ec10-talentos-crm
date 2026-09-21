# EC10 CRM: recuperação e contingência (21/09/2026)

## Estado verificado

- `https://ec10talentos.com/crm` ainda recebe a tela atual, mas o login na API do projeto Supabase `ptylfzhrkudaazcbsbwu` responde HTTP 402 `exceed_egress_quota`.
- O PostgreSQL desse mesmo projeto continua acessível por conexão direta. Não houve transferência nem exclusão dos dados de clientes.
- A cópia de emergência da interface atual está em `https://crm-api.147-15-27-235.nip.io/crm`. Ela **não substitui** o endereço oficial e não deve ser anunciada como CRM completo até a validação dos módulos abaixo.
- O gateway Oracle usa `ec10-crm-gateway`, `ec10-postgrest` e `caddy`. O guardião roda a cada cinco minutos.
- Testes realizados: 3 verificações unitárias do gateway, 6 de integração (incluindo RLS e JWT inválido), 7 de login/renovação/logout com uma identidade temporária removida ao fim, e abertura da tela em Chrome sem erro de carregamento.

## Cópias de segurança

- `ec10-crm-backup.timer`: cópia diária às 06:00 UTC, com atraso aleatório de até 15 minutos.
- O arquivo é um `pg_dump` customizado criptografado, validado por `pg_restore --list` antes da publicação.
- A primeira cópia verificada foi feita em 21/09/2026. Há uma cópia no Oracle em `/var/backups/ec10-crm/` e outra no PC em `C:\Users\Admin\.codex\shared-access\backups\ec10-crm\`.
- A chave está fora do repositório, em `/etc/ec10-crm-backup.key` no Oracle e `C:\Users\Admin\.codex\shared-access\secrets\ec10-crm-backup.key` no PC. Perder as duas cópias da chave inviabiliza a restauração.
- Ainda falta automatizar o envio diário para um segundo local independente do Oracle e testar uma restauração completa em banco isolado. Portanto, a contingência de backup ainda não está concluída.

## Lacunas que impedem o corte de produção

1. O gateway cobre autenticação por senha e REST/PostgREST; `storage/v1`, `functions/v1`, realtime, convites e recuperação de senha ainda não estão implementados. Essas rotas retornam manutenção, em vez de falharem silenciosamente.
2. A interface de emergência usa uma cópia mecânica do bundle publicado. Ela precisa ser substituída por uma compilação de fonte versionada antes do corte oficial.
3. Foi testada uma identidade temporária. Falta um teste assistido com uma conta real de vendedor e de superadministrador, sem expor senhas ao operador.
4. Falta validar os fluxos de leads, funil, agenda, WhatsApp e arquivos ponta a ponta na interface de emergência.
5. Falta revisar os privilégios da credencial PostgreSQL usada pelos dois serviços Oracle e testar recuperação/rollback.
6. O endereço oficial `/crm` continua dependente do Supabase bloqueado. Não fazer redirecionamento global do site; qualquer corte deve ser limitado a `/crm` e testado em preview.

## Operação e rollback

- Verificação de saúde: `https://crm-api.147-15-27-235.nip.io/health/ready`.
- O script de instalação está em `deploy/oracle-resilient/install.sh`. Ele preserva o segredo JWT existente ao ser executado novamente e instala o backup apenas quando a chave já existe no servidor.
- O Caddyfile anterior foi preservado no Oracle em `/etc/caddy/Caddyfile.pre-crm-preview-20260921`.
- Nenhuma alteração foi feita nos serviços de WhatsApp/Gustavo nem nas campanhas Meta nesta recuperação.
