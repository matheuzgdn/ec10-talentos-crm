export function bookingProgramLabel(service:string,age?:number|null) {
  if(service==='plano_carreira')return 'Plano de Carreira';
  if(service==='plano_internacional')return 'Plano Internacional';
  return age&&age>=8&&age<=13?'Eurokids / Sudakids':'Eurocamp';
}
