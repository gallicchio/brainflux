// The scanner: a pulse sequence as a timeline of RF, gradients and the ADC; the k-space
// trajectory k(t) = (gamma / 2 pi) integral of G dt that follows from it; k-space sampled line
// by line from the weighted picture (by the FFT, since the samples lie on a Cartesian grid);
// the picture reconstructed from the lines measured so far by the inverse FFT, with the field
// of view, the matrix, noise and averaging of a real scan; and Lauterbur's way (1973):
// projections under a gradient turned to many angles, back-projected.  No DOM.
//
// Units as in bloch.js: mm, ms, mT/m, kHz.  The picture's grid is that of phantom.js (y up,
// the origin at pixel (N/2, N/2)); k-space has the same layout: pixel (p, q) is
// kx = (p - N/2) dk, ky = (N/2 - q) dk with dk = 1 / fov (cycles per mm), so with the centred
// FFT of lib/fft.js the forward transform of the picture is exactly the signal equation
// s(k) = sum of m(r) exp(-2 pi i k . r) (times 1/N: the transform is unitary).

import { fft2Centered } from '../lib/fft.js';
import { GB, lorentzOffsets } from './bloch.js';
import { rasterize, weightedImage, projection, shapesExtent, tissueAt } from './phantom.js';
import { prepareRaster, projectRaster, backproject, padRow, filterResponse, filterRow, filterWork, circleRows } from '../tomography/radon.js';

// ------------------------------------------------------------------- the sequence

/**
 * A spin-echo or gradient-echo sequence for one line of k-space.
 *   p: { type: 'se' | 'gre', TE, TR, N (matrix), fov (mm), Gx (the readout gradient, mT/m),
 *        Tpe (the phase-encode lobe's length, ms), Trf (the RF pulses' length), Gz (the
 *        slice-select gradient), bw (the pulses' bandwidth, kHz), flip (radians), T2prime }
 * Times are ms from the start of the TR.  The pi/2 pulse is centred at t90 = Trf/2; TE is
 * measured from there to the centre of the readout; k = 0 at t90.
 *
 * The parts follow one another, so that each can be watched alone: after the pulse and the
 * slice's rephasing lobe, the phase-encoding lobe Gy (stripes along y), then the readout's
 * prephasing lobe (k moves along x to one end of the row), then the readout +Gx, with the ADC
 * on, centred at TE.  Gradient echo: the prephaser is -Gx.  Spin echo: the prephaser is +Gx and
 * the pi pulse at TE/2 turns k into -k (it conjugates the transverse magnetization), so the
 * phase-encoding lobe winds -ky for the readout to run along +ky, through k = 0 at TE.
 */
