// The drum's sound: a sum of its modes, each a damped sine, played through Web Audio.
//
// A drum struck at time 0 (displacement 0, a short velocity kick v₀ under the mallet) moves as
//   u(x, t) = Σ_k (a_k/ω_k) φ_k(x) sin(ω_k t),   a_k = ⟨φ_k | v₀⟩,
// and what is heard here is the membrane under the mallet, ⟨v₀|u⟩ = Σ (a_k²/ω_k) sin ω_k t: the
// same weights as the spectroscopist's signal.  Real drums lose their high modes first; here
// every mode rings for the same number of cycles (a constant Q), so mode k decays in
// τ_k = τ₁ f₁/f_k.  Only synthesize() is needed by the tests; play() touches the audio system.

/**
 * Samples of Σ_k amps[k] sin(2π f_k t) e^{−t/τ_k}, normalised to an r.m.s. of 0.2 (over the first
 * half second), as a Float32Array.  Each mode by the two-term recurrence of a damped sine.
 */
export function synthesize(freqs, amps, taus, sampleRate, duration) {
  const S = Math.max(1, Math.round(sampleRate * duration)), out = new Float64Array(S);
  const nyquist = 0.45 * sampleRate;
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k], A = amps[k];
    if (!(f > 0 && f < nyquist) || !A) continue;
    const w = (2 * Math.PI * f) / sampleRate, r = Math.exp(-1 / (taus[k] * sampleRate));
    const c = 2 * r * Math.cos(w), r2 = r * r;
    let y1 = 0, y0 = A * r * Math.sin(w); // y[0] = 0, y[1]
    const end = Math.min(S, Math.ceil(taus[k] * sampleRate * 12));
    for (let n = 1; n < end; n++) { out[n] += y0; const y = c * y0 - r2 * y1; y1 = y0; y0 = y; }
  }
  // A few milliseconds of fade-in at the very start keep the speaker from clicking.
  let ms = 0;
  const M = Math.min(S, Math.round(0.5 * sampleRate));
  for (let n = 0; n < M; n++) ms += out[n] * out[n];
  const g = ms > 0 ? 0.2 / Math.sqrt(ms / M) : 0;
  const fade = Math.round(0.002 * sampleRate), res = new Float32Array(S);
  for (let n = 0; n < S; n++) res[n] = out[n] * g * (n < fade ? n / fade : 1);
  return res;
}

export const SAMPLE_RATE = 44100;
let ctx = null, comp = null, playing = null;

/**
 * Play samples (a Float32Array at SAMPLE_RATE) at a volume 0..1, stopping whatever was playing.
 * The audio system is started on the first call, which must come from a click (browsers allow
 * sound only after one).  Returns false if this browser has no Web Audio.
 */
export function play(samples, volume = 0.5) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return false;
  if (!ctx) {
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  stop();
  const buf = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  gain.gain.value = volume;
  src.buffer = buf; src.connect(gain); gain.connect(comp);
  src.start();
  playing = { src, gain };
  return true;
}

export function stop() {
  if (!playing || !ctx) return;
  const { src, gain } = playing;
  playing = null;
  try { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015); src.stop(ctx.currentTime + 0.08); } catch { /* already stopped */ }
}
