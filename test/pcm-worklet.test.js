import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal AudioWorkletGlobalScope stub so the processor can run under Node.
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { messages: [], postMessage(m) { this.messages.push(m); } }; } };
globalThis.registerProcessor = (_name, cls) => { Processor = cls; };
await import('../public/js/pcm-worklet.js');

test('downsamples 48 kHz input to 100 ms chunks of 16 kHz PCM16', () => {
  const p = new Processor();
  const block = new Float32Array(128);
  let t = 0;
  // 1 second of a 440 Hz tone at half amplitude, in 128-sample render quanta.
  for (let n = 0; n < 48000 / 128; n++) {
    for (let i = 0; i < 128; i++, t++) block[i] = 0.5 * Math.sin((2 * Math.PI * 440 * t) / 48000);
    p.process([[block]]);
  }
  const chunks = p.port.messages;
  assert.equal(chunks.length, 10);
  for (const { pcm, level } of chunks) {
    const samples = new Int16Array(pcm);
    assert.equal(samples.length, 1600);
    assert.ok(Math.max(...samples) > 15000 && Math.max(...samples) <= 0x7fff);
    assert.ok(level > 0.3 && level < 0.4); // RMS of a 0.5 sine ≈ 0.354
  }
});
