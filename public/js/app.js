import { api } from './api.js';
import { createEngine, browserSpeechSupported } from './engines.js';
import { tts } from './tts.js';

const $ = (id) => document.getElementById(id);
const el = {
  engineStatus: $('engineStatus'), engine: $('engine'), language: $('language'),
  recordBtn: $('recordBtn'), recordLabel: $('recordLabel'), meterFill: $('meterFill'), timer: $('timer'),
  transcript: $('transcript'), interim: $('interim'), titleInput: $('titleInput'),
  speakLiveBtn: $('speakLiveBtn'), copyBtn: $('copyBtn'), clearBtn: $('clearBtn'), saveBtn: $('saveBtn'),
  statTotal: $('statTotal'), statWords: $('statWords'), statMinutes: $('statMinutes'),
  search: $('search'), historyList: $('historyList'), emptyState: $('emptyState'),
  prevPage: $('prevPage'), nextPage: $('nextPage'), pageInfo: $('pageInfo'),
  editDialog: $('editDialog'), editForm: $('editForm'), editTitle: $('editTitle'), editLanguage: $('editLanguage'),
  editContent: $('editContent'), editMeta: $('editMeta'), editCancel: $('editCancel'),
  deleteDialog: $('deleteDialog'), deleteText: $('deleteText'), toasts: $('toasts'),
};

const PAGE_SIZE = 8;
const LANGUAGE_LABELS = { 'hi-en': 'Hindi + English', auto: 'Auto', en: 'English', hi: 'Hindi' };

const state = {
  config: { geminiConfigured: false, model: '' },
  engine: null,
  recording: false,
  busy: false,
  recordedSeconds: 0, // accumulated across multiple record sessions before saving
  startedAt: 0,
  timerId: null,
  usedEngine: 'gemini-live',
  page: 1,
  total: 0,
  query: '',
  editingId: null,
};

