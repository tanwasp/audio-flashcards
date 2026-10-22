// Haptics, little sounds, the mascot and a confirm sheet: the bits that make the app feel alive.

const prefs = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const feedbackSettings = {
  get haptics() { return prefs.get('haptics', true); },
  set haptics(v) { prefs.set('haptics', v); },
  get sounds() { return prefs.get('sounds', true); },
  set sounds(v) { prefs.set('sounds', v); },
};

// ---------- haptics ----------
// Android: the Vibration API. iPhone has no API, but Safari 18+ gives a haptic tick
// when a <input switch> is toggled, so we toggle a hidden one. Must run inside a tap.

const PATTERNS = {
  tap: 6,
  select: 8,
  success: [12, 60, 18],
  warning: [20, 40, 20],
  error: [30, 50, 30, 50, 30],
  heavy: 25,
  celebrate: [20, 50, 20, 50, 40, 80, 60],
};

let iosSwitch = null;
const isIos = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function iosTick() {
  if (!iosSwitch) {
    iosSwitch = document.createElement('label');
    iosSwitch.setAttribute('aria-hidden', 'true');
    iosSwitch.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    iosSwitch.append(input);
    document.body.append(iosSwitch);
  }
  iosSwitch.click();
}

export function haptic(kind = 'tap') {
  if (!feedbackSettings.haptics) return;
  if ('vibrate' in navigator && !isIos) {
    try { navigator.vibrate(PATTERNS[kind] ?? 6); } catch {}
  } else if (isIos) {
    iosTick();
  }
}

// ---------- sounds ----------
// Synthesized, so there are no files to load and they work offline.

