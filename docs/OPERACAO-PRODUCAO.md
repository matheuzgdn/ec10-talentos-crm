# Operacao de producao

## Modelo de acesso

- GitHub: colaborador individual, com branch e pull request.
- Oracle: usuario Linux individual e chave SSH publica propria.
- Segredos: permanecem no servidor e nunca entram no repositorio.
- Banco: mudancas estruturais somente por migration versionada.
- WhatsApp: a sessao ativa nao deve ser copiada ou baixada.

## Publicacao segura

1. Atualize a branch `main` no servidor.
2. Instale dependencias com `npm ci` quando o lockfile mudar.
3. Execute `npm run typecheck` e `npm run build`.
4. Rode os testes do Gustavo sem habilitar envio real.
5. Reinicie somente o servico do bot.
6. Confira health, logs recentes, fila e guardiao.
7. Se a validacao falhar, restaure a versao anterior do codigo; nao apague a sessao do WhatsApp.

As unidades em `deploy/` documentam o bot e o guardiao. Endereco do servidor, usuario concedido e chave ficam fora deste repositorio e sao entregues ao colaborador por canal privado.