export function sequence(p) {
  const { type = 'se', TR = 500, N = 128, fov = 256, Gx = 10, Tpe = 1, Trf = 3, Gz = 6, bw = 1.3, flip = Math.PI / 2, T2prime = 40 } = p;
  const dk = 1 / fov, Tro = N * dk / (GB * Gx);           // the readout sweeps N dk = N / fov cycles/mm
  const t90 = Trf / 2;
  // The phase-encoding lobe right after the slice's rephasing lobe, then the prephaser.
  const gyStart = 1.5 * Trf, preStart = gyStart + Tpe, preEnd = preStart + Tro / 2;
  const TEmin = (type === 'gre' ? preEnd + Tro / 2 - t90 : 2 * Math.max(preEnd + Trf / 2 - t90, Trf / 2 + Tro / 2)) + 0.05;
  const TE = Math.max(p.TE ?? 20, TEmin);
  const tEcho = t90 + TE, t180 = type === 'se' ? t90 + TE / 2 : null;
  const adc = [tEcho - Tro / 2, tEcho + Tro / 2];
  const rf = [{ t0: 0, t1: Trf, flip, label: flip === Math.PI / 2 ? 'π/2' : `${Math.round((flip * 180) / Math.PI)}°` }];
  const gz = [[0, Trf, Gz], [Trf, 1.5 * Trf, -Gz]];
  const gx = [[preStart, preEnd, type === 'se' ? Gx : -Gx]];
  if (type === 'se') {
    rf.push({ t0: t180 - Trf / 2, t1: t180 + Trf / 2, flip: Math.PI, label: 'π' });
    gz.push([t180 - Trf / 2, t180 + Trf / 2, Gz]);
  }
  gx.push([adc[0], adc[1], Gx]);
  const ky = (q) => (N / 2 - q) * dk;                       // the ky of k-space row q
  const Gy = (q) => ky(q) / (GB * Tpe);                     // the size of the lobe that winds it
  // (For a spin echo it winds -ky, which the pi pulse turns into +ky.)
  const gyLobe = (q) => [[gyStart, gyStart + Tpe, (type === 'se' ? -1 : 1) * Gy(q)]];
  const tEnd = adc[1] + 0.3;
  const seq = {
    type, TE, TR, N, fov, dk, Gx, Tro, Tpe, Trf, Gz, bw, flip, T2prime, t90, t180, tEcho, tEnd, TEmin, rf, gz, gx, adc, ky, Gy, gyLobe, gyStart, preStart, preEnd,
    readoutBandwidth: GB * Gx * fov,                        // kHz across the field of view
    /** The gradients [Gx, Gy] at time t for the line of row q. */
    gradientsAt(q, t) {
      let X = 0, Y = 0;
      for (const [a, b, g] of gx) if (t >= a && t < b) X = g;
      for (const [a, b, g] of gyLobe(q)) if (t >= a && t < b) Y = g;
      return [X, Y];
    },
    /** The times at which the in-plane gradients (or the pi pulse) change, after t90, sorted. */
    breakpoints(q) {
      const s = new Set([t90]);
      for (const [a, b] of [...gx, ...gyLobe(q)]) { s.add(a); s.add(b); }
      if (t180 !== null) s.add(t180);
      s.add(tEnd);
      return [...s].filter((t) => t >= t90).sort((a, b) => a - b);
    },
    /** k(t) = GB integral of G from t90, turned into -k by the pi pulse: [kx, ky] in cycles/mm. */
    kOf(q, t) {
      let kx = 0, kyv = 0;
      const bp = seq.breakpoints(q);
      for (let i = 0; i + 1 < bp.length; i++) {
        const a = bp[i], b = Math.min(bp[i + 1], t);
        if (b <= a) break;
        if (t180 !== null && a === t180) { kx = -kx; kyv = -kyv; }
        const [X, Y] = seq.gradientsAt(q, a + 1e-9);
        kx += GB * X * (b - a); kyv += GB * Y * (b - a);
      }
      return [kx, kyv];
    },
    /** The time at which the readout reaches kx (within the ADC window). */
    tOfKx(kx) { return tEcho + kx / (GB * Gx); },
    /** How long an uneven field has had to dephase the spins at time t: t - t90 for a gradient
     *  echo; for a spin echo the pi pulse turns that around, so it is t - tEcho after it (zero at
     *  the echo, which is the point of the pi pulse). */
    dephaseTime(t) { return t180 !== null && t >= t180 ? t - tEcho : t - t90; },
  };
  return seq;
}

/** The order in which the rows of k-space are measured: 'centre' (0, +1, -1, +2, ...) or 'up'
 *  (from -kmax to +kmax).  Returns the row indices q. */
export function lineOrder(N, scheme = 'centre') {
  const out = [];
  if (scheme === 'up') { for (let q = N - 1; q >= 0; q--) out.push(q); return out; }
  out.push(N / 2);
  for (let d = 1; d <= N / 2; d++) { if (N / 2 - d >= 0) out.push(N / 2 - d); if (N / 2 + d < N) out.push(N / 2 + d); }
  return out;
}

// ---------------------------------------------------------------------- k-space

