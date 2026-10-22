// The audio editor on the Add screen: a waveform you can tap to play, a live level
// meter while recording, and trim handles to crop the clip.

import { decodeMono, peaks, crop } from './audio.js';
import { haptic } from './feedback.js';

const BAR = 3;
const GAP = 2;
const MIN_LEN = 0.15; // seconds; shortest clip trimming allows

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, width, height };
}

function bar(g, x, h, height, color) {
  const y = (height - h) / 2;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, BAR, h, BAR / 2);
  g.fill();
}

export function createWaveEditor(root, { onTrim }) {
  const $ = (s) => root.querySelector(s);
  const canvas = $('#wave-canvas');
  const wave = $('#wave');
  const audio = new Audio();
  let blob = null;
  let url = null;
  let decoded = null; // { samples, rate }
  let levels = null;
  let duration = 0;
  let trimming = false;
  let sel = { start: 0, end: 1 }; // fractions of the clip
  let stopAt = null; // seconds; stop playback here (trim preview)
  let raf = 0;

  function draw() {
    if (!levels || wave.offsetParent === null) return;
    const { g, width, height } = sizeCanvas(canvas);
    const n = Math.floor((width + GAP) / (BAR + GAP));
    const data = levels.length === n ? levels : (levels = peaks(decoded.samples, n));
    const played = duration ? audio.currentTime / duration : 0;
    const playing = !audio.paused;
    const on = css('--accent');
    const off = css('--wave');
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const h = Math.max(3, data[i] * (height - 4));
      bar(g, i * (BAR + GAP), h, height, playing && f <= played ? on : off);
    }
    if (trimming) {
      wave.style.setProperty('--s', `${sel.start * 100}%`);
      wave.style.setProperty('--e', `${sel.end * 100}%`);
      $('#trim-label').textContent = `${fmt(sel.start * duration)} – ${fmt(sel.end * duration)} · ${((sel.end - sel.start) * duration).toFixed(1)}s`;
    }
  }

  function tick() {
    if (stopAt != null && audio.currentTime >= stopAt) audio.pause();
    draw();
    $('#wave-time').textContent = audio.paused ? fmt(duration) : fmt(audio.currentTime);
    if (!audio.paused) raf = requestAnimationFrame(tick);
  }

  function setPlayIcon() {
    const btn = $('#wave-play');
    btn.classList.toggle('playing', !audio.paused);
    btn.innerHTML = audio.paused
      ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';
  }
  audio.addEventListener('play', () => { setPlayIcon(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  audio.addEventListener('pause', () => { setPlayIcon(); stopAt = null; draw(); $('#wave-time').textContent = fmt(duration); });
  audio.addEventListener('ended', () => audio.pause());

  function playFrom(seconds, until = null) {
    audio.currentTime = Math.max(0, Math.min(seconds, duration - 0.01));
    stopAt = until;
    audio.play().catch(() => {});
  }

  $('#wave-play').addEventListener('click', () => {
    if (!audio.paused) { audio.pause(); return; }
    haptic('tap');
    if (trimming) playFrom(sel.start * duration, sel.end * duration);
    else playFrom(audio.currentTime >= duration - 0.05 ? 0 : audio.currentTime);
  });

  // Tap the waveform to play from there; in trim mode, drag the nearest handle.
  let dragging = null;
  const fracAt = (e) => {
    const r = wave.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  wave.addEventListener('pointerdown', (e) => {
    if (!decoded) return;
    const f = fracAt(e);
    if (!trimming) {
      haptic('tap');
      playFrom(f * duration);
      return;
    }
    dragging = Math.abs(f - sel.start) < Math.abs(f - sel.end) ? 'start' : 'end';
    wave.setPointerCapture(e.pointerId);
    wave.classList.add(`drag-${dragging}`);
    haptic('select');
    audio.pause();
    moveHandle(f);
  });
  wave.addEventListener('pointermove', (e) => dragging && moveHandle(fracAt(e)));
  const endDrag = () => {
    if (!dragging) return;
    wave.classList.remove(`drag-${dragging}`);
    // Preview what's kept from the moved edge.
    const s = sel.start * duration, en = sel.end * duration;
    if (dragging === 'start') playFrom(s, Math.min(en, s + 1.5));
    else playFrom(Math.max(s, en - 1.5), en);
    dragging = null;
  };
  wave.addEventListener('pointerup', endDrag);
  wave.addEventListener('pointercancel', endDrag);

  function moveHandle(f) {
    const gap = Math.min(1, MIN_LEN / duration);
    const before = { ...sel };
    if (dragging === 'start') sel.start = Math.min(f, sel.end - gap);
    else sel.end = Math.max(f, sel.start + gap);
    // A light tick each time an edge reaches an end of the clip.
    if ((sel.start === 0 && before.start !== 0) || (sel.end === 1 && before.end !== 1)) haptic('tap');
    draw();
  }

  function setTrimming(on) {
    trimming = on;
    root.dataset.state = on ? 'trimming' : 'ready';
    audio.pause();
    if (on) sel = { start: 0, end: 1 };
    requestAnimationFrame(draw);
  }

  $('#trim-btn').addEventListener('click', () => { haptic('select'); setTrimming(true); });
  $('#trim-cancel').addEventListener('click', () => setTrimming(false));
  $('#trim-reset').addEventListener('click', () => { sel = { start: 0, end: 1 }; haptic('tap'); draw(); });
  $('#trim-done').addEventListener('click', async () => {
    if (sel.start <= 0.001 && sel.end >= 0.999) { setTrimming(false); return; }
    const cut = crop(decoded.samples, decoded.rate, sel.start * duration, sel.end * duration);
    haptic('success');
    setTrimming(false);
    await onTrim(cut);
  });

  window.addEventListener('resize', () => requestAnimationFrame(draw));

  // ---------- live level meter while recording ----------

  // `src` is the microphone's source node in the shared audio context.
  function meter(src) {
    const mc = $('#level-meter');
    const an = src.context.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const history = [];
    let frame = 0;
    let id = 0;
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      // Every other frame, to scroll at a calm pace.
      if (frame++ % 2 === 0) history.push(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      const { g, width, height } = sizeCanvas(mc);
      const n = Math.floor((width + GAP) / (BAR + GAP));
      while (history.length > n) history.shift();
      const color = css('--danger');
      history.forEach((v, i) => bar(g, width - (history.length - i) * (BAR + GAP), Math.max(3, v * (height - 4)), height, color));
      id = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(id); an.disconnect(); };
  }

  // Duration from the audio element, for clips the browser can play but not decode.
  const elementDuration = () => new Promise((resolve) => {
    const done = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    if (audio.readyState >= 1) done();
    else {
      audio.addEventListener('loadedmetadata', done, { once: true });
      audio.addEventListener('error', done, { once: true });
    }
  });

  return {
    meter,
    get trimming() { return trimming; },
    pause: () => audio.pause(),
    async show(newBlob) {
      audio.pause();
      if (url) URL.revokeObjectURL(url);
      blob = newBlob;
      decoded = levels = null;
      trimming = false;
      if (!blob) {
        url = null;
        audio.removeAttribute('src');
        return;
      }
      url = URL.createObjectURL(blob);
      audio.src = url;
      let ok = true;
      try {
        decoded = await decodeMono(blob);
      } catch {
        ok = false;
      }
      if (blob !== newBlob) return; // replaced while decoding
      // Some browsers decode only the start of their own recordings. If the decoded clip
      // is much shorter than what plays, show a plain bar and turn off trimming.
      const playable = await elementDuration();
      if (ok && playable > 0.5 && decoded.samples.length / decoded.rate < playable * 0.6) ok = false;
      if (blob !== newBlob) return;
      if (!ok) decoded = { samples: new Float32Array(64).fill(0.3), rate: 64 / (playable || 1) };
      root.classList.toggle('no-trim', !ok);
      duration = decoded.samples.length / decoded.rate;
      levels = new Float32Array(0);
      $('#wave-time').textContent = fmt(duration);
      setPlayIcon();
      requestAnimationFrame(draw);
    },
  };
}
