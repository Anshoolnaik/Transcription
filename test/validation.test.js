import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
const { validate, countWords, ValidationError } = await import('../src/transcriptions.js');
const { pool } = await import('../src/db.js');
test.after(() => pool.end());

test('countWords handles mixed Hindi + English', () => {
  assert.equal(countWords('Kal meeting hai, कृपया समय पर आना.'), 7);
  assert.equal(countWords('   '), 0);
});

test('create requires content', () => {
  assert.throws(() => validate({}, { partial: false }), ValidationError);
  assert.throws(() => validate({ content: '   ' }, { partial: false }), ValidationError);
  assert.equal(validate({ content: ' hello ' }, { partial: false }).content, 'hello');
});

test('update allows partial payloads but not blank fields', () => {
  assert.deepEqual(validate({ title: 'New' }, { partial: true }).title, 'New');
  assert.throws(() => validate({ title: '' }, { partial: true }), ValidationError);
  assert.throws(() => validate({ content: ' ' }, { partial: true }), ValidationError);
});

test('rejects wrong types and bad durations', () => {
  assert.throws(() => validate({ content: 42 }, { partial: false }), ValidationError);
  assert.throws(() => validate({ content: 'x', duration_seconds: -1 }, { partial: false }), ValidationError);
  assert.throws(() => validate({ content: 'x', title: 'a'.repeat(201) }, { partial: false }), ValidationError);
});
