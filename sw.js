// Service worker: network-first for the app's own files, falling back to the
// cache so the app opens offline. Card data lives in IndexedDB, not here.
// Also sends the daily reminder (Periodic Background Sync, where supported).

const CACHE = 'audio-flashcards-v5';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'audio.js',
  'srs.js',
  'game.js',
  'waveform.js',
  'feedback.js',
  'fonts/nunito-latin.woff2',
  'fonts/nunito-latin-ext.woff2',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// ---------- daily reminder ----------
// The browser wakes us now and then (at most every few hours, at its discretion).
// Notify once a day, after the chosen hour, if the daily goal isn't met yet.

function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('audio-flashcards');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function read(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = key === undefined
      ? db.transaction(store).objectStore(store).getAll()
      : db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function maybeRemind() {
  const db = await openDb();
  try {
    await remind(db);
  } finally {
    db.close(); // don't block the app from upgrading the database
  }
}

async function remind(db) {
  if (!db.objectStoreNames.contains('meta')) return;
  const settings = (await read(db, 'meta', 'settings')) ?? {};
  const now = new Date();
  const today = dayKey(now);
  if (!settings.reminders || now.getHours() < (settings.reminderHour ?? 19)) return;
  if ((await read(db, 'meta', 'lastReminder')) === today) return;
  const day = await read(db, 'days', today);
  if (day?.goalMet) return;

  const days = new Set((await read(db, 'days')).filter((d) => d.goalMet).map((d) => d.date));
  let streak = 0;
  for (const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); days.has(dayKey(d)); d.setDate(d.getDate() - 1)) streak++;
  const due = (await read(db, 'cards')).filter((c) => !c.due || c.due <= today).length;
  const left = Math.max(1, (settings.goal ?? 10) - (day?.reviews ?? 0));

  await self.registration.showNotification(
    streak ? `Keep your ${streak}-day streak alive 🔥` : 'Time for a quick review',
    {
      body: `${left} review${left === 1 ? '' : 's'} to hit today's goal` + (due ? ` · ${due} cards waiting` : ''),
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'reminder',
    }
  );
  await new Promise((resolve) => {
    const t = db.transaction('meta', 'readwrite');
    t.objectStore('meta').put(today, 'lastReminder');
    t.oncomplete = t.onerror = resolve;
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'daily-reminder') e.waitUntil(maybeRemind());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) =>
      list.length ? list[0].focus() : self.clients.openWindow('./')
    )
  );
});
