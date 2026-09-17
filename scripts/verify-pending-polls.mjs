import { fetchPendingWhatsAppPolls } from '../apps/bot/dist/store.js';
const polls=await fetchPendingWhatsAppPolls();
console.log(JSON.stringify({pendingPolls:polls.length,targetPending:polls.some(p=>p.phone.replace(/\D/g,'').endsWith('94432962'))}));
