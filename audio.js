// Light audio clean-up for short word/phrase clips, done entirely on-device:
//   1. high-pass filter to cut low rumble (traffic, AC, handling noise)
//   2. noise gate that quiets the hiss between words
//   3. trim silence at the start and end
//   4. normalize volume
// Output is a mono 16-bit WAV.

const SAMPLE_RATE = 24000; // plenty for speech, keeps files small
const FRAME = 480; // 20 ms at 24 kHz

export async function cleanAudio(blob) {
  const decoded = await decode(blob);
  const samples = await highPass(decoded);
  gate(samples);
  const trimmed = trim(samples);
  normalize(trimmed);
  return encodeWav(trimmed, SAMPLE_RATE);
}

// Decode any audio file to mono samples at SAMPLE_RATE, for the waveform and trimming.
export async function decodeMono(blob) {
  const decoded = await decode(blob);
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  return { samples: (await ctx.startRendering()).getChannelData(0), rate: SAMPLE_RATE };
}

// Loudness of `n` equal slices, scaled so the loudest is 1.
export function peaks(samples, n) {
  const out = new Float32Array(n);
  const size = samples.length / n;
  let max = 0;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    const end = Math.min(samples.length, Math.floor((i + 1) * size));
    for (let j = Math.floor(i * size); j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
    out[i] = peak;
    max = Math.max(max, peak);
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  return out;
}

// Keep the part between `start` and `end` seconds, with short fades so the cut doesn't click.
export function crop(samples, rate, start, end) {
  const out = samples.slice(Math.floor(start * rate), Math.ceil(end * rate));
  const fade = Math.min(Math.floor(0.008 * rate), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return encodeWav(out, rate);
}

async function decode(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close();
  }
}

// Resample to mono SAMPLE_RATE and apply the high-pass filter in one offline render.
async function highPass(buffer) {
  const length = Math.ceil(buffer.duration * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 85;
  src.connect(hp).connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

function frameLevels(samples) {
  const levels = [];
  for (let i = 0; i < samples.length; i += FRAME) {
    let sum = 0;
    const end = Math.min(i + FRAME, samples.length);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / (end - i)));
  }
  return levels;
}

// Speech threshold: a few times the background level, estimated from the quietest frames.
function threshold(levels) {
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  return Math.max(floor * 3, 0.004);
}

function gate(samples) {
  const levels = frameLevels(samples);
  const thr = threshold(levels);
  const HOLD = 8; // frames (160 ms) to stay open after speech so word endings aren't clipped
  const CLOSED = 0.12; // about -18 dB: quieter, not silent, so it doesn't sound chopped

  const target = new Float32Array(levels.length);
  let hold = 0;
  for (let f = 0; f < levels.length; f++) {
    hold = levels[f] > thr ? HOLD : Math.max(0, hold - 1);
    target[f] = hold > 0 ? 1 : CLOSED;
  }

  // Smooth gain changes sample by sample: fast open, slower close.
  const attack = 1 - Math.exp(-1 / (0.005 * SAMPLE_RATE));
  const release = 1 - Math.exp(-1 / (0.08 * SAMPLE_RATE));
  let g = target[0] ?? 1;
  for (let i = 0; i < samples.length; i++) {
    const t = target[Math.floor(i / FRAME)];
    g += (t - g) * (t > g ? attack : release);
    samples[i] *= g;
  }
}

function trim(samples) {
  const levels = frameLevels(samples);
  const thr = threshold(levels);
  const first = levels.findIndex((l) => l > thr);
  if (first === -1) return samples; // nothing that looks like speech; leave it alone
  let last = levels.length - 1;
  while (last > first && levels[last] <= thr) last--;
  const pad = Math.round(0.15 * SAMPLE_RATE);
  const start = Math.max(0, first * FRAME - pad);
  const end = Math.min(samples.length, (last + 1) * FRAME + pad);
  return samples.slice(start, end);
}

function normalize(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak < 1e-4) return;
  const gain = Math.min(0.9 / peak, 10); // cap boost so near-silent clips don't become loud noise
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

function encodeWav(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}
