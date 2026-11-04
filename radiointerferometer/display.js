// The time streams the page shows: the same noise as the correlator's, slowed down.
//
// The correlator (sim.js) averages a fresh chunk of 512 carrier cycles every frame, far too
// fast to watch.  What the page draws instead is a slow-motion recording: each source gets a
// "tape", a periodic stretch of its band-limited noise 1024 cycles long (so it loops without a
// seam), and the page scrolls through it a few cycles a second.  What an antenna hears is
// composed from the sources' tapes with the antenna's own delays, every frame, so that moving
// an antenna moves what it hears at once, and B's stream is visibly A's, shifted.
//
// Tapes hold the complex envelope s(t) at 4 samples per cycle (enough for a band as wide as
// 2ν₀: the envelope then reaches ±ν₀); values between samples come by cubic interpolation, and
// the real voltage is x(t) = √2 Re[s(t) e^{2πiν₀t}].  Times are in carrier cycles.

import { ifft } from '../lib/fft.js';
import { gaussianPair, bandHalf } from './sim.js';

export const TAPE_CYCLES = 1024;
export const RATE = 4;                       // samples per cycle
export const LEN = TAPE_CYCLES * RATE;       // 4096
const TWO_PI = 2 * Math.PI;

/** A tape of band-limited complex Gaussian noise, mean power `power`, a flat band of width
 *  `band` (as a fraction of ν₀) round the carrier.  Returns {re, im}, periodic in LEN samples. */
export function makeTape(band, power = 1, random = Math.random) {
  const re = new Float64Array(LEN), im = new Float64Array(LEN), h = bandHalf(band, TAPE_CYCLES), nb = 2 * h + 1;
  // ifft divides by LEN; with coefficients a(g1 + i g2), ⟨|s|²⟩ = 2a² nb / LEN².
  const a = LEN * Math.sqrt(power / (2 * nb));
  for (let q = -h; q <= h; q++) {
    const [g1, g2] = gaussianPair(random), b = (q + LEN) % LEN;
    re[b] = a * g1; im[b] = a * g2;
  }
  ifft(re, im);
  return { re, im, band, power };
}

/** The envelope of a tape at time t (cycles), periodic, by Catmull–Rom interpolation.
 *  Writes [re, im] into out and returns it. */
export function sampleTape(tape, t, out = [0, 0]) {
  let x = t * RATE;
  x -= Math.floor(x / LEN) * LEN;
  const i1 = x | 0, f = x - i1;
  const i0 = (i1 + LEN - 1) % LEN, i2 = (i1 + 1) % LEN, i3 = (i1 + 2) % LEN;
  const f2 = f * f, f3 = f2 * f;
  // Catmull–Rom weights.
  const w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
  const R = tape.re, I = tape.im;
  out[0] = w0 * R[i0] + w1 * R[i1] + w2 * R[i2] + w3 * R[i3];
  out[1] = w0 * I[i0] + w1 * I[i1] + w2 * I[i2] + w3 * I[i3];
  return out;
}

/**
 * What a receiver hears, as a complex envelope, at `points` times from t0 to t1 (cycles):
 * Σ_k amp_k s_k(t − d_k) e^{−2πi d_k} + noise(t), each source k a tape (or the shared tape,
 * turned by phase_k, when the sources are coherent).  terms: [{tape, delay, amp, phase}].
 * Writes into out = [re, im] (Float64Arrays of `points`) and returns it.
 */
export function receiverStream(terms, noise, noiseAmp, t0, t1, points, out) {
  const re = out[0], im = out[1], s = [0, 0], dt = points > 1 ? (t1 - t0) / (points - 1) : 0;
  re.fill(0, 0, points); im.fill(0, 0, points);
  for (const { tape, delay, amp, phase = 0 } of terms) {
    const ph = -TWO_PI * delay + phase, c = amp * Math.cos(ph), d = amp * Math.sin(ph);
    for (let p = 0; p < points; p++) {
      sampleTape(tape, t0 + p * dt - delay, s);
      re[p] += c * s[0] - d * s[1]; im[p] += c * s[1] + d * s[0];
    }
  }
  if (noise && noiseAmp > 0) for (let p = 0; p < points; p++) {
    sampleTape(noise, t0 + p * dt, s);
    re[p] += noiseAmp * s[0]; im[p] += noiseAmp * s[1];
  }
  return out;
}

/** The real voltage x(t) = √2 Re[s(t) e^{2πiν₀t}] of a stream of envelopes at times t0 + p dt. */
export function realVoltage(env, t0, t1, points, out) {
  const dt = points > 1 ? (t1 - t0) / (points - 1) : 0, re = env[0], im = env[1];
  for (let p = 0; p < points; p++) {
    const ph = TWO_PI * (t0 + p * dt);
    out[p] = Math.SQRT2 * (re[p] * Math.cos(ph) - im[p] * Math.sin(ph));
  }
  return out;
}

/** The real voltage of one tape at one time (for the field over the ground). */
export function voltageAt(tape, t, amp = 1, phase = 0, s = [0, 0]) {
  sampleTape(tape, t, s);
  const ph = TWO_PI * t + phase;
  return Math.SQRT2 * amp * (s[0] * Math.cos(ph) - s[1] * Math.sin(ph));
}
