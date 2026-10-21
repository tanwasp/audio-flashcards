// Audio Flashcards: flashcards with audio, stored locally in IndexedDB.

import { cleanAudio } from './audio.js';
import { dayKey, addDays, daysBetween, isDue, isNew, schedule, formatInterval } from './srs.js';
import { XP, BADGES, emptyDay, summarize, earnedBadges } from './game.js';

const DB_NAME = 'audio-flashcards';
const STORE = 'cards';
const DRAFTS = 'drafts'; // unsaved recording for the card being written
const DAYS = 'days'; // one record per local day: reviews, XP, goal met
const META = 'meta'; // 'settings' and 'profile'; the service worker reads these too

const DEFAULT_SETTINGS = { goal: 10, newPerDay: 10, reminders: false, reminderHour: 19 };

// ---------- storage ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
      if (!db.objectStoreNames.contains(DAYS)) db.createObjectStore(DAYS, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
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
const putCard = (card) => tx(STORE, 'readwrite', (s) => s.put({ ...card, updatedAt: Date.now() }));
const deleteCard = (id) => tx(STORE, 'readwrite', (s) => s.delete(id));
const getDraftAudio = () => tx(DRAFTS, 'readonly', (s) => s.get('audio'));
const setDraftAudio = (blob) =>
  tx(DRAFTS, 'readwrite', (s) => (blob ? s.put(blob, 'audio') : s.delete('audio')));
const getAllDays = () => tx(DAYS, 'readonly', (s) => s.getAll());
const getDay = async (date) => (await tx(DAYS, 'readonly', (s) => s.get(date))) ?? emptyDay(date);
const putDay = (day) => tx(DAYS, 'readwrite', (s) => s.put(day));
const getMeta = (key) => tx(META, 'readonly', (s) => s.get(key));
const setMeta = (key, value) => tx(META, 'readwrite', (s) => s.put(value, key));

let settings = { ...DEFAULT_SETTINGS };
let profile = {}; // { badges: [ids already announced], perfectSessions }

const saveSettings = () => setMeta('settings', settings);
const saveProfile = () => setMeta('profile', profile);

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
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

const buzz = (ms = 10) => navigator.vibrate?.(ms);

let toastTimer;
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
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
  document.body.classList.toggle('in-session', name === 'session');
  window.scrollTo(0, 0);
  if (name === 'list') renderList();
  if (name === 'today') renderToday();
  if (name === 'me') renderMe();
}

document.querySelectorAll('.tabbar button').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.view === 'add' && form.cardId.value) startNewCard();
    showView(b.dataset.view);
  })
);
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-goto]');
  if (target) showView(target.dataset.goto);
});

// ---------- languages ----------

let deckLang = '';

async function refreshLanguages() {
  const cards = await getAllCards();
  const langs = [...new Set(cards.map((c) => c.language).filter(Boolean))].sort();
  $('#languages').replaceChildren(...langs.map((l) => el('option', { value: l })));
  const current = $('#review-language').value;
  $('#review-language').replaceChildren(el('option', { value: '' }, 'All languages'), ...langs.map((l) => el('option', { value: l }, l)));
  $('#review-language').value = langs.includes(current) ? current : '';
  $('#review-language').hidden = langs.length < 2;
  if (!langs.includes(deckLang)) deckLang = '';
  // Only worth showing the filter once there's more than one language.
  $('#filter-language').hidden = langs.length < 2;
  $('#filter-language').replaceChildren(
    ...['', ...langs].map((l) =>
      el('button', {
        type: 'button',
        class: l === deckLang ? 'chip on' : 'chip',
        onclick: () => { deckLang = l; refreshLanguages(); renderList(); },
      }, l || 'All')
    )
  );
  return cards;
}

// ---------- progress ----------

// Apply `fn` to today's record, award the goal bonus when it's first reached.
async function updateToday(fn) {
  const day = await getDay(dayKey());
  fn(day);
  let goalJustMet = false;
  if (!day.goalMet && day.reviews >= settings.goal) {
    day.goalMet = true;
    day.xp += XP.goal;
    goalJustMet = true;
  }
  await putDay(day);
  return { day, goalJustMet };
}

