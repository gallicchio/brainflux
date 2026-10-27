// Fourier-transform spectroscopy: record I(Δ) at Δ_k = kδ, k = 0 ... K, and transform back.
//
// Since I(Δ) = I0 + ∫ S(σ) cos(2πσΔ) dσ and I(0) = 2 I0, the samples F_k = I_k - I_0/2 are the
// cosine transform of the spectrum, and
//     S_est(σ) = 2δ Σ_{k=-K}^{K} a_k F_|k| cos(2πσkδ),
// with a_k = 1 (no apodization) or 1 - |k|/K (triangular apodization).  Two things limit it:
//   - the scan length Δmax = Kδ: S_est is S convolved with the transform of the window, a sinc
//     of first zero 1/(2Δmax) (or sinc² of first zero 1/Δmax with the triangle): the resolution;
//   - the step δ: samples cannot tell σ from σ ± m/δ, so light above the Nyquist wavenumber
//     σ_N = 1/(2δ) is folded back below it: aliasing.

import { fft, fft2 } from '../lib/fft.js';
import { TWO_PI, sinc2 } from './spectrum.js';

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * I(kδ) for k = 0 ... K.  The lines are summed directly; the continuum, a sum of triangles, is
 * resampled on a finer grid of spacing 1/(Nδ) so that its transform at the samples is one FFT.
 */
export function sampleInterferogram(spec, step, K, method = 'auto') {
  const out = new Float64Array(K + 1).fill(spec.I0);
  for (const l of spec.lines) {
    const g = 2 * Math.PI * Math.PI * l.w * l.w;
    for (let k = 0; k <= K; k++) {
      const D = k * step;
      out[k] += l.A * Math.exp(-g * D * D) * Math.cos(TWO_PI * l.s * D);
    }
  }
  if (spec.i1 < spec.i0) return out;
  const span = spec.i1 - spec.i0 + 1;
  const ds = spec.cont.ds, N = nextPow2(Math.max(2 * (K + 1), Math.ceil(4 / (step * ds))));
  if (method === 'direct' || (method === 'auto' && (span * (K + 1) < 4e5 || N > 1 << 21))) {
    const g = [0, 0];
    for (let k = 0; k <= K; k++) out[k] += spec.contGamma(k * step, g)[0];
    return out;
  }
  // The continuum as straight lines through S at σ'_j = j dσ', dσ' = 1/(Nδ); its transform at
  // Δ = kδ is dσ' sinc²(π dσ' kδ) Σ_j S(σ'_j) e^{2πijk/N}, and j can be taken mod N (aliasing).
  const dsp = 1 / (N * step), re = new Float64Array(N), im = new Float64Array(N);
  const { s0 } = spec.cont, lo = s0 + (spec.i0 - 1) * ds, hi = s0 + (spec.i1 + 1) * ds;
  for (let j = Math.ceil(lo / dsp); j <= Math.floor(hi / dsp); j++) re[((j % N) + N) % N] += spec.contDensity(j * dsp) * dsp;
  fft2(re, im, N, 1, +1);   // unnormalised inverse: Σ_j re_j e^{+2πijk/N}
  for (let k = 0; k <= K; k++) out[k] += sinc2(Math.PI * dsp * k * step) * re[k];
  return out;
}

/**
 * The spectrum from samples I_0 ... I_K at step δ: { s0: 0, ds, v } on 0 ... 1/(2δ), with
 * ds = 1/(Lδ), L ≥ 2(K + 1) a power of two times pad (zero filling: smoother, not sharper).
 */
export function recoverSpectrum(I, step, { apodize = false, pad = 1, length = 0 } = {}) {
  const K = I.length - 1, L = length || nextPow2(2 * (K + 1)) * pad;
  const re = new Float64Array(L), im = new Float64Array(L), ref = I[0] / 2;
  for (let k = 0; k <= K; k++) {
    const a = apodize && K > 0 ? 1 - k / (K + 1) : 1, F = (I[k] - ref) * a;
    if (k === 0) re[0] = F; else { re[k] = F; re[L - k] = F; }
  }
  fft(re, im);
  const v = new Float64Array(L / 2 + 1);
  for (let m = 0; m <= L / 2; m++) v[m] = 2 * step * re[m];
  return { s0: 0, ds: 1 / (L * step), v };
}

/** Resample samples of a drawn interferogram to a new step and length (linear interpolation; zero path stays fixed). */
export function resampleSamples(I, step, newStep, newK) {
  const out = new Float64Array(newK + 1), K = I.length - 1, tail = I[0] / 2;
  for (let k = 0; k <= newK; k++) {
    const p = (k * newStep) / step, j = Math.floor(p), f = p - j;
    if (j >= K) out[k] = j === K && f === 0 ? I[K] : tail;
    else out[k] = I[j] * (1 - f) + I[j + 1] * f;
  }
  return out;
}
