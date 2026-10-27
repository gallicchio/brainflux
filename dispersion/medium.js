// The optical response of a medium, with no DOM: Lorentz oscillators (bound charges) and Drude
// terms (free electrons), the refractive index on its physical branch, the reflectance, the
// Kramers–Kronig relations on a frequency grid, the impulse response χ(t), and the f-sum rule.
//
// Conventions (as in Jackson): fields go as e^{-iωt}, so
//     P(ω) = ε0 χ(ω) E(ω),   χ(ω) = ∫ χ(t) e^{iωt} dt,   ε = 1 + χ,
// a causal response (χ(t) = 0 for t < 0) is analytic in the upper half ω-plane, a real one has
// χ(-ω) = χ(ω)*, and a passive one absorbs: Im χ(ω) ≥ 0 for ω > 0.  Units: c = 1.
//
// One oscillator j, of resonance ω_j, damping γ_j and strength S_j = f_j ω_p² = ω_pj²:
//     χ_j(ω) = S_j / (ω_j² − ω² − iγ_j ω),
// the response of x'' + γ x' + ω_j² x = (q/m) E.  ω_j = 0 is a free electron (Drude).

import { fft, ifft } from '../lib/fft.js';

/** An oscillator: { w0, g, wp } with strength S = wp^2 (w0 = 0: free electrons). */
export const strength = (o) => o.wp * o.wp;

/**
 * χ(ω) of a set of oscillators at the frequencies w (any sign), into out.re and out.im.
 * At ω = 0 a Drude term's Im χ (which diverges as 1/ω) is given the value 0 of an odd function.
 */
export function chiOscillators(oscs, w, out = { re: new Float64Array(w.length), im: new Float64Array(w.length) }) {
  const { re, im } = out;
  re.fill(0); im.fill(0);
  for (const o of oscs) {
    const S = strength(o), w02 = o.w0 * o.w0, g = o.g;
    if (S === 0) continue;
    for (let i = 0; i < w.length; i++) {
      const x = w[i];
      if (w02 === 0) {
        // S / (-ω² - iγω) = -S / (ω (ω + iγ)): Re = -S/(ω² + γ²), Im = Sγ / (ω (ω² + γ²)).
        const d = x * x + g * g;
        if (d === 0) continue;
        re[i] -= S / d;
        if (x !== 0) im[i] += (S * g) / (x * d);
        continue;
      }
      const a = w02 - x * x, b = g * x, d = a * a + b * b;
      re[i] += (S * a) / d;
      im[i] += (S * b) / d;
    }
  }
  return out;
}

/**
 * The impulse response χ(t) of the oscillators (without the instantaneous part), exactly:
 * the displacement after a kick, S e^{-γt/2} sin(νt)/ν with ν² = ω_j² − γ²/4 (sinh when
 * overdamped), and S (1 − e^{-γt})/γ for free electrons.  Zero for t < 0.
 */
export function chiTimeOscillators(oscs, t) {
  const out = new Float64Array(t.length);
  for (const o of oscs) {
    const S = strength(o), g = o.g, w02 = o.w0 * o.w0;
    const nu2 = w02 - (g * g) / 4;
    for (let i = 0; i < t.length; i++) {
      const s = t[i];
      if (s <= 0) continue;
      if (w02 === 0) { out[i] += g > 0 ? (S * -Math.expm1(-g * s)) / g : S * s; continue; }
      const damp = Math.exp(-0.5 * g * s);
      if (nu2 > 1e-12 * w02) { const nu = Math.sqrt(nu2); out[i] += (S * damp * Math.sin(nu * s)) / nu; }
      else if (nu2 < -1e-12 * w02) { const mu = Math.sqrt(-nu2); out[i] += (S * damp * Math.sinh(mu * s)) / mu; }
      else out[i] += S * damp * s;
    }
  }
  return out;
}

/**
 * √ε on the physical branch: n + iκ with n ≥ 0, and κ ≥ 0 whenever Im ε ≥ 0 (a passive medium
 * absorbs; a real negative ε, a lossless metal, gives n = 0 and κ = √|ε|).  Written to avoid
 * cancellation when ε is close to the negative real axis.
 */
export function sqrtEps(er, ei) {
  const m = Math.hypot(er, ei);
  if (m === 0) return [0, 0];
  if (er >= 0) {
    const n = Math.sqrt((m + er) / 2);
    return [n, ei / (2 * n)];
  }
  const k = Math.sqrt((m - er) / 2) * (ei < 0 ? -1 : 1);
  return [ei / (2 * k), k];
}

/** Normal-incidence reflectance |(ñ − 1)/(ñ + 1)|² from vacuum onto a medium of index n + iκ. */
export function reflectance(n, k) {
  return ((n - 1) * (n - 1) + k * k) / ((n + 1) * (n + 1) + k * k);
}

// ----------------------------------------------------------------------- responses

/**
 * A response function: what every view needs from a medium, whatever it is made of.
 *   chi(w)       -> {re, im}: χ at frequencies w ≥ 0 (the full χ, including χ∞)
 *   chiInf       the instantaneous part (ε∞ − 1), a constant
 *   kind         'osc' | 'grid' | 'fn'
 * Make one from oscillators, from samples on a FreqGrid, or from a function.
 */
