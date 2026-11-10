// The detector's output: Gaussian noise drawn from the noise curve, a binary's chirp added to
// it, the data whitened, and the matched filter that finds the chirp.  No DOM here, so that the
// tests can exercise it.
//
// Conventions.  A stretch of T seconds sampled at fs: N = fs T samples t_j = j Δt, Fourier bins
// f_k = k Δf with Δf = 1/T, and x̃_k = Δt Σ_j x_j e^{−2πi jk/N} (the continuous transform's
// discrete twin).  S_n(f) is the one-sided power spectral density of the strain noise, so for
// stationary Gaussian noise E|ñ_k|² = S_n(f_k)/(2Δf) and the variance per sample is ∫S_n df.
//
// The noise.  A seeded white spectrum w_k, complex Gaussian with E|w_k|² = 1, is shaped by the
// noise curve, ñ_k = w_k √(S_n(f_k)/(2Δf)), and transformed back to time.  The realisation is
// fixed by the seed: change the spectrum (turn squeezing on) and the same w_k are rescaled.
//
// Whitened data.  Divide by the noise's amplitude in each bin, ũ_k = x̃_k / √(S_n/(2Δf)), keep
// the chirp's band [f0, f1], back to time, and scale so that the noise has unit variance per
// sample: the whitened noise is then w itself, the same whatever the spectrum, and the chirp
// shows as the matched filter sees it, each frequency weighted by how quiet the detector is.
//
// The matched filter.  The template T(t) is the chirp at 1 Mpc with its merger at t = 0; its
// correlation with the data d, weighted by the noise, slid to every merger time t0:
//
//     z(t0) = 4Δf Re Σ_k d̃_k T̃_k* e^{2πi f_k t0} / S_n(f_k) / σ,    σ² = 4Δf Σ_k |T̃_k|²/S_n(f_k),
//
// the sums over the band.  For noise alone z is Gaussian with mean 0 and variance exactly 1 (its
// variance is 16Δf² Σ |T̃|²/S_n² · S_n/(4Δf) / σ² = 1); for the chirp at distance d merging at
// t0 it is σ/d, the optimal signal-to-noise ratio ρ = √(4∫|h̃|²/S_n df).  So the output is
// ρ plus unit noise when the template lines up, and unit noise elsewhere.

import { fft, ifft } from '../lib/fft.js';
import { Rng } from './homodyne.js';

export class Detector {
  /** fs: samples per second; T: seconds (fs T a power of two). */
  constructor({ fs = 4096, T = 8 } = {}) {
    this.fs = fs; this.T = T; this.N = Math.round(fs * T); this.dt = 1 / fs; this.df = 1 / T;
    if (this.N & (this.N - 1)) throw new Error('fs T must be a power of two');
    const N = this.N, H = N / 2 + 1;
    this.f = Float64Array.from({ length: H }, (_, k) => k * this.df);
    this.wRe = new Float64Array(H); this.wIm = new Float64Array(H);       // the white spectrum
    this.tRe = new Float64Array(H); this.tIm = new Float64Array(H);       // the template's spectrum (merger at 0)
    this.S = new Float64Array(H);                                         // S_n at the bins
    this.re = new Float64Array(N); this.im = new Float64Array(N);         // workspace
    // The series, made again in place for each new spectrum (the raw noise only when asked for).
    this.whiteNoise = new Float64Array(N); this.mfNoise = new Float64Array(N);
    this.whiteSignal1 = new Float64Array(N); this.mfSignal1 = new Float64Array(N);
    this._raw = new Float64Array(N); this._rawFresh = false;
    this.seed = null; this.spectrumKey = null; this.fresh = false;
    this.band = [20, 1000]; this.rawLow = 10;
  }

