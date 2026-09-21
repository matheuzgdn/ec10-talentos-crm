# EC10 Oracle CRM Gateway

Camada de contingência do CRM. Mantém autenticação e acesso PostgREST fora da cota de API do Supabase, usando a conexão PostgreSQL direta e as políticas RLS existentes.

## Serviços

- `ec10-crm-gateway`: autenticação compatível com `supabase-js`, CORS, limitação de tentativas e proxy controlado.
- `ec10-postgrest`: API REST com paginação máxima e as funções/roles já existentes no banco.

O estado verificado, a cópia de emergência, os backups e os bloqueios de corte estão em `docs/CRM-RESILIENCE-2026-09-21.md` na raiz do repositório. Esta camada ainda não implementa Storage, Edge Functions nem realtime.

## Variáveis

- `DATABASE_URL`
- `JWT_SECRET`
- `GATEWAY_PUBLIC_ORIGIN`
- `POSTGREST_ORIGIN`
- `ALLOWED_ORIGINS`

Segredos não pertencem ao repositório. Em produção ficam no arquivo protegido do systemd.
