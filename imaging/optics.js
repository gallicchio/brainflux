// Imaging with a 4f system: object, lens, Fourier plane (the pupil), lens, image.
//
// Scalar, thin-object, paraxial theory.  The object is a transmission t(x, y) = a e^{i phi}, lit
// by a plane wave.  The first lens puts the object's Fourier transform T(f) in its back focal
// plane, where light that left the object at angle theta arrives at f = sin(theta) / lambda; the
// pupil P(f) multiplies it there; the second lens transforms again and forms the image
//
//     coherent:    E(x) = F^-1[ P(f) T(f - s) ](x),   I = |E|^2
//
// where s = sin(theta_illumination) / lambda tilts the illuminating wave (oblique light shifts
// the whole spectrum).  The image is drawn the right way up (a real 4f system inverts it).
//
//     partially coherent (Abbe's method): the condenser lights the object from many directions
//     s at once, mutually incoherent, so their intensities add:  I = mean over s of |E_s|^2.
//
//     incoherent (self-luminous, or a condenser much wider than the objective): intensities
//     convolve with the intensity PSF |h|^2, h = F^-1[P]; in Fourier space
//     I~(f) = OTF(f) (|t|^2)~(f), OTF = autocorrelation of P, normalised to OTF(0) = 1.
//
// The grid: n x n pixels of dx micrometres, periodic.  Arrays are row-major, pixel (i, j) is the
// point x = (i - n/2) dx, y = (n/2 - j) dx (y up), and the centred unitary FFT of lib/fft.js
// puts frequency f = 0 at the same pixel, with fx = (i - n/2) df, fy = (n/2 - j) df,
// df = 1 / (n dx).  In the pupil, lengths are in frequency pixels; numerical apertures convert
// with pxPerNA() (NA = lambda f).

import { fft2Centered } from '../lib/fft.js';

/** Frequency pixels per unit of numerical aperture: f = NA / lambda, in steps of 1 / (n dx). */
export const pxPerNA = (n, dx, lambda) => (n * dx) / lambda;

/** The centred unitary Fourier transform of (re, im), as a new pair. */
export function spectrum(re, im, n) {
  const R = Float64Array.from(re), I = im ? Float64Array.from(im) : new Float64Array(n * n);
  fft2Centered(R, I, n, n, false);
  return { re: R, im: I };
}

/**
 * The pupil, as a complex array.  opts (lengths in frequency pixels):
 *   cut      aperture radius: the objective's NA / lambda (Infinity: no aperture)
 *   stop     radius of a central stop (null: none; 0 blocks the zero order alone)
 *   dot      { r, phase, amp }: a phase dot over the zero order (Zernike), radius r (0: the
 *            zero order alone), phase shift, amplitude transmission
 *   ring     { r0, r1, phase, amp }: the same on an annulus r0 <= |f| <= r1 (phase ring)
 *   knife    { e, angle }: keep only fx cos(angle) + fy sin(angle) >= e (Foucault's knife edge)
 *   defocus  kappa: multiply by exp(-i kappa |f|^2) (kappa = pi lambda z df^2: paraxial defocus z)
 *   paint    { re, im, mask }: painted pixels (mask = 1) replace everything but the defocus
 */
export function pupil(n, opts = {}) {
  const { cut = Infinity, stop = null, dot = null, ring = null, knife = null, defocus = 0, paint = null } = opts;
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  const c = n / 2, eps = 1e-9;
  const cut2 = cut * cut + eps;
  const stop2 = stop === null ? -1 : stop * stop + eps;
  const dot2 = dot ? dot.r * dot.r + eps : -1;
  const ka = knife ? Math.cos(knife.angle) : 0, kb = knife ? Math.sin(knife.angle) : 0;
  for (let j = 0; j < n; j++) {
    const v = c - j;
    for (let i = 0; i < n; i++) {
      const u = i - c, r2 = u * u + v * v, o = j * n + i;
      let a = r2 <= cut2 ? 1 : 0, ph = 0;
      if (r2 <= stop2) a = 0;
      if (r2 <= dot2) { a *= dot.amp; ph += dot.phase; }
      if (ring && r2 >= ring.r0 * ring.r0 - eps && r2 <= ring.r1 * ring.r1 + eps) { a *= ring.amp; ph += ring.phase; }
      if (knife && u * ka + v * kb < knife.e - eps) a = 0;
      let pr = a * Math.cos(ph), pi = a * Math.sin(ph);
      if (paint && paint.mask[o]) { pr = paint.re[o]; pi = paint.im[o]; }
      if (defocus) {
        const d = -defocus * r2, cd = Math.cos(d), sd = Math.sin(d);
        const t = pr * cd - pi * sd; pi = pr * sd + pi * cd; pr = t;
      }
      re[o] = pr; im[o] = pi;
    }
  }
  return { re, im };
}