  /**
   * The chirp at 1 Mpc (h1, sampled at fs) merging at the time tMerge (s) of the stretch; band:
   * the frequencies kept in the whitened data and the matched filter (the chirp's, say);
   * rawLow: the raw data are high-passed there (the detector's data are usable above ~10 Hz).
   */
  setSignal(h1, tMerge, band, rawLow = 10) {
    const N = this.N, n = h1.length, m = Math.round(tMerge * this.fs);
    if (n > m || m > N) throw new Error('the chirp does not fit in the stretch');
    this.n = n; this.mergeIndex = m % N; this.band = band; this.rawLow = rawLow;
    // The data's chirp, in time, ending at the merger.
    this.signal1 = new Float64Array(N);
    this.signal1.set(h1, m - n);
    // The template: the same chirp with its merger at t = 0 (wrapped to the end of the stretch).
    this.re.fill(0); this.im.fill(0);
    this.re.set(h1, N - n);
    fft(this.re, this.im);
    for (let k = 0; k <= N / 2; k++) { this.tRe[k] = this.re[k] * this.dt; this.tIm[k] = this.im[k] * this.dt; }
    this.k0 = Math.max(1, Math.ceil(band[0] / this.df)); this.k1 = Math.min(N / 2 - 1, Math.floor(band[1] / this.df));
    this.kRaw = Math.max(1, Math.ceil(rawLow / this.df));
    this.fresh = false; this.spectrumKey = null;
  }

  /** A fresh white spectrum from the seed (the noise realisation). */
  setSeed(seed) {
    if (seed === this.seed) return;
    this.seed = seed;
    const rng = new Rng(seed), s = Math.SQRT1_2;
    this.wRe[0] = this.wIm[0] = 0;
    for (let k = 1; k < this.N / 2; k++) { this.wRe[k] = s * rng.gauss(); this.wIm[k] = s * rng.gauss(); }
    this.wRe[this.N / 2] = this.wIm[this.N / 2] = 0;
    this.fresh = false; this.spectrumKey = null;
  }

  /** The noise curve: Sn(f), the one-sided PSD; key: anything that changes when it does. */
  setSpectrum(Sn, key) {
    if (key !== undefined && key === this.spectrumKey && this.fresh) return false;
    const N = this.N, lo = Math.min(this.kRaw, this.k0);
    for (let k = 0; k <= N / 2; k++) this.S[k] = k >= lo && k < N / 2 ? Sn(this.f[k]) : Infinity;
    this.spectrumKey = key;
    this.compute();
    return true;
  }

  /** Every series that depends on the seed, the signal and the spectrum (the raw noise when first asked for). */
  compute() {
    const N = this.N, df = this.df, { k0, k1, S, wRe, wIm, tRe, tIm } = this;
    const nBand = k1 - k0 + 1, uScale = 1 / Math.sqrt(2 * nBand);
    let s2 = 0;
    for (let k = k0; k <= k1; k++) s2 += (tRe[k] * tRe[k] + tIm[k] * tIm[k]) / S[k];
    this.sigma1 = Math.sqrt(4 * df * s2);
    const m = this.mergeIndex;
    // Series are paired for the inverse transforms by size (each pair's round-off leaks into
    // the other at 1e-16 of its size, so the strain-sized raw noise goes alone).
    // 1. The matched filter's output for the noise and for the chirp at 1 Mpc.
    const mf = (4 * df) / this.sigma1;
    // The data's chirp: the template moved to merge at m, e^{−2πi k m/N} by a recurrence.
    const ca = Math.cos((2 * Math.PI * m) / N), sa = -Math.sin((2 * Math.PI * m) / N);
    let cr = Math.cos((2 * Math.PI * k0 * m) / N), ci = -Math.sin((2 * Math.PI * k0 * m) / N);
    const hR = new Float64Array(k1 + 1), hI = new Float64Array(k1 + 1);
    for (let k = k0; k <= k1; k++) {
      hR[k] = tRe[k] * cr - tIm[k] * ci; hI[k] = tRe[k] * ci + tIm[k] * cr;
      if ((k - k0) % 64 === 63) { const a = (-2 * Math.PI * (k + 1) * m) / N; cr = Math.cos(a); ci = Math.sin(a); }
      else { const t = cr * ca - ci * sa; ci = cr * sa + ci * ca; cr = t; }
    }
    this.twoReal((k, out) => {
      if (k < k0 || k > k1) { out.fill(0); return; }
      const amp = Math.sqrt(S[k] / (2 * df)), nr = wRe[k] * amp, ni = wIm[k] * amp, hr = hR[k], hi = hI[k], g = (0.5 * mf) / S[k];
      // ñ T̃* / S and h̃ T̃* / S, with the 1/2 because twoReal makes 2 Re Σ.
      out[0] = g * (nr * tRe[k] + ni * tIm[k]); out[1] = g * (ni * tRe[k] - nr * tIm[k]);
      out[2] = g * (hr * tRe[k] + hi * tIm[k]); out[3] = g * (hi * tRe[k] - hr * tIm[k]);
    }, this.mfNoise, this.mfSignal1);
    // 2. The whitened noise (the seed and the band only: w itself) and the whitened chirp.
    this.twoReal((k, out) => {
      if (k < k0 || k > k1) { out.fill(0); return; }
      const w = uScale / Math.sqrt(S[k] / (2 * df));
      out[0] = wRe[k] * uScale; out[1] = wIm[k] * uScale;
      out[2] = hR[k] * w; out[3] = hI[k] * w;
    }, this.whiteNoise, this.whiteSignal1);
    this._rawFresh = false;
    this.fresh = true;
  }