/** A seeded random generator (xorshift32), and Gaussian pairs from it (Box-Muller). */
export function random(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function gaussianPair(rand) {
  const u = Math.max(rand(), 1e-12), v = rand(), r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/**
 * The picture of the object as a field of view fov (mm) of N x N pixels sees it: rasterized
 * at dx = fov / N over the object's whole height, then folded in y with the period fov (what
 * sampling k-space every 1/fov does to an object taller than the field of view: the parts
 * outside land fov away, inside).  Along x (the readout) nothing folds: a real scanner samples
 * faster than it needs and filters the frequencies outside the field of view away, so what lies
 * outside is simply cut off.  Returns the weighted total and its fat part, N x N.
 */
const RASTERS = new Map();
export function pictureOf(shapes, seq, B0, N, fov, ss = 4, withParts = false) {
  const dx = fov / N, [, , y0, y1] = shapesExtent(shapes);
  let ny = Math.ceil(2 * Math.max(Math.abs(y0), Math.abs(y1), fov / 2) / dx) + 2;
  if (ny % 2) ny++;
  // (The rasterized object does not depend on the sequence: the last few are kept, so that
  // changing TR or TE only reweights it.)
  const key = `${N}|${ny}|${dx}|${ss}|${JSON.stringify(shapes)}`;
  let raster = RASTERS.get(key);
  if (!raster) {
    raster = rasterize(shapes, N, ny, dx, ss);
    RASTERS.set(key, raster);
    if (RASTERS.size > 8) RASTERS.delete(RASTERS.keys().next().value);
  }
  const w = weightedImage(raster, seq, B0);
  const fold = (src) => {
    const out = new Float64Array(N * N);
    for (let jb = 0; jb < ny; jb++) {
      const j = (((jb - ny / 2 + N / 2) % N) + N) % N;
      for (let i = 0; i < N; i++) out[j * N + i] += src[jb * N + i];
    }
    return out;
  };
  const total = fold(w.total), fat = fold(w.fat);
  // (Each tissue's own part of the picture, when its decay during the readout is wanted.)
  let parts = null;
  if (withParts) {
    parts = [];
    for (const [name, wt] of Object.entries(w.weights)) {
      const f = raster.fills[name], img = new Float64Array(f.length);
      for (let i = 0; i < f.length; i++) img[i] = wt * f[i];
      const t = tissueAt(name, B0);
      parts.push({ name, shift: !!t.shift, T2: t.T2, img: fold(img) });
    }
  }
  return { total, fat, weights: w.weights, parts, dx, raster, folded: Math.max(Math.abs(y0), Math.abs(y1)) > fov / 2 + 1e-9 };
}

/**
 * How much each column of k-space (each kx, so each moment of the readout) keeps of a tissue's
 * signal as it decays during the readout, relative to the echo at kx = 0: the readout reaches
 * kx at tau = kx / (GB Gx) ms from the echo, by which time the echo has gone on fading as
 * exp(-tau / T2) (from the pi/2 pulse, so it is larger before the echo than after); and the
 * uneven field's T2': refocused at the echo of a spin echo, exp(-|tau| / T2'), or going on
 * from the pi/2 pulse in a gradient echo, exp(-tau / T2').  The k-space of a spread of
 * frequencies is the picture smeared along x: a symmetric exp(-|tau|/T) is a Lorentzian of
 * full width 1 / (pi T GB Gx) mm at half height, Tro / (pi T) pixels.  Returns Float64Array(N).
 */
export function readoutDecay(seq, T2) {
  const { N, dk, Gx, type, T2prime = Infinity } = seq, out = new Float64Array(N);
  for (let p = 0; p < N; p++) {
    const tau = ((p - N / 2) * dk) / (GB * Gx);
    out[p] = Math.exp(-tau / T2 - (type === 'se' ? Math.abs(tau) : tau) / T2prime);
  }
  return out;
}

/** The full width at half maximum, in pixels, of the smear along x that a decay with time
 *  constant T (ms, about the echo) gives over a readout of Tro ms: Tro / (pi T). */
export const readoutBlurPixels = (Tro, T) => Tro / (Math.PI * T);

/**
 * K-space from a picture: the unitary centred 2D FFT of the non-fat part plus that of the fat
 * part shifted along x by fatShift (mm; a phase ramp e^{-2 pi i kx shift}), which is what fat's
 * chemical shift does under the readout gradient.  Returns {re, im} (N x N).
 */
export function kspaceOf(total, fat, N, dk, fatShift = 0) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) re[i] = total[i] - fat[i];
  fft2Centered(re, im, N, N, false);
  let hasFat = false;
  for (let i = 0; i < N * N; i++) if (fat[i] !== 0) { hasFat = true; break; }
  if (hasFat) {
    const fr = Float64Array.from(fat), fi = new Float64Array(N * N);
    fft2Centered(fr, fi, N, N, false);
    for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
      const o = q * N + p, phi = -2 * Math.PI * (p - N / 2) * dk * fatShift, c = Math.cos(phi), s = Math.sin(phi);
      re[o] += fr[o] * c - fi[o] * s; im[o] += fr[o] * s + fi[o] * c;
    }
  }
  return { re, im };
}

