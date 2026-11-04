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
 * divided by √N (meanGauss draws the N, for the tests).  The noise of a sample depends only on a
 * seed and on where the sample falls on the grid of the sampling interval, not on the order in
 * which samples were taken, so a run gives the same noise however its clock was stepped.
 *
 * Each record has an id, a version that every change moves on (a sample added, the noise drawn
 * afresh, the start trimmed, everything cleared), and an epoch that only the changes to what is
 * already there move on (all but adding a sample): a picture of it keyed on the id and version
 * is good until the record changes, and a picture of its samples so far, on the id and epoch,
 * until anything but its growth does.
 */
let records = 0;
export class Record {
  constructor() { this.id = ++records; this.version = 0; this.epoch = 0; this.clear(); }

  clear() { this.t = []; this.x = []; this.y = []; this.z = []; this.nx = []; this.ny = []; this.k = []; this.version++; this.epoch++; }

  get length() { return this.t.length; }

  /** A sample; noise: {seed, dt, averages} (no noise when omitted). */
  push(t, x, y, z, noise = null) {
    this.version++;
    this.t.push(t); this.x.push(x); this.y.push(y); this.z.push(z);
    if (!noise) { this.nx.push(0); this.ny.push(0); this.k.push(0); return; }
    const k = noiseIndex(t, noise.dt), g = gauss2(noise.seed, k), f = 1 / Math.sqrt(Math.max(1, noise.averages || 1));
    this.k.push(k); this.nx.push(g[0] * f); this.ny.push(g[1] * f);
  }

  /** Draw the noise afresh (from another seed) for every sample, as the mean of `averages` repeats. */
  renoise(seed, averages = 1) {
    const f = 1 / Math.sqrt(Math.max(1, averages));
    this.version++; this.epoch++;
    for (let i = 0; i < this.t.length; i++) { const g = gauss2(seed, this.k[i]); this.nx[i] = g[0] * f; this.ny[i] = g[1] * f; }
  }

  /** Drop the samples before tMin (keeping one, for interpolation). */
  trim(tMin) {
    const i = Math.max(0, this.index(tMin));
    if (i > 0) { this.version++; this.epoch++; for (const k of ['t', 'x', 'y', 'z', 'nx', 'ny', 'k']) this[k].splice(0, i); }
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
 * How to sample the raw trace between t0 and t1 for a scope's display `cols` device columns wide
 * (lib/scope.js draws the samples; rawFill makes them).  Where a column holds less than a period
 * of the reference, the trace itself: 16 samples a period, so a carrier a few pixels a period
 * keeps its crests (cos π/16 of them at worst), and at least `perCol` a column.  Where it holds more (at 5 MHz over a
 * millisecond, thousands a column), a scope shows a band, its edges the envelope and its
 * brightness across it the sinusoid's (arcsine) density, whatever the carrier's own frequency:
 * so the same M_x′ and M_y′ go against a stand-in carrier of about one period a column,
 * `perCycle` samples to it, a few samples a column instead of thousands (band: true).  (A little
 * over one: 1 + 0.618/perCycle, so that from column to column the samples fall at other phases,
 * as a real scope's do, and the kinks of the line between them don't stack into stripes.)  fast (the
 * old per-column drawing, which needs only each column's extremes): for a band four samples a
 * column, the envelope's top and bottom in turn (so that every column has both, wherever its edges
 * fall among them), and otherwise 2 a column, 8 a period.  Returns
 * {n, band, perCycle, fast}.
 */
export function rawPlan(omegaRef, t0, t1, cols, { perCol = 1, perCycle = 24, fast = false } = {}) {
  const C = Math.max(1, Math.round(cols)), cycles = (Math.abs(omegaRef) * (t1 - t0)) / (2 * Math.PI);
  const band = cycles > C;
  let n = band ? C * (fast ? 4 : perCycle) + 1 : Math.ceil(Math.max(C * (fast ? 2 : perCol), cycles * (fast ? 8 : 16))) + 1;
  // (Never 1.2 to 2 a column: a part of the trace, drawn on its own as the trace grows, then can't
  // fall on the other side of lib/scope.js's 1.5 a column, from line to graded, than the whole.)
  if (!band && !fast && n > 1.2 * C && n < 2 * C) n = 2 * C + 1;
  return { n: Math.max(2, n), band, perCycle: fast ? 4 : perCycle, fast };
}

/**
 * The plan's samples (rawPlan) of the raw trace Vpk (M_x′ sin ω_ref t − M_y′ cos ω_ref t), sample j
 * at t0 + j (t1 − t0)/(n − 1), in units of Vpk, M_x′ and M_y′ (and their noise times sigma)
 * interpolated in the record as Record.at does; for a band, the stand-in carrier's phase is
 * 2π j (1 + 0.618/perCycle)/perCycle at sample j (for fast, the envelope's top and bottom in turn).
 * Samples j0 to j1 (all of them by default) into out[0 …] (a Float32Array of j1 − j0 + 1), which is
 * returned: a part is the same as that part of the whole.
 */
export function rawFill(record, omegaRef, t0, t1, plan, sigma = 0, out = null, j0 = 0, j1 = plan.n - 1) {
  const { n, band, perCycle, fast } = plan, T = record.t, N = T.length, X = record.x, Y = record.y, NX = record.nx, NY = record.ny;
  if (!out) out = new Float32Array(j1 - j0 + 1);
  if (!N) { out.fill(0, 0, j1 - j0 + 1); return out; }
  const dt = (t1 - t0) / (n - 1), w = (2 * Math.PI * (1 + 0.618 / perCycle)) / perCycle;
  let i = Math.max(0, record.index(t0 + j0 * dt));
  for (let j = j0; j <= j1; j++) {
    const t = t0 + j * dt, o = j - j0;
    while (i + 1 < N && T[i + 1] <= t) i++;          // (the last sample at or before t, as index() finds)
    const k = Math.min(N - 1, i + 1), f = k > i && T[k] > T[i] ? Math.max(0, Math.min(1, (t - T[i]) / (T[k] - T[i]))) : 0;
    const mx = X[i] + (X[k] - X[i]) * f + sigma * (NX[i] + (NX[k] - NX[i]) * f);
    const my = Y[i] + (Y[k] - Y[i]) * f + sigma * (NY[i] + (NY[k] - NY[i]) * f);
    if (!band) { const p = omegaRef * t; out[o] = mx * Math.sin(p) - my * Math.cos(p); }
    else if (fast) out[o] = (j & 1 ? -1 : 1) * Math.hypot(mx, my);
    else { const p = w * j; out[o] = mx * Math.sin(p) - my * Math.cos(p); }
  }
  return out;
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

/** Where a sample at t falls on the grid of interval dt: the index its noise is drawn for. */
export function noiseIndex(t, dt) { return Math.round(t / (Number.isFinite(dt) && dt > 0 ? dt : 1e-12)) | 0; }

/** A 32-bit integer hash (MurmurHash3's finaliser). */
function mix32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Two independent standard normal numbers that depend only on (seed, k) (Box–Muller). */
export function gauss2(seed, k) {
  const a = mix32((seed ^ mix32(k)) >>> 0), b = mix32((a ^ 0x9e3779b9 ^ mix32(k ^ 0x5bd1e995)) >>> 0);
  const u1 = (a + 0.5) / 4294967296, u2 = (b + 0.5) / 4294967296;
  const r = Math.sqrt(-2 * Math.log(u1)), p = 2 * Math.PI * u2;
  return [r * Math.cos(p), r * Math.sin(p)];
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