async function loadStats() {
  const [cards, days] = await Promise.all([getAllCards(), getAllDays()]);
  return { cards, days, stats: summarize(days, cards, profile) };
}

// Announce badges earned since last time. The first run just records them.
async function checkBadges() {
  const { stats } = await loadStats();
  const earned = earnedBadges(stats);
  const known = new Set(profile.badges ?? earned);
  const fresh = earned.filter((id) => !known.has(id));
  profile.badges = earned;
  await saveProfile();
  fresh.forEach((id, i) => {
    const b = BADGES.find((x) => x.id === id);
    setTimeout(() => { toast(`${b.icon} Badge unlocked: ${b.name}`, 2600); buzz([20, 40, 20]); }, 600 + i * 2800);
  });
}

// ---------- today ----------

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Cards for a scheduled session: everything due, plus today's allowance of new cards.
function scheduledQueue(cards, today, day) {
  const due = cards.filter((c) => isDue(c, today)).sort((a, b) => a.due.localeCompare(b.due));
  const allowance = Math.max(0, settings.newPerDay - day.newSeen);
  const fresh = cards.filter(isNew).sort((a, b) => a.createdAt - b.createdAt).slice(0, allowance);
  return { due, fresh };
}

function reviewable(cards) {
  const lang = $('#review-language').value;
  return cards.filter((c) => (!lang || c.language === lang) && (mode !== 'audio' || c.audio));
}

async function renderToday() {
  const today = dayKey();
  const { cards, days, stats } = await loadStats();
  const day = days.find((d) => d.date === today) ?? emptyDay(today);

  $('#greeting').textContent = greeting();
  $('#level-pill').textContent = `Lv ${stats.level} · ${stats.xp} XP`;
  $('#today-empty').hidden = cards.length > 0;
  $('#review-panel').hidden = cards.length === 0;

  // Streak + goal
  const pct = Math.min(100, (day.reviews / settings.goal) * 100);
  $('#goal-ring .fill').style.strokeDasharray = `${pct} 100`;
  $('#goal-ring').classList.toggle('met', day.goalMet);
  $('#streak-count').textContent = stats.streak;
  const left = settings.goal - day.reviews;
  $('#goal-text').textContent = day.goalMet
    ? `Goal done for today: ${day.reviews} reviewed`
    : stats.streak
      ? `Review ${left} more to keep your streak alive`
      : `Review ${left} card${left === 1 ? '' : 's'} today to start a streak`;

  const byDate = new Map(days.map((d) => [d.date, d]));
  $('#week-strip').replaceChildren(
    ...Array.from({ length: 7 }, (_, i) => {
      const key = addDays(today, i - 6);
      const d = byDate.get(key);
      const [y, m, dd] = key.split('-').map(Number);
      const label = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'narrow' });
      const state = d?.goalMet ? 'met' : d?.reviews ? 'some' : '';
      return el('li', { class: `${state} ${key === today ? 'today' : ''}`, title: key },
        el('span', { class: 'dot' }, d?.goalMet ? '🔥' : ''), label);
    })
  );

  // Review counts for the chosen direction and language
  const pool = reviewable(cards);
  const { due, fresh } = scheduledQueue(pool, today, day);
  $('#due-count').textContent = due.length;
  $('#new-count').textContent = fresh.length;
  $('#today-count').textContent = day.reviews;
  const n = due.length + fresh.length;
  $('#start-review').textContent = n ? `Start review · ${n}` : pool.length ? 'All caught up' : 'No cards with audio yet';
  $('#start-review').disabled = !n;
  $('#start-practice').hidden = !pool.length;
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
    await updateToday((d) => { d.added++; d.xp += XP.added; });
    toast(`Card saved · +${XP.added} XP`);
    startNewCard();
    form.romanization.focus();
  }
  checkBadges();
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

function statusChip(card, today) {
  if (isNew(card)) return el('span', { class: 'status new' }, 'New');
  if (isDue(card, today)) return el('span', { class: 'status due' }, 'Due');
  return el('span', { class: 'status' }, `in ${formatInterval(daysBetween(today, card.due))}`);
}