/**
 * K-space tissue by tissue, each decaying during the readout at its own rate: the sum over the
 * picture's parts ({img, shift, T2}, from pictureOf with parts) of the FFT of each, times
 * decayOf(part) (a weight for each column, readoutDecay), with the fat shift's phase ramp on
 * the parts that turn 3.4 ppm slower.  With every weight 1 it is kspaceOf.  Returns {re, im}.
 */
export function kspaceOfParts(parts, N, dk, fatShift = 0, decayOf = null) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (const part of parts) {
    const fr = Float64Array.from(part.img), fi = new Float64Array(N * N);
    fft2Centered(fr, fi, N, N, false);
    const D = decayOf ? decayOf(part) : null, shift = part.shift ? fatShift : 0;
    for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
      const o = q * N + p, d = D ? D[p] : 1, phi = -2 * Math.PI * (p - N / 2) * dk * shift, c = d * Math.cos(phi), s = d * Math.sin(phi);
      re[o] += fr[o] * c - fi[o] * s; im[o] += fr[o] * s + fi[o] * c;
    }
  }
  return { re, im };
}

/** Complex Gaussian noise, seeded: each of re and im gets standard deviation sigma, as the two
 *  channels of a receiver do. */
export function noiseField(N, sigma, seed = 7) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N), rand = random(seed);
  if (sigma > 0) for (let i = 0; i < N * N; i++) { const [a, b] = gaussianPair(rand); re[i] = sigma * a; im[i] = sigma * b; }
  return { re, im };
}

// What an acquisition keeps from one setting to the next.  K-space is linear in the picture, and
// the picture is each tissue's fill times that tissue's weight (TR, TE, the field), so each
// tissue's own k-space, the transform of the fraction of each pixel it fills (folded into the
// field of view), is made once per rasterized object and re-weighted when the sequence changes:
// a new TR, TE, readout gradient or noise costs a weighted sum, not a 2D FFT per tissue.  And
// the unit noise is drawn once per matrix and seed, and scaled.
const TISSUE_K = new WeakMap(), UNIT_NOISE = new Map();
function tissueKspaces(raster, N) {
  let K = TISSUE_K.get(raster);
  if (K) return K;
  K = {};
  const ny = raster.ny;
  for (const [name, f] of Object.entries(raster.fills)) {
    const re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (let jb = 0; jb < ny; jb++) {
      const j = (((jb - ny / 2 + N / 2) % N) + N) % N;
      for (let i = 0; i < N; i++) re[j * N + i] += f[jb * N + i];
    }
    fft2Centered(re, im, N, N, false);
    K[name] = { re, im };
  }
  TISSUE_K.set(raster, K);
  return K;
}
function unitNoise(N, seed) {
  const key = `${N}|${seed}`;
  let n = UNIT_NOISE.get(key);
  if (!n) { n = noiseField(N, 1, seed); UNIT_NOISE.set(key, n); if (UNIT_NOISE.size > 8) UNIT_NOISE.delete(UNIT_NOISE.keys().next().value); }
  return n;
}

