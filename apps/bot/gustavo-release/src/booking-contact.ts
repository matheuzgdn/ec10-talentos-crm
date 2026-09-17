export function parseBookingContactName(body:string|null|undefined):string|null {
  const name=(body||'').trim().replace(/^(?:meu nome [ée]|me chamo|o nome (?:do respons[aá]vel|dele|dela) [ée]|(?:meu pai|minha m[aã]e) (?:se chama|[ée]))\s*/i,'').replace(/\s+/g,' ');
  if(name.length<5||name.length>100||!/^[\p{L}][\p{L}'’-]*(?: [\p{L}][\p{L}'’-]*){1,7}$/u.test(name))return null;
  if(/\b(?:quero|duvida|dúvida|valor|valores|preço|preco|horario|horário|agenda|agendar|obrigado|sim|nao|não|bom dia|boa tarde|boa noite|atleta|responsável|responsavel|humano|atendente)\b/i.test(name))return null;
  return name;
}
