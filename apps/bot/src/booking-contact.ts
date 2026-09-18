export function parseBookingContactName(body:string|null|undefined):string|null {
  const name=(body||'').trim().replace(/^(?:meu nome [ée]|me chamo|o nome (?:do respons[aá]vel|dele|dela) [ée]|(?:meu pai|minha m[aã]e) (?:se chama|[ée]))\s*/i,'').replace(/\s+/g,' ');
  if(name.length<5||name.length>100||!/^[\p{L}][\p{L}'’-]*(?: [\p{L}][\p{L}'’-]*){1,7}$/u.test(name))return null;
  if(/\b(?:quero|duvida|dúvida|valor|valores|preço|preco|horario|horário|agenda|agendar|obrigado|sim|nao|não|bom dia|boa tarde|boa noite|atleta|responsável|responsavel|humano|atendente)\b/i.test(name))return null;
  return name;
}

type BookingIdentityMetadata = Record<string, unknown> | null | undefined;

function metadataName(metadata:BookingIdentityMetadata,key:string) {
  return parseBookingContactName(typeof metadata?.[key]==='string'?String(metadata[key]):'');
}

function looseMetadataName(metadata:BookingIdentityMetadata,key:string) {
  const value=typeof metadata?.[key]==='string'?String(metadata[key]).trim().replace(/\s+/g,' '):'';
  return /^[\p{L}][\p{L}'’-]*(?: [\p{L}][\p{L}'’-]*){0,7}$/u.test(value)?value:null;
}

export function selectBookingContactName(input:{
  metadata:BookingIdentityMetadata;
  minor:boolean;
  responsibleRole:boolean;
}) {
  const athleteName=looseMetadataName(input.metadata,'athleteName');
  const candidates=input.minor||input.responsibleRole
    ? [
        metadataName(input.metadata,'bookingContactName'),
        metadataName(input.metadata,'responsibleName'),
        metadataName(input.metadata,'guardianName'),
        ...(input.responsibleRole ? [metadataName(input.metadata,'leadName')] : []),
      ]
    : [metadataName(input.metadata,'bookingContactName'),metadataName(input.metadata,'leadName')];
  const athleteKey=athleteName?.toLocaleLowerCase('pt-BR');
  return candidates.find(name=>{
    if(!name||!athleteKey)return Boolean(name);
    const candidateKey=name.toLocaleLowerCase('pt-BR');
    return candidateKey!==athleteKey&&!candidateKey.startsWith(`${athleteKey} `)&&!athleteKey.startsWith(`${candidateKey} `);
  })||null;
}
