// Making an image from a sparse uv plane.  Every method has to guess the spacings no pair
// measured, and each guesses differently:
//
//   the dirty image   the inverse transform of what was measured: every missing sample a zero
//                     (synthesis.js: dirtyImage);
//   CLEAN             the sky as a few points (synthesis.js: cleanStart, cleanSteps, restore);
//   maximum entropy   the smoothest positive sky that agrees with the measurements (here).
//
// Conventions as in synthesis.js: n x n grids, row-major; the dirty beam B is 1 at its centre
// pixel (n/2, n/2); the sky in flux per pixel; the dirty image D = B (*) sky in flux per beam,
// where (*) is circular convolution with B centred there:
//     (B (*) X)(i, j) = Σ X(i', j') B(i − i' + n/2, j − j' + n/2)      (indices mod n).
//
// Maximum entropy (Gull and Daniell 1978; Cornwell and Evans 1985).  Minimise
//
//     J(I) = ½ ⟨I, B (*) I⟩ − ⟨I, D⟩ + α Σ [I ln(I/M) − I + M]
//
// over images I > 0 inside a window (zero outside).  The first two terms are, but for a
// constant, half the misfit to the measured visibilities, Σ_k w_k |Ĩ_k − V_k|² with the weights
// the beam has (B (*) is the uv weights in the image domain); the last is minus the entropy of I
// relative to a default image M (flat, holding the total flux), smallest when I = M.  The
// gradient is
//
//     ∇J = (B (*) I − D) + α ln(I/M) = −R + α ln(I/M),          R = D − B (*) I, the residual,
//
// so the answer is the image with
//
//     I = M e^{R/α}      at every pixel:
//
// a pixel rises above the default only where the measurements still want more there, and no
// pixel can go negative.  J is strictly convex (B (*) is positive semi-definite: its
// eigenvalues are the uv weights, never negative), so that image is unique.  α sets the
// balance: large, a smooth image near M that fits the data loosely; small, a close fit.
//
// The minimisation is preconditioned conjugate gradients (Polak–Ribière), the preconditioner
// the diagonal of the Hessian, B(0) + α/I = 1 + α/I, with an exact line search: along a line
// I + t d, J needs only ⟨d, R⟩, ⟨d, B (*) d⟩ (one convolution) and the entropy, pixel by pixel.

import { fft2 } from '../lib/fft.js';

/** The transform of the beam, wrapped so that its centre is at index 0: the convolution
 *  kernel.  Real, since the beam is symmetric through its centre; kept with the beam. */
export function beamKernel(beam, n) {
  const h = n / 2, re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) re[j * n + i] = beam[((j + h) % n) * n + ((i + h) % n)];
  fft2(re, im, n, n, -1);
  const inv = 1 / (n * n);
  for (let k = 0; k < re.length; k++) re[k] *= inv;          // (fft2 does not normalise)
  return { n, re, im };
}

/** B (*) X for one or two real images at once (X1 in the real part, X2 in the imaginary: the
 *  kernel's transform is real, so the two stay apart).  Into out1 (and out2). */
export function convolve(kernel, x1, x2, out1, out2 = null) {
  const { n, re: kr, im: ki } = kernel, re = Float64Array.from(x1), im = x2 ? Float64Array.from(x2) : new Float64Array(n * n);
  fft2(re, im, n, n, -1);
  for (let k = 0; k < re.length; k++) {
    const a = re[k] * kr[k] - im[k] * ki[k], b = re[k] * ki[k] + im[k] * kr[k];
    re[k] = a; im[k] = b;
  }
  fft2(re, im, n, n, +1);
  out1.set(re);
  if (out2) out2.set(im);
  return out1;
}

/** The pixels of a window [i0, j0, i1, j1) (columns i0..i1−1, rows j0..j1−1), as indices. */
export function windowIndices(n, box = [0, 0, n, n]) {
  const [i0, j0, i1, j1] = box, out = new Int32Array((i1 - i0) * (j1 - j0));
  let k = 0;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) out[k++] = j * n + i;
  return out;
}

/**
 * Start a maximum-entropy image: I = M everywhere in the window, flat, holding `flux` in all
 * (the total flux, which one dish alone can measure).  alpha: the entropy's weight, in the
 * dirty image's units (flux per beam).  Returns the state, with .model (the image I, flux per
 * pixel) and .residual (R = D − B (*) I) as CLEAN's state has them, so that restore() works on it.
 */
export function memStart(dirty, beam, n, { alpha, flux, box = [0, 0, n, n] }) {
  const idx = windowIndices(n, box), level = flux / idx.length;
  const M = new Float64Array(n * n), I = new Float64Array(n * n);
  for (const o of idx) { M[o] = level; I[o] = level; }
  const kernel = beamKernel(beam, n), BI = convolve(kernel, I, null, new Float64Array(n * n));
  const R = new Float64Array(n * n);
  for (let o = 0; o < R.length; o++) R[o] = dirty[o] - BI[o];
  return { n, alpha, flux, box, idx, dirty, kernel, default: M, model: I, residual: R, iterations: 0,
    g: null, z: null, d: null, gz: 0, objective: [objective(I, R, dirty, M, alpha, idx)], mismatch: Infinity, done: false };
}

/** J(I) = ½⟨I, B(*)I⟩ − ⟨I, D⟩ + α Σ [I ln(I/M) − I + M], from R = D − B(*)I:
 *  ½⟨I, B(*)I⟩ − ⟨I, D⟩ = −½⟨I, D + R⟩. */
