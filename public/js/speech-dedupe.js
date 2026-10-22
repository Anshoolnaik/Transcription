// Extracts only new final text from SpeechRecognition results.
//
// Desktop Chrome reports each final result once. Mobile Chrome (Android) often:
//   - re-sends the same final result in later events,
//   - makes a result cumulative ("kal" -> "kal meeting" -> "kal meeting hai"), either at the same
//     index or as a new index that repeats the previous one,
//   - restarts the result list, so an old index holds a brand-new utterance.
// Without this, those come out as doubled and repeated phrases.

const toWords = (text) => text.trim().split(/\s+/u).filter(Boolean);
const norm = (w) => w.toLowerCase().replace(/[.,!?।]+$/u, '');

function startsWith(words, prefix) {
  return prefix.length <= words.length && prefix.every((w, i) => norm(w) === norm(words[i]));
}

/** Returns the words of `next` that are not already covered by `prev`. */
function newWords(prev, next) {
  if (!prev) return next;
  if (startsWith(prev, next)) return []; // repeat (or a shorter restatement)
  if (startsWith(next, prev)) return next.slice(prev.length); // cumulative: keep the extension
  return next; // different utterance
}

export class FinalTextTracker {
  constructor() {
    this.reset();
  }

  /** Call at the start of every recognition session. */
  reset() {
    this.byIndex = new Map(); // result index -> words already emitted for it
  }

  /**
   * @param {ArrayLike<{isFinal: boolean, 0: {transcript: string}}>} results  event.results
   * @returns {{ fresh: string, interim: string }} new final text to append, and current interim text
   */
  update(results) {
    const fresh = [];
    let interim = '';
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result.isFinal) {
        interim += result[0].transcript;
        continue;
      }
      const words = toWords(result[0].transcript);
      // Compare with what this index already produced, or else with the previous final result.
      const prev = this.byIndex.get(i) ?? this.byIndex.get(i - 1);
      fresh.push(...newWords(prev, words));
      this.byIndex.set(i, words);
    }
    return { fresh: fresh.join(' '), interim: interim.trim() };
  }
}
