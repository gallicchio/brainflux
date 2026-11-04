// The detected signal: the record of the magnetization the coil sees, the EMF it induces (the
// raw trace a scope on the coil shows), the demodulated signal (the mixer's two outputs and the
// detector's envelope), thermal noise and averaging, the spectrum of a free induction decay, and
// the fits of time constants.  No DOM.
//
// The EMF.  A coil along x̂ sees V = −N A dB_x/dt ∝ −dM_x/dt.  With M_x = M_x′ cos ω_ref t +
// M_y′ sin ω_ref t (the rotating frame turns clockwise at ω_ref), the derivative is dominated by
// the fast factor: −dM_x/dt ≈ ω_ref (M_x′ sin ω_ref t − M_y′ cos ω_ref t), the slow change of M_x′
// and M_y′ being smaller by 1/(ω_ref T2*).  So the signal is ∝ ω0 × (the transverse
// magnetization), and the raw trace here is Vpk (M_x′ sin ω_ref t − M_y′ cos ω_ref t), with Vpk
// the EMF of the full equilibrium magnetization precessing (1.2 μV for the board's litre of
// water).  Mixing it with the reference and filtering gives M_x′ and M_y′ back: the demodulated
// signal, whose magnitude is the detector's envelope.

import { fft } from '../lib/fft.js';

// ------------------------------------------------------------------------ the record

/**
 * Samples of the magnetization in the rotating frame, (t, M_x′, M_y′, M_z), each with its own
 * thermal noise on the two transverse parts (nx, ny): what is left of unit noise after averaging
 * `averages` repeats.  The repeats' signals are the same, so their average is the signal plus the
 * mean of N standard normal numbers, which is a normal number of r.m.s. 1/√N: one is drawn,
 * divided by √N (meanGauss draws the N, for the tests).
 */
export class Record {
  constructor() { this.clear(); }

  clear() { this.t = []; this.x = []; this.y = []; this.z = []; this.nx = []; this.ny = []; }

  get length() { return this.t.length; }

  push(t, x, y, z, rng = null, averages = 1) {
    this.t.push(t); this.x.push(x); this.y.push(y); this.z.push(z);
    const k = 1 / Math.sqrt(Math.max(1, averages));
    this.nx.push(rng ? rng.gauss() * k : 0);
    this.ny.push(rng ? rng.gauss() * k : 0);
  }

  /** Draw the noise afresh for every sample, as the mean of `averages` repeats. */
  renoise(rng, averages = 1) {
    const k = 1 / Math.sqrt(Math.max(1, averages));
    for (let i = 0; i < this.t.length; i++) { this.nx[i] = rng.gauss() * k; this.ny[i] = rng.gauss() * k; }
  }

  /** Drop the samples before tMin (keeping one, for interpolation). */
  trim(tMin) {
    const i = Math.max(0, this.index(tMin));
    if (i > 0) for (const k of ['t', 'x', 'y', 'z', 'nx', 'ny']) this[k].splice(0, i);
  }

