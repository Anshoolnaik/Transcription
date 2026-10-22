# Speech to Text — Real-time Multilingual Transcription

A web app where you speak, in Hindi, English, or a mix of both (Hinglish), and the words are transcribed **live** as you talk. Each transcription can be saved to **PostgreSQL**. A dashboard shows the history with full **CRUD** (create, read, update, delete), search, pagination and stats, and any transcript can be read back aloud with **text to speech**.

| Concern | Choice |
| --- | --- |
| Backend | Node.js 20+, Express 5, `ws` WebSocket server |
| Speech to text | **Gemini Live API** (`gemini-3.1-flash-live-preview`, free tier) via `@google/genai`, streamed through the server. The fallback is the browser's built-in Web Speech API |
| Database | PostgreSQL (any: local, Docker, Neon, Supabase, RDS) via `pg` |
| Text to speech | Browser `speechSynthesis` (OS voices, no API key needed). It automatically picks a Hindi voice for Devanagari text |
| Frontend | Plain HTML, CSS and ES modules with an `AudioWorklet` for audio capture. No build step |

## Architecture

```
 Browser                                   Node server                         Google
 ┌──────────────────────────┐   WebSocket  ┌──────────────────────────┐  Live API  ┌──────────────┐
 │ mic → AudioWorklet       │  PCM16 16kHz │ /ws/transcribe           │ (WebSocket)│ Gemini 3.1   │
 │ (resample → 100ms chunks)│ ───────────▶ │ LiveBridge               │ ─────────▶ │ Flash Live   │
 │                          │ ◀─────────── │  forwards inputTranscript│ ◀───────── │ input        │
 │ live transcript textarea │  JSON deltas │                          │            │ transcription│
 │                          │              │ REST /api/transcriptions │            └──────────────┘
 │ dashboard (CRUD, search) │ ◀──────────▶ │  Express + pg            │ ──▶ PostgreSQL
 └──────────────────────────┘              └──────────────────────────┘
```

* The browser captures the microphone with an `AudioWorklet`, downsamples to **16 kHz mono 16-bit PCM**, and sends a binary WebSocket frame every 100 ms.
* The server opens a Gemini Live session with `inputAudioTranscription` enabled. For Hinglish the server uses automatic language detection, because passing `hi-IN` as a hint makes Gemini write English speech in Devanagari. The system prompt asks Gemini to keep English words in Latin script and Hindi words in Devanagari. The single-language modes send `en-IN` or `hi-IN` as a hint. The server relays each transcript fragment to the browser as it arrives. **The API key never reaches the browser.**
* Audio that arrives while the Gemini session is still opening is buffered, so the first words aren't lost. On **Stop**, the server sends `audioStreamEnd` and waits briefly for the last words before closing the session.
* When you press **Save**, the transcript (which you can edit first), its language, engine, duration and word count are written to the `transcriptions` table.

## Getting started

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#   GEMINI_API_KEY  – free key from https://aistudio.google.com/apikey
#   DATABASE_URL    – any PostgreSQL connection string

# 3. Run (creates the table automatically on start)
npm start
# → http://localhost:3000
```

Open the app in Chrome or Edge and allow microphone access. Choose **Hindi + English**, press **Start recording**, and speak, for example: *"Kal meeting hai at 10 AM, please sab log time pe aana."*

If `GEMINI_API_KEY` is not set, the app still works with the **Browser Web Speech** engine (Chrome/Edge). The status pill in the header shows which engine is active.

Need a local Postgres quickly?

```bash
docker run -d --name stt-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=speech_to_text -p 5432:5432 postgres:17
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload on file changes |
| `npm run db:init` | Apply [db/schema.sql](db/schema.sql) without starting the server |
| `npm test` | Unit tests (validation and the PCM resampler) |

## Deployment: frontend on Vercel, backend on Render

The frontend in `public/` is plain static files. The backend serves the REST API and the transcription WebSocket. Both are deployed from this repo.

**1. Backend on Render**

