// Pulses through a dispersive medium, exactly, in the frequency domain (no DOM).
//
// A field E(0, t) enters the medium at z = 0.  Each frequency travels as e^{i(k(ω) z − ωt)} with
// k = ñ(ω) ω / c, so
//     E(z, ω) = E(0, ω) e^{i ñ(ω) ω z / c}.
// We work in the retarded time τ = t − z/c (the time after a flash of light through vacuum
// would arrive), where the factor is e^{i (ñ − 1) ω z / c}, which tends to 1 at high frequency:
// a front travels at exactly c.  One FFT per distance gives the field and, because only
// positive frequencies are kept (doubled), its analytic signal: Re a = E, |a| = the envelope,
// −d(arg a)/dt = the local frequency.  Units: c = 1.

import { fft, ifft } from '../lib/fft.js';
import { sqrtEps } from './medium.js';

const LN2 = Math.LN2;

/**
 * The incident field at times t.
 *   gauss:  e^{-2 ln2 t²/T²} cos(ω0 t)          (T = full width at half maximum of |E|²)
 *   front:  the same Gaussian, switched on at t = tf (< 0): zero before, sin(ω0 (t − tf)) after,
 *           so the field is continuous but has a front
 *   step:   cos(ω0 t) switched on at t = 0 (a jump, Sommerfeld and Brillouin's signal),
 *           turned off smoothly long after the view, at tOff
 */
export function incident(shape, p, t) {
  const out = new Float64Array(t.length), { w0, T } = p;
  for (let i = 0; i < t.length; i++) {
    const s = t[i];
    if (shape === 'gauss') out[i] = Math.exp((-2 * LN2 * s * s) / (T * T)) * Math.cos(w0 * s);
    else if (shape === 'front') out[i] = s < p.tf ? 0 : Math.exp((-2 * LN2 * s * s) / (T * T)) * Math.sin(w0 * (s - p.tf));
    else if (shape === 'step') out[i] = s < 0 ? 0 : Math.cos(w0 * s) * 0.5 * (1 - Math.tanh((s - p.tOff) / p.tRamp));
  }
  return out;
}

/** Where the incident field lives: [first, last] times outside which |E| < 1e-8. */
export function support(shape, p) {
  if (shape === 'gauss') return [-3.7 * p.T, 3.7 * p.T];
  if (shape === 'front') return [p.tf, 3.7 * p.T];
  return [0, Infinity];
}

/**
 * Choose the time grid.  view = [lo, hi] is the stretch of τ to be shown (in the frame chosen);
 * wTop is the highest frequency at which the medium does anything interesting.
 * A Gaussian needs frequencies up to ω0 + 14/T (beyond which its spectrum is below 1e-8).  A
 * front has every frequency: the grid goes as high as the view can show (2000 steps across it),
 * and the incident spectrum is rolled off by a Gaussian at Ω/5 (`smooth`), which rounds the
 * front over a couple of time steps instead of letting it ring before it starts.
 * For a step, p.tOff (where the carrier is switched off again, smoothly, after the view) is set.
 */
export function planGrid(shape, p, view, wTop = 0, maxN = 1 << 17) {
  const span = view[1] - view[0];
  const sharp = shape !== 'gauss';
  const Omega = sharp ? Math.max((2000 * Math.PI) / span, 40 * p.w0, 10 * wTop) : (p.w0 + 14 / p.T) / 0.75;
  let dt = Math.PI / Omega;
  if (shape === 'step') { p.tOff = view[1] + 0.3 * span; p.tRamp = Math.max(2 * Math.PI / p.w0, 0.03 * span); }
  // The window must hold the view, the incident field, and (for a step) its switching off,
  // with room to spare so that nothing wraps round the periodic grid.
  const [s0, s1] = support(shape, p);
  const lo = Math.min(view[0], s0) - 0.25 * span;
  const hi = shape === 'step' ? p.tOff + 4 * p.tRamp : Math.max(view[1], s1);
  const W = 2.2 * (hi - lo);
  let N = 1024;
  while (N * dt < W && N < maxN) N *= 2;
  if (N * dt < W) dt = W / N; // the window wins over the top frequency
  return { N, dt, t0: lo, smooth: sharp ? Math.PI / dt / 5 : 0 };
}

/**
 * The propagator on one time grid: t_n = t0 + n dt, n = 0..N−1, and frequencies ω_k = k dω,
 * dω = 2π/(N dt).  Set the incident field once, the medium (ñ at the positive frequencies) once,
 * then ask for the field at any z and in any frame shift tc (the output is E(z, t_n + tc)).
 */
export class Propagator {
  constructor(N, dt, t0) {
    this.N = N; this.dt = dt; this.t0 = t0;
    this.dw = (2 * Math.PI) / (N * dt);
    this.half = N / 2;
    this.t = Float64Array.from({ length: N }, (_, n) => t0 + n * dt);
    this.w = Float64Array.from({ length: this.half }, (_, k) => k * this.dw);
    this.Xr = new Float64Array(this.half); this.Xi = new Float64Array(this.half);
    this.pr = new Float64Array(this.half); this.pi = new Float64Array(this.half); // (ñ − 1) ω
    this.ar = new Float64Array(N); this.ai = new Float64Array(N);
  }

