// AudioWorklet: converts the microphone stream (any sample rate) into 16 kHz mono PCM16
// chunks of 100 ms, which is the format the Gemini Live API expects.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // input samples per output sample
    this.pos = 0; // fractional read position inside the current input block
    this.buf = new Int16Array(CHUNK_SAMPLES);
    this.len = 0;
    this.energy = 0;
    this.count = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    while (this.pos < ch.length) {
      // Average the input samples covered by this output sample (cheap low-pass), then quantise.
      const start = Math.floor(this.pos);
      const end = Math.min(ch.length, Math.max(start + 1, Math.floor(this.pos + this.step)));
      let sum = 0;
      for (let i = start; i < end; i++) sum += ch[i];
      const s = Math.max(-1, Math.min(1, sum / (end - start)));

      this.buf[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.energy += s * s;
      this.count++;

      if (this.len === CHUNK_SAMPLES) {
        const level = Math.sqrt(this.energy / this.count);
        this.port.postMessage({ pcm: this.buf.buffer, level }, [this.buf.buffer]);
        this.buf = new Int16Array(CHUNK_SAMPLES);
        this.len = 0;
        this.energy = 0;
        this.count = 0;
      }
      this.pos += this.step;
    }
    this.pos -= ch.length;
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
