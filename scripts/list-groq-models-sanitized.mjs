import {config} from '../apps/bot/dist/config.js';
const response=await fetch(`${config.GROQ_API_BASE_URL}/models`,{headers:{Authorization:`Bearer ${config.GROQ_API_KEY}`}});
const payload=await response.json();
if(!response.ok)throw new Error(`Groq models HTTP ${response.status}`);
console.log(JSON.stringify((payload.data||[]).map(model=>model.id).filter(id=>/llama|gpt|qwen/i.test(id)).sort()));