  /**
   * The incident field E(0, t_n).  smooth > 0 multiplies its spectrum by e^{−ω²/2smooth²}: the
   * field is averaged over a Gaussian of r.m.s. width 1/smooth, so a jump becomes a rise over a
   * few time steps, and nothing rings ahead of it.
   */
  setInput(E0, smooth = 0) {
    const { N, half } = this, a = Float64Array.from(E0), b = new Float64Array(N);
    ifft(a, b); // a_k = (1/N) Σ E_n e^{+2πikn/N}: the spectrum (up to the phase of t0, which cancels)
    for (let k = 0; k < half; k++) {
      const f = smooth > 0 ? Math.exp(-0.5 * ((k * this.dw) / smooth) ** 2) : 1;
      this.Xr[k] = a[k] * f; this.Xi[k] = b[k] * f;
    }
    this.input = E0;
  }

  /** The medium: a function chi(w) -> {re, im} at frequencies w ≥ 0 (see medium.js). */
  setMedium(resp) {
    const { re, im } = resp.chi(this.w);
    this.n = new Float64Array(this.half); this.kappa = new Float64Array(this.half);
    for (let k = 0; k < this.half; k++) {
      const [n, kap] = sqrtEps(1 + re[k], im[k]);
      this.n[k] = n; this.kappa[k] = kap;
      this.pr[k] = (n - 1) * this.w[k];
      this.pi[k] = kap * this.w[k];
    }
  }

  /** A medium of constant index (for the tests). */
  setConstantIndex(n, kappa = 0) {
    for (let k = 0; k < this.half; k++) { this.pr[k] = (n - 1) * this.w[k]; this.pi[k] = kappa * this.w[k]; }
  }

  /**
   * The analytic signal of E(z, τ) at τ = t_n + tc: returns {re, im} (views of internal arrays,
   * overwritten by the next call).  vacuum = true leaves out the medium.
   */
  field(z, tc = 0, vacuum = false) {
    const { N, half, ar, ai, Xr, Xi, pr, pi, dw } = this;
    ar.fill(0); ai.fill(0);
    for (let k = 0; k < half; k++) {
      const amp = vacuum ? 1 : Math.exp(-pi[k] * z);
      if (amp < 1e-300 && k > 0) continue;
      const ph = (vacuum ? 0 : pr[k] * z) - k * dw * tc;
      const c = amp * Math.cos(ph), s = amp * Math.sin(ph), f = k === 0 ? 1 : 2;
      ar[k] = f * (Xr[k] * c - Xi[k] * s);
      ai[k] = f * (Xr[k] * s + Xi[k] * c);
    }
    fft(ar, ai); // Σ_k X_k H_k e^{-2πikn/N}: back to time
    return { re: ar, im: ai };
  }
}

// --------------------------------------------------------------------- measuring

/** Time of the largest |a|², refined by a parabola through the three samples around it. */
export function peakTime(t, re, im, from = 0, to = re.length) {
  let best = -1, bi = from;
  for (let i = from; i < to; i++) { const p = re[i] * re[i] + im[i] * im[i]; if (p > best) { best = p; bi = i; } }
  let tp = t[bi];
  if (bi > from && bi < to - 1) {
    const p = (j) => re[j] * re[j] + im[j] * im[j];
    const a = p(bi - 1), b = p(bi), c = p(bi + 1), d = a - 2 * b + c;
    if (d < 0) tp += (0.5 * (a - c) / d) * (t[1] - t[0]);
  }
  return { t: tp, peak: Math.sqrt(best), index: bi };
}

/** Centroid and r.m.s. width of |a|² (the energy's mean arrival time and spread). */
export function moments(t, re, im) {
  let s = 0, m = 0, m2 = 0;
  for (let i = 0; i < t.length; i++) { const p = re[i] * re[i] + im[i] * im[i]; s += p; m += p * t[i]; }
  const mean = m / s;
  for (let i = 0; i < t.length; i++) { const p = re[i] * re[i] + im[i] * im[i], d = t[i] - mean; m2 += p * d * d; }
  return { mean, rms: Math.sqrt(m2 / s), energy: s };
}

/** The largest |E| (the real field) at times before tLimit. */
export function maxBefore(t, field, tLimit) {
  let m = 0;
  for (let i = 0; i < t.length; i++) if (t[i] < tLimit) m = Math.max(m, Math.abs(field[i]));
  return m;
}

/** A causal envelope: the largest |E| over the preceding window samples (a sliding maximum). */
export function causalEnvelope(field, window, out = new Float64Array(field.length)) {
  const q = new Int32Array(field.length);
  let h = 0, tl = 0;
  for (let i = 0; i < field.length; i++) {
    const v = Math.abs(field[i]);
    while (tl > h && Math.abs(field[q[tl - 1]]) <= v) tl--;
    q[tl++] = i;
    while (q[h] <= i - window) h++;
    out[i] = Math.abs(field[q[h]]);
  }
  return out;
}
