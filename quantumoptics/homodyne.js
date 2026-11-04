// Homodyne detection: the signal beats against a strong local oscillator on a 50:50 beam
// splitter, and the difference of the two photocurrents reads one quadrature of the signal.
//
// With the signal a and the local oscillator in the coherent state β = |β| e^{iθ}, the beam
// splitter's outputs are c = (a + β)/√2 and d = (a − β)/√2, and
//     c†c − d†d = β* a + β a† = 2 |β| X_θ,   X_θ = X1 cos θ + X2 sin θ:
// the local oscillator's phase θ chooses which quadrature is read, and the photocurrent's
// mean and noise are those of X_θ (for a Gaussian state, exactly Gaussian).  Everything here
// is in units of the quadrature, the 2|β| divided out.

import { quadratureMean, quadratureVariance } from './states.js';

/** A small seeded random generator (mulberry32), so that a run can be repeated. */
export class Rng {
  constructor(seed = 1) { this.s = seed >>> 0; this.spare = null; }
  /** Uniform in [0, 1). */
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** A standard normal deviate (Box–Muller, both halves used). */
  gauss() {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u, v, s;
    do { u = 2 * this.next() - 1; v = 2 * this.next() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * f;
    return u * f;
  }
}

/** One sample of the photocurrent (in quadrature units) for the state st and the LO phase θ. */
export function sample(st, theta, rng) {
  return quadratureMean(st, theta) + Math.sqrt(quadratureVariance(st, theta)) * rng.gauss();
}

/** The theory for the readout: the photocurrent's mean and variance at θ. */
export function photocurrent(st, theta) {
  return { mean: quadratureMean(st, theta), variance: quadratureVariance(st, theta) };
}

/**
 * The record of a scan: samples binned by the LO phase (bins over 0 … 2π), keeping each bin's
 * count, sum and sum of squares, so that the measured mean and variance against θ can be drawn.
 */
export class VarianceRecord {
  constructor(bins = 180) {
    this.bins = bins;
    this.n = new Float64Array(bins); this.sum = new Float64Array(bins); this.sum2 = new Float64Array(bins);
  }
  reset() { this.n.fill(0); this.sum.fill(0); this.sum2.fill(0); }
  bin(theta) {
    const t = theta / (2 * Math.PI);
    return Math.floor((t - Math.floor(t)) * this.bins) % this.bins;
  }
  add(theta, x) {
    const k = this.bin(theta);
    this.n[k]++; this.sum[k] += x; this.sum2[k] += x * x;
  }
  /** The bin's centre, count, mean and variance (null if fewer than 2 samples). */
  stats(k) {
    const n = this.n[k];
    if (n < 2) return null;
    const mean = this.sum[k] / n, v = Math.max(0, (this.sum2[k] - n * mean * mean) / (n - 1));
    return { theta: ((k + 0.5) / this.bins) * 2 * Math.PI, n, mean, variance: v };
  }
  get count() { let c = 0; for (let k = 0; k < this.bins; k++) c += this.n[k]; return c; }
}

/** Noise relative to the vacuum's, in decibels: 10 log10(V / (1/4)). */
export const noiseDb = (variance) => 10 * Math.log10(4 * variance);

/**
 * A phase measurement: a phase shift φ on the signal turns its cloud about the origin, and the
 * phase quadrature (θ = 90° from the mean field) reads |α| sin φ against the noise ΔX there.
 * Returns the shift of the mean, the noise and their ratio, and the smallest shift at ratio 1.
 */
export function phaseMeasurement(shifted, unshifted, theta) {
  const d = quadratureMean(shifted, theta) - quadratureMean(unshifted, theta);
  const sd = Math.sqrt(quadratureVariance(shifted, theta));
  const alpha = Math.hypot(unshifted.x1, unshifted.x2);
  return { shift: d, noise: sd, snr: d / sd, minimum: alpha > 0 ? Math.sqrt(quadratureVariance(unshifted, theta)) / alpha : Infinity };
}