/** The picture from the rows of k-space that were measured (mask[q] = 1): the inverse FFT with
 *  zeros for the rest.  Returns {re, im, mag}. */
export function reconstruct(kre, kim, N, mask) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let q = 0; q < N; q++) if (mask[q]) { re.set(kre.subarray(q * N, (q + 1) * N), q * N); im.set(kim.subarray(q * N, (q + 1) * N), q * N); }
  fft2Centered(re, im, N, N, true);
  const mag = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) mag[i] = Math.hypot(re[i], im[i]);
  return { re, im, mag };
}

/** The root-mean-square difference between two pictures, and the largest value of the second. */
export function rmsDiff(a, b) {
  let s = 0, m = 0;
  for (let i = 0; i < a.length; i++) { s += (a[i] - b[i]) ** 2; m = Math.max(m, Math.abs(b[i])); }
  return { rms: Math.sqrt(s / a.length), max: m };
}

/**
 * One acquisition: the object (shapes) seen by a sequence with a field of view and matrix,
 * its k-space (with noise, averaged nsa times) and the rows measured so far.
 */
export class Acquisition {
  constructor() { this.N = 0; this.mask = null; }

  /**
   * Set everything: shapes, the sequence (from sequence()), B0, and the sampling: noise sigma
   * (as a fraction of the brightest pixel of the full picture), nsa averages, the fat shift
   * on or off (3.4 ppm of f0 under the readout gradient), seed.  The rows measured so far keep
   * what they measured (a row is a copy, taken when it is measured), so an object that changes
   * during a scan gives the artefacts of motion; call remeasure() to measure them all again.
   * noiseAbs: the noise of one average in the picture's own units (a pixel of water, fully
   * recovered and not faded, is 1), in place of sigma: the noise a real receiver sets (the
   * Earth's-field board's).  gain: the signal's size (the polarization: 1/170 without the
   * board's polarizing coil).  decay: each tissue fades during the readout (readoutDecay).
   */
  set({ shapes, seq, B0 = 1.5, sigma = 0, noiseAbs = null, nsa = 1, gain = 1, chemicalShift = false, decay = false, seed = 7 }) {
    const N = seq.N;
    if (N !== this.N) {
      this.N = N; this.mask = new Uint8Array(N);
      this.mre = new Float64Array(N * N); this.mim = new Float64Array(N * N);
    }
    this.seq = seq; this.B0 = B0; this.sigma = sigma; this.nsa = nsa; this.gain = gain; this.decay = decay;
    const pic = pictureOf(shapes, seq, B0, N, seq.fov, 4);
    if (gain !== 1) {
      for (const a of [pic.total, pic.fat]) for (let i = 0; i < a.length; i++) a[i] *= gain;
      for (const k of Object.keys(pic.weights)) pic.weights[k] *= gain;
    }
    this.picture = pic;
    // Fat precesses 3.4 ppm slower than water; under the readout gradient that reads as a
    // shift of -3.4e-6 f0 / (GB Gx) mm along x.
    this.fatShift = chemicalShift ? -(3.4e-6 * 42.577e3 * B0) / (GB * seq.Gx) : 0;   // kHz / (kHz/mm)
    // K-space: each tissue's own (tissueKspaces) times its weight, times, column by column (each
    // kx, each moment of the readout), the phase ramp of the fat shift for fat and oil and, if
    // asked for, what the tissue's decay during the readout leaves (readoutDecay).  The same as
    // kspaceOf, or kspaceOfParts with the decay, to rounding.
    const K = tissueKspaces(pic.raster, N), kre = new Float64Array(N * N), kim = new Float64Array(N * N);
    const cr = new Float64Array(N), ci = new Float64Array(N);
    for (const [name, w] of Object.entries(pic.weights)) {
      const T = K[name];
      if (!T || w === 0) continue;
      const t = tissueAt(name, B0), D = decay ? readoutDecay(seq, t.T2) : null, shift = t.shift ? this.fatShift : 0;
      for (let p = 0; p < N; p++) { const phi = -2 * Math.PI * (p - N / 2) * seq.dk * shift, d = w * (D ? D[p] : 1); cr[p] = d * Math.cos(phi); ci[p] = d * Math.sin(phi); }
      const R = T.re, I = T.im;
      for (let q = 0, o = 0; q < N; q++) for (let p = 0; p < N; p++, o++) { kre[o] += R[o] * cr[p] - I[o] * ci[p]; kim[o] += R[o] * ci[p] + I[o] * cr[p]; }
    }
    this.kre = kre; this.kim = kim;
    let max = 0;
    for (const v of pic.total) max = Math.max(max, v);
    this.peak = max;
    this.noise = (noiseAbs ?? sigma * max) / Math.sqrt(nsa);
    const u = this.noise > 0 ? unitNoise(N, seed) : null, s = this.noise;
    this.nre = new Float64Array(N * N); this.nim = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) { this.nre[i] = kre[i] + (u ? s * u.re[i] : 0); this.nim[i] = kim[i] + (u ? s * u.im[i] : 0); }
    this.stale = true;
    return this;
  }

  get measuredCount() { let n = 0; for (const m of this.mask) n += m; return n; }
  /** Measure row q now: copy what the scanner would record into the rows measured. */
  measure(q) {
    const N = this.N;
    this.mre.set(this.nre.subarray(q * N, (q + 1) * N), q * N);
    this.mim.set(this.nim.subarray(q * N, (q + 1) * N), q * N);
    this.mask[q] = 1; this.stale = true;
  }
  clear() { this.mask.fill(0); this.mre.fill(0); this.mim.fill(0); this.stale = true; }
  measureAll() { for (let q = 0; q < this.N; q++) this.measure(q); }
  /** Measure again every row measured so far (after a change, once a scan is over). */
  remeasure() { for (let q = 0; q < this.N; q++) if (this.mask[q]) this.measure(q); }

  /** The picture from the measured rows (cached until something changes). */
  image() {
    if (this.stale || !this._image) { this._image = reconstruct(this.mre, this.mim, this.N, this.mask); this.stale = false; }
    return this._image;
  }

  /** The signal along row q as the ADC records it: |s| against kx (and so against time). */
  rowMagnitude(q) {
    const N = this.N, out = new Float64Array(N);
    for (let p = 0; p < N; p++) out[p] = Math.hypot(this.nre[q * N + p], this.nim[q * N + p]);
    return out;
  }
}