async function renderList() {
  const q = $('#search').value.toLowerCase().trim();
  const all = await getAllCards();
  const today = dayKey();
  const cards = all
    .filter((c) => !deckLang || c.language === deckLang)
    .filter((c) => !q || [c.romanization, c.native, c.english, c.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  const dueCount = all.filter((c) => isDue(c, today)).length;
  $('#deck-count').textContent = all.length
    ? `${plural(all.length, 'card')}${dueCount ? ` · ${dueCount} due` : ''}`
    : '';
  const showLang = new Set(all.map((c) => c.language)).size > 1 && !deckLang;

  $('#card-list').replaceChildren(
    ...cards.map((c) =>
      el('li', { class: 'card-row' },
        playButton(c.audio),
        el('div', { class: 'text', onclick: () => editCard(c.id) },
          el('div', { class: 'primary-text' }, primaryText(c)),
          el('div', { class: 'secondary' }, [c.english, c.romanization && c.native].filter(Boolean).join(' · ')),
          showLang ? el('div', { class: 'lang' }, c.language) : null
        ),
        statusChip(c, today)
      )
    )
  );

  if (!all.length) {
    $('#card-list').append(
      el('li', { class: 'empty' },
        el('div', { class: 'emoji' }, '🗂️'),
        el('div', {}, 'No cards yet.'),
        el('button', { class: 'btn primary', onclick: () => showView('add') }, 'Add your first card')
      )
    );
  } else if (!cards.length) {
    $('#card-list').append(el('li', { class: 'empty' }, 'No matches.'));
  }
}

$('#search').addEventListener('input', renderList);

// ---------- progress view ----------

const HEAT_WEEKS = 17;

function heatLevel(d) {
  if (!d?.reviews) return 0;
  const r = d.reviews / settings.goal;
  return r < 0.5 ? 1 : r < 1 ? 2 : r < 2 ? 3 : 4;
}

function formatDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function dayDetail(key, d) {
  if (!d?.reviews && !d?.added) return `${formatDay(key)}: nothing yet`;
  const parts = [plural(d.reviews, 'review')];
  if (d.added) parts.push(`${d.added} added`);
  if (d.goalMet) parts.push('goal met 🔥');
  return `${formatDay(key)}: ${parts.join(' · ')}`;
}

async function renderMe() {
  const today = dayKey();
  const { cards, days, stats } = await loadStats();

  $('#level-num').textContent = $('#level-num-2').textContent = stats.level;
  $('#xp-fill').style.width = `${(stats.into / stats.needed) * 100}%`;
  $('#xp-text').textContent = `${stats.into} / ${stats.needed} XP to level ${stats.level + 1}`;
  $('#stat-best').textContent = stats.best;
  $('#stat-reviews').textContent = stats.reviews.toLocaleString();
  $('#stat-accuracy').textContent = stats.reviews ? `${Math.round((stats.correct / stats.reviews) * 100)}%` : '–';
  // "Learned": answered correctly at least twice in a row, i.e. past the first short intervals.
  $('#stat-learned').textContent = cards.filter((c) => (c.interval ?? 0) >= 3).length;

  // Heatmap: columns are weeks (Monday first), ending with the current week.
  const byDate = new Map(days.map((d) => [d.date, d]));
  const [y, m, d] = today.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const start = addDays(today, -weekday - (HEAT_WEEKS - 1) * 7);
  const cells = [];
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    const key = addDays(start, i);
    if (key > today) { cells.push(el('span', { class: 'cell future' })); continue; }
    const rec = byDate.get(key);
    const detail = dayDetail(key, rec);
    cells.push(el('button', {
      type: 'button',
      class: `cell h${heatLevel(rec)}${key === today ? ' today' : ''}`,
      title: detail,
      'aria-label': detail,
      onclick: () => ($('#heat-detail').textContent = detail),
    }));
  }
  $('#heatmap').replaceChildren(...cells);
  $('#heatmap').setAttribute('aria-label', `Daily reviews over the last ${HEAT_WEEKS} weeks`);

  const earned = new Set(earnedBadges(stats));
  $('#badge-count').textContent = `${earned.size} of ${BADGES.length}`;
  $('#badges').replaceChildren(
    ...BADGES.map((b) =>
      el('li', { class: earned.has(b.id) ? 'badge got' : 'badge' },
        el('span', { class: 'icon' }, b.icon),
        el('strong', {}, b.name),
        el('small', {}, b.desc)
      )
    )
  );

  $('#set-goal').value = settings.goal;
  $('#set-new').value = settings.newPerDay;
  $('#set-reminders').checked = settings.reminders;
  $('#set-reminder-hour').value = settings.reminderHour;
  $('#reminder-time-row').hidden = !settings.reminders;
}

$('#set-reminder-hour').replaceChildren(
  ...Array.from({ length: 24 }, (_, h) =>
    el('option', { value: h }, new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }))
  )
);

