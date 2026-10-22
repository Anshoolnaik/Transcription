import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FinalTextTracker } from '../public/js/speech-dedupe.js';

const final = (t) => ({ isFinal: true, 0: { transcript: t } });
const interim = (t) => ({ isFinal: false, 0: { transcript: t } });

/** Feeds a sequence of event.results snapshots and returns the full emitted text. */
function run(events) {
  const tracker = new FinalTextTracker();
  return events.map((results) => tracker.update(results).fresh).filter(Boolean).join(' ');
}

test('desktop: each final result emitted once', () => {
  assert.equal(
    run([[interim('kal')], [final('kal meeting hai')], [final('kal meeting hai'), interim('please')], [final('kal meeting hai'), final('please aana')]]),
    'kal meeting hai please aana',
  );
});

test('android: same final re-sent in later events', () => {
  assert.equal(run([[final('hello there')], [final('hello there')], [final('hello there')]]), 'hello there');
});

test('android: cumulative result at the same index', () => {
  assert.equal(run([[final('kal')], [final('kal meeting')], [final('kal meeting hai')]]), 'kal meeting hai');
});

test('android: cumulative result repeated as a new index', () => {
  assert.equal(run([[final('kal meeting'), final('kal meeting hai at 10')]]), 'kal meeting hai at 10');
  assert.equal(run([[final('hello there'), final('hello there')]]), 'hello there');
});

test('android: result list restarts with a new utterance', () => {
  assert.equal(run([[final('first sentence')], [final('second sentence')]]), 'first sentence second sentence');
});

test('ignores case and trailing punctuation when comparing; Hindi works', () => {
  assert.equal(run([[final('Kal meeting.')], [final('kal meeting hai')]]), 'Kal meeting. hai');
  assert.equal(run([[final('मेरा नाम')], [final('मेरा नाम राहुल है।')]]), 'मेरा नाम राहुल है।');
});

test('reset starts a fresh session', () => {
  const tracker = new FinalTextTracker();
  assert.equal(tracker.update([final('yes')]).fresh, 'yes');
  tracker.reset();
  assert.equal(tracker.update([final('yes')]).fresh, 'yes');
});

test('returns interim text separately', () => {
  const tracker = new FinalTextTracker();
  assert.deepEqual(tracker.update([final('done'), interim(' next words')]), { fresh: 'done', interim: 'next words' });
});