// ------------------------------------------------------ the spins, for the live pictures

/**
 * The slice's spins for the live pictures: the weighted picture on an n x n grid (m, one spin
 * per pixel), and each spin's offset df (kHz) in a field that is not quite even, drawn from a
 * Lorentzian of half-width 1/(2 pi T2') so that together they dephase as exp(-|t|/T2').
 */
export function spinsOf(shapes, seq, B0, n, fov, seed = 11) {
  // (Weighted with T2 alone, as for a spin echo: the offsets themselves do the dephasing that
  // makes T2* in a gradient echo.)
  const pic = pictureOf(shapes, { ...seq, type: 'se' }, B0, n, fov, 2);
  return { n, dx: fov / n, m: pic.total, df: lorentzOffsets(n * n, seq.T2prime ?? 40, seed) };
}

/** The times to draw a line's signal at: nBefore from t90 to the readout, then the N instants
 *  at which the ADC samples (kx = (p - N/2) dk: the k-space samples themselves), then a few. */
export function traceTimes(seq, nBefore = 100, nAfter = 8) {
  const out = [];
  for (let i = 0; i < nBefore; i++) out.push(seq.t90 + ((seq.adc[0] - seq.t90) * i) / nBefore);
  for (let p = 0; p < seq.N; p++) out.push(seq.tOfKx((p - seq.N / 2) * seq.dk));
  const last = out[out.length - 1];
  for (let i = 1; i <= nAfter; i++) out.push(last + ((seq.tEnd - last) * i) / nAfter);
  return Float64Array.from(out);
}

