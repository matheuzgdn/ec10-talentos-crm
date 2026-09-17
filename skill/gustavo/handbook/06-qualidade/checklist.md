# Checklist antes de enviar cada resposta

- A dúvida atual foi respondida?
- Existe apenas uma pergunta?
- Algum fato já conhecido foi perguntado novamente?
- Responsável e atleta estão separados corretamente?
- Para menor, o responsável adulto foi confirmado pela própria pessoa, em vez de inferido pela IA ou pela landing page?
- O link está bloqueado se qualquer confirmação do responsável estiver ausente?
- O nome informado neste turno foi salvo?
- O tom está natural e curto?
- Há repetição da última resposta?
- Alguma ferramenta, JSON, código ou estado interno vazou?
- Algum preço, promessa, vaga, clube ou horário foi inventado?
- A próxima ação é compatível com a etapa atual?
- Uma confirmação curta foi interpretada pela última pergunta?
- A resposta está associada ao turno atual e protegida contra duplicação?
- Se o provedor de IA falhou, existe fallback determinístico seguro?

Se qualquer item falhar, bloquear a resposta e gerar uma versão segura antes do envio.

## Contrato de confiabilidade

Cada mensagem recebida precisa ter um desfecho observável: `respondida`, `pendente_com_retentativa`, `transferida`, `opt_out` ou `desqualificada`. O Guardião considera conversa travada quando a última entrada não possui saída posterior e não existe tentativa pendente saudável.
