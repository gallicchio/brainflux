// Fourier-transform spectroscopy: the mirror steps the path difference through Δ_k = kδ, the
// detector's signal I(Δ_k) is recorded at each step, and the spectrum is computed from the samples.
//
// I(Δ) = I0 + ∫ S(σ) cos(2πσΔ) dσ is even in Δ: the two sides of zero path are mirror images
// and carry the same information.  With F_k = I_k − I0 (I0 = I(0)/2, the level with no
// interference), the spectrum is the cosine transform
//     S_est(σ) = 2δ Σ_{k=−K}^{K} a_k F_k cos(2πσkδ),
// summed over a two-sided scan (k = −K ... K, every sample measured) or over one side
// (k = 0 ... K, with F_−k = F_k), and a_k = 1, or 1 − |k|/(K + 1) to apodize (a triangle).
// Two things limit it:
//   - the scan's reach Δmax = Kδ: S_est is S convolved with the transform of the window, a sinc
//     of first zero 1/(2Δmax) (or sinc² of first zero 1/Δmax with the triangle): the resolution,
//     δσ ≈ 1/Δmax as usually quoted (two lines show a dip between them from about 0.7/Δmax apart,
//     0.9/Δmax with the triangle);
//   - the step δ: samples cannot tell σ from σ ± m/δ, so light above the Nyquist wavenumber
//     σ_N = 1/(2δ) is folded back below it: aliasing.
//
// What the second side buys.  The one-sided sum needs its first sample exactly at zero path.  If
// the samples are at Δ = kδ + ε instead, a line at σ0 comes out times cos 2πσ0ε, plus a
// dispersion-shaped error times sin 2πσ0ε (at ε = λ/4 the line turns into a wiggle; at λ/2 it
// is upside down).  But the complex sum over a two-sided scan,
//     C(σ) = 2δ Σ_k F_k e^{−2πiσkδ}  ≈  S(σ) e^{2πiσε}   (each line keeping the phase 2πσ0ε),
// only gains a phase.  Taking the phase out gives S back: phase correction.  The phase to take
// out is that of the same sum with the triangle's weights (as Mertz did with a short two-sided
// scan): the triangle's transform is nowhere negative, so where the light is, that sum has the
// light's own phase, while the unweighted sum also has the ripples, which are negative.

import { fft, fft2 } from '../lib/fft.js';
import { TWO_PI, sinc2 } from './spectrum.js';

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * The detector's signal at Δ = kδ + offset: for k = 0 ... K (sides 1), or for k = −K ... K
 * (sides 2, the sample at k at index k + K).  The lines are summed directly; the continuum, a sum
 * of triangles, is resampled on a finer grid of spacing 1/(Nδ) so that its transform at all the
 * samples is one FFT.
 */
export function sampleInterferogram(spec, step, K, method = 'auto', { sides = 1, offset = 0 } = {}) {
  const k0 = sides === 2 ? -K : 0, n = K - k0 + 1, at = (j) => (k0 + j) * step + offset;
  const out = new Float64Array(n).fill(spec.I0);
  for (const l of spec.lines) {
    const g = 2 * Math.PI * Math.PI * l.w * l.w;
    for (let j = 0; j < n; j++) {
      const D = at(j);
      out[j] += l.A * Math.exp(-g * D * D) * Math.cos(TWO_PI * l.s * D);
    }
  }
  if (spec.i1 < spec.i0) return out;
  const span = spec.i1 - spec.i0 + 1;
  const ds = spec.cont.ds, N = nextPow2(Math.max(2 * n, Math.ceil(4 / (step * ds))));
  if (method === 'direct' || (method === 'auto' && (span * n < 4e5 || N > 1 << 21))) {
    const g = [0, 0];
    for (let j = 0; j < n; j++) out[j] += spec.contGamma(at(j), g)[0];
    return out;
  }
  // The continuum as straight lines through S at σ'_i = i dσ', dσ' = 1/(Nδ); its transform at
  // Δ = kδ + ε is dσ' sinc²(π dσ' Δ) Σ_i S(σ'_i) e^{2πiσ'_iε} e^{2πiik/N}, and i can be taken
  // mod N (that is aliasing).
  const dsp = 1 / (N * step), re = new Float64Array(N), im = new Float64Array(N);
  const { s0 } = spec.cont, lo = s0 + (spec.i0 - 1) * ds, hi = s0 + (spec.i1 + 1) * ds;
  for (let i = Math.ceil(lo / dsp); i <= Math.floor(hi / dsp); i++) {
    const v = spec.contDensity(i * dsp) * dsp, q = ((i % N) + N) % N;
    if (offset) { const ph = TWO_PI * i * dsp * offset; re[q] += v * Math.cos(ph); im[q] += v * Math.sin(ph); } else re[q] += v;
  }
  fft2(re, im, N, 1, +1);   // unnormalised inverse: Σ_i x_i e^{+2πiik/N}
  for (let j = 0; j < n; j++) out[j] += sinc2(Math.PI * dsp * at(j)) * re[(((k0 + j) % N) + N) % N];
  return out;
}

/**
 * The spectrum from samples I_j taken at Δ = (j − zero)δ: { s0: 0, ds, v } on 0 ... 1/(2δ), with
 * ds = 1/(Lδ), L ≥ 2(m + 1) a power of two times pad (zero filling: smoother, not sharper).
 *   sides 1: the samples from zero on (m of them after it), the other side taken as their mirror
 *            image: the cosine transform, which assumes that sample zero is at zero path.
 *   sides 2: the samples from zero − m to zero + m, m the shorter side: the complex transform
 *            (re, im) and, if correct, v = Re(C e^{−iφ}) with φ the phase of the
 *            triangle-weighted transform (phase correction); else v = Re C.
 *   ref: the level with no interference (default: half the sample at zero).
 */
export function recoverSpectrum(I, step, { apodize = false, pad = 1, length = 0, zero = 0, sides = 1, ref, correct = true } = {}) {
  const two = sides === 2, m = two ? Math.min(zero, I.length - 1 - zero) : I.length - 1 - zero;
  const L = length || nextPow2(2 * (m + 1)) * pad, base = ref ?? I[zero] / 2;
  // F_k a_k at index k mod L; the weights a_k = 1, or the triangle 1 − |k|/(m + 1).
  const fill = (tri) => {
    const re = new Float64Array(L), im = new Float64Array(L);
    for (let k = 0; k <= m; k++) {
      const a = tri && m > 0 ? 1 - k / (m + 1) : 1;
      re[k] = (I[zero + k] - base) * a;
      if (k) re[L - k] = two ? (I[zero - k] - base) * a : re[k];
    }
    fft(re, im);
    return [re, im];
  };
  const [re, im] = fill(apodize);
  const n = L / 2 + 1, ds = 1 / (L * step), v = new Float64Array(n);
  if (!two) {
    for (let p = 0; p < n; p++) v[p] = 2 * step * re[p];
    return { s0: 0, ds, v };
  }
  const [wr, wi] = correct && !apodize ? fill(true) : [re, im];
  const R = new Float64Array(n), J = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    R[p] = 2 * step * re[p]; J[p] = 2 * step * im[p];
    const a = Math.hypot(wr[p], wi[p]);
    v[p] = correct && a > 0 ? (R[p] * wr[p] + J[p] * wi[p]) / a : R[p];
  }
  return { s0: 0, ds, v, re: R, im: J };
}
