// Time-domain OCT: the detector's signal as the reference mirror moves, and the A-scan
// demodulated from it.  No DOM.
//
// With the reference mirror's amplitude 1 and the sample sending back bursts of amplitude a_i
// at round-trip paths Δ_i (a reflector at depth z in index n: Δ_i = 2nz), the detector sees
//     I(Δ) = I_dc + 2 Re E(Δ),      E(Δ) = Σ_i a_i γ(Δ − Δ_i),
//     I_dc = 1 + Σ a_i² + Σ_{i≠j} a_i a_j Re γ(Δ_i − Δ_j),
// Δ = 2d the round-trip path difference set by the mirror's position d, γ the source's
// coherence function (source.js): fringes at the centre wavelength, cos k₀(Δ − Δ_i), under a
// Gaussian envelope of full width 2ℓ_c in Δ, i.e. ℓ_c in d.  The last term of I_dc is the
// interference of the sample's reflections with each other, which does not move with the mirror.
// The A-scan is the envelope of the fringes, |E(Δ)|: the sample's reflectivity against depth.
//
// A real detector gives I(Δ) plus noise.  The envelope is recovered here as a lock-in would:
// band-pass the signal around the fringe frequency k₀ (a window as wide as the source's
// spectrum, so the bursts pass whole and most of the noise does not), then take the magnitude of
// the analytic signal (the Hilbert transform, by FFT).

import { fft, ifft } from '../lib/fft.js';
import { gaussPair } from './sample.js';

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * The complex envelope E on the grid Δ_j = D0 + j h, j < N, written into re, im (Float64Array(N)):
 * each burst contributes only where its envelope is above 10⁻⁶ (|Δ − Δ_i| < reach), with the
 * carrier e^{ik₀(Δ − Δ_i)} advanced by one complex multiplication per sample.
 */
export function complexEnvelope(bursts, src, D0, h, N, re, im) {
  re.fill(0); im.fill(0);
  const k0 = src.k0, s2 = 0.5 * src.sigk * src.sigk;
  const cs = Math.cos(k0 * h), sn = Math.sin(k0 * h), g = [0, 0];
  for (const b of bursts) {
    const reach = src.reachWith(b.beta || 0);
    const j0 = Math.max(0, Math.ceil((b.D - reach - D0) / h)), j1 = Math.min(N - 1, Math.floor((b.D + reach - D0) / h));
    if (j1 < j0) continue;
    if (b.beta) {
      // A burst spread by dispersion: its chirped coherence function, sample by sample.
      for (let j = j0; j <= j1; j++) { src.gamma(D0 + j * h - b.D, g, b.beta); re[j] += b.a * g[0]; im[j] += b.a * g[1]; }
      continue;
    }
    let u = D0 + j0 * h - b.D;
    let c = Math.cos(k0 * u) * b.a, s = Math.sin(k0 * u) * b.a;
    for (let j = j0; j <= j1; j++, u += h) {
      const e = Math.exp(-s2 * u * u);
      re[j] += e * c; im[j] += e * s;
      const t = c * cs - s * sn; s = c * sn + s * cs; c = t;
    }
  }
}

/** The level with no fringes: 1 + Σ a_i² + the sample's reflections interfering with each other
 *  (they pass the same glass, so dispersion in the sample arm does not touch these terms). */
export function dcLevel(bursts, src) {
  let dc = 1;
  for (const b of bursts) dc += b.a * b.a;
  for (let i = 0; i < bursts.length; i++) for (let j = 0; j < bursts.length; j++) {
    if (i === j) continue;
    const D = bursts[i].D - bursts[j].D;
    dc += bursts[i].a * bursts[j].a * src.envelope(D) * Math.cos(src.k0 * D);
  }
  return dc;
}

/**
 * The band-pass window used to demodulate, at wavenumber k: 1 within 3σ_k of k₀, falling as cos²
 * to 0 at 4σ_k; and its noise-equivalent width ∫ W² dk (for calibrating the noise).
 */
export function bandWindow(src, k) {
  const u = Math.abs(k - src.k0) / src.sigk;
  if (u <= 3) return 1;
  if (u >= 4) return 0;
  const c = Math.cos((Math.PI / 2) * (u - 3));
  return c * c;
}
export const BAND_WIDTH_SIGMAS = 6 + 2 * 0.375;    // ∫ W² dk / σ_k: 6 flat, and 3/8 of each taper