$('#set-goal').addEventListener('change', async (e) => {
  settings.goal = Number(e.target.value);
  await saveSettings();
  // Today's record may now meet (or still miss) the new goal.
  await updateToday(() => {});
  renderMe();
});
$('#set-new').addEventListener('change', (e) => { settings.newPerDay = Number(e.target.value); saveSettings(); });
$('#set-reminder-hour').addEventListener('change', (e) => { settings.reminderHour = Number(e.target.value); saveSettings(); });

// ---------- reminders ----------

// Scheduled reminders need the app closed, so they run in the service worker
// via Periodic Background Sync. That exists in Chrome/Edge on Android and
// desktop for installed apps; Safari and Firefox don't support it.
async function enableReminders() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'This browser can’t show notifications. On iPhone, install the app to your home screen first.';
  }
  if ((await Notification.requestPermission()) !== 'granted') {
    return 'Notifications are blocked. Allow them in your browser settings.';
  }
  const reg = await navigator.serviceWorker.ready;
  if (!reg.periodicSync) {
    return 'This browser can’t schedule reminders while the app is closed (needs Chrome or Edge, with the app installed).';
  }
  try {
    await reg.periodicSync.register('daily-reminder', { minInterval: 4 * 60 * 60 * 1000 });
  } catch {
    return 'Install the app to your home screen to turn on reminders.';
  }
  reg.showNotification('Reminders are on', {
    body: 'We’ll nudge you if you haven’t hit your daily goal.',
    icon: 'icons/icon-192.png',
    tag: 'reminder',
  });
  return null;
}

$('#set-reminders').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const problem = await enableReminders();
    if (problem) {
      e.target.checked = false;
      $('#reminder-note').textContent = problem;
      return;
    }
  } else {
    const reg = await navigator.serviceWorker?.ready;
    await reg?.periodicSync?.unregister('daily-reminder');
  }
  settings.reminders = e.target.checked;
  $('#reminder-time-row').hidden = !settings.reminders;
  saveSettings();
});

// ---------- import / export ----------

$('#export-btn').addEventListener('click', async () => {
  const cards = await Promise.all(
    (await getAllCards()).map(async (c) => ({ ...c, audio: c.audio ? await blobToDataUrl(c.audio) : null }))
  );
  const backup = { version: 2, cards, days: await getAllDays(), settings, profile };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  el('a', { href: URL.createObjectURL(blob), download: `flashcards-${date}.json` }).click();
});

$('#import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    for (const c of backup.cards) {
      await putCard({ ...c, id: c.id ?? crypto.randomUUID(), audio: c.audio ? await dataUrlToBlob(c.audio) : null });
    }
    // Merge history, keeping whichever copy of a day has more activity.
    for (const d of backup.days ?? []) {
      const mine = await getDay(d.date);
      if (d.reviews + d.added >= mine.reviews + mine.added) await putDay({ ...emptyDay(d.date), ...d });
    }
    if (backup.settings) { settings = { ...DEFAULT_SETTINGS, ...backup.settings, reminders: settings.reminders }; await saveSettings(); }
    await refreshLanguages();
    await checkBadges();
    renderMe();
    toast(`Imported ${plural(backup.cards.length, 'card')}`);
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
const GRADES = ['again', 'good', 'easy'];

let mode = prefs.get('reviewMode') ?? 'audio';
let session = null;

