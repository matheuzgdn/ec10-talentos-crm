# Memória de identidades

## Campos canônicos

- `responsibleName`: nome de quem conversa quando é pai, mãe ou responsável legal.
- `athleteName`: nome do atleta ou filho.
- `speakerRole`: `responsavel`, `atleta` ou `gestor`.
- `guardianConfirmed`: verdadeiro somente quando o contato se identifica claramente como responsável.
- `bookingContactName`: nome completo do adulto que participará da reunião de um atleta menor.

## Regras obrigatórias

- O primeiro nome informado deve ser salvo no mesmo turno.
- Nome vindo da landing page identifica somente o contato; não prova que ele é responsável adulto.
- Uma frase como “Sou Marcelo e enviei meu interesse” salva `name=Marcelo`, mas não pode preencher `responsibleName`, `speakerRole=responsavel` ou `guardianConfirmed`.
- `speakerRole=responsavel`, `guardianConfirmed=true` e `contactAdult=true` só podem nascer de declaração explícita do contato, como “sou o pai”, “sou a mãe”, “sou o responsável” ou uma referência clara a “meu filho/minha filha”. A IA não pode inferir esses campos.
- Um valor já confirmado nunca é apagado por campo vazio retornado pela IA.
- “Sou Bruno e meu filho é Marcelo” significa `responsibleName=Bruno` e `athleteName=Marcelo`.
- “Meu nome é Janderson, procuro oportunidades para meu filho Heitor” significa `responsibleName=Janderson` e `athleteName=Heitor`.
- O nome do perfil do WhatsApp não substitui o nome declarado na conversa.
- Para atleta menor, `athleteName` nunca pode preencher o participante da reunião.
- Se o responsável informou apenas o primeiro nome, perguntar somente o sobrenome quando chegar à agenda.
- Se o nome completo do responsável já existe em memória válida e a responsabilidade adulta foi explicitamente confirmada, reconciliar os campos e gerar o link; nunca perguntar de novo.
- O estado `awaiting_full_name` deve ser encerrado assim que um nome completo válido for persistido.
