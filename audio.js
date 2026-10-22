// Decoding audio files for their waveform. Recordings made in the app don't need this
// (their waveform comes from the level meter); it's for uploaded files and old cards.

const SAMPLE_RATE = 8000; // plenty for drawing a waveform

export async function decodeMono(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close();
  }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return { samples: (await off.startRendering()).getChannelData(0), rate: SAMPLE_RATE };
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