/** The spins' transverse magnetization at time t of row q's sequence, m e^{-2 pi i (k.r + df tau)},
 *  into re, im (n x n).  tip: the part of the pi/2 pulse played so far (0 to 1), if t < t90. */
export function phaseMap(sp, seq, q, t, re, im, tip = 1) {
  const { n, dx, m, df } = sp, [kx, ky] = t <= seq.t90 ? [0, 0] : seq.kOf(q, t), tau = t <= seq.t90 ? 0 : seq.dephaseTime(t);
  const a = t < seq.t90 ? Math.sin((tip * Math.PI) / 2) : 1;
  const cx = new Float64Array(n), sx = new Float64Array(n);
  for (let i = 0; i < n; i++) { const ph = -2 * Math.PI * kx * (i - n / 2) * dx; cx[i] = Math.cos(ph); sx[i] = Math.sin(ph); }
  for (let j = 0; j < n; j++) {
    const py = -2 * Math.PI * ky * (n / 2 - j) * dx, cy = Math.cos(py), sy = Math.sin(py);
    for (let i = 0, o = j * n; i < n; i++, o++) {
      const v = m[o] * a;
      if (v === 0) { re[o] = 0; im[o] = 0; continue; }
      const pd = -2 * Math.PI * df[o] * tau, cd = Math.cos(pd), sd = Math.sin(pd);
      // e^{i(px + py + pd)}
      const c1 = cx[i] * cy - sx[i] * sy, s1 = sx[i] * cy + cx[i] * sy;
      re[o] = v * (c1 * cd - s1 * sd); im[o] = v * (s1 * cd + c1 * sd);
    }
  }
}

/**
 * The signal of row q's sequence at the times ts (ms, increasing, from t90 on): the sum over
 * the spins of m e^{-2 pi i (k(t).r + df tau(t))}, divided by the sum of m (so 1 when they are
 * all in step).  The k part factorizes (rows, then columns); the offsets' phases are turned on
 * from sample to sample and conjugated by the pi pulse.  Returns {re, im}.
 */
export function echoTrace(sp, seq, q, ts) {
  const { n, dx, m, df } = sp, N2 = n * n, nt = ts.length, outRe = new Float64Array(nt), outIm = new Float64Array(nt);
  let total = 0;
  for (let o = 0; o < N2; o++) total += m[o];
  if (!(total > 0)) return { re: outRe, im: outIm };
  // The offsets' phasors at the first sample, and the turn per unit of tau (recomputed if the step changes).
  const Pr = new Float64Array(N2), Pi = new Float64Array(N2);
  let tau0 = seq.dephaseTime(ts[0]);
  for (let o = 0; o < N2; o++) { const a = -2 * Math.PI * df[o] * tau0; Pr[o] = Math.cos(a); Pi[o] = Math.sin(a); }
  const Rr = new Float64Array(N2), Ri = new Float64Array(N2);
  let step = NaN;
  const cx = new Float64Array(n), sx = new Float64Array(n), rowRe = new Float64Array(n), rowIm = new Float64Array(n);
  for (let s = 0; s < nt; s++) {
    const t = ts[s], tau = seq.dephaseTime(t);
    if (s > 0) {
      const d = tau - tau0;
      if (Math.abs(d - step) > 1e-9 || !Number.isFinite(step)) {
        if (Math.abs(tau + tau0) < 1e-9 * Math.max(1, Math.abs(tau))) { for (let o = 0; o < N2; o++) Pi[o] = -Pi[o]; tau0 = tau; }   // the pi pulse
        else { step = d; for (let o = 0; o < N2; o++) { const a = -2 * Math.PI * df[o] * d; Rr[o] = Math.cos(a); Ri[o] = Math.sin(a); } }
      }
      if (tau !== tau0) {
        for (let o = 0; o < N2; o++) { const a = Pr[o], b = Pi[o]; Pr[o] = a * Rr[o] - b * Ri[o]; Pi[o] = a * Ri[o] + b * Rr[o]; }
        tau0 = tau;
      }
    }
    const [kx, ky] = seq.kOf(q, t);
    for (let i = 0; i < n; i++) { const ph = -2 * Math.PI * kx * (i - n / 2) * dx; cx[i] = Math.cos(ph); sx[i] = Math.sin(ph); }
    let sr = 0, si = 0;
    for (let j = 0; j < n; j++) {
      let ar = 0, ai = 0;
      for (let i = 0, o = j * n; i < n; i++, o++) {
        const v = m[o];
        if (v === 0) continue;
        const pr = v * Pr[o], pi = v * Pi[o];
        ar += pr * cx[i] - pi * sx[i]; ai += pr * sx[i] + pi * cx[i];
      }
      const py = -2 * Math.PI * ky * (n / 2 - j) * dx, cy = Math.cos(py), sy = Math.sin(py);
      sr += ar * cy - ai * sy; si += ar * sy + ai * cy;
    }
    outRe[s] = sr / total; outIm[s] = si / total;
  }
  return { re: outRe, im: outIm };
}

