// Audio Flashcards: flashcards with audio, stored locally in IndexedDB.

const DB_NAME = 'audio-flashcards';
const STORE = 'cards';

// ---------- storage ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDb();

async function tx(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

const getAllCards = () => tx('readonly', (s) => s.getAll());
const getCard = (id) => tx('readonly', (s) => s.get(id));
const putCard = (card) => tx('readwrite', (s) => s.put(card));
const deleteCard = (id) => tx('readwrite', (s) => s.delete(id));

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function audioEl(blob) {
  if (!blob) return null;
  const a = el('audio', { controls: '' });
  a.src = URL.createObjectURL(blob);
  return a;
}

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

// ---------- navigation ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'list') renderList();
}

document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.view))
);

// ---------- languages dropdowns ----------

async function refreshLanguages() {
  const langs = [...new Set((await getAllCards()).map((c) => c.language))].sort();
  $('#languages').replaceChildren(...langs.map((l) => el('option', { value: l })));
  for (const sel of ['#filter-language', '#review-language']) {
    const current = $(sel).value;
    $(sel).replaceChildren(
      el('option', { value: '' }, 'All languages'),
      ...langs.map((l) => el('option', { value: l }, l))
    );
    $(sel).value = langs.includes(current) ? current : '';
  }
}

// ---------- add / edit ----------

const form = $('#card-form');
const preview = $('#audio-preview');
let pendingAudio = null; // Blob from file upload or recording

function setPendingAudio(blob) {
  pendingAudio = blob;
  preview.hidden = !blob;
  if (blob) preview.src = URL.createObjectURL(blob);
}

form.audio.addEventListener('change', () => setPendingAudio(form.audio.files[0] ?? null));

let recorder = null;
$('#record-btn').addEventListener('click', async () => {
  const btn = $('#record-btn');
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setPendingAudio(new Blob(chunks, { type: recorder.mimeType }));
      recorder = null;
      btn.textContent = '● Record';
      btn.classList.remove('recording');
    };
    recorder.start();
    btn.textContent = '■ Stop';
    btn.classList.add('recording');
  } catch (err) {
    alert(`Could not access microphone: ${err.message}`);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = form.cardId.value || crypto.randomUUID();
  const existing = form.cardId.value ? await getCard(id) : null;
  await putCard({
    id,
    language: form.language.value.trim(),
    native: form.native.value.trim(),
    romanization: form.romanization.value.trim(),
    english: form.english.value.trim(),
    notes: form.notes.value.trim(),
    audio: pendingAudio ?? existing?.audio ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
  });
  const lang = form.language.value;
  form.reset();
  form.language.value = lang; // keep language for the next card
  form.cardId.value = '';
  setPendingAudio(null);
  await refreshLanguages();
  form.native.focus();
});

form.addEventListener('reset', () => {
  form.cardId.value = '';
  setPendingAudio(null);
});

async function editCard(id) {
  const c = await getCard(id);
  showView('add');
  form.cardId.value = c.id;
  for (const k of ['language', 'native', 'romanization', 'english', 'notes']) form[k].value = c[k] ?? '';
  setPendingAudio(null);
  if (c.audio) {
    preview.hidden = false;
    preview.src = URL.createObjectURL(c.audio);
  }
}

// ---------- deck list ----------

async function renderList() {
  const q = $('#search').value.toLowerCase();
  const lang = $('#filter-language').value;
  const cards = (await getAllCards())
    .filter((c) => !lang || c.language === lang)
    .filter((c) => !q || [c.native, c.romanization, c.english, c.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  $('#card-list').replaceChildren(
    ...cards.map((c) =>
      el('li', {},
        el('div', { class: 'native' }, c.native),
        c.romanization ? el('div', { class: 'meta' }, c.romanization) : null,
        el('div', {}, c.english),
        c.notes ? el('div', { class: 'meta' }, c.notes) : null,
        audioEl(c.audio),
        el('div', { class: 'actions' },
          el('span', { class: 'meta' }, c.language),
          el('button', { onclick: () => editCard(c.id) }, 'Edit'),
          el('button', {
            onclick: async () => {
              if (confirm(`Delete "${c.native}"?`)) {
                await deleteCard(c.id);
                await refreshLanguages();
                renderList();
              }
            },
          }, 'Delete')
        )
      )
    )
  );
  if (!cards.length) $('#card-list').append(el('li', { class: 'meta' }, 'No cards yet.'));
}

$('#search').addEventListener('input', renderList);
$('#filter-language').addEventListener('change', renderList);

// ---------- import / export ----------

$('#export-btn').addEventListener('click', async () => {
  const cards = await Promise.all(
    (await getAllCards()).map(async (c) => ({ ...c, audio: c.audio ? await blobToDataUrl(c.audio) : null }))
  );
  const blob = new Blob([JSON.stringify({ version: 1, cards }, null, 2)], { type: 'application/json' });
  el('a', { href: URL.createObjectURL(blob), download: 'audio-flashcards-deck.json' }).click();
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
    alert(`Imported ${cards.length} cards.`);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
  e.target.value = '';
});

// ---------- review ----------

let queue = [];
let current = null;
let total = 0;

function face(card, side) {
  if (side === 'audio') {
    const a = audioEl(card.audio);
    if (a) a.autoplay = true;
    return a ?? el('div', { class: 'meta' }, '(no audio)');
  }
  if (side === 'native') return el('div', { class: 'native' }, card.native);
  return el('div', {}, card.english);
}

function showNext() {
  current = queue.shift();
  if (!current) {
    $('#review-card').hidden = true;
    $('#review-empty').hidden = false;
    $('#review-empty').textContent = total ? `Done! Reviewed ${total} cards.` : 'Nothing to review. Add some cards first.';
    return;
  }
  const mode = $('#review-mode').value;
  $('#review-prompt').replaceChildren(face(current, mode));
  const answer = [
    el('div', { class: 'native' }, current.native),
    current.romanization ? el('div', { class: 'meta' }, current.romanization) : null,
    el('div', {}, current.english),
    mode !== 'audio' ? audioEl(current.audio) : null,
    current.notes ? el('div', { class: 'meta' }, current.notes) : null,
  ].filter(Boolean);
  $('#review-answer').replaceChildren(...answer);
  $('#review-answer').hidden = true;
  $('#reveal-btn').hidden = false;
  $('#again-btn').hidden = $('#good-btn').hidden = true;
  $('#review-progress').textContent = `${queue.length + 1} left`;
}

$('#start-review').addEventListener('click', async () => {
  const lang = $('#review-language').value;
  const mode = $('#review-mode').value;
  queue = shuffle(
    (await getAllCards()).filter((c) => (!lang || c.language === lang) && (mode !== 'audio' || c.audio))
  );
  total = queue.length;
  $('#review-card').hidden = !queue.length;
  $('#review-empty').hidden = !!queue.length;
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

$('#good-btn').addEventListener('click', showNext);

refreshLanguages();

// ---------- offline / install ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.();