function setMode(m) {
  mode = MODE_HINTS[m] ? m : 'audio';
  prefs.set('reviewMode', mode);
  document.querySelectorAll('#review-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#mode-hint').textContent = MODE_HINTS[mode];
  $('#review-empty').hidden = true;
}

document.querySelectorAll('#review-mode button').forEach((b) =>
  b.addEventListener('click', () => { setMode(b.dataset.mode); renderToday(); })
);
$('#review-language').addEventListener('change', renderToday);

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

function startSession(cards, practice) {
  session = {
    practice,
    queue: cards,
    total: cards.length,
    done: 0,
    graded: new Set(), // cards answered once; later repeats don't count again
    reviews: 0,
    correct: 0,
    xp: 0,
    combo: 0,
    goalJustMet: false,
    current: null,
  };
  $('#session-card').hidden = false;
  $('#session-done').hidden = true;
  showView('session');
  showNext();
}

function showNext() {
  player.pause();
  const s = session;
  s.current = s.queue.shift();
  $('#progress-bar').style.width = `${s.total ? (s.done / s.total) * 100 : 0}%`;
  if (!s.current) {
    finishSession();
    return;
  }
  const c = s.current;
  $('#card-tag').textContent = s.graded.has(c.id) ? 'Again' : isNew(c) ? 'New' : s.practice ? 'Practice' : 'Review';
  $('#card-tag').className = `card-tag ${s.graded.has(c.id) ? 'again' : isNew(c) ? 'new' : ''}`;
  $('#review-prompt').replaceChildren(...promptFor(c).filter(Boolean));
  $('#review-answer').replaceChildren(...answerFor(c));
  $('#review-answer').hidden = true;
  $('#reveal-btn').hidden = false;
  $('#grades').hidden = true;
  const card = $('#flashcard');
  card.classList.remove('enter');
  void card.offsetWidth; // restart the animation
  card.classList.add('enter');
}

function reveal() {
  const s = session;
  $('#review-answer').hidden = false;
  $('#reveal-btn').hidden = true;
  $('#grades').hidden = false;
  // Show when each answer would bring the card back. Practice and repeats don't reschedule.
  const showIntervals = !s.practice && !s.graded.has(s.current.id);
  for (const g of GRADES) {
    $(`#iv-${g}`).textContent = showIntervals ? formatInterval(g === 'again' ? 0 : schedule(s.current, g).interval) : '';
  }
}

async function grade(g) {
  const s = session;
  const card = s.current;
  if (!card) return;
  s.current = null;
  buzz(g === 'again' ? [15, 30, 15] : 10);

  if (!s.graded.has(card.id)) {
    s.graded.add(card.id);
    const ok = g !== 'again';
    const wasNew = isNew(card);
    if (!s.practice) await putCard({ ...card, ...schedule(card, g) });
    const xp = XP[g];
    s.reviews++;
    s.xp += xp;
    if (ok) s.correct++;
    const { goalJustMet } = await updateToday((d) => {
      d.reviews++;
      d.xp += xp;
      if (ok) d.correct++;
      if (wasNew && !s.practice) d.newSeen++;
    });
    if (goalJustMet) {
      s.goalJustMet = true;
      s.xp += XP.goal;
      toast(`🔥 Daily goal reached! +${XP.goal} XP`, 2400);
    }
  }

  s.combo = g === 'again' ? 0 : s.combo + 1;
  $('#combo').hidden = s.combo < 3;
  $('#combo').textContent = `🔥 ${s.combo}`;
  $('#combo').classList.remove('pop');
  void $('#combo').offsetWidth;
  $('#combo').classList.add('pop');

  if (g === 'again') {
    // Put the card back a few positions later so it comes up again this session.
    s.queue.splice(Math.min(3, s.queue.length), 0, card);
  } else {
    s.done++;
  }
  showNext();
}

