// The audio editor on the Add screen: a waveform you can tap to play, a live level
// meter while recording, and trim handles.
//
// Trimming never re-encodes the audio. It stores a start and end time and playback
// sticks to that range. iPhone Safari can't reliably decode its own recordings, so
// nothing here depends on decoding them: the waveform of a recording comes from the
// level meter while it was being made.

import { decodeMono, peaks as decodePeaks } from './audio.js';
import { haptic, audioCtx } from './feedback.js';

export const PEAK_COUNT = 160; // waveform resolution stored with a card
const BAR = 3;
const GAP = 2;
const MIN_LEN = 0.15; // seconds; shortest clip trimming allows

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (s) => `${Math.floor(s / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, '0')}`;

// ---------- playing part of a clip ----------

const stopAt = new WeakMap();
const watched = new WeakSet();

// Play `el` from `from` to `to` seconds. iPhone Safari doesn't load a clip's metadata
// until it starts playing, so seeking may have to wait; it stays muted until then so
// the trimmed-off start isn't heard.
export function playClip(el, from = 0, to = null) {
  stopAt.set(el, to);
  if (!watched.has(el)) {
    watched.add(el);
    el.addEventListener('playing', () => {
      const check = () => {
        if (el.paused) return;
        const end = stopAt.get(el);
        if (end != null && el.currentTime >= end) el.pause();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }
  const seek = () => { try { el.currentTime = from; } catch {} };
  if (el.readyState >= 1) {
    seek();
  } else if (from > 0.01) {
    el.muted = true;
    const unmute = () => (el.muted = false);
    el.addEventListener('loadedmetadata', seek, { once: true });
    el.addEventListener('seeked', unmute, { once: true });
    setTimeout(unmute, 800);
  }
  return el.play();
}

// Resample levels to `n` bars (taking the loudest in each) scaled so the loudest is 1.
export function resamplePeaks(levels, n = PEAK_COUNT) {
  const out = new Array(n).fill(0);
  if (!levels.length) return out;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * levels.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    for (let j = a; j < b && j < levels.length; j++) out[i] = Math.max(out[i], levels[j]);
    max = Math.max(max, out[i]);
  }
  return out.map((v) => (max ? Math.round((v / max) * 100) / 100 : 0));
}

// ---------- drawing ----------

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, width, height };
}

function bar(g, x, h, height, color, alpha = 1) {
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, (height - h) / 2, BAR, h, BAR / 2);
  g.fill();
  g.globalAlpha = 1;
}

// ---------- editor ----------