  /** The last index whose time is ≤ t (−1 before the first sample). */
  index(t) {
    const T = this.t;
    let lo = 0, hi = T.length - 1;
    if (hi < 0 || t < T[0]) return -1;
    if (t >= T[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo;
  }

  /** The magnetization at t by linear interpolation, with the noise times sigma added:
   *  [x, y, z].  Outside the record: its nearest end. */
  at(t, sigma = 0, out = [0, 0, 0]) {
    const T = this.t, n = T.length;
    if (n === 0) { out[0] = out[1] = out[2] = 0; return out; }
    let i = this.index(t);
    if (i < 0) i = 0;
    let j = Math.min(n - 1, i + 1), f = 0;
    if (j > i && T[j] > T[i]) f = Math.max(0, Math.min(1, (t - T[i]) / (T[j] - T[i])));
    out[0] = this.x[i] + (this.x[j] - this.x[i]) * f + sigma * (this.nx[i] + (this.nx[j] - this.nx[i]) * f);
    out[1] = this.y[i] + (this.y[j] - this.y[i]) * f + sigma * (this.ny[i] + (this.ny[j] - this.ny[i]) * f);
    out[2] = this.z[i] + (this.z[j] - this.z[i]) * f;
    return out;
  }

  /** The largest transverse magnitude (noise included) between t0 and t1, and when. */
  envelopeMax(t0, t1, sigma = 0) {
    let best = -1, tb = t0;
    const i0 = Math.max(0, this.index(t0)), i1 = Math.max(i0, this.index(t1));
    for (let i = i0; i <= i1; i++) {
      if (this.t[i] < t0 || this.t[i] > t1) continue;
      const m = Math.hypot(this.x[i] + sigma * this.nx[i], this.y[i] + sigma * this.ny[i]);
      if (m > best) { best = m; tb = this.t[i]; }
    }
    return { max: Math.max(0, best), t: tb };
  }

  /** The time-average of the envelope |M_xy| (noise included) between t0 and t1, the record
   *  interpolated at n evenly spaced times. */
  meanEnvelope(t0, t1, sigma = 0, n = 33) {
    const tmp = [0, 0, 0];
    let s = 0;
    for (let k = 0; k < n; k++) { const m = this.at(t0 + ((t1 - t0) * k) / (n - 1), sigma, tmp); s += Math.hypot(m[0], m[1]) * (k === 0 || k === n - 1 ? 0.5 : 1); }
    return s / (n - 1);
  }

  /** The time-average of M_y′ (noise included) between t0 and t1, a signed amplitude: the
   *  record interpolated at n evenly spaced times (its samples need not be evenly spaced). */
  meanY(t0, t1, sigma = 0, n = 33) {
    const tmp = [0, 0, 0];
    let s = 0;
    for (let k = 0; k < n; k++) s += this.at(t0 + ((t1 - t0) * k) / (n - 1), sigma, tmp)[1] * (k === 0 || k === n - 1 ? 0.5 : 1);
    return s / (n - 1);
  }
}

// -------------------------------------------------------------------------- the raw trace

/**
 * The raw trace V(t) = Vpk (M_x′ sin ω_ref t − M_y′ cos ω_ref t) at one time (noise included
 * through sigma, in units of Vpk).
 */
export function rawAt(record, omegaRef, t, sigma = 0, tmp = [0, 0, 0]) {
  const m = record.at(t, sigma, tmp), p = omegaRef * t;
  return m[0] * Math.sin(p) - m[1] * Math.cos(p);
}

/**
 * The raw trace between t0 and t1 in `cols` columns, as a scope draws it: the lowest and highest
 * value in each column (in units of Vpk).  Where a column holds a whole period or more the
 * oscillation sweeps every phase and the column is ± the envelope; otherwise the trace is
 * sampled `sub` times across it.  Returns {lo, hi} (Float32Arrays).
 */
export function rawColumns(record, omegaRef, t0, t1, cols, sigma = 0, sub = 4) {
  const lo = new Float32Array(cols), hi = new Float32Array(cols), w = (t1 - t0) / cols;
  const periodsPerCol = (w * omegaRef) / (2 * Math.PI);
  const tmp = [0, 0, 0];
  if (periodsPerCol >= 1) {
    // Every phase in every column: ± the largest envelope among the samples in it.
    for (let c = 0; c < cols; c++) {
      const ta = t0 + c * w, tb = ta + w;
      let m = 0;
      const i0 = Math.max(0, record.index(ta)), i1 = Math.max(i0, record.index(tb));
      for (let i = i0; i <= i1; i++) m = Math.max(m, Math.hypot(record.x[i] + sigma * record.nx[i], record.y[i] + sigma * record.ny[i]));
      lo[c] = -m; hi[c] = m;
    }
    return { lo, hi, envelope: true };
  }
  for (let c = 0; c < cols; c++) {
    let a = Infinity, b = -Infinity;
    for (let s = 0; s < sub; s++) {
      const v = rawAt(record, omegaRef, t0 + (c + (s + 0.5) / sub) * w, sigma, tmp);
      if (v < a) a = v;
      if (v > b) b = v;
    }
    lo[c] = a; hi[c] = b;
  }
  return { lo, hi, envelope: false };
}

// ------------------------------------------------------------------------ thermal noise

/** A seeded random generator (mulberry32) with standard normal numbers (Box–Muller). */
export class Rng {
  constructor(seed = 1) { this.s = seed >>> 0; this.spare = null; }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  gauss() {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u, v, s;
    do { u = 2 * this.next() - 1; v = 2 * this.next() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * f;
    return u * f;
  }
}

/** The mean of n standard normal numbers: what averaging n repeats does to unit noise. */
export function meanGauss(rng, n = 1) {
  if (n <= 1) return rng.gauss();
  let s = 0;
  for (let i = 0; i < n; i++) s += rng.gauss();
  return s / n;
}

/** The root mean square of an array. */
export function rms(a) {
  let s = 0;
  for (const v of a) s += v * v;
  return a.length ? Math.sqrt(s / a.length) : 0;
}

/** The r.m.s. of the noise in a record's transverse parts between t0 and t1, in units of Vpk. */
export function noiseRms(record, t0, t1, sigma) {
  const i0 = Math.max(0, record.index(t0)), i1 = Math.max(i0, record.index(t1));
  let s = 0, n = 0;
  for (let i = i0; i <= i1; i++) if (record.t[i] >= t0 && record.t[i] <= t1) { s += record.nx[i] ** 2 + record.ny[i] ** 2; n += 2; }
  return n ? sigma * Math.sqrt(s / n) : 0;
}

// ----------------------------------------------------------------------------- spectrum

/**
 * The power spectrum of the demodulated signal s(t) = M_x′ − i M_y′ (noise included) between t0
 * and t1: resampled uniformly to n points, zero-padded `pad` times and transformed.  A spin that
 * precesses faster than the frame shows at a positive frequency.  Returns {f, power}
 * (frequencies in Hz relative to the frame's, in increasing order; |S(f)|², normalised so that a
 * steady signal of amplitude 1 gives 1 at its frequency), the frequency step df, and the line:
 * peak {f, power} (the highest point, refined by a parabola through its neighbours) and its full
 * width at half power.
 *
 * Why the power: an FID A e^{−t/T2*} that starts at t = 0 has the transform A/(1/T2* + 2πi f),
 * whose magnitude falls to half at f = ±√3/(2πT2*), but whose square falls to half at
 * f = ±1/(2πT2*): the line is 1/(πT2*) wide at half power (and so is the absorption, the real
 * part once the phase is corrected).
 */
export function spectrum(record, t0, t1, sigma = 0, n = 2048, pad = 4) {
  const N = n * pad, dt = (t1 - t0) / n;
  const re = new Float64Array(N), im = new Float64Array(N), tmp = [0, 0, 0];
  for (let j = 0; j < n; j++) {
    record.at(t0 + j * dt, sigma, tmp);
    re[j] = tmp[0]; im[j] = -tmp[1];
  }
  fft(re, im);
  const df = 1 / (N * dt), f = new Float64Array(N), power = new Float64Array(N);
  // Reorder to increasing frequency: k = N/2 … N−1 are the negative frequencies.  The spins
  // turn clockwise in the frame (M_x′ + i M_y′ ∝ e^{−iδω t} for a spin δω ahead of it), so
  // s = M_x′ − i M_y′ ∝ e^{+iδω t} and the transform, with e^{−2πi k j/N}, puts it at +δω.
  for (let k = 0; k < N; k++) {
    const src = (k + N / 2) % N;
    f[k] = (k - N / 2) * df;
    power[k] = (re[src] ** 2 + im[src] ** 2) / (n * n);
  }
  return { f, power, df, ...line(f, power) };
}

/** The peak of a spectrum, refined by a parabola, and its full width at half maximum. */
export function line(f, mag) {
  let k = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[k]) k = i;
  let fp = f[k], mp = mag[k];
  if (k > 0 && k < mag.length - 1) {
    const a = mag[k - 1], b = mag[k], c = mag[k + 1], d = a - 2 * b + c;
    if (d < 0) { const x = (0.5 * (a - c)) / d; fp = f[k] + x * (f[1] - f[0]); mp = b - 0.25 * (a - c) * x; }
  }
  const half = mp / 2;
  let l = k, r = k;
  while (l > 0 && mag[l] > half) l--;
  while (r < mag.length - 1 && mag[r] > half) r++;
  const cross = (i, j) => (mag[i] === mag[j] ? f[i] : f[i] + ((half - mag[i]) * (f[j] - f[i])) / (mag[j] - mag[i]));
  const fl = l < k ? cross(l, l + 1) : f[0], fr = r > k ? cross(r, r - 1) : f[f.length - 1];
  return { peak: { f: fp, power: mp }, fwhm: fr - fl };
}

// --------------------------------------------------------------------------------- fits

export const SHAPES = {
  decay: (t, tau) => Math.exp(-t / tau),            // A e^{−t/τ}: a free induction, an echo train
  rise: (t, tau) => 1 - Math.exp(-t / tau),         // A (1 − e^{−t/τ}): the FID against the polarizing time
  recovery: (t, tau) => 1 - 2 * Math.exp(-t / tau), // A (1 − 2 e^{−t/τ}): inversion recovery
};

/**
 * Fit y(t) = A × shape(t, τ) by least squares: A is linear, τ is found by scanning log τ and
 * refining by golden section.  Returns {A, tau, rms} (rms: of the residuals).
 */
export function fitShape(t, y, shape = 'decay', { tauMin, tauMax } = {}) {
  const s = typeof shape === 'string' ? SHAPES[shape] : shape;
  const span = Math.max(...t) - Math.min(...t) || 1;
  const lo = Math.log(tauMin ?? span / 200), hi = Math.log(tauMax ?? span * 100);
  const sse = (lt) => {
    const tau = Math.exp(lt);
    let sy = 0, ss = 0;
    for (let i = 0; i < t.length; i++) { const v = s(t[i], tau); sy += y[i] * v; ss += v * v; }
    const A = ss > 0 ? sy / ss : 0;
    let e = 0;
    for (let i = 0; i < t.length; i++) e += (y[i] - A * s(t[i], tau)) ** 2;
    return { e, A };
  };
  let best = lo, bestE = Infinity;
  for (let i = 0; i <= 80; i++) { const lt = lo + ((hi - lo) * i) / 80; const { e } = sse(lt); if (e < bestE) { bestE = e; best = lt; } }
  let a = best - (hi - lo) / 80, b = best + (hi - lo) / 80;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = sse(c).e, fd = sse(d).e;
  for (let i = 0; i < 60; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sse(c).e; }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sse(d).e; }
  }
  const lt = (a + b) / 2, { e, A } = sse(lt);
  return { A, tau: Math.exp(lt), rms: Math.sqrt(e / Math.max(1, t.length)) };
}
