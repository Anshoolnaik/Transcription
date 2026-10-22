import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { initSchema } from './db.js';
import { api } from './routes.js';
import { attachLiveTranscription } from './live.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.use('/api', api);
app.use(express.static(publicDir));

const server = http.createServer(app);
attachLiveTranscription(server);

try {
  await initSchema();
} catch (err) {
  console.error('Could not reach the database / apply schema:', err.message);
  process.exit(1);
}

server.listen(config.port, () => {
  console.log(`Speech to Text running on http://localhost:${config.port}`);
  console.log(`Gemini model: ${config.geminiModel}${config.geminiApiKey ? '' : '  (GEMINI_API_KEY missing - only the Browser engine will work)'}`);
});
