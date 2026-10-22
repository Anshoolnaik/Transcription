// Text to speech via the browser's built-in Web Speech synthesis (no API key, works offline
// with OS voices). Picks a Hindi voice when the text contains Devanagari.
const synth = window.speechSynthesis;
let current = null;

const hasDevanagari = (text) => /[ऀ-ॿ]/.test(text);

function pickVoice(lang) {
  const voices = synth.getVoices();
  const prefix = lang.split('-')[0];
  return (
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.replace('_', '-').startsWith(prefix)) ||
    null
  );
}

export const tts = {
  supported: Boolean(synth),

  speaking: () => Boolean(current),

  stop() {
    synth?.cancel();
    current = null;
  },

  /** Speaks text; onEnd fires when finished or cancelled. */
  speak(text, onEnd) {
    if (!synth || !text.trim()) return;
    this.stop();
    const lang = hasDevanagari(text) ? 'hi-IN' : 'en-IN';
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    const done = () => {
      if (current === utterance) current = null;
      onEnd?.();
    };
    utterance.onend = done;
    utterance.onerror = done;
    current = utterance;
    synth.speak(utterance);
  },
};

// Some browsers load voices asynchronously.
synth?.addEventListener?.('voiceschanged', () => synth.getVoices());