  /** The raw noise, high-passed at rawLow: made when first asked for after a new spectrum. */
  get rawNoise() {
    if (!this._rawFresh) {
      const { kRaw, S, wRe, wIm, df } = this;
      this.twoReal((k, out) => {
        const amp = k >= kRaw ? Math.sqrt(S[k] / (2 * df)) * df : 0;
        out[0] = wRe[k] * amp; out[1] = wIm[k] * amp; out[2] = out[3] = 0;
      }, this._raw, null);
      this._rawFresh = true;
    }
    return this._raw;
  }

  /**
   * Two real series a_j = 2 Re Σ_k A_k e^{2πi jk/N} and b_j likewise, from one inverse FFT of
   * A + iB made Hermitian.  coef(k, out) puts A_k into out[0..1] and B_k into out[2..3].
   */
  twoReal(coef, a, b) {
    const N = this.N, re = this.re, im = this.im, out = new Float64Array(4);
    re.fill(0); im.fill(0);
    for (let k = 1; k < N / 2; k++) {
      coef(k, out);
      const [ar, ai, br, bi] = out;
      re[k] = ar - bi; im[k] = ai + br;
      re[N - k] = ar + bi; im[N - k] = br - ai;
    }
    ifft(re, im);
    for (let j = 0; j < N; j++) a[j] = re[j] * N;
    if (b) for (let j = 0; j < N; j++) b[j] = im[j] * N;
  }

  /** The series at distance d (Mpc): raw and whitened data and the matched filter's output, each noise + chirp. */
  series(d) {
    const N = this.N, g = 1 / d, raw = new Float64Array(N), white = new Float64Array(N), mf = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      raw[j] = this.rawNoise[j] + g * this.signal1[j];
      white[j] = this.whiteNoise[j] + g * this.whiteSignal1[j];
      mf[j] = this.mfNoise[j] + g * this.mfSignal1[j];
    }
    return { raw, white, mf };
  }

  /**
   * What the matched filter finds at distance d: rho, the expected height of its peak (σ/d);
   * atMerger, its output when the template lines up; peak and tPeak, its largest value and when;
   * noisePeak, its largest |z| more than `guard` seconds from the merger.
   */
  findings(d, guard = 0.1) {
    const N = this.N, g = 1 / d, m = this.mergeIndex, w = Math.round(guard * this.fs);
    let peak = -Infinity, jp = 0, noisePeak = 0;
    for (let j = 0; j < N; j++) {
      const z = this.mfNoise[j] + g * this.mfSignal1[j];
      if (z > peak) { peak = z; jp = j; }
      const dj = Math.min(Math.abs(j - m), N - Math.abs(j - m));
      if (dj > w) noisePeak = Math.max(noisePeak, Math.abs(z));
    }
    return { rho: this.sigma1 * g, atMerger: this.mfNoise[m] + g * this.mfSignal1[m], peak, tPeak: jp * this.dt, noisePeak, tMerge: m * this.dt };
  }
}

/** The sample mean and variance of x[i0 .. i1). */
export function meanVariance(x, i0 = 0, i1 = x.length) {
  let s = 0, s2 = 0;
  for (let i = i0; i < i1; i++) { s += x[i]; s2 += x[i] * x[i]; }
  const n = i1 - i0, mean = s / n;
  return { mean, variance: (s2 - n * mean * mean) / (n - 1) };
}
