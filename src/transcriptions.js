// Data access + validation for the transcriptions table.
import { pool } from './db.js';

const COLUMNS = 'id, title, content, language, engine, duration_seconds::float AS duration_seconds, word_count, created_at, updated_at';

export class ValidationError extends Error {}

export function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function defaultTitle(content) {
  const firstLine = content.trim().split('\n')[0];
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

function optionalString(value, field, max) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return trimmed;
}

/** Validates a create (partial = false) or update (partial = true) payload. */
export function validate(body, { partial }) {
  if (!body || typeof body !== 'object') throw new ValidationError('Request body must be a JSON object');

  const content = optionalString(body.content, 'content', 100_000);
  const title = optionalString(body.title, 'title', 200);
  const language = optionalString(body.language, 'language', 50);
  const engine = optionalString(body.engine, 'engine', 40);

  if (!partial && !content) throw new ValidationError('content is required');
  if (partial && content === '') throw new ValidationError('content cannot be empty');
  if (partial && title === '') throw new ValidationError('title cannot be empty');

  let duration;
  if (body.duration_seconds !== undefined) {
    duration = Number(body.duration_seconds);
    if (!Number.isFinite(duration) || duration < 0) throw new ValidationError('duration_seconds must be a non-negative number');
  }

  return { content, title, language, engine, duration };
}

export async function list({ q = '', page = 1, limit = 10 }) {
  const params = [];
  let where = '';
  if (q) {
    params.push(`%${q}%`);
    where = 'WHERE title ILIKE $1 OR content ILIKE $1';
  }
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM transcriptions ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM transcriptions ${where}`, params),
  ]);
  return { items: rows.rows, total: total.rows[0].n, page, limit };
}

export async function stats() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(SUM(word_count), 0)::int AS words,
            COALESCE(SUM(duration_seconds), 0)::float AS seconds
       FROM transcriptions`,
  );
  return rows[0];
}

export async function get(id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM transcriptions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function create(data) {
  const { rows } = await pool.query(
    `INSERT INTO transcriptions (title, content, language, engine, duration_seconds, word_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [
      data.title || defaultTitle(data.content),
      data.content,
      data.language || 'auto',
      data.engine || 'gemini-live',
      data.duration ?? 0,
      countWords(data.content),
    ],
  );
  return rows[0];
}

export async function update(id, data) {
  const { rows } = await pool.query(
    `UPDATE transcriptions
        SET title      = COALESCE($2, title),
            content    = COALESCE($3, content),
            language   = COALESCE($4, language),
            word_count = COALESCE($5, word_count),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, data.title ?? null, data.content ?? null, data.language ?? null, data.content ? countWords(data.content) : null],
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  const { rowCount } = await pool.query('DELETE FROM transcriptions WHERE id = $1', [id]);
  return rowCount > 0;
}