1. In Render, choose **New → Blueprint**, pick this repo, and Render reads [render.yaml](render.yaml). Or create a **Web Service** by hand with build command `npm ci` and start command `npm start`.
2. Set the secret environment variables:
   - `DATABASE_URL`: your PostgreSQL connection string (Neon)
   - `GEMINI_API_KEY`: your Gemini key
   - `ALLOWED_ORIGINS`: your Vercel URL, for example `https://speech-to-text.vercel.app`. Fill this in after step 2; separate multiple URLs with commas.
3. Deploy, then open `https://<your-service>.onrender.com/api/health`. It should return `{"ok":true}`.

**2. Frontend on Vercel**

1. In [public/config.js](public/config.js), set `RENDER_URL` to your Render URL, then commit and push.
2. In Vercel, choose **Add New → Project**, import this repo, and set **Root Directory** to `public`. Use Framework Preset **Other** and leave the build command empty.
3. Deploy, then put the resulting `https://….vercel.app` URL into `ALLOWED_ORIGINS` on Render. Render redeploys automatically.

The backend only accepts browser requests and WebSocket connections from its own origin and from `ALLOWED_ORIGINS`, so other websites can't use your Gemini key through it. On Render's free plan the service sleeps after about 15 minutes idle. The first visit afterwards takes up to a minute, and the page shows "Waking up server…" while it waits.

## Database schema

```sql
CREATE TABLE transcriptions (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200)  NOT NULL,
    content          TEXT          NOT NULL,
    language         VARCHAR(50)   NOT NULL DEFAULT 'auto',        -- hi-en | auto | en | hi
    engine           VARCHAR(40)   NOT NULL DEFAULT 'gemini-live', -- gemini-live | browser-web-speech
    duration_seconds NUMERIC(10,2) NOT NULL DEFAULT 0,
    word_count       INTEGER       NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
```

## REST API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/transcriptions?q=&page=1&limit=10` | List with search (title/text) and pagination → `{ items, total, page, limit }` |
| `GET` | `/api/transcriptions/:id` | Get one |
| `POST` | `/api/transcriptions` | Create. Body: `{ content, title?, language?, engine?, duration_seconds? }` |
| `PUT` | `/api/transcriptions/:id` | Update. Body: any of `{ title, content, language }` |
| `DELETE` | `/api/transcriptions/:id` | Delete → `204` |
| `GET` | `/api/stats` | `{ total, words, seconds }` |
| `GET` | `/api/config` | Whether Gemini is configured, and the model name |

Validation errors return `400 { error }`, and missing records return `404`.

### WebSocket `/ws/transcribe`

| Direction | Message |
| --- | --- |
| client → server | `{"type":"start","language":"hi-en"}`, then binary PCM16 / 16 kHz / mono frames, then `{"type":"stop"}` |
| server → client | `{"type":"ready"}`, `{"type":"transcript","text":"…"}` (incremental), `{"type":"turn_complete"}`, `{"type":"stopped"}`, `{"type":"error","message":"…"}` |

## Project structure

```
src/
  server.js          HTTP server, static files, schema bootstrap
  config.js          env configuration
  db.js              pg pool + schema init
  transcriptions.js  validation + SQL for CRUD/search/stats
  routes.js          REST endpoints
  live.js            WebSocket ↔ Gemini Live bridge
public/
  index.html, css/style.css
  js/app.js          UI: recorder, dashboard, dialogs
  js/engines.js      Gemini Live engine + Web Speech fallback
  js/pcm-worklet.js  mic → 16 kHz PCM16 AudioWorklet
  js/tts.js          text to speech
  js/api.js          REST client
db/schema.sql
test/
```

## Notes and limits

* Gemini Live audio-only sessions are limited to about 15 minutes. The UI shows a message if the server ends a session.
* The Gemini 3.1 Live model is a native-audio model, so it always produces a spoken reply. The server tells it to stay silent and discards any audio it returns; only the *input* transcription is used.
* To use a different Live model, set `GEMINI_MODEL` in `.env`.
