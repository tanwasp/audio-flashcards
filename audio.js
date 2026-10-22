// Decoding audio files for their waveform. Recordings made in the app don't need this
// (their waveform comes from the level meter); it's for uploaded files and old cards.

import { audioCtx } from './feedback.js';

// Uses the app's one shared AudioContext: creating extra ones can interrupt playback on iPhone.
export async function decodeMono(blob) {
  const ctx = audioCtx();
  if (!ctx) throw new Error('no Web Audio');
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  return { samples: decoded.getChannelData(0), rate: decoded.sampleRate };
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
