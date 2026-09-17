import assert from 'node:assert/strict';
for (const service of ['plano_carreira', 'plano_internacional', 'eurocamp']) {
 const response = await fetch(`https://cliente-whatsapp-crm.vercel.app/api/booking?service=${service}`);
 const data = await response.json();
 assert.equal(response.status, 200);
 assert.ok(Array.isArray(data.slots) && data.slots.length > 0, 'No public availability');
 assert.equal(new Set(data.slots.map(s => s.startsAt)).size, data.slots.length, 'Duplicate customer hours');
 for (const slot of data.slots) {
  const local = new Date(new Date(slot.startsAt).getTime() - 3 * 3600000);
  const day=local.getUTCDay()||7,hour=local.getUTCHours(),seller=String(slot.sellerName||'').toLowerCase();
  if(seller.includes('pablo')) assert.ok(hour>=8&&hour<20);
  else if(seller.includes('augustin')||seller.includes('agustin')) assert.ok(hour>=14&&hour<19);
  else if(seller.includes('joao')||seller.includes('joão')) assert.ok(day<=5&&hour>=(day===2||day===4?15:14)&&hour<22);
  else assert.ok(day<=5&&hour>=8&&hour<=17);
  assert.equal(new Date(slot.endsAt) - new Date(slot.startsAt), 3600000);
 }
 console.log(JSON.stringify({service, publicHours: data.slots.length, firstStart: data.slots[0].startsAt, sellerSchedulesValid: true, duplicateHours: false, reservationsCreated: 0}));
}
