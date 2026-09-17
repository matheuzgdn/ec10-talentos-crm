# Publicação segura no Oracle

O painel, as APIs e a agenda são publicados automaticamente pela Vercel quando a branch `main` recebe uma alteração.

O processo persistente do WhatsApp usa o timer `ec10-github-sync.timer`. Ele:

1. lê a versão mais recente da branch `main`;
2. ignora commits que não alteram o runtime do bot;
3. instala e compila em uma pasta de versão isolada;
4. executa typecheck, varredura de segredos e testes antifalhas;
5. troca a versão ativa somente depois dessas validações;
6. reinicia o serviço e exige o estado `ready`;
7. volta automaticamente à versão anterior se a saúde não confirmar.

Dados persistentes, credenciais, sessões do WhatsApp, runtime e backups não ficam no GitHub e não são substituídos durante o deploy.

