// Speech-to-text engines. Both expose the same interface:
//   const engine = createEngine(kind, handlers); await engine.start(language); await engine.stop();
// handlers: onText(delta) for final text, onTurn() at the end of an utterance, onInterim(text), onLevel(0..1), onReady(info), onError(message)

const noop = () => {};

/** Streams 16 kHz PCM16 microphone audio to our server, which relays it to Gemini Live. */
class GeminiLiveEngine {
  constructor(handlers) {
    this.h = handlers;
    this.stopping = false;
  }

  async start(language) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/transcribe`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('Could not connect to the transcription server'));
    });

    ws.onmessage = (event) => this.onServerMessage(JSON.parse(event.data));
    ws.onclose = () => {
      if (!this.stopping) this.h.onError('Connection to the transcription server was lost');
      this.releaseAudio();
    };
    ws.send(JSON.stringify({ type: 'start', language }));

    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('/js/pcm-worklet.js');
    const source = this.ctx.createMediaStreamSource(this.stream);
    const capture = new AudioWorkletNode(this.ctx, 'pcm-capture');
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // keep the graph pulled without echoing the mic to the speakers
    source.connect(capture).connect(mute).connect(this.ctx.destination);

    capture.port.onmessage = ({ data }) => {
      this.h.onLevel(data.level);
      if (ws.readyState === WebSocket.OPEN && !this.stopping) ws.send(data.pcm);
    };
  }

  onServerMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.h.onReady(msg);
        break;
      case 'transcript':
        this.h.onText(msg.text);
        break;
      case 'turn_complete':
        this.h.onTurn();
        break;
      case 'stopped':
        this.resolveStopped?.();
        break;
      case 'error':
        this.h.onError(msg.message);
        break;
    }
  }

  releaseAudio() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
    this.ctx = null;
    this.h.onLevel(0);
  }

  async stop() {
    this.stopping = true;
    this.releaseAudio();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Give the server a moment to flush the final words before closing.
    await new Promise((resolve) => {
      this.resolveStopped = resolve;
      setTimeout(resolve, 4000);
      ws.send(JSON.stringify({ type: 'stop' }));
    });
    ws.close();
  }
}

const BROWSER_LANG = { 'hi-en': 'en-IN', en: 'en-US', hi: 'hi-IN', auto: navigator.language || 'en-IN' };

/** Fallback using the browser's built-in SpeechRecognition (Chrome / Edge). */
class BrowserSpeechEngine {
  constructor(handlers) {
    this.h = handlers;
    this.active = false;
  }

  static get Recognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  async start(language) {
    const Recognition = BrowserSpeechEngine.Recognition;
    if (!Recognition) throw new Error('This browser does not support the Web Speech API. Use Chrome/Edge or the Gemini engine.');

    const rec = new Recognition();
    rec.lang = BROWSER_LANG[language] ?? 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) this.h.onText(`${result[0].transcript.trim()} `);
        else interim += result[0].transcript;
      }
      this.h.onInterim(interim);
      this.h.onLevel(interim ? 0.25 : 0);
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.active = false;
      this.h.onError(`Speech recognition error: ${event.error}`);
    };
    // Chrome ends continuous sessions after a pause; restart while the user is still recording.
    rec.onend = () => {
      if (this.active) rec.start();
    };

    this.rec = rec;
    this.active = true;
    rec.start();
    this.h.onReady({ model: `Web Speech (${rec.lang})` });
  }

  async stop() {
    this.active = false;
    this.rec?.stop();
    this.h.onInterim('');
    this.h.onLevel(0);
  }
}

export function createEngine(kind, handlers) {
  const h = { onText: noop, onTurn: noop, onInterim: noop, onLevel: noop, onReady: noop, onError: noop, ...handlers };
  return kind === 'browser' ? new BrowserSpeechEngine(h) : new GeminiLiveEngine(h);
}

export const browserSpeechSupported = () => Boolean(BrowserSpeechEngine.Recognition);
