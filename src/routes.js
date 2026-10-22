import express, { Router } from 'express';
import * as repo from './transcriptions.js';
import { config } from './config.js';

export const api = Router();

// Parsed inside the router so malformed JSON reaches the error handler below.
api.use(express.json({ limit: '1mb' }));

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new repo.ValidationError('id must be a positive integer');
  return id;
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max);
}

api.get('/health', (_req, res) => res.json({ ok: true }));

api.get('/config', (_req, res) => {
  res.json({ geminiConfigured: Boolean(config.geminiApiKey), model: config.geminiModel });
});

api.get('/stats', async (_req, res) => {
  res.json(await repo.stats());
});

api.get('/transcriptions', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const limit = clampInt(req.query.limit, 10, 1, 100);
  res.json(await repo.list({ q, page, limit }));
});

api.get('/transcriptions/:id', async (req, res) => {
  const row = await repo.get(parseId(req.params.id));
  if (!row) return res.status(404).json({ error: 'Transcription not found' });
  res.json(row);
});

api.post('/transcriptions', async (req, res) => {
  const row = await repo.create(repo.validate(req.body, { partial: false }));
  res.status(201).json(row);
});

api.put('/transcriptions/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const row = await repo.update(id, repo.validate(req.body, { partial: true }));
  if (!row) return res.status(404).json({ error: 'Transcription not found' });
  res.json(row);
});

api.delete('/transcriptions/:id', async (req, res) => {
  const deleted = await repo.remove(parseId(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Transcription not found' });
  res.status(204).end();
});

// Express 5 forwards rejected promises here.
api.use((err, _req, res, _next) => {
  if (err instanceof repo.ValidationError) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error('[api]', err);
  res.status(500).json({ error: 'Internal server error' });
});