/**
 * The spectrum seen with the illumination tilted by (sx, sy) frequency pixels (integers):
 * T_s(f) = T(f - s), wrapping around.  The zero order moves from the centre to s.
 */
export function shifted(T, n, sx, sy, out = null) {
  out = out || { re: new Float64Array(n * n), im: new Float64Array(n * n) };
  sx = Math.round(sx); sy = Math.round(sy);
  if (!sx && !sy) { out.re.set(T.re); out.im.set(T.im); return out; }
  for (let j = 0; j < n; j++) {
    const from = ((((j + sy) % n) + n) % n) * n, to = j * n;
    for (let i = 0; i < n; i++) {
      const k = from + ((((i - sx) % n) + n) % n);
      out.re[to + i] = T.re[k]; out.im[to + i] = T.im[k];
    }
  }
  return out;
}

/**
 * The coherent image field E = F^-1[P T_s] for illumination tilted by (sx, sy).
 * Returns { re, im } (pass `out` to reuse arrays).
 */
export function coherentField(T, P, n, sx = 0, sy = 0, out = null) {
  const E = shifted(T, n, sx, sy, out);
  for (let o = 0; o < n * n; o++) {
    const a = E.re[o], b = E.im[o];
    E.re[o] = a * P.re[o] - b * P.im[o];
    E.im[o] = a * P.im[o] + b * P.re[o];
  }
  fft2Centered(E.re, E.im, n, n, true);
  return E;
}

/** |E|^2. */
export function intensity(E, out = null) {
  const m = E.re.length;
  out = out || new Float64Array(m);
  for (let o = 0; o < m; o++) out[o] = E.re[o] * E.re[o] + E.im[o] * E.im[o];
  return out;
}

/** The coherent image intensity. */
export function coherentImage(T, P, n, sx = 0, sy = 0) {
  return intensity(coherentField(T, P, n, sx, sy));
}

/**
 * The optical transfer function for incoherent light: the Fourier transform of the intensity
 * PSF |h|^2 (h = F^-1[P]), which is the autocorrelation sum_g P(g) P*(g - f), normalised so
 * that OTF(0) = 1.  Returns { re, im } (Hermitian: OTF(-f) = OTF(f)*).
 */
export function otf(P, n) {
  const h = { re: Float64Array.from(P.re), im: Float64Array.from(P.im) };
  fft2Centered(h.re, h.im, n, n, true);
  for (let o = 0; o < n * n; o++) { h.re[o] = h.re[o] * h.re[o] + h.im[o] * h.im[o]; h.im[o] = 0; }
  fft2Centered(h.re, h.im, n, n, false);
  const c = (n / 2) * n + n / 2, norm = h.re[c];
  if (!(norm > 0)) { h.re.fill(0); h.im.fill(0); return h; }
  for (let o = 0; o < n * n; o++) { h.re[o] /= norm; h.im[o] /= norm; }
  return h;
}

/** The spectrum of |t|^2, which incoherent imaging filters. */
export function intensitySpectrum(t, n) {
  const re = new Float64Array(n * n);
  for (let o = 0; o < n * n; o++) re[o] = t.re[o] * t.re[o] + t.im[o] * t.im[o];
  return spectrum(re, null, n);
}

/** The incoherent image: F^-1[OTF S], S the spectrum of |t|^2.  Real (the imaginary part is round-off). */
export function incoherentImage(S, O, n) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let o = 0; o < n * n; o++) {
    re[o] = S.re[o] * O.re[o] - S.im[o] * O.im[o];
    im[o] = S.re[o] * O.im[o] + S.im[o] * O.re[o];
  }
  fft2Centered(re, im, n, n, true);
  return re;
}