export function oscillatorResponse(oscs, epsInf = 1) {
  const chiInf = epsInf - 1;
  return {
    kind: 'osc', oscs, chiInf,
    chi(w) { const out = chiOscillators(oscs, w); if (chiInf) for (let i = 0; i < w.length; i++) out.re[i] += chiInf; return out; },
  };
}

/** A response sampled on a grid (FFT order, as kept by the Kramers–Kronig view), read by linear
 *  interpolation; beyond the grid χ is continued as Re ~ 1/ω², Im ~ 1/ω³ (the free-oscillator tails). */
export function gridResponse(grid, re, im, chiInf = 0) {
  const { dw, N } = grid, half = N / 2, last = half - 1, W = last * dw;
  return {
    kind: 'grid', chiInf, grid, re, im,
    chi(w) {
      const out = { re: new Float64Array(w.length), im: new Float64Array(w.length) };
      for (let i = 0; i < w.length; i++) {
        const x = Math.abs(w[i]), s = w[i] < 0 ? -1 : 1;
        if (x >= W) {
          const q = W / x;
          out.re[i] = chiInf + re[last] * q * q;
          out.im[i] = s * im[last] * q * q * q;
          continue;
        }
        // (The sample at ω = 0 may hold a free-electron δ(ω): read the one next to it instead.)
        const u = x / dw, k = Math.floor(u), f = u - k;
        out.re[i] = chiInf + re[k === 0 ? 1 : k] * (1 - f) + re[k + 1] * f;
        out.im[i] = s * (im[k] * (1 - f) + im[k + 1] * f);
      }
      return out;
    },
  };
}

/** A response from a function f(w) -> {re, im} of χ for w ≥ 0 (a typed formula, say). */
export function functionResponse(f) {
  return {
    kind: 'fn', chiInf: 0,
    chi(w) {
      const a = Float64Array.from(w, Math.abs), v = f(a);
      const re = Float64Array.from(v.re), im = v.im ? Float64Array.from(v.im) : new Float64Array(w.length);
      for (let i = 0; i < w.length; i++) {
        if (!Number.isFinite(re[i])) re[i] = 0;
        if (!Number.isFinite(im[i])) im[i] = 0;
        if (w[i] < 0) im[i] = -im[i];
      }
      return { re, im };
    },
  };
}

/** n, κ, Re ε, Im ε and R at frequencies w ≥ 0. */
export function optics(resp, w) {
  const { re, im } = resp.chi(w), L = w.length;
  const n = new Float64Array(L), k = new Float64Array(L), R = new Float64Array(L);
  const er = new Float64Array(L), ei = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    er[i] = 1 + re[i]; ei[i] = im[i];
    const [a, b] = sqrtEps(er[i], ei[i]);
    n[i] = a; k[i] = b; R[i] = reflectance(a, b);
  }
  return { chiRe: re, chiIm: im, er, ei, n, k, R };
}

/** The group index n_g = n + ω dn/dω = c dk/dω, by a central difference of step h. */
export function groupIndex(resp, w, h) {
  const L = w.length, pts = new Float64Array(3 * L);
  for (let i = 0; i < L; i++) { pts[3 * i] = w[i] - h; pts[3 * i + 1] = w[i]; pts[3 * i + 2] = w[i] + h; }
  for (let i = 0; i < 3 * L; i++) pts[i] = Math.max(0, pts[i]);
  const { n } = optics(resp, pts), out = new Float64Array(L);
  for (let i = 0; i < L; i++) out[i] = n[3 * i + 1] + (w[i] * (n[3 * i + 2] - n[3 * i])) / (pts[3 * i + 2] - pts[3 * i]);
  return out;
}

// ----------------------------------------------------------------- Kramers–Kronig

/**
 * A symmetric frequency grid of N points (a power of two) from −Ω to Ω − dω, in FFT order:
 * index k is ω = k dω for k < N/2 and (k − N) dω above.  Its time grid has dt = 2π/(N dω) = π/Ω
 * and is periodic with period 2π/dω.
 */
export class FreqGrid {
  constructor(N, Omega) {
    this.N = N; this.Omega = Omega; this.dw = (2 * Omega) / N; this.dt = Math.PI / Omega;
    this.w = new Float64Array(N);
    for (let k = 0; k < N; k++) this.w[k] = (k < N / 2 ? k : k - N) * this.dw;
  }
  /** t for each index of the time grid, in the same order. */
  times() { return Float64Array.from(this.w, (w) => (w / this.dw) * this.dt); }
}

// sgn(t) on the periodic time grid: + for 0 < n < N/2, − above, 0 at t = 0 and at the far end.
function multiplySign(re, im) {
  const N = re.length;
  re[0] = im[0] = re[N / 2] = im[N / 2] = 0;
  for (let n = N / 2 + 1; n < N; n++) { re[n] = -re[n]; im[n] = -im[n]; }
}

