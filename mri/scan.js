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
import { GB } from './bloch.js';
import { rasterize, weightedImage, projection, shapesExtent } from './phantom.js';
import { prepareRaster, backproject, padRow, filterResponse, filterRow, filterWork, circleRows } from '../tomography/radon.js';

// ------------------------------------------------------------------- the sequence

/**
 * A spin-echo or gradient-echo sequence for one line of k-space.
 *   p: { type: 'se' | 'gre', TE, TR, N (matrix), fov (mm), Gx (the readout gradient, mT/m),
 *        Tpe (the phase-encode lobe's length, ms), Trf (the RF pulses' length), Gz (the
 *        slice-select gradient), bw (the pulses' bandwidth, kHz), flip (radians) }
 * Times are ms from the start of the TR.  The pi/2 pulse is centred at t90 = Trf/2; TE is
 * measured from there to the centre of the readout; k = 0 at t90.
 *
 * Gradient echo: after the pulse (and the slice rephaser), the phase-encode lobe Gy and the
 * readout prephaser -Gx run together; the readout +Gx, with the ADC on, is centred at TE.
 * Spin echo: the prephaser is +Gx and comes before the pi pulse at TE/2, which turns k into -k
 * (it conjugates the transverse magnetization), so that the readout then runs through k = 0 at
 * TE; the phase-encode lobe follows the pi pulse.
 */
export function sequence(p) {
  const { type = 'se', TR = 500, N = 128, fov = 256, Gx = 10, Tpe = 1, Trf = 3, Gz = 6, bw = 1.3, flip = Math.PI / 2 } = p;
  const dk = 1 / fov, Tro = N * dk / (GB * Gx);           // the readout sweeps N dk = N / fov cycles/mm
  const t90 = Trf / 2;
  const TEmin = type === 'gre' ? Trf / 2 + Math.max(Tpe, Tro / 2, Trf / 2) + Tro / 2 + 0.05
    : Math.max(2 * Trf + Math.max(Tro, Trf), Trf + 2 * Tpe + Tro) + 0.1;
  const TE = Math.max(p.TE ?? 20, TEmin);
  const tEcho = t90 + TE, t180 = type === 'se' ? t90 + TE / 2 : null;
  const adc = [tEcho - Tro / 2, tEcho + Tro / 2];
  const rf = [{ t0: 0, t1: Trf, flip, label: flip === Math.PI / 2 ? 'π/2' : `${Math.round((flip * 180) / Math.PI)}°` }];
  const gz = [[0, Trf, Gz], [Trf, 1.5 * Trf, -Gz]];
  const gx = [];
  let gyStart;
  if (type === 'se') {
    rf.push({ t0: t180 - Trf / 2, t1: t180 + Trf / 2, flip: Math.PI, label: 'π' });
    gz.push([t180 - Trf / 2, t180 + Trf / 2, Gz]);
    gx.push([Trf, Trf + Tro / 2, Gx]);
    gyStart = t180 + Trf / 2;
  } else {
    gx.push([Trf, Trf + Tro / 2, -Gx]);
    gyStart = Trf;
  }
  gx.push([adc[0], adc[1], Gx]);
  const ky = (q) => (N / 2 - q) * dk;                       // the ky of k-space row q
  const Gy = (q) => ky(q) / (GB * Tpe);                     // the lobe that winds it
  const gyLobe = (q) => [[gyStart, gyStart + Tpe, Gy(q)]];
  const tEnd = adc[1] + 0.3;
  const seq = {
    type, TE, TR, N, fov, dk, Gx, Tro, Tpe, Trf, Gz, bw, flip, t90, t180, tEcho, tEnd, TEmin, rf, gz, gx, adc, ky, Gy, gyLobe, gyStart,
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
export function pictureOf(shapes, seq, B0, N, fov, ss = 4) {
  const dx = fov / N, [, , y0, y1] = shapesExtent(shapes);
  let ny = Math.ceil(2 * Math.max(Math.abs(y0), Math.abs(y1), fov / 2) / dx) + 2;
  if (ny % 2) ny++;
  const raster = rasterize(shapes, N, ny, dx, ss);
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
  return { total, fat, weights: w.weights, dx, raster, folded: Math.max(Math.abs(y0), Math.abs(y1)) > fov / 2 + 1e-9 };
}

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

/** Complex Gaussian noise, seeded: each of re and im gets standard deviation sigma, as the two
 *  channels of a receiver do. */
export function noiseField(N, sigma, seed = 7) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N), rand = random(seed);
  if (sigma > 0) for (let i = 0; i < N * N; i++) { const [a, b] = gaussianPair(rand); re[i] = sigma * a; im[i] = sigma * b; }
  return { re, im };
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
   * on or off (3.4 ppm of f0 under the readout gradient), seed.  Keeps the mask if N is the
   * same (a changed object is measured again at once for the rows already done).
   */
  set({ shapes, seq, B0 = 1.5, sigma = 0, nsa = 1, chemicalShift = false, seed = 7 }) {
    const N = seq.N;
    if (N !== this.N) { this.N = N; this.mask = new Uint8Array(N); }
    this.seq = seq; this.B0 = B0; this.sigma = sigma; this.nsa = nsa;
    const pic = pictureOf(shapes, seq, B0, N, seq.fov);
    this.picture = pic;
    // Fat precesses 3.4 ppm slower than water; under the readout gradient that reads as a
    // shift of -3.4e-6 f0 / (GB Gx) mm along x.
    this.fatShift = chemicalShift ? -(3.4e-6 * 42.577e3 * B0) / (GB * seq.Gx) : 0;   // kHz / (kHz/mm)
    const k = kspaceOf(pic.total, pic.fat, N, seq.dk, this.fatShift);
    this.kre = k.re; this.kim = k.im;
    let max = 0;
    for (const v of pic.total) max = Math.max(max, v);
    this.peak = max;
    const noise = noiseField(N, (sigma * max) / Math.sqrt(nsa), seed);
    this.nre = new Float64Array(N * N); this.nim = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) { this.nre[i] = k.re[i] + noise.re[i]; this.nim[i] = k.im[i] + noise.im[i]; }
    this.stale = true;
    return this;
  }

  get measuredCount() { let n = 0; for (const m of this.mask) n += m; return n; }
  measure(q) { if (!this.mask[q]) { this.mask[q] = 1; this.stale = true; } }
  clear() { this.mask.fill(0); this.stale = true; }
  measureAll() { this.mask.fill(1); this.stale = true; }

  /** The picture from the measured rows (cached until something changes). */
  image() {
    if (this.stale || !this._image) { this._image = reconstruct(this.nre, this.nim, this.N, this.mask); this.stale = false; }
    return this._image;
  }

  /** The signal along row q as the ADC records it: |s| against kx (and so against time). */
  rowMagnitude(q) {
    const N = this.N, out = new Float64Array(N);
    for (let p = 0; p < N; p++) out[p] = Math.hypot(this.nre[q * N + p], this.nim[q * N + p]);
    return out;
  }
}

// ------------------------------------------------------------- Lauterbur's way (1973)

/**
 * Projections of a picture (N x N, pixel dx mm) under a gradient G turned to each of the
 * angles (radians): the spectrum of the FID at angle theta is the picture summed along lines
 * perpendicular to the gradient, with frequency f = GB G s, s the distance along the gradient.
 * Returns {profiles: [Float64Array(N)], ds, fOfS}.
 */
export function projections(img, N, dx, angles, G = 1) {
  // (Array.from: a typed array's own map would turn each profile into a number.)
  const profiles = Array.from(angles, (th) => projection(img, N, N, dx, th, N, dx));
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