export function objective(I, R, D, M, alpha, idx) {
  let s = 0;
  for (const o of idx) {
    const v = I[o];
    s += -0.5 * v * (D[o] + R[o]) + alpha * (v > 0 ? v * Math.log(v / M[o]) - v + M[o] : M[o]);
  }
  return s;
}

/**
 * Take `steps` iterations of the minimisation (each one convolution and a line search).
 * Returns the state; .mismatch is how far the image is from the answer I = M e^{R/α}: the
 * root-mean-square of ln(I/M) − R/α weighted by I (a relative error in the brightness), and
 * .done when it is below `tol`.
 */
export function memSteps(ms, { steps = 1, tol = 1e-3, restart = 25 } = {}) {
  const { n, alpha, idx, default: M, model: I, residual: R, kernel } = ms;
  const Bd = new Float64Array(n * n);
  for (let s = 0; s < steps && !ms.done; s++) {
    // The gradient g = α ln(I/M) − R, the preconditioned z = g I/(I + α).
    const g = new Float64Array(idx.length), z = new Float64Array(idx.length);
    let gz = 0, mis = 0, wsum = 0;
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k], v = I[o], lg = Math.log(v / M[o]);
      g[k] = alpha * lg - R[o];
      z[k] = (g[k] * v) / (v + alpha);
      gz += g[k] * z[k];
      const e = lg - R[o] / alpha;
      mis += v * e * e; wsum += v;
    }
    ms.mismatch = Math.sqrt(mis / Math.max(wsum, 1e-300));
    if (ms.mismatch < tol) { ms.done = true; break; }
    // Polak–Ribière (with its restart when it would not go downhill).
    let d = new Float64Array(idx.length);
    let beta = 0;
    if (ms.g && ms.iterations % restart !== 0) {
      let num = 0;
      for (let k = 0; k < idx.length; k++) num += (g[k] - ms.g[k]) * z[k];
      beta = Math.max(0, num / ms.gz);
    }
    let slope = 0;
    for (let k = 0; k < idx.length; k++) { d[k] = -z[k] + beta * (ms.d ? ms.d[k] : 0); slope += d[k] * g[k]; }
    if (!(slope < 0)) { for (let k = 0; k < idx.length; k++) d[k] = -z[k]; slope = -gz; }
    ms.g = g; ms.z = z; ms.gz = gz; ms.d = d;
    // The line: B (*) d, then φ'(t) = −⟨d, R⟩ + t ⟨d, B(*)d⟩ + α Σ d ln((I + t d)/M) = 0.
    const full = new Float64Array(n * n);
    for (let k = 0; k < idx.length; k++) full[idx[k]] = d[k];
    convolve(kernel, full, null, Bd);
    let dR = 0, q = 0, tmax = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k];
      dR += d[k] * R[o]; q += d[k] * Bd[o];
      if (d[k] < 0) tmax = Math.min(tmax, -I[o] / d[k]);
    }
    const dphi = (t) => {
      let a = -dR + t * q, b = q;
      for (let k = 0; k < idx.length; k++) {
        const dk = d[k];
        if (dk === 0) continue;
        const o = idx[k], v = I[o] + t * dk;
        a += alpha * dk * Math.log(v / M[o]); b += (alpha * dk * dk) / v;
      }
      return [a, b];
    };
    const t = lineSearch(dphi, tmax);
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k];
      I[o] = Math.max(I[o] + t * d[k], 1e-12 * M[o]);
    }
    for (let o = 0; o < R.length; o++) R[o] -= t * Bd[o];
    ms.iterations++;
    // The residual kept exactly: recomputed now and then (it drifts by rounding only).
    if (ms.iterations % 20 === 0) {
      const BI = convolve(kernel, I, null, new Float64Array(n * n));
      for (let o = 0; o < R.length; o++) R[o] = ms.dirty[o] - BI[o];
    }
    ms.objective.push(objective(I, R, ms.dirty, M, alpha, idx));
  }
  return ms;
}

/** The zero of φ' (increasing) on (0, tmax): bracket, then Newton steps kept in the bracket. */
function lineSearch(dphi, tmax) {
  let lo = 0, hi = Number.isFinite(tmax) ? tmax * (1 - 1e-9) : Infinity;
  let t = Math.min(1, hi * 0.5);
  if (!Number.isFinite(hi)) {
    // Expand until φ' > 0.
    for (let k = 0; k < 60; k++) { const [a] = dphi(t); if (a > 0) { hi = t; break; } lo = t; t *= 2; }
    if (!Number.isFinite(hi)) return lo;
  }
  for (let k = 0; k < 40; k++) {
    const [a, b] = dphi(t);
    if (Math.abs(a) <= 1e-12 * Math.max(1, Math.abs(b * t))) return t;
    if (a > 0) hi = t; else lo = t;
    let next = t - a / b;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - t) <= 1e-12 * t) return next;
    t = next;
  }
  return t;
}

/** How far an image is from a reference (the true sky seen through the clean beam): the
 *  root-mean-square difference over the pixels idx, as a fraction of the reference's peak. */
export function rmsError(image, ref, idx) {
  let s = 0, peak = 0;
  for (const o of idx) { const e = image[o] - ref[o]; s += e * e; peak = Math.max(peak, Math.abs(ref[o])); }
  return Math.sqrt(s / idx.length) / (peak || 1);
}
