// Audio Flashcards: flashcards with audio, stored locally in IndexedDB.

import { cleanAudio } from './audio.js';

const DB_NAME = 'audio-flashcards';
const STORE = 'cards';
const DRAFTS = 'drafts'; // unsaved recording for the card being written

// ---------- storage ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDb();

async function tx(store, mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
  });
}

const getAllCards = () => tx(STORE, 'readonly', (s) => s.getAll());
const getCard = (id) => tx(STORE, 'readonly', (s) => s.get(id));
const putCard = (card) => tx(STORE, 'readwrite', (s) => s.put(card));
const deleteCard = (id) => tx(STORE, 'readwrite', (s) => s.delete(id));
const getDraftAudio = () => tx(DRAFTS, 'readonly', (s) => s.get('audio'));
const setDraftAudio = (blob) =>
  tx(DRAFTS, 'readwrite', (s) => (blob ? s.put(blob, 'audio') : s.delete('audio')));

// Small per-device preferences; the app works fine if storage is unavailable.
const prefs = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null && c !== ''));
  return node;
}

// What to show as a card's main text: romanization, falling back to the written form.
const primaryText = (c) => c.romanization || c.native || '';

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

// ---------- playback ----------

const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

const player = new Audio();
let playingBtn = null;

function resetPlayingBtn() {
  if (playingBtn) {
    playingBtn.innerHTML = PLAY_ICON;
    playingBtn.classList.remove('playing');
    playingBtn = null;
  }
}
player.addEventListener('ended', resetPlayingBtn);
player.addEventListener('pause', resetPlayingBtn);

function play(blob, btn) {
  if (playingBtn === btn) {
    player.pause();
    return;
  }
  player.pause();
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(blob);
  player.play().then(() => {
    playingBtn = btn;
    btn.innerHTML = STOP_ICON;
    btn.classList.add('playing');
  }).catch(() => {});
}

function playButton(blob, big = false) {
  const btn = el('button', { type: 'button', class: big ? 'play big' : 'play', 'aria-label': 'Play', html: PLAY_ICON });
  if (blob) btn.addEventListener('click', (e) => { e.stopPropagation(); play(blob, btn); });
  else btn.disabled = true;
  return btn;
}

// ---------- navigation ----------

function showView(name) {
  player.pause();
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
  if (name === 'list') renderList();
}

document.querySelectorAll('.tabbar button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.view === 'add' && form.cardId.value) startNewCard();
    showView(b.dataset.view);
  })
);

// ---------- languages ----------

async function refreshLanguages() {
  const cards = await getAllCards();
  const langs = [...new Set(cards.map((c) => c.language).filter(Boolean))].sort();
  $('#languages').replaceChildren(...langs.map((l) => el('option', { value: l })));
  for (const [sel, allLabel] of [['#filter-language', 'All'], ['#review-language', 'All languages']]) {
    const current = $(sel).value;
    $(sel).replaceChildren(el('option', { value: '' }, allLabel), ...langs.map((l) => el('option', { value: l }, l)));
    $(sel).value = langs.includes(current) ? current : '';
  }
  // Only worth showing the filter once there's more than one language.
  $('#filter-language').hidden = langs.length < 2;
  return cards;
}

// ---------- add / edit ----------

const form = $('#card-form');
const preview = $('#audio-preview');
const TEXT_FIELDS = ['romanization', 'english', 'native', 'language', 'notes'];

let rawAudio = null; // what was recorded or uploaded
let pendingAudio = null; // what will be saved: rawAudio, or its cleaned-up version
let audioJob = 0;

function setStatus(text) {
  $('#record-status').textContent = text;
}

async function setRawAudio(blob, { saveDraft = true } = {}) {
  rawAudio = blob;
  if (saveDraft && !form.cardId.value) setDraftAudio(blob);
  await applyCleanup();
}

async function applyCleanup() {
  const job = ++audioJob;
  pendingAudio = rawAudio;
  if (rawAudio && $('#clean-audio').checked) {
    setStatus('Cleaning up…');
    try {
      const cleaned = await cleanAudio(rawAudio);
      if (job !== audioJob) return;
      pendingAudio = cleaned;
    } catch {
      if (job !== audioJob) return;
      toast("Couldn't clean this file; keeping the original");
    }
  }
  showAudio(pendingAudio);
}

function showAudio(blob) {
  preview.hidden = !blob;
  $('#remove-audio').hidden = !blob;
  if (preview.src) URL.revokeObjectURL(preview.src);
  if (blob) preview.src = URL.createObjectURL(blob);
  else preview.removeAttribute('src');
  setStatus(blob ? '' : 'Tap to record');
}

form.audio.addEventListener('change', () => {
  const file = form.audio.files[0];
  if (file) setRawAudio(file);
  form.audio.value = '';
});

$('#clean-audio').addEventListener('change', () => {
  prefs.set('cleanAudio', $('#clean-audio').checked);
  if (rawAudio) applyCleanup();
});

