import assert from 'node:assert/strict';
import {bookingPool} from '../api/_booking-db.ts';
const results=[];
for(const [product,service] of [['carreira','plano_carreira'],['temporada','plano_internacional'],['kids','eurocamp'],['juvenil','eurocamp']]){
 const response=await fetch('https://ec10talentos.com/api/campaign-lead',{
  method:'POST',headers:{'content-type':'application/json',origin:'https://ec10talentos.com'},
  body:JSON.stringify({dryRun:true,role:'responsavel',name:'EC10 QA Dryrun',email:'qa@example.invalid',countryCode:'US',countryDialCode:'1',phone:'+12025550123',productId:product,eventId:'qa-dryrun-'+product})});
 const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.dryRun,true);assert.equal(data.crmDestination,'https://ec10talentos.com/crm');assert.equal(data.serviceInterest,service);
 results.push({product,status:response.status,mainCrm:true,dryRun:true});
}
const bad=await fetch('https://cliente-whatsapp-crm.vercel.app/api/booking?mode=prefill&cadastro='+'Q'.repeat(43));
assert.equal(bad.status,410);assert.ok(bad.headers.get('cache-control').includes('no-store'));
const availability=(await bookingPool.query('select service,count(*)::int as future_slots from whatsapp_bot.ec10_booking_slots where starts_at>now()+make_interval(hours=>2) group by service')).rows;
console.log(JSON.stringify({results,invalidPrivateLinkStatus:bad.status,futureAvailability:availability,registrationsCreated:0,capiEventsSent:0}));