export function createWaveEditor(root, { onTrim }) {
  const $ = (s) => root.querySelector(s);
  const canvas = $('#wave-canvas');
  const wave = $('#wave');
  const audio = new Audio();
  audio.preload = 'auto';
  let url = null;
  let clip = null; // { blob, peaks, duration, trim: { start, end } | null }
  let trimming = false;
  let sel = { start: 0, end: 0 }; // seconds, while trimming
  let raf = 0;

  const kept = () => (trimming ? sel : clip?.trim ?? { start: 0, end: clip?.duration ?? 0 });

  function draw() {
    if (!clip?.peaks || wave.offsetParent === null) return;
    const { g, width, height } = sizeCanvas(canvas);
    const n = Math.floor((width + GAP) / (BAR + GAP));
    const d = clip.duration || 1;
    const { start, end } = kept();
    const playing = !audio.paused;
    const on = css('--accent');
    const off = css('--wave');
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * d;
      const level = clip.peaks[Math.min(clip.peaks.length - 1, Math.floor((i / n) * clip.peaks.length))];
      const h = Math.max(3, level * (height - 4));
      const inside = t >= start && t <= end;
      bar(g, i * (BAR + GAP), h, height, playing && inside && t <= audio.currentTime ? on : off, inside || trimming ? 1 : 0.35);
    }
    if (trimming) {
      wave.style.setProperty('--s', `${(sel.start / d) * 100}%`);
      wave.style.setProperty('--e', `${(sel.end / d) * 100}%`);
      $('#trim-label').textContent = `${fmt(sel.start)} – ${fmt(sel.end)} · ${(sel.end - sel.start).toFixed(1)}s`;
    }
  }

  function showTime() {
    const { start, end } = kept();
    $('#wave-time').textContent = audio.paused ? fmt(end - start) : fmt(audio.currentTime - start);
  }

  function tick() {
    draw();
    showTime();
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
  audio.addEventListener('pause', () => { setPlayIcon(); draw(); showTime(); });
  audio.addEventListener('ended', () => audio.pause());

  function playRange(from, to) {
    playClip(audio, from, to).catch(() => {});
  }

  $('#wave-play').addEventListener('click', () => {
    if (!audio.paused) { audio.pause(); return; }
    haptic('tap');
    const { start, end } = kept();
    playRange(start, end);
  });

  // Tap the waveform to play from there; while trimming, drag the nearest handle.
  let dragging = null;
  const timeAt = (e) => {
    const r = wave.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * clip.duration;
  };
  wave.addEventListener('pointerdown', (e) => {
    if (!clip?.duration) return;
    const t = timeAt(e);
    if (!trimming) {
      const { start, end } = kept();
      haptic('tap');
      playRange(Math.min(Math.max(t, start), end - 0.05), end);
      return;
    }
    dragging = Math.abs(t - sel.start) < Math.abs(t - sel.end) ? 'start' : 'end';
    wave.setPointerCapture(e.pointerId);
    wave.classList.add(`drag-${dragging}`);
    haptic('select');
    audio.pause();
    moveHandle(t);
  });
  wave.addEventListener('pointermove', (e) => dragging && moveHandle(timeAt(e)));
  const endDrag = () => {
    if (!dragging) return;
    wave.classList.remove(`drag-${dragging}`);
    // Preview what's kept from the moved edge.
    if (dragging === 'start') playRange(sel.start, Math.min(sel.end, sel.start + 1.5));
    else playRange(Math.max(sel.start, sel.end - 1.5), sel.end);
    dragging = null;
  };
  wave.addEventListener('pointerup', endDrag);
  wave.addEventListener('pointercancel', endDrag);

  function moveHandle(t) {
    const d = clip.duration;
    const gap = Math.min(d, MIN_LEN);
    const before = { ...sel };
    if (dragging === 'start') sel.start = Math.max(0, Math.min(t, sel.end - gap));
    else sel.end = Math.min(d, Math.max(t, sel.start + gap));
    if ((sel.start === 0 && before.start !== 0) || (sel.end === d && before.end !== d)) haptic('tap');
    draw();
  }

  function setTrimming(on) {
    if (on) sel = { ...(clip.trim ?? { start: 0, end: clip.duration }) };
    trimming = on;
    root.dataset.state = on ? 'trimming' : 'ready';
    audio.pause();
    requestAnimationFrame(() => { draw(); showTime(); });
  }

  $('#trim-btn').addEventListener('click', () => { haptic('select'); setTrimming(true); });
  $('#trim-cancel').addEventListener('click', () => setTrimming(false));
  $('#trim-reset').addEventListener('click', () => { sel = { start: 0, end: clip.duration }; haptic('tap'); draw(); });
  $('#trim-done').addEventListener('click', () => {
    const whole = sel.start < 0.01 && sel.end > clip.duration - 0.01;
    clip.trim = whole ? null : { start: Math.round(sel.start * 100) / 100, end: Math.round(sel.end * 100) / 100 };
    haptic('success');
    setTrimming(false);
    onTrim(clip.trim);
  });

  window.addEventListener('resize', () => requestAnimationFrame(draw));

  // ---------- live level meter while recording ----------
  // Returns stop(), which gives back every level measured, for the clip's waveform.

  function meter(stream) {
    const mc = $('#level-meter');
    const all = [];
    let id = 0;
    let an = null;
    let src = null;
    try {
      const actx = audioCtx();
      an = actx.createAnalyser();
      an.fftSize = 1024;
      src = actx.createMediaStreamSource(stream);
      src.connect(an);
    } catch {
      return () => all; // no meter; the clip just gets a plain waveform
    }
    const buf = new Float32Array(an.fftSize);
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      all.push(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      const { g, width, height } = sizeCanvas(mc);
      const n = Math.floor((width + GAP) / (BAR + GAP));
      const shown = all.filter((_, i) => i % 2 === 0).slice(-n); // every other frame scrolls at a calm pace
      const color = css('--danger');
      shown.forEach((v, i) => bar(g, width - (shown.length - i) * (BAR + GAP), Math.max(3, v * (height - 4)), height, color));
      id = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(id);
      src.disconnect();
      return all;
    };
  }

  // Duration from the audio element; MediaRecorder files in Chrome report Infinity.
  const elementDuration = () => new Promise((resolve) => {
    const done = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    if (audio.readyState >= 1) return done();
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('error', () => resolve(0), { once: true });
    setTimeout(() => resolve(0), 1500); // iPhone may not load metadata before playing
  });

  return {
    meter,
    pause: () => audio.pause(),
    // Show a clip: { blob, peaks?, duration?, trim? }. Fills in the peaks and duration it
    // can work out and returns the clip so they can be saved with the card.
    async show(newClip) {
      audio.pause();
      trimming = false;
      if (url) URL.revokeObjectURL(url);
      clip = newClip;
      if (!clip?.blob) {
        url = null;
        audio.removeAttribute('src');
        return null;
      }
      const mine = clip;
      url = URL.createObjectURL(clip.blob);
      audio.src = url;
      if (!clip.peaks || !clip.duration) {
        const playable = await elementDuration();
        let decoded = null;
        try { decoded = await decodeMono(clip.blob); } catch {}
        if (clip !== mine) return null; // replaced meanwhile
        const decodedLen = decoded ? decoded.samples.length / decoded.rate : 0;
        clip.duration ||= playable || decodedLen;
        // Use the decoded waveform only if it covers the clip (see the note at the top).
        clip.peaks ||= decoded && decodedLen >= clip.duration * 0.9
          ? Array.from(decodePeaks(decoded.samples, PEAK_COUNT), (v) => Math.round(v * 100) / 100)
          : new Array(PEAK_COUNT).fill(0.3);
      }
      root.classList.toggle('no-trim', !clip.duration);
      setPlayIcon();
      requestAnimationFrame(() => { draw(); showTime(); });
      return clip;
    },
  };
}