// ------------------------------------------------------------- Lauterbur's way (1973)

/**
 * Projections of a picture (N x N, pixel dx mm) under a gradient G turned to each of the
 * angles (radians): the spectrum of the FID at angle theta is the picture summed along lines
 * perpendicular to the gradient, with frequency f = GB G s, s the distance along the gradient.
 * Returns {profiles: [Float64Array(N)], ds, fOfS}.
 */
export function projections(img, N, dx, angles, G = 1) {
  // By the tomography demo's projector (Joseph's method: each ray steps through the rows or
  // columns and interpolates), on its grid, which is this one: pixel N/2 at the centre, the
  // scan circle's radius fov/2, so its line integrals are in units of fov/2.
  const raster = prepareRaster(img, N), half = (N * dx) / 2, M = N, ds = 2 / M;
  // (Array.from: a typed array's own map would turn each profile into a number.)
  const profiles = Array.from(angles, (th) => { const p = projectRaster(raster, th, M, ds, 1, new Float64Array(M)); for (let k = 0; k < M; k++) p[k] *= half; return p; });
  return { profiles, ds: dx, fOfS: (s) => GB * G * s };
}

/**
 * Back-projection of profiles measured at angles (radians), unfiltered (as Lauterbur did,
 * summing the projections back along their lines) or filtered with the ramp (the tomography
 * demo's filtered back-projection, which gives the picture itself).  Both are returned as
 * N x N pictures; the unfiltered one is scaled so that its mean inside the circle matches the
 * filtered one's, to be drawn on the same grey scale.
 */
export function backprojection(profiles, angles, N, dx, filter = true) {
  const M = N, ds = 2 / N, rows = circleRows(N), unf = new Float64Array(N * N), filt = new Float64Array(N * N);
  const H = filterResponse('ramlak', M, ds, 1), work = filterWork(M), Q = new Float64Array(M), tmp = new Float64Array(M);
  const dth = Math.PI / angles.length, scale = 2 / (N * dx);     // mm per unit length: fov / 2
  for (let j = 0; j < angles.length; j++) {
    for (let k = 0; k < M; k++) tmp[k] = profiles[j][k] * scale;      // the projection in units of the scan radius
    const pA = padRow(tmp, M);
    if (filter) { filterRow(tmp, M, H, Q, work); backproject(N, rows, angles[j], M, ds, unf, pA, dth, filt, padRow(Q, M), dth); }
    else backproject(N, rows, angles[j], M, ds, unf, pA, dth);
  }
  return { filtered: filter ? filt : null, unfiltered: unf };
}
