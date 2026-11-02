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
 * front has every frequency: the grid goes well above the carrier and the medium's lines
 * (where n → 1),
 * and the incident spectrum is rolled off by a Gaussian at Ω/5 (`smooth`), which rounds the
 * front over a couple of time steps instead of letting it ring before it starts.
 * For a step, p.tOff (where the carrier is switched off again, smoothly, after the view) is set.
 */
export function planGrid(shape, p, view, wTop = 0, maxN = 1 << 17) {
  const span = view[1] - view[0];
  const sharp = shape !== 'gauss';
  // (2000 samples across the view, so that every pixel column of a plot has a couple.)
  const Omega = Math.max((2000 * Math.PI) / span, sharp ? Math.max(24 * p.w0, 6 * wTop) : (p.w0 + 14 / p.T) / 0.75);
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
    let top = 0;
    for (let k = 0; k < half; k++) {
      const f = smooth > 0 ? Math.exp(-0.5 * ((k * this.dw) / smooth) ** 2) : 1;
      this.Xr[k] = a[k] * f; this.Xi[k] = b[k] * f;
      top = Math.max(top, this.Xr[k] ** 2 + this.Xi[k] ** 2);
    }
    // Frequencies above the last one carrying more than 1e-32 of the peak power are skipped.
    this.kmax = 0;
    for (let k = half - 1; k >= 0; k--) if (this.Xr[k] ** 2 + this.Xi[k] ** 2 > 1e-32 * top) { this.kmax = k; break; }
    // For pictures in space, the frequencies that matter to the eye: above 1e-12 of the peak power.
    const sig = [];
    for (let k = 0; k <= this.kmax; k++) if (this.Xr[k] ** 2 + this.Xi[k] ** 2 > 1e-12 * top) sig.push(k);
    this.sig = Int32Array.from(sig);
    this.input = E0; this._inc = null;
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
    const { ar, ai, Xr, Xi, pr, pi, dw } = this;
    ar.fill(0); ai.fill(0);
    for (let k = 0; k <= this.kmax; k++) {
      const amp = vacuum ? 1 : Math.exp(Math.min(300, -pi[k] * z)); // (a drawn gain medium could overflow)
      if (amp < 1e-300 && k > 0) continue;
      const ph = (vacuum ? 0 : pr[k] * z) - k * dw * tc;
      const c = amp * Math.cos(ph), s = amp * Math.sin(ph), f = k === 0 ? 1 : 2;
      ar[k] = f * (Xr[k] * c - Xi[k] * s);
      ai[k] = f * (Xr[k] * s + Xi[k] * c);
    }
    fft(ar, ai); // Σ_k X_k H_k e^{-2πikn/N}: back to time
    return { re: ar, im: ai };
  }

  /**
   * A picture in space: the analytic signal inside the medium at one moment t (time since the
   * incident peak crossed z = 0), at the M depths z_j = z0 + j dz (all ≥ 0), with its local
   * frequency.  What field() gives at the retarded time τ = t − z, summed directly,
   *     a(z, t) = Σ_k X_k e^{iω_k t0} e^{iñ_k ω_k z} e^{−iω_k t},
   * over the frequencies that carry the pulse (sig), stepping each one in z by e^{iñωdz}.
   * Returns {re, im, w} (w: the local frequency, NaN where the field is negligible).
   */
  snapshot(t, z0, dz, M) {
    const out = { re: new Float64Array(M), im: new Float64Array(M), w: new Float64Array(M) };
    const { Xr, Xi, pr, pi, dw, sig, t0 } = this, wr = new Float64Array(M), wi = new Float64Array(M);
    if (!sig || !this.n) return out;
    for (const k of sig) {
      const w = k * dw, f = k === 0 ? 1 : 2;
      // ñω z = ω z + (pr + i pi) z, with pr = (n − 1)ω, pi = κω.
      const kr = w + pr[k], ki = pi[k];
      const lnA0 = -ki * z0;
      if (lnA0 < -700) continue;
      const amp = Math.exp(Math.min(300, lnA0)), ph = kr * z0 + w * (t0 - t);
      let cr = f * amp * (Xr[k] * Math.cos(ph) - Xi[k] * Math.sin(ph));
      let ci = f * amp * (Xr[k] * Math.sin(ph) + Xi[k] * Math.cos(ph));
      const g = Math.exp(Math.min(300, -ki * dz)), mr = g * Math.cos(kr * dz), mi = g * Math.sin(kr * dz);
      const { re, im } = out;
      for (let j = 0; j < M; j++) {
        re[j] += cr; im[j] += ci; wr[j] += w * cr; wi[j] += w * ci;
        const nr = cr * mr - ci * mi;
        ci = cr * mi + ci * mr; cr = nr;
        if (cr * cr + ci * ci < 1e-300 && j > 0) break;
      }
    }
    let top = 0;
    for (let j = 0; j < M; j++) top = Math.max(top, out.re[j] ** 2 + out.im[j] ** 2);
    for (let j = 0; j < M; j++) {
      const p = out.re[j] ** 2 + out.im[j] ** 2;
      // The local frequency −d(arg a)/dt = Re(a* Σ ω c)/|a|².
      out.w[j] = p > 1e-8 * top ? (out.re[j] * wr[j] + out.im[j] * wi[j]) / p : NaN;
    }
    return out;
  }

  /** The incident pulse in vacuum (as smoothed for the grid), its analytic signal at time τ, read
   *  off the grid: E(z, t) = this at τ = t − z for z < 0.  Returns [re, im].  Between two samples
   *  the modulus and the phase are interpolated (a carrier under a slow envelope comes out right
   *  even when there are only a few samples to a period). */
  incidentAt(tau) {
    if (!this._inc) { const a = this.field(0, 0, true); this._inc = [Float64Array.from(a.re), Float64Array.from(a.im)]; }
    const u = (tau - this.t0) / this.dt, k = Math.floor(u), f = u - k, [br, bi] = this._inc;
    if (k < 0 || k + 1 >= this.N) return [0, 0];
    const m0 = Math.hypot(br[k], bi[k]), m1 = Math.hypot(br[k + 1], bi[k + 1]);
    if (!(m0 > 1e-12 && m1 > 1e-12)) return [br[k] * (1 - f) + br[k + 1] * f, bi[k] * (1 - f) + bi[k + 1] * f];
    const p0 = Math.atan2(bi[k], br[k]);
    let dp = Math.atan2(bi[k + 1], br[k + 1]) - p0;
    dp -= 2 * Math.PI * Math.round(dp / (2 * Math.PI));
    const m = m0 * (1 - f) + m1 * f, p = p0 + f * dp;
    return [m * Math.cos(p), m * Math.sin(p)];
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
