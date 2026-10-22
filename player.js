// The one audio element everything in the app plays through (deck, review, editor).
// Separate elements competing for playback is what made iPhone refuse to play a card
// right after it had been opened in the editor.
//
// Whoever starts playback passes an owner: { onPlay?, onStop? }. Starting something
// else, or reaching the end, calls the previous owner's onStop, so play buttons
// never get stuck showing "stop".

const el = new Audio();
el.preload = 'auto';
let owner = null;
let stopAt = null; // seconds; end of a trimmed range
let token = 0; // bumped on every play/stop so stale async steps bail out

// Object URLs for recently played clips, reused so replaying is instant.
const urls = new Map();
function urlFor(blob) {
  let url = urls.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(blob, url);
    if (urls.size > 30) {
      const [oldBlob, oldUrl] = urls.entries().next().value;
      if (oldUrl !== el.src) { URL.revokeObjectURL(oldUrl); urls.delete(oldBlob); }
    }
  }
  return url;
}

function finish() {
  const o = owner;
  owner = null;
  stopAt = null;
  el.muted = false;
  o?.onStop?.();
}

export function stop() {
  token++;
  if (!el.paused) el.pause();
  finish();
}

export const isPlaying = (o) => owner === o && !el.paused;
export const currentTime = () => el.currentTime;

const waitFor = (event, ms) => new Promise((resolve) => {
  const done = () => { el.removeEventListener(event, done); clearTimeout(t); resolve(); };
  const t = setTimeout(done, ms);
  el.addEventListener(event, done);
});

// Play `blob` from `from` to `to` seconds. Resolves true once playing.
export async function playRange(blob, { from = 0, to = null, owner: o = {} } = {}) {
  stop();
  const my = ++token;
  owner = o;
  stopAt = to;
  const url = urlFor(blob);
  if (el.src !== url || el.error) el.src = url;
  try {
    if (from > 0.01 && el.readyState < 1) {
      // iPhone only loads a clip once it plays, so seeking has to wait for that.
      // Stay muted until the seek lands so the trimmed-off start isn't heard.
      el.muted = true;
      await el.play();
      if (my !== token) return false;
      el.currentTime = from;
      await waitFor('seeked', 500);
      if (my !== token) return false;
      el.muted = false;
    } else {
      try { el.currentTime = from; } catch {}
      await el.play();
      if (my !== token) return false;
    }
    o.onPlay?.();
    watchEnd(my);
    return true;
  } catch {
    if (my === token) finish();
    return false;
  }
}

function watchEnd(my) {
  const check = () => {
    if (my !== token || el.paused) return;
    if (stopAt != null && el.currentTime >= stopAt) stop();
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

// Backups for when animation frames are paused (app in the background).
el.addEventListener('timeupdate', () => { if (stopAt != null && el.currentTime >= stopAt) stop(); });
el.addEventListener('ended', () => { token++; finish(); });
// Paused by the system (a call, another app). Ignore our own pause-then-replay.
el.addEventListener('pause', () => { if (el.paused && owner) { token++; finish(); } });