// One AudioContext for the whole app (sounds and the recording level meter).
// iPhones can cut off a live recording when a new one is created mid-capture.
let ctx = null;
export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(c, { freq, to, at = 0, dur = 0.12, type = 'sine', gain = 0.08 }) {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SOUNDS = {
  correct: [{ freq: 784, dur: 0.1, type: 'triangle' }, { freq: 1175, at: 0.08, dur: 0.16, type: 'triangle' }],
  again: [{ freq: 330, to: 247, dur: 0.18, type: 'triangle', gain: 0.06 }],
  pop: [{ freq: 420, to: 920, dur: 0.09, gain: 0.1 }],
  saved: [{ freq: 523, dur: 0.09, type: 'triangle' }, { freq: 659, at: 0.07, dur: 0.09, type: 'triangle' }, { freq: 1047, at: 0.14, dur: 0.2, type: 'triangle' }],
  goal: [523, 659, 784, 1047, 1319].map((f, i) => ({ freq: f, at: i * 0.08, dur: 0.22, type: 'triangle', gain: 0.07 })),
};

export function sound(name) {
  if (!feedbackSettings.sounds) return;
  const c = audioCtx();
  if (c) for (const t of SOUNDS[name] ?? []) tone(c, t);
}

// ---------- mascot ----------
// The flashcard with headphones from the app icon, with a few moods.

const FACES = {
  happy: `
    <ellipse cx="220" cy="276" rx="13" ry="16" fill="#1c1917"/><ellipse cx="292" cy="276" rx="13" ry="16" fill="#1c1917"/>
    <circle cx="225" cy="270" r="5" fill="#fff"/><circle cx="297" cy="270" r="5" fill="#fff"/>
    <path d="M240 306 Q256 324 272 306" fill="none" stroke="#1c1917" stroke-width="7" stroke-linecap="round"/>`,
  excited: `
    <path d="M206 282 Q220 262 234 282 M278 282 Q292 262 306 282" fill="none" stroke="#1c1917" stroke-width="8" stroke-linecap="round"/>
    <path d="M236 302 Q256 302 276 302 Q274 330 256 330 Q238 330 236 302 Z" fill="#1c1917"/>
    <path d="M246 320 Q256 312 266 320 Q262 328 256 328 Q250 328 246 320 Z" fill="#fb7185"/>`,
  star: `
    <path d="M220 258 l6 12 13 2 -9.5 9 2.5 13 -12 -6.5 -12 6.5 2.5 -13 -9.5 -9 13 -2 z" fill="#f59e0b"/>
    <path d="M292 258 l6 12 13 2 -9.5 9 2.5 13 -12 -6.5 -12 6.5 2.5 -13 -9.5 -9 13 -2 z" fill="#f59e0b"/>
    <path d="M236 304 Q256 330 276 304" fill="none" stroke="#1c1917" stroke-width="7" stroke-linecap="round"/>`,
  sleepy: `
    <path d="M206 276 Q220 288 234 276 M278 276 Q292 288 306 276" fill="none" stroke="#1c1917" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="256" cy="312" rx="8" ry="9" fill="#1c1917"/>`,
  thinking: `
    <ellipse cx="222" cy="270" rx="12" ry="15" fill="#1c1917"/><ellipse cx="294" cy="270" rx="12" ry="15" fill="#1c1917"/>
    <circle cx="227" cy="263" r="4.5" fill="#fff"/><circle cx="299" cy="263" r="4.5" fill="#fff"/>
    <path d="M244 312 Q256 306 270 312" fill="none" stroke="#1c1917" stroke-width="7" stroke-linecap="round"/>`,
};

const EXTRAS = {
  sleepy: `<text x="352" y="176" font-family="Nunito, sans-serif" font-weight="900" font-size="44" fill="currentColor" opacity="0.6">z</text>
           <text x="384" y="140" font-family="Nunito, sans-serif" font-weight="900" font-size="30" fill="currentColor" opacity="0.4">z</text>`,
  excited: `<path d="M120 170 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z M392 150 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4 z" fill="#facc15"/>`,
  star: `<path d="M120 170 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z M392 150 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4 z" fill="#facc15"/>`,
  happy: `<path d="M380 150 v46 a14 12 0 1 1 -8 -11 v-44 l30 -8 v12 z" fill="currentColor" opacity="0.35"/>`,
};

export function mascot(mood = 'happy', cls = '') {
  return `<svg class="mascot ${cls}" viewBox="100 120 320 290" aria-hidden="true">
    <path d="M146 262 C146 150 366 150 366 262" fill="none" stroke="#134e4a" stroke-width="22" stroke-linecap="round"/>
    <g class="mascot-body" transform="rotate(-5 256 290)">
      <rect x="162" y="186" width="188" height="200" rx="40" fill="#fffbf5" stroke="#1c1917" stroke-opacity="0.08" stroke-width="3"/>
      <ellipse cx="200" cy="310" rx="16" ry="10" fill="#fda4af" opacity="0.85"/>
      <ellipse cx="312" cy="310" rx="16" ry="10" fill="#fda4af" opacity="0.85"/>
      ${FACES[mood] ?? FACES.happy}
    </g>
    <rect x="122" y="240" width="48" height="80" rx="22" fill="#f97316"/>
    <rect x="342" y="240" width="48" height="80" rx="22" fill="#f97316"/>
    ${EXTRAS[mood] ?? ''}
  </svg>`;
}

// ---------- confirm sheet ----------

export function confirmSheet({ title, body = '', confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = `
      <div class="sheet-body">
        <h2></h2><p class="muted"></p>
        <button class="btn block big ${danger ? 'danger-fill' : 'primary'}" value="yes"></button>
        <button class="btn block big" value="no">Cancel</button>
      </div>`;
    dlg.querySelector('h2').textContent = title;
    dlg.querySelector('p').textContent = body;
    dlg.querySelector('[value=yes]').textContent = confirm;
    const close = (answer) => {
      dlg.classList.add('closing');
      setTimeout(() => { dlg.close(); dlg.remove(); resolve(answer); }, 180);
    };
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) close(b.value === 'yes');
      else if (e.target === dlg) close(false); // tapped the backdrop
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    document.body.append(dlg);
    dlg.showModal();
    haptic(danger ? 'warning' : 'tap');
  });
}
