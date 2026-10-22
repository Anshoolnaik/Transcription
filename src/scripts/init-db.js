import { initSchema, pool } from '../db.js';

try {
  await initSchema();
  console.log('Schema applied.');
} catch (err) {
  console.error('Failed to apply schema:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