/**
 * Kramers–Kronig: the real part of a causal response from its imaginary part,
 *     Re χ(ω) = (1/π) P∫ Im χ(ω') / (ω' − ω) dω',
 * done as the time domain sees it.  Im χ (odd) is the transform of the odd part of χ(t);
 * causality makes the even part sgn(t) times the odd part; its transform is Re χ.
 */
export function kkImToRe(im, out = new Float64Array(im.length)) {
  const N = im.length, a = new Float64Array(N), b = Float64Array.from(im);
  fft(a, b);                 // N × (the odd part of χ(t)), on the time grid
  multiplySign(a, b);        // N × (the even part)
  ifft(a, b);
  out.set(a);
  return out;
}

/** The imaginary part of a causal response from its real part (the inverse relation). */
export function kkReToIm(re, out = new Float64Array(re.length)) {
  const N = re.length, a = Float64Array.from(re), b = new Float64Array(N);
  fft(a, b);
  multiplySign(a, b);
  ifft(a, b);
  out.set(b);
  return out;
}

/**
 * The impulse response χ(t) = (1/2π) ∫ χ(ω) e^{-iωt} dω from samples of χ on a FreqGrid, at the
 * grid's times (FFT order).  For a χ that is not causal it leaks into t < 0; for one that does
 * not describe a real response, the imaginary part (returned too) is not zero.
 */
export function impulseResponse(grid, re, im) {
  const a = Float64Array.from(re), b = Float64Array.from(im);
  fft(a, b);
  const s = grid.dw / (2 * Math.PI);
  for (let n = 0; n < a.length; n++) { a[n] *= s; b[n] *= s; }
  return { re: a, im: b };
}

/** Sample a response on the grid's frequencies (both signs), without its instantaneous part. */
export function sampleOnGrid(resp, grid) {
  const { re, im } = resp.chi(grid.w);
  for (let k = 0; k < grid.N; k++) re[k] -= resp.chiInf;
  im[grid.N / 2] = 0; // the far end, −Ω, is its own mirror image: an odd function is 0 there
  if (resp.kind === 'osc') {
    // A free-electron term's χ(t) tends to S/γ: its transform has a delta function at ω = 0,
    // π (S/γ) δ(ω), which on the grid is one sample of height π S/(γ dω).
    for (const o of resp.oscs) if (o.w0 === 0 && o.g > 0) re[0] += (Math.PI * strength(o)) / (o.g * grid.dw);
  }
  return { re, im };
}

// ------------------------------------------------------------------ the sum rule

/**
 * ∫_0^∞ ω Im ε(ω) dω for a set of oscillators, by Simpson's rule on pieces that resolve every
 * line (a fine grid across each one and a geometric one far out), plus the 1/ω² tail.  The
 * f-sum rule says it equals (π/2) Σ S_j = π ω_p²/2.
 */
export function sumRuleOscillators(oscs) {
  if (!oscs.length) return 0;
  let wmax = 0;
  for (const o of oscs) wmax = Math.max(wmax, o.w0, o.wp, o.g);
  // Break points closing in on every line geometrically (its tails fall as 1/(ω − ω_j)²).
  const brk = new Set([0]);
  for (const o of oscs) {
    const g = Math.max(o.g, 1e-6);
    brk.add(o.w0);
    for (let s = 0.5; s * g < 4 * wmax + 1; s *= 2) for (const x of [o.w0 - s * g, o.w0 + s * g]) if (x > 0) brk.add(x);
  }
  let W = 4 * wmax + 1;
  for (let i = 0; i < 12; i++) { brk.add(W); W *= 3; }
  const pts = [...brk].sort((a, b) => a - b);
  // ω Im χ_j = S γ ω² / ((ω_j² − ω²)² + γ²ω²), which is S γ/(ω² + γ²) for a free electron:
  // finite at ω = 0 even though Im χ is not.
  const f = (x) => {
    let s = 0;
    for (const o of oscs) {
      const a = o.w0 * o.w0 - x * x, S = strength(o);
      s += o.w0 === 0 ? (S * o.g) / (x * x + o.g * o.g) : (S * o.g * x * x) / (a * a + o.g * o.g * x * x);
    }
    return s;
  };
  let sum = 0;
  for (let i = 0; i + 1 < pts.length; i++) sum += simpson(f, pts[i], pts[i + 1], 64);
  const Wend = pts[pts.length - 1];
  return sum + f(Wend) * Wend; // the tail: ω Im ε → C/ω², whose integral beyond W is C/W
}

/** The same integral for samples on a grid (trapezoids over 0..Ω, plus the 1/ω² tail).  At ω = 0
 *  the integrand ω Im χ is taken from the first sample (it is S/γ for free electrons, 0 otherwise). */
export function sumRuleGrid(grid, im) {
  const half = grid.N / 2, dw = grid.dw;
  let sum = 0.5 * dw * im[1];
  for (let k = 1; k < half; k++) sum += k * dw * im[k] * (k === half - 1 ? 0.5 : 1);
  sum *= dw;
  const W = (half - 1) * dw;
  return sum + W * im[half - 1] * W;
}

export function simpson(f, a, b, n) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