$('#remove-audio').addEventListener('click', () => {
  setRawAudio(null);
  if (form.cardId.value) editingHadAudio = false;
});

let recorder = null;
let recordTimer = null;
$('#record-btn').addEventListener('click', async () => {
  const btn = $('#record-btn');
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
    });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recordTimer);
      btn.classList.remove('recording');
      btn.setAttribute('aria-label', 'Record');
      setRawAudio(new Blob(chunks, { type: recorder.mimeType }));
      recorder = null;
    };
    recorder.start();
    player.pause();
    btn.classList.add('recording');
    btn.setAttribute('aria-label', 'Stop recording');
    const started = Date.now();
    setStatus('Recording… 0:00');
    recordTimer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setStatus(`Recording… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 250);
  } catch (err) {
    toast('Microphone not available');
  }
});

// Keep the card being written so it survives the app being closed.
function saveDraft() {
  if (form.cardId.value) return;
  const draft = Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k].value]));
  prefs.set('draft', draft);
}
form.addEventListener('input', saveDraft);

function clearDraft() {
  prefs.set('draft', null);
  setDraftAudio(null);
}

let editingHadAudio = false;

function startNewCard() {
  form.reset();
}

form.addEventListener('reset', () => {
  // Runs before the browser clears the fields; finish once they're cleared.
  setTimeout(() => {
    form.cardId.value = '';
    form.language.value = prefs.get('lastLanguage') ?? '';
    $('#form-title').textContent = 'New card';
    $('#delete-btn').hidden = true;
    $('#form-error').hidden = true;
    editingHadAudio = false;
    clearDraft();
    setRawAudio(null, { saveDraft: false });
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k].value.trim()]));
  const problem =
    !v.romanization && !v.native ? 'Add the romanization or the written form.' :
    !v.english ? 'Add the English meaning.' :
    !v.language ? 'Add the language.' : null;
  if (problem) {
    $('#form-error').textContent = problem;
    $('#form-error').hidden = false;
    return;
  }
  $('#form-error').hidden = true;

  const editing = !!form.cardId.value;
  const id = form.cardId.value || crypto.randomUUID();
  const existing = editing ? await getCard(id) : null;
  const audio = rawAudio ? pendingAudio : editingHadAudio ? existing?.audio ?? null : null;
  await putCard({ ...existing, ...v, id, audio, createdAt: existing?.createdAt ?? Date.now() });
  prefs.set('lastLanguage', v.language);
  await refreshLanguages();

  if (editing) {
    toast('Card updated');
    startNewCard();
    showView('list');
  } else {
    toast('Card saved');
    startNewCard();
    form.romanization.focus();
  }
});

$('#delete-btn').addEventListener('click', async () => {
  const id = form.cardId.value;
  if (!id || !confirm('Delete this card?')) return;
  await deleteCard(id);
  await refreshLanguages();
  toast('Card deleted');
  startNewCard();
  showView('list');
});

async function editCard(id) {
  const c = await getCard(id);
  form.cardId.value = c.id;
  for (const k of TEXT_FIELDS) form[k].value = c[k] ?? '';
  $('#form-title').textContent = 'Edit card';
  $('#delete-btn').hidden = false;
  $('#form-error').hidden = true;
  // Keep the saved audio unless a new one is recorded or it's removed.
  rawAudio = pendingAudio = null;
  editingHadAudio = !!c.audio;
  showAudio(c.audio ?? null);
  showView('add');
}

async function restoreDraft() {
  const draft = prefs.get('draft');
  form.language.value = prefs.get('lastLanguage') ?? '';
  if (draft) for (const k of TEXT_FIELDS) if (draft[k]) form[k].value = draft[k];
  const audio = await getDraftAudio();
  if (audio) await setRawAudio(audio, { saveDraft: false });
}

// ---------- deck list ----------

async function renderList() {
  const q = $('#search').value.toLowerCase().trim();
  const lang = $('#filter-language').value;
  const all = await getAllCards();
  const cards = all
    .filter((c) => !lang || c.language === lang)
    .filter((c) => !q || [c.romanization, c.native, c.english, c.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  $('#deck-count').textContent = all.length ? `${all.length} card${all.length === 1 ? '' : 's'}` : '';
  const showLang = new Set(all.map((c) => c.language)).size > 1;

  $('#card-list').replaceChildren(
    ...cards.map((c) =>
      el('li', { class: 'card-row' },
        playButton(c.audio),
        el('div', { class: 'text', onclick: () => editCard(c.id) },
          el('div', { class: 'primary-text' }, primaryText(c)),
          el('div', { class: 'secondary' }, [c.english, c.romanization && c.native].filter(Boolean).join(' · ')),
          showLang ? el('div', { class: 'lang' }, c.language) : null
        )
      )
    )
  );

  if (!all.length) {
    $('#card-list').append(
      el('li', { class: 'empty' },
        el('div', {}, 'No cards yet.'),
        el('button', { class: 'btn primary', onclick: () => showView('add') }, 'Add your first card')
      )
    );
  } else if (!cards.length) {
    $('#card-list').append(el('li', { class: 'empty' }, 'No matches.'));
  }
}

$('#search').addEventListener('input', renderList);
$('#filter-language').addEventListener('change', renderList);

// ---------- import / export ----------

$('#export-btn').addEventListener('click', async () => {
  const cards = await Promise.all(
    (await getAllCards()).map(async (c) => ({ ...c, audio: c.audio ? await blobToDataUrl(c.audio) : null }))
  );
  const blob = new Blob([JSON.stringify({ version: 1, cards }, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  el('a', { href: URL.createObjectURL(blob), download: `flashcards-${date}.json` }).click();
});

$('#import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { cards } = JSON.parse(await file.text());
    for (const c of cards) {
      await putCard({ ...c, id: c.id ?? crypto.randomUUID(), audio: c.audio ? await dataUrlToBlob(c.audio) : null });
    }
    await refreshLanguages();
    renderList();
    toast(`Imported ${cards.length} cards`);
  } catch (err) {
    toast('Import failed: not a deck file');
  }
  e.target.value = '';
});

// ---------- review ----------

const MODE_HINTS = {
  audio: 'Hear it, then recall what it means.',
  text: 'Read it, then recall what it means.',
  english: 'See the English, then say it out loud.',
};

let mode = prefs.get('reviewMode') ?? 'audio';
let queue = [];
let current = null;
let total = 0;
let done = 0;

function setMode(m) {
  mode = MODE_HINTS[m] ? m : 'audio';
  prefs.set('reviewMode', mode);
  document.querySelectorAll('#review-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#mode-hint').textContent = MODE_HINTS[mode];
  $('#review-empty').hidden = true;
}

document.querySelectorAll('#review-mode button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode))
);

function promptFor(card) {
  if (mode === 'audio') {
    const btn = playButton(card.audio, true);
    // Started from a tap, so autoplay is allowed.
    queueMicrotask(() => play(card.audio, btn));
    return [btn];
  }
  if (mode === 'text') {
    return [
      el('div', { class: 'big-text' }, primaryText(card)),
      card.romanization && card.native ? el('div', { class: 'native' }, card.native) : null,
    ];
  }
  return [el('div', { class: 'big-text' }, card.english)];
}

function answerFor(card) {
  return [
    mode !== 'text' ? el('div', { class: 'big-text' }, primaryText(card)) : null,
    mode !== 'text' && card.romanization && card.native ? el('div', { class: 'native' }, card.native) : null,
    mode !== 'english' ? el('div', { class: 'meaning' }, card.english) : null,
    mode !== 'audio' && card.audio ? playButton(card.audio) : null,
    card.notes ? el('div', { class: 'note' }, card.notes) : null,
  ].filter(Boolean);
}

function showNext() {
  player.pause();
  current = queue.shift();
  $('#progress-bar').style.width = `${total ? (done / total) * 100 : 0}%`;
  if (!current) {
    endReview(total ? `Done! You went through ${total} card${total === 1 ? '' : 's'}.` : null);
    return;
  }
  $('#review-prompt').replaceChildren(...promptFor(current).filter(Boolean));
  $('#review-answer').replaceChildren(...answerFor(current));
  $('#review-answer').hidden = true;
  $('#reveal-btn').hidden = false;
  $('#again-btn').hidden = $('#good-btn').hidden = true;
}

function endReview(message) {
  player.pause();
  $('#review-session').hidden = true;
  $('#review-setup').hidden = false;
  $('#review-empty').hidden = !message;
  $('#review-empty').textContent = message ?? '';
}

$('#start-review').addEventListener('click', async () => {
  const lang = $('#review-language').value;
  queue = shuffle(
    (await getAllCards()).filter((c) => (!lang || c.language === lang) && (mode !== 'audio' || c.audio))
  );
  total = queue.length;
  done = 0;
  if (!total) {
    endReview(mode === 'audio' ? 'No cards with audio yet.' : 'No cards yet. Add some first.');
    return;
  }
  $('#review-setup').hidden = true;
  $('#review-session').hidden = false;
  showNext();
});

$('#reveal-btn').addEventListener('click', () => {
  $('#review-answer').hidden = false;
  $('#reveal-btn').hidden = true;
  $('#again-btn').hidden = $('#good-btn').hidden = false;
});

$('#again-btn').addEventListener('click', () => {
  // Put the card back a few positions later so it comes up again this session.
  queue.splice(Math.min(3, queue.length), 0, current);
  showNext();
});

$('#good-btn').addEventListener('click', () => {
  done++;
  showNext();
});

$('#end-review').addEventListener('click', () => endReview(null));

// ---------- start up ----------

$('#clean-audio').checked = prefs.get('cleanAudio') ?? true;
setMode(mode);
refreshLanguages().then((cards) => {
  // First run with existing cards: default to the most recently used language.
  if (!prefs.get('lastLanguage') && cards.length) {
    const latest = cards.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    prefs.set('lastLanguage', latest.language);
  }
  restoreDraft();
  renderList();
});

// ---------- offline / install ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.();