// ---------- helpers ----------
function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'error' : ''}`;
  node.textContent = message;
  el.toasts.append(node);
  setTimeout(() => node.remove(), type === 'error' ? 6000 : 3000);
}

function setStatus(text, kind = '') {
  el.engineStatus.textContent = text;
  el.engineStatus.className = `pill ${kind}`;
}

const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

function elapsedSeconds() {
  return state.recordedSeconds + (state.recording ? (Date.now() - state.startedAt) / 1000 : 0);
}

function idleStatus() {
  if (el.engine.value === 'browser') {
    return browserSpeechSupported() ? setStatus('Browser engine ready', 'ok') : setStatus('Web Speech not supported here', 'warn');
  }
  return state.config.geminiConfigured
    ? setStatus(`Gemini Live ready · ${state.config.model}`, 'ok')
    : setStatus('GEMINI_API_KEY not set on server', 'warn');
}

// ---------- live transcript ----------
function appendText(delta) {
  const box = el.transcript;
  box.value += delta;
  box.scrollTop = box.scrollHeight;
}

function endOfTurn() {
  // Gemini emits an utterance as a run of fragments; separate utterances with a space.
  if (el.transcript.value && !/\s$/.test(el.transcript.value)) appendText(' ');
}

function setRecordingUi(recording) {
  el.recordBtn.setAttribute('aria-pressed', String(recording));
  el.recordLabel.textContent = recording ? 'Stop' : 'Start recording';
  el.transcript.readOnly = recording;
  el.engine.disabled = recording;
  el.language.disabled = recording;
  el.saveBtn.disabled = recording;
}

async function startRecording() {
  state.busy = true;
  el.recordBtn.disabled = true;
  setStatus('Connecting…');
  state.usedEngine = el.engine.value === 'browser' ? 'browser-web-speech' : 'gemini-live';

  const engine = createEngine(el.engine.value, {
    onText: appendText,
    onTurn: endOfTurn,
    onInterim: (t) => { el.interim.textContent = t; },
    onLevel: (v) => { el.meterFill.style.width = `${Math.min(100, v * 400)}%`; },
    onReady: (info) => setStatus(`Listening · ${info.model}`, 'live'),
    onError: (message) => {
      toast(message, 'error');
      if (state.recording) stopRecording();
    },
  });

  try {
    await engine.start(el.language.value);
    state.engine = engine;
    state.recording = true;
    state.startedAt = Date.now();
    state.timerId = setInterval(() => { el.timer.textContent = fmtClock(elapsedSeconds()); }, 250);
    setRecordingUi(true);
  } catch (err) {
    await engine.stop().catch(() => {});
    const denied = err.name === 'NotAllowedError';
    toast(denied ? 'Microphone permission was denied.' : err.message, 'error');
    idleStatus();
  } finally {
    state.busy = false;
    el.recordBtn.disabled = false;
  }
}

async function stopRecording() {
  if (!state.recording) return;
  state.recordedSeconds = elapsedSeconds();
  state.recording = false;
  clearInterval(state.timerId);
  el.timer.textContent = fmtClock(state.recordedSeconds);
  setRecordingUi(false);
  el.recordBtn.disabled = true;
  setStatus('Finishing…');
  try {
    await state.engine?.stop();
  } finally {
    state.engine = null;
    el.interim.textContent = '';
    el.recordBtn.disabled = false;
    idleStatus();
  }
}

function clearLive() {
  el.transcript.value = '';
  el.interim.textContent = '';
  el.titleInput.value = '';
  state.recordedSeconds = 0;
  el.timer.textContent = '00:00';
}

async function saveLive() {
  const content = el.transcript.value.trim();
  if (!content) return toast('Nothing to save yet — record or type something first.', 'error');
  el.saveBtn.disabled = true;
  try {
    await api.create({
      title: el.titleInput.value.trim() || undefined,
      content,
      language: el.language.value,
      engine: state.usedEngine,
      duration_seconds: Math.round(state.recordedSeconds * 100) / 100,
    });
    toast('Transcription saved');
    clearLive();
    state.page = 1;
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    el.saveBtn.disabled = false;
  }
}

// ---------- text to speech ----------
function toggleSpeak(button, text) {
  if (!tts.supported) return toast('Text to speech is not supported in this browser.', 'error');
  if (!text.trim()) return;
  if (button.dataset.speaking === 'true') return tts.stop();
  button.dataset.speaking = 'true';
  button.textContent = 'Stop';
  tts.speak(text, () => {
    button.dataset.speaking = 'false';
    button.textContent = 'Speak';
  });
}

// ---------- history dashboard ----------
function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = `
    <div class="item-head"><span class="item-title"></span><span class="item-date"></span></div>
    <p class="item-text"></p>
    <div class="item-foot">
      <div class="tags"></div>
      <div class="actions">
        <button class="btn small" data-action="speak" type="button">Speak</button>
        <button class="btn small" data-action="edit" type="button">View / Edit</button>
        <button class="btn small ghost-danger" data-action="delete" type="button">Delete</button>
      </div>
    </div>`;
  li.querySelector('.item-title').textContent = item.title;
  li.querySelector('.item-date').textContent = fmtDate(item.created_at);
  li.querySelector('.item-text').textContent = item.content;

  const tags = li.querySelector('.tags');
  for (const text of [
    LANGUAGE_LABELS[item.language] ?? item.language,
    item.engine === 'gemini-live' ? 'Gemini Live' : 'Web Speech',
    `${item.word_count} words`,
    fmtDuration(item.duration_seconds),
  ]) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = text;
    tags.append(tag);
  }

  li.querySelector('[data-action="speak"]').addEventListener('click', (e) => toggleSpeak(e.currentTarget, item.content));
  li.querySelector('[data-action="edit"]').addEventListener('click', () => openEdit(item.id));
  li.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(item));
  return li;
}

async function loadHistory() {
  const data = await api.list({ q: state.query, page: state.page, limit: PAGE_SIZE });
  // Deleting the last item on a page leaves it empty; step back.
  if (data.items.length === 0 && state.page > 1) {
    state.page -= 1;
    return loadHistory();
  }
  state.total = data.total;
  el.historyList.replaceChildren(...data.items.map(renderItem));
  el.emptyState.hidden = data.total > 0;
  if (data.total === 0 && state.query) el.emptyState.textContent = `No transcriptions match “${state.query}”.`;
  else el.emptyState.innerHTML = 'No transcriptions yet. Record something and press <strong>Save</strong>.';

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  el.pageInfo.textContent = `Page ${state.page} of ${pages} · ${data.total} total`;
  el.prevPage.disabled = state.page <= 1;
  el.nextPage.disabled = state.page >= pages;
}

async function loadStats() {
  const s = await api.stats();
  el.statTotal.textContent = s.total.toLocaleString();
  el.statWords.textContent = s.words.toLocaleString();
  el.statMinutes.textContent = (s.seconds / 60).toFixed(1);
}

async function refresh() {
  try {
    await Promise.all([loadHistory(), loadStats()]);
  } catch (err) {
    toast(`Could not load history: ${err.message}`, 'error');
  }
}

async function openEdit(id) {
  try {
    const item = await api.get(id);
    state.editingId = id;
    el.editTitle.value = item.title;
    el.editContent.value = item.content;
    el.editLanguage.value = LANGUAGE_LABELS[item.language] ? item.language : 'auto';
    el.editMeta.textContent = `Created ${fmtDate(item.created_at)} · Updated ${fmtDate(item.updated_at)} · ${item.word_count} words`;
    el.editDialog.showModal();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitEdit(event) {
  event.preventDefault();
  try {
    await api.update(state.editingId, {
      title: el.editTitle.value,
      content: el.editContent.value,
      language: el.editLanguage.value,
    });
    el.editDialog.close();
    toast('Transcription updated');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function confirmDelete(item) {
  el.deleteText.textContent = `“${item.title}” will be permanently removed.`;
  el.deleteDialog.returnValue = '';
  el.deleteDialog.showModal();
  el.deleteDialog.addEventListener('close', async () => {
    if (el.deleteDialog.returnValue !== 'confirm') return;
    try {
      await api.remove(item.id);
      toast('Transcription deleted');
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }, { once: true });
}

// ---------- wiring ----------
el.recordBtn.addEventListener('click', () => {
  if (state.busy) return;
  state.recording ? stopRecording() : startRecording();
});
el.engine.addEventListener('change', idleStatus);
el.saveBtn.addEventListener('click', saveLive);
el.clearBtn.addEventListener('click', clearLive);
el.speakLiveBtn.addEventListener('click', (e) => toggleSpeak(e.currentTarget, el.transcript.value));
el.copyBtn.addEventListener('click', async () => {
  if (!el.transcript.value.trim()) return;
  await navigator.clipboard.writeText(el.transcript.value);
  toast('Copied to clipboard');
});

let searchTimer;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = el.search.value.trim();
    state.page = 1;
    loadHistory().catch((err) => toast(err.message, 'error'));
  }, 250);
});
el.prevPage.addEventListener('click', () => { state.page -= 1; loadHistory(); });
el.nextPage.addEventListener('click', () => { state.page += 1; loadHistory(); });

el.editForm.addEventListener('submit', submitEdit);
el.editCancel.addEventListener('click', () => el.editDialog.close());

// ---------- init ----------
(async function init() {
  // Free-tier hosts sleep when idle; the first request can take up to a minute.
  const wakeTimer = setTimeout(() => setStatus('Waking up server… (up to a minute)', 'warn'), 3000);
  try {
    state.config = await api.config();
  } catch {
    setStatus('Server unreachable', 'warn');
  } finally {
    clearTimeout(wakeTimer);
  }
  // Without a Gemini key, default to the browser engine so the app still works.
  if (!state.config.geminiConfigured && browserSpeechSupported()) el.engine.value = 'browser';
  idleStatus();
  await refresh();
})();
