// WebSocket bridge: browser microphone (PCM16 @ 16 kHz) -> Gemini Live API -> live transcript.
//
// The API key never leaves the server. Client protocol on /ws/transcribe:
//   client -> server  text   {"type":"start","language":"auto|hi-en|en|hi"}
//                     binary raw little-endian PCM16 mono 16 kHz audio
//                     text   {"type":"stop"}
//   server -> client  {"type":"ready"} | {"type":"transcript","text":"..."} |
//                     {"type":"turn_complete"} | {"type":"stopped"} | {"type":"error","message":"..."}
import { GoogleGenAI, Modality } from '@google/genai';
import { WebSocketServer } from 'ws';
import { config } from './config.js';

const LANGUAGE_HINTS = {
  auto: 'The speaker may use any language, and may mix languages within one sentence.',
  'hi-en': 'The speaker mixes Hindi and English (Hinglish) within the same sentence. Keep English words in Latin script and Hindi words in Devanagari.',
  en: 'The speaker is speaking English (possibly Indian-accented).',
  hi: 'The speaker is speaking Hindi.',
};

// BCP-47 hints for the input-transcription ASR; omitted for "auto" (automatic detection).
// Omitted for "auto" and for Hinglish: whenever hi-IN is among the hints, English speech comes back
// transliterated into Devanagari ("हेलो एवरीवन"), so mixed speech relies on auto-detection.
const LANGUAGE_CODES = { en: ['en-IN'], hi: ['hi-IN'] };

const MAX_QUEUED_CHUNKS = 200; // ~20 s of audio buffered while the Gemini session is opening
const DRAIN_MS = 1500; // wait for trailing transcript after the user stops

const ai = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

function liveConfig(language) {
  return {
    // Native-audio Live models only emit AUDIO; we ignore the spoken reply and use the input transcript.
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: LANGUAGE_CODES[language] ? { languageCodes: LANGUAGE_CODES[language] } : {},
    systemInstruction:
      'You are a silent speech transcription service. Never answer, translate or comment on what you hear; ' +
      `if you must respond, say only "ok". ${LANGUAGE_HINTS[language] ?? LANGUAGE_HINTS.auto}`,
    realtimeInputConfig: {
      automaticActivityDetection: { silenceDurationMs: 600 },
    },
  };
}

class LiveBridge {
  constructor(ws) {
    this.ws = ws;
    this.session = null;
    this.connecting = false;
    this.queue = [];
    this.stopping = false;

    ws.on('message', (data, isBinary) => (isBinary ? this.onAudio(data) : this.onControl(data)));
    ws.on('close', () => this.closeSession());
    ws.on('error', () => this.closeSession());
  }

  send(msg) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onControl(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return this.send({ type: 'error', message: 'Invalid control message' });
    }
    if (msg.type === 'start') this.start(msg.language);
    else if (msg.type === 'stop') this.stop();
  }

  onAudio(data) {
    if (this.stopping) return;
    if (this.session) this.sendAudio(data);
    else if (this.connecting && this.queue.length < MAX_QUEUED_CHUNKS) this.queue.push(data);
  }

  sendAudio(data) {
    try {
      this.session.sendRealtimeInput({
        audio: { data: Buffer.from(data).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
      });
    } catch (err) {
      this.send({ type: 'error', message: `Failed to stream audio: ${err.message}` });
    }
  }

  async start(language) {
    if (this.session || this.connecting) return;
    if (!ai) {
      return this.send({
        type: 'error',
        message: 'GEMINI_API_KEY is not configured on the server. Add it to .env or switch to the Browser engine.',
      });
    }

    this.connecting = true;
    this.stopping = false;
    try {
      const session = await ai.live.connect({
        model: config.geminiModel,
        config: liveConfig(language),
        callbacks: {
          onmessage: (m) => this.onGeminiMessage(m),
          onerror: (e) => this.send({ type: 'error', message: `Gemini error: ${e.message ?? 'unknown'}` }),
          onclose: (e) => {
            const wasActive = this.session && !this.stopping;
            this.session = null;
            if (wasActive) this.send({ type: 'error', message: `Gemini session closed: ${e.reason || 'no reason given'}` });
          },
        },
      });

      // The browser may have stopped or disconnected while we were connecting.
      if (this.stopping || this.ws.readyState !== this.ws.OPEN) return session.close();

      this.session = session;
      for (const chunk of this.queue.splice(0)) this.sendAudio(chunk);
      this.send({ type: 'ready', model: config.geminiModel });
    } catch (err) {
      this.send({ type: 'error', message: `Could not connect to Gemini Live: ${err.message}` });
    } finally {
      this.connecting = false;
      this.queue = [];
    }
  }

  onGeminiMessage(message) {
    const sc = message.serverContent;
    if (sc?.inputTranscription?.text) this.send({ type: 'transcript', text: sc.inputTranscription.text });
    if (sc?.turnComplete) this.send({ type: 'turn_complete' });
    if (message.goAway) this.send({ type: 'error', message: 'Gemini session is ending soon (time limit reached).' });
  }

  stop() {
    this.stopping = true;
    if (!this.session) return this.send({ type: 'stopped' });
    try {
      this.session.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      // session already gone
    }
    setTimeout(() => {
      this.closeSession();
      this.send({ type: 'stopped' });
    }, DRAIN_MS);
  }

  closeSession() {
    const session = this.session;
    this.session = null;
    this.queue = [];
    try {
      session?.close();
    } catch {
      // ignore
    }
  }
}

export function attachLiveTranscription(server) {
  const wss = new WebSocketServer({ server, path: '/ws/transcribe', maxPayload: 1024 * 1024 });
  wss.on('connection', (ws) => new LiveBridge(ws));
  return wss;
}