/**
 * Illumination directions (integer frequency pixels) filling a disk of radius `radius` (or an
 * annulus inner..radius) about (cx, cy): the condenser's aperture, as seen in the Fourier plane.
 * When the disk holds more than maxPoints pixels it is sampled on a coarser square lattice
 * (every q-th pixel), so the sum over directions stays affordable.  The centre comes first and
 * the rest in a scrambled order, so that a partial sum is already a fair picture.
 */
export function sourcePoints(radius, cx = 0, cy = 0, maxPoints = 40, inner = 0) {
  const pts = (q) => {
    const out = [], m = Math.floor(radius / q + 1e-9);
    for (let b = -m; b <= m; b++) for (let a = -m; a <= m; a++) {
      const r2 = (a * q) ** 2 + (b * q) ** 2;
      if (r2 <= radius * radius + 1e-9 && r2 >= inner * inner - 1e-9) out.push([cx + a * q, cy + b * q]);
    }
    return out;
  };
  if (radius < 1) return [[cx, cy]];
  let q = 1, list = pts(1);
  while (list.length > maxPoints) list = pts(++q);
  if (!list.length) return [[cx + Math.round(radius), cy]];
  // Centre first (if it is in the list), then a fixed pseudo-random order.
  const centre = list.findIndex(([x, y]) => x === cx && y === cy);
  const first = centre >= 0 ? list.splice(centre, 1) : [];
  let seed = 12345;
  for (let k = list.length - 1; k > 0; k--) {
    seed = (seed * 16807) % 2147483647;
    const r = seed % (k + 1);
    [list[k], list[r]] = [list[r], list[k]];
  }
  return [...first, ...list];
}

/**
 * Partially coherent imaging, a few illumination directions at a time so that the page stays
 * responsive: start(), then step() until done; `image` is the mean of |E_s|^2 so far.
 */
export class PartialImage {
  constructor(n) {
    this.n = n;
    this.sum = new Float64Array(n * n);
    this.image = new Float64Array(n * n);
    this.buf = { re: new Float64Array(n * n), im: new Float64Array(n * n) };
    this.points = []; this.count = 0;
  }
  start(T, P, points) {
    this.T = T; this.P = P; this.points = points; this.count = 0;
    this.sum.fill(0);
  }
  get done() { return this.count >= this.points.length; }
  /** Add up to k more directions; returns true when all are in. */
  step(k = 1) {
    const { n, sum, buf } = this;
    for (let a = 0; a < k && !this.done; a++) {
      const [sx, sy] = this.points[this.count++];
      coherentField(this.T, this.P, n, sx, sy, buf);
      for (let o = 0; o < n * n; o++) sum[o] += buf.re[o] * buf.re[o] + buf.im[o] * buf.im[o];
    }
    const w = 1 / Math.max(1, this.count);
    for (let o = 0; o < n * n; o++) this.image[o] = sum[o] * w;
    return this.done;
  }
  /** All at once. */
  run() { while (!this.step(64)); return this.image; }
}

/** Minimum, maximum, mean and the contrast (max - min) / (max + min) of an image (or part). */
export function stats(I, from = 0, to = I.length) {
  let lo = Infinity, hi = -Infinity, s = 0;
  for (let o = from; o < to; o++) { const v = I[o]; if (v < lo) lo = v; if (v > hi) hi = v; s += v; }
  return { min: lo, max: hi, mean: s / (to - from), contrast: hi + lo > 0 ? (hi - lo) / (hi + lo) : 0 };
}

/** The fraction of the light leaving the object that gets through the pupil: sum |P T_s|^2 / sum |T|^2. */
export function throughput(T, P, n, sx = 0, sy = 0) {
  const Ts = shifted(T, n, sx, sy);
  let a = 0, b = 0;
  for (let o = 0; o < n * n; o++) {
    const t2 = Ts.re[o] * Ts.re[o] + Ts.im[o] * Ts.im[o];
    a += t2 * (P.re[o] * P.re[o] + P.im[o] * P.im[o]); b += t2;
  }
  return b > 0 ? a / b : 0;
}