/**
 * The detector's trace on the grid Δ_j = D0 + j h: { I, re, im, dc, sigmaI } with I the noisy
 * signal, (re, im) the noiseless complex envelope.  noise: the standard deviation of the noise
 * in the demodulated A-scan, in units of reflectivity (so a reflector with a < noise is lost);
 * the white noise added to each sample of the trace has the standard deviation that gives it:
 * white noise of variance σ_I² per sample is a flat spectrum σ_I² h/2π per unit k; the analytic
 * signal keeps the band ∫W²dk of it, doubled, and the A-scan is half of that: per component
 * σ_r² = σ_I² h B/(4π), B = ∫ W² dk.
 */
export function detectorTrace(bursts, src, D0, h, N, { noise = 0, rng = null } = {}) {
  const re = new Float64Array(N), im = new Float64Array(N);
  complexEnvelope(bursts, src, D0, h, N, re, im);
  const dc = dcLevel(bursts, src), I = new Float64Array(N);
  for (let j = 0; j < N; j++) I[j] = dc + 2 * re[j];
  const B = BAND_WIDTH_SIGMAS * src.sigk;
  const sigmaI = noise > 0 ? noise * Math.sqrt((4 * Math.PI) / (h * B)) : 0;
  if (sigmaI > 0 && rng) {
    const g = [0, 0];
    for (let j = 0; j < N; j += 2) { gaussPair(rng, g); I[j] += sigmaI * g[0]; if (j + 1 < N) I[j + 1] += sigmaI * g[1]; }
  }
  return { I, re, im, dc, sigmaI, D0, h, N };
}

/**
 * The A-scan from a trace: the magnitude of the band-passed analytic signal of (I − dc)/2, on the
 * same grid.  The transform is zero-padded to a power of two at least twice the length; the
 * sample step h must resolve the fringes (h < λ₀/2).
 */
export function demodulate(trace, src) {
  const { I, dc, h, N } = trace, L = nextPow2(2 * N);
  const re = new Float64Array(L), im = new Float64Array(L);
  for (let j = 0; j < N; j++) re[j] = 0.5 * (I[j] - dc);
  fft(re, im);
  // Keep the positive frequencies only, doubled, inside the band-pass window.  The FFT bin m is
  // the wavenumber 2π m / (L h).
  const dk = (2 * Math.PI) / (L * h);
  re[0] = im[0] = 0;
  for (let m = 1; m < L / 2; m++) {
    const w = 2 * bandWindow(src, m * dk);
    re[m] *= w; im[m] *= w;
    re[L - m] = im[L - m] = 0;
  }
  { const w = bandWindow(src, (L / 2) * dk); re[L / 2] *= w; im[L / 2] *= w; }
  ifft(re, im);
  const A = new Float64Array(N);
  for (let j = 0; j < N; j++) A[j] = Math.hypot(re[j], im[j]);
  return A;
}

/**
 * The peaks of an A-scan A on a grid starting at D0 with step h: [{ D, a, j }] for every local
 * maximum above `floor`, highest first.
 */
export function peaks(A, D0, h, floor = 0) {
  const out = [];
  for (let j = 1; j + 1 < A.length; j++) {
    if (A[j] > floor && A[j] >= A[j - 1] && A[j] > A[j + 1]) {
      // A parabola through the three points refines the position.
      const d = 0.5 * (A[j - 1] - A[j + 1]) / (A[j - 1] - 2 * A[j] + A[j + 1]);
      out.push({ D: D0 + (j + (Number.isFinite(d) ? d : 0)) * h, a: A[j], j });
    }
  }
  return out.sort((p, q) => q.a - p.a);
}

/** The full width at half maximum of the peak at index j of A (in samples times h). */
export function peakWidth(A, j, h) {
  const half = A[j] / 2;
  let lo = j, hi = j;
  while (lo > 0 && A[lo] > half) lo--;
  while (hi + 1 < A.length && A[hi] > half) hi++;
  // Interpolate the crossings.
  const fl = lo < j ? (A[lo + 1] - half) / (A[lo + 1] - A[lo]) : 0, fh = hi > j ? (A[hi - 1] - half) / (A[hi - 1] - A[hi]) : 0;
  return (hi - fh - (lo + 1 - fl)) * h;
}

/** 20 log₁₀ of an amplitude (10 log₁₀ of the power reflectivity R = r²), −∞ guarded. */
export const dB = (a) => (a > 0 ? 20 * Math.log10(a) : -200);