async function finishSession() {
  const s = session;
  player.pause();
  if (!s.reviews) { endSession(); return; }
  const perfect = s.reviews >= 10 && s.correct === s.reviews;
  if (perfect) { profile.perfectSessions = (profile.perfectSessions ?? 0) + 1; await saveProfile(); }

  const { stats, days } = await loadStats();
  const today = days.find((d) => d.date === dayKey());
  const acc = Math.round((s.correct / s.reviews) * 100);
  $('#done-emoji').textContent = s.goalJustMet ? '🔥' : perfect ? '✨' : acc >= 80 ? '🎉' : '💪';
  $('#done-title').textContent = s.goalJustMet
    ? stats.streak > 1 ? `${stats.streak}-day streak!` : 'Streak started!'
    : perfect ? 'Flawless!' : 'Session complete';
  $('#done-sub').textContent = s.goalJustMet
    ? 'Daily goal reached. Come back tomorrow to keep it going.'
    : today?.goalMet
      ? 'Goal already done today. Nice extra practice.'
      : `${settings.goal - (today?.reviews ?? 0)} more to reach today's goal.`;
  $('#done-xp').textContent = `+${s.xp}`;
  $('#done-cards').textContent = s.reviews;
  $('#done-acc').textContent = `${acc}%`;
  $('#session-card').hidden = true;
  $('#session-done').hidden = false;
  $('#progress-bar').style.width = '100%';
  $('#combo').hidden = true;
  if (s.goalJustMet || perfect) celebrate();
  checkBadges();
}

function celebrate() {
  const colors = ['#f97316', '#facc15', '#2dd4bf', '#ec4899', '#60a5fa'];
  $('#confetti').replaceChildren(
    ...Array.from({ length: 40 }, (_, i) =>
      el('i', {
        style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};` +
          `animation-delay:${Math.random() * 0.4}s;animation-duration:${1.6 + Math.random()}s;` +
          `transform:rotate(${Math.random() * 360}deg)`,
      })
    )
  );
  buzz([30, 60, 30, 60, 60]);
}

function endSession() {
  player.pause();
  session = null;
  $('#confetti').replaceChildren();
  showView('today');
}

$('#start-review').addEventListener('click', async () => {
  const today = dayKey();
  const pool = reviewable(await getAllCards());
  const { due, fresh } = scheduledQueue(pool, today, await getDay(today));
  // Due cards first (most overdue first, shuffled within that), new cards mixed into the second half.
  const queue = [...shuffle(due)];
  for (const c of fresh) queue.splice(Math.floor(queue.length / 2 + Math.random() * (queue.length / 2 + 1)), 0, c);
  if (!queue.length) return;
  startSession(queue, false);
});

$('#start-practice').addEventListener('click', async () => {
  const pool = reviewable(await getAllCards());
  if (!pool.length) {
    $('#review-empty').textContent = mode === 'audio' ? 'No cards with audio yet.' : 'No cards yet. Add some first.';
    $('#review-empty').hidden = false;
    return;
  }
  startSession(shuffle(pool), true);
});

$('#reveal-btn').addEventListener('click', reveal);
$('#grades').addEventListener('click', (e) => {
  const b = e.target.closest('[data-grade]');
  if (b) grade(b.dataset.grade);
});
$('#end-review').addEventListener('click', () => (session?.reviews ? finishSession() : endSession()));
$('#done-btn').addEventListener('click', endSession);

document.addEventListener('keydown', (e) => {
  if ($('#view-session').hidden || e.target.matches('input, select, textarea')) return;
  if (!$('#session-done').hidden) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); endSession(); }
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!$('#reveal-btn').hidden) reveal();
  } else if (!$('#grades').hidden && ['1', '2', '3'].includes(e.key)) {
    grade(GRADES[Number(e.key) - 1]);
  } else if (e.key === 'Escape') {
    $('#end-review').click();
  }
});

// ---------- start up ----------

$('#clean-audio').checked = prefs.get('cleanAudio') ?? true;
setMode(mode);
(async () => {
  settings = { ...DEFAULT_SETTINGS, ...(await getMeta('settings')) };
  profile = (await getMeta('profile')) ?? {};
  const cards = await refreshLanguages();
  // First run with existing cards: default to the most recently used language.
  if (!prefs.get('lastLanguage') && cards.length) {
    const latest = cards.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    prefs.set('lastLanguage', latest.language);
  }
  restoreDraft();
  renderToday();
  checkBadges();
})();

// Back from the background on a new day: refresh what's due.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#view-today').hidden) renderToday();
});

// ---------- offline / install ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.();
