// Fourier-domain OCT: the mirror stays still, a spectrometer records the interference spectrum,
// and its Fourier transform is the A-scan.  No DOM.
//
// With the reference's amplitude 1 and bursts of amplitude a_i at round-trip paths Δ_i, the
// spectrometer's pixel at wavenumber k measures
//     I(k) = S(k) [ 1 + Σ a_i² + 2 Σ_i a_i cos(kΔ_i) + 2 Σ_{i<j} a_i a_j cos(k(Δ_i − Δ_j)) ],
// a fringe in k for every reflector, of period 2π/Δ_i: the deeper the reflector, the finer the
// fringes.  Its inverse Fourier transform (the interferometer demo's spectrometer run backwards),
//     A(Δ) = δk | Σ_pixels I(k) e^{ikΔ} |,
// has the source's coherence envelope at Δ = ±Δ_i (the real spectrum cannot tell a reflector
// from one the same distance the other side of zero path: the mirror image), the DC term
// 1 + Σa² at Δ = 0, and the autocorrelation terms a_i a_j at ±(Δ_i − Δ_j).  Only Δ ≥ 0 is kept
// as the image.  The pixels are δk apart over the camera's range, so the fringes can be sampled
// only up to a period of 2δk: the depth range is Δ_max = π/δk, z_max = π/(2 n δk).  Each pixel
// integrates over its width δk, which multiplies A by sinc(Δδk/2), and the spectrometer's
// optical resolution (a Gaussian blur of one pixel's width, here) by exp(−(Δδk)²/(16 ln 2)): the
// fall-off with depth.

import { fft } from '../lib/fft.js';
import { nextPow2 } from './tdoct.js';

/** The camera covers this many times the source's full width at half maximum. */
export const SPAN = 3;

/**
 * The spectrometer: N pixels, δk apart, covering k₀ ± SPAN Δk/2; kLo the first pixel's
 * wavenumber; zMax(n) the depth range; rolloff(Δ) the fall-off factor.
 */
export function makeSpectrometer(src, N, { blur = 1 } = {}) {
  const dk = (SPAN * src.dk) / N, kLo = src.k0 - 0.5 * SPAN * src.dk + 0.5 * dk;
  const spec = {
    N, dk, kLo, blur, kHi: kLo + (N - 1) * dk,
    k: (j) => kLo + j * dk,
    DMax: Math.PI / dk,
    zMax: (n) => Math.PI / (2 * n * dk),
    rolloff(D) {
      const x = 0.5 * D * dk, s = Math.abs(x) < 1e-6 ? 1 : Math.sin(x) / x;
      const b = blur * D * dk;
      return s * Math.exp(-(b * b) / (16 * Math.LN2));
    },
  };
  return spec;
}

/**
 * The interference spectrum on the camera: { I, S, dc } (Float64Array(N) each, S the source
 * alone, the reference spectrum; dc the factor 1 + Σa²).  noise: the standard deviation of the
 * noise in the A-scan, in units of reflectivity (white noise on the pixels that gives it; see
 * noiseSigma).  rng: a random generator for it.
 */
export function cameraSpectrum(bursts, src, spec, { noise = 0, rng = null, autocorrelation = true } = {}) {
  const { N, dk } = spec, I = new Float64Array(N), S = new Float64Array(N);
  let dc = 1;
  for (const b of bursts) dc += b.a * b.a;
  for (let j = 0; j < N; j++) { S[j] = src.spectrum(spec.k(j)); I[j] = dc * S[j]; }
  const term = (D, amp) => {
    // amp cos(kΔ) at every pixel, by rotation; each pixel integrates over its width: times the roll-off.
    const f = amp * spec.rolloff(D) * 2;
    const cs = Math.cos(dk * D), sn = Math.sin(dk * D);
    let c = Math.cos(spec.kLo * D), s = Math.sin(spec.kLo * D);
    for (let j = 0; j < N; j++) {
      I[j] += f * S[j] * c;
      const t = c * cs - s * sn; s = c * sn + s * cs; c = t;
    }
  };
  for (const b of bursts) term(b.D, b.a);
  if (autocorrelation) for (let i = 0; i < bursts.length; i++) for (let l = i + 1; l < bursts.length; l++) term(bursts[i].D - bursts[l].D, bursts[i].a * bursts[l].a);
  if (noise > 0 && rng) {
    const sI = noiseSigma(src, spec, noise);
    for (let j = 0; j < N; j++) { const u = 1 - rng(), v = rng(); I[j] += sI * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  }
  return { I, S, dc };
}

/**
 * The white noise per pixel that leaves a noise of standard deviation σ_r (per component of the
 * complex A-scan, in units of reflectivity): the transform is δk Σ_j I_j e^{ikΔ}, so N pixels of
 * variance σ_I² give each component the variance N σ_I² δk² / 2, whereas a reflector a gives
 * the peak 2a Σ S_j δk cos(...) e^{...} → a (the spectrum has unit area).
 */
export function noiseSigma(src, spec, sigmaR) { return (sigmaR * Math.SQRT2) / (spec.dk * Math.sqrt(spec.N)); }

/**
 * The A-scan from the camera's spectrum: { A, D0: −Δ_max, h, L } with A(Δ) = δk |Σ_j I_j e^{ikΔ}|
 * on the grid Δ = −Δ_max + m h, m < L, h = 2π/(L δk), L = pad × N rounded up to a power of
 * two (zero-filling, for a smooth curve: it adds no information).  Subtracting the reference
 * spectrum S (measured with the sample arm blocked) takes the DC term out.
 */
export function fdAScan(cam, spec, { subtract = false, pad = 4 } = {}) {
  const { N, dk, kLo } = spec, L = nextPow2(pad * N);
  const re = new Float64Array(L), im = new Float64Array(L);
  for (let j = 0; j < N; j++) re[j] = subtract ? cam.I[j] - cam.dc * cam.S[j] : cam.I[j];
  // Σ_j x_j e^{+2πi jm/L} is the conjugate of the forward transform of the real data.
  fft(re, im);
  const h = (2 * Math.PI) / (L * dk), A = new Float64Array(L);
  // Bin m (0 ≤ m < L/2) is Δ = m h; bins above L/2 are negative Δ.  Put Δ = −Δ_max first.
  for (let m = 0; m < L; m++) {
    const q = (m + L / 2) % L;   // the bin whose Δ is −Δ_max + m h
    A[m] = dk * Math.hypot(re[q], im[q]);
  }
  return { A, D0: -Math.PI / dk, h, L, DMax: Math.PI / dk };
}

/** The A-scan for Δ ≥ 0 only (the image): { A, D0: 0, h }. */
export function positiveHalf(scan) {
  const m0 = scan.L / 2;
  return { A: scan.A.subarray(m0), D0: 0, h: scan.h };
}

/**
 * Where optical depth d lands in a Fourier-domain image of range dm (= Δ_max/2): the spectrum is
 * real, so −d looks like d, and it is sampled every δk, so d and 2dm − d look alike.  fold(d)
 * folds d into [0, dm].
 */
export function fold(d, dm) {
  const p = 2 * dm;
  let u = ((d % p) + p) % p;
  if (u > dm) u = p - u;
  return u;
}
