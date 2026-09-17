import fs from 'node:fs';
import path from 'node:path';
import { transcribeAudioWithAi } from '../apps/bot/dist/ai.js';

const audioPath = path.resolve(process.argv[2] || '');
if (!audioPath || !fs.existsSync(audioPath)) throw new Error('Informe um arquivo de audio existente.');

const extension = path.extname(audioPath).toLowerCase();
const mimeType = extension === '.mp3' ? 'audio/mpeg'
  : extension === '.wav' ? 'audio/wav'
    : extension === '.m4a' ? 'audio/mp4'
      : 'audio/ogg';
const transcript = await transcribeAudioWithAi({
  base64Data: fs.readFileSync(audioPath).toString('base64'),
  mimeType,
});

if (!transcript || transcript.length < 8) throw new Error('A IA nao conseguiu transcrever o audio de teste.');
console.log(JSON.stringify({
  audioTranscription: true,
  characters: transcript.length,
  preview: transcript.slice(0, 140),
}));
