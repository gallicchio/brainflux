// Parallel-beam computed tomography: projections (the Radon transform), back-projection, the
// ramp filter, photon counting, and the Fourier-space view.  No DOM: the tests import this.
//
// Coordinates.  The object f(x, y) lives on an N x N grid of square pixels of side h = 2/N:
// pixel (i, j), column i and row j, is centred on x = (i - N/2) h, y = (N/2 - j) h, so y points
// up and the centre of rotation is pixel (N/2, N/2), the origin of the centred FFT.  The scan
// circle (the field of view) has radius 1; objects are kept inside it.
//
// A projection at angle theta collects line integrals along the rays perpendicular to
// n = (cos theta, sin theta):
//
//     p(theta, s) = integral of f over the line  x cos theta + y sin theta = s.
//
// At theta = 0 the rays run along y and s = x.  The detector has M bins spanning the scan
// circle, ds = 2/M; bin k is centred on s_k = (k - M/2) ds, and averages p over a width
// aperture * ds about its centre (aperture 1: bins side by side; small: point samples).

import { fftCentered, fft2Centered, fft, ifft } from '../lib/fft.js';

export const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------- analytic objects
//
// Ellipses {type: 'ellipse', x, y, a, b, phi, rho}: centre (x, y), semi-axis a along the
// direction phi (radians from the x axis), semi-axis b across it, density rho added inside.
// Gaussian blobs {type: 'gauss', x, y, sigma, rho}: rho exp(-r^2 / 2 sigma^2) (a "point").
// Both have exact Radon transforms, so their sinograms are exact.

// The Shepp-Logan head phantom (L. A. Shepp and B. F. Logan, IEEE Trans. Nucl. Sci. 21, 21
// (1974); the table in Kak and Slaney, "Principles of Computerized Tomographic Imaging", 1988).
// Columns: x, y, a, b, phi (degrees; the a axis), and the density added in the 1974 paper and
// in the "modified" (high-contrast) version of Toft (1996), which most software shows.
const SL = [
  //  x       y        a       b      phi   1974    modified
  [0, 0, 0.69, 0.92, 0, 2.0, 1.0],          // the skull
  [0, -0.0184, 0.6624, 0.874, 0, -0.98, -0.8], // the brain
  [0.22, 0, 0.11, 0.31, -18, -0.02, -0.2],   // the right ventricle
  [-0.22, 0, 0.16, 0.41, 18, -0.02, -0.2],   // the left ventricle
  [0, 0.35, 0.21, 0.25, 0, 0.01, 0.1],
  [0, 0.1, 0.046, 0.046, 0, 0.01, 0.1],
  [0, -0.1, 0.046, 0.046, 0, 0.01, 0.1],
  [-0.08, -0.605, 0.046, 0.023, 0, 0.01, 0.1],
  [0, -0.605, 0.023, 0.023, 0, 0.01, 0.1],
  [0.06, -0.605, 0.023, 0.046, 0, 0.01, 0.1],
];

/** The Shepp-Logan phantom as ellipses: 'original' (1974, skull 2, brain 1.02) or 'modified'. */
export function sheppLogan(variant = 'modified') {
  const col = variant === 'original' ? 5 : 6;
  return SL.map((r) => ({ type: 'ellipse', x: r[0], y: r[1], a: r[2], b: r[3], phi: (r[4] * Math.PI) / 180, rho: r[col] }));
}

/** A uniform disk. */
export const disk = (x, y, R, rho = 1) => ({ type: 'ellipse', x, y, a: R, b: R, phi: 0, rho });

/** A Gaussian blob of width sigma with total mass `mass` (2 pi sigma^2 rho). */
export const blob = (x, y, sigma, mass = 1) => ({ type: 'gauss', x, y, sigma, rho: mass / (TWO_PI * sigma * sigma) });

/** The total mass (integral of f) of a list of shapes. */
export function shapesMass(shapes) {
  let m = 0;
  for (const sh of shapes) m += sh.type === 'ellipse' ? Math.PI * sh.a * sh.b * sh.rho : TWO_PI * sh.sigma * sh.sigma * sh.rho;
  return m;
}

/** f(x, y) of a list of shapes at one point. */
export function shapesAt(shapes, x, y) {
  let v = 0;
  for (const sh of shapes) {
    const dx = x - sh.x, dy = y - sh.y;
    if (sh.type === 'ellipse') {
      const c = Math.cos(sh.phi), s = Math.sin(sh.phi);
      const u = (dx * c + dy * s) / sh.a, w = (-dx * s + dy * c) / sh.b;
      if (u * u + w * w <= 1) v += sh.rho;
    } else v += sh.rho * Math.exp(-(dx * dx + dy * dy) / (2 * sh.sigma * sh.sigma));
  }
  return v;
}

// erf by its everywhere-convergent series of positive terms,
//   erf(x) = (2/sqrt pi) exp(-x^2) sum_n 2^n x^(2n+1) / (1.3.5...(2n+1)),
// which has no cancellation; beyond |x| = 6, erf = +-1 to double precision.
export function erf(x) {
  const ax = Math.abs(x);
  if (ax >= 6) return Math.sign(x);
  let term = ax, sum = ax;
  const x2 = ax * ax;
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  const r = (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum;
  return x < 0 ? -r : r;
}

/**
 * The exact projection of analytic shapes at angle theta, averaged over each detector bin's
 * aperture, added into out (length M).
 *
 * An ellipse projects to (2 rho a b / q^2) sqrt(q^2 - s'^2), with q^2 = a^2 cos^2(theta - phi)
 * + b^2 sin^2(theta - phi) and s' measured from the projected centre: for a disk, the chord
 * length 2 sqrt(R^2 - s^2) times rho.  Its integral over a bin is the area of a segment.
 * A Gaussian projects to rho sqrt(2 pi) sigma exp(-s'^2 / 2 sigma^2), integrated with erf.
 */
export function projectShapes(shapes, theta, M, ds, aperture, out) {
  const ct = Math.cos(theta), st = Math.sin(theta), w = aperture * ds, half = w / 2;
  for (const sh of shapes) {
    const s0 = sh.x * ct + sh.y * st;
    if (sh.type === 'ellipse') {
      const c = Math.cos(theta - sh.phi), s = Math.sin(theta - sh.phi);
      const q2 = sh.a * sh.a * c * c + sh.b * sh.b * s * s, q = Math.sqrt(q2);
      const coef = (2 * sh.rho * sh.a * sh.b) / q2 / w;
      // The integral of sqrt(q^2 - u^2) from 0 to u (clamped to the ellipse's shadow).
      const G = (u) => { u = u < -q ? -q : u > q ? q : u; return 0.5 * (u * Math.sqrt(Math.max(0, q2 - u * u)) + q2 * Math.asin(u / q)); };
      const k0 = Math.max(0, Math.floor((s0 - q - half) / ds + M / 2)), k1 = Math.min(M - 1, Math.ceil((s0 + q + half) / ds + M / 2));
      for (let k = k0; k <= k1; k++) {
        const sk = (k - M / 2) * ds - s0;
        out[k] += coef * (G(sk + half) - G(sk - half));
      }
    } else {
      const r2s = Math.SQRT2 * sh.sigma, reach = 8.5 * sh.sigma + half;
      const coef = (sh.rho * Math.PI * sh.sigma * sh.sigma) / w;
      const k0 = Math.max(0, Math.floor((s0 - reach) / ds + M / 2)), k1 = Math.min(M - 1, Math.ceil((s0 + reach) / ds + M / 2));
      for (let k = k0; k <= k1; k++) {
        const sk = (k - M / 2) * ds - s0;
        out[k] += coef * (erf((sk + half) / r2s) - erf((sk - half) / r2s));
      }
    }
  }
  return out;
}

/**
 * The shapes as an N x N picture of pixel averages: ellipses by sub-sampling each pixel ss x ss
 * times (exact where a pixel is wholly inside or outside), Gaussians exactly (with erf).
 */
export function rasterizeShapes(shapes, N, ss = 4, out = new Float64Array(N * N)) {
  out.fill(0);
  const h = 2 / N;
  for (const sh of shapes) {
    if (sh.type === 'ellipse') {
      const c = Math.cos(sh.phi), s = Math.sin(sh.phi);
      // The bounding box, in pixels.
      const ex = Math.sqrt((sh.a * c) ** 2 + (sh.b * s) ** 2), ey = Math.sqrt((sh.a * s) ** 2 + (sh.b * c) ** 2);
      const i0 = Math.max(0, Math.floor((sh.x - ex) / h + N / 2 - 1)), i1 = Math.min(N - 1, Math.ceil((sh.x + ex) / h + N / 2 + 1));
      const j0 = Math.max(0, Math.floor(N / 2 - (sh.y + ey) / h - 1)), j1 = Math.min(N - 1, Math.ceil(N / 2 - (sh.y - ey) / h + 1));
      const ia2 = 1 / (sh.a * sh.a), ib2 = 1 / (sh.b * sh.b), wgt = sh.rho / (ss * ss);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          let count = 0;
          for (let q = 0; q < ss; q++) {
            const y = (N / 2 - j + 0.5 - (q + 0.5) / ss) * h - sh.y;
            for (let p = 0; p < ss; p++) {
              const x = (i - N / 2 - 0.5 + (p + 0.5) / ss) * h - sh.x;
              const u = x * c + y * s, v = -x * s + y * c;
              if (u * u * ia2 + v * v * ib2 <= 1) count++;
            }
          }
          if (count) out[j * N + i] += count * wgt;
        }
      }
    } else {
      // The pixel average of a Gaussian is a product of two erf differences.
      const r2s = Math.SQRT2 * sh.sigma, reach = 8.5 * sh.sigma + h;
      const i0 = Math.max(0, Math.floor((sh.x - reach) / h + N / 2)), i1 = Math.min(N - 1, Math.ceil((sh.x + reach) / h + N / 2));
      const j0 = Math.max(0, Math.floor(N / 2 - (sh.y + reach) / h)), j1 = Math.min(N - 1, Math.ceil(N / 2 - (sh.y - reach) / h));
      const coef = (sh.rho * Math.PI * sh.sigma * sh.sigma) / (2 * h * h);
      const gx = [];
      for (let i = i0; i <= i1; i++) {
        const x = (i - N / 2) * h - sh.x;
        gx.push(erf((x + h / 2) / r2s) - erf((x - h / 2) / r2s));
      }
      for (let j = j0; j <= j1; j++) {
        const y = (N / 2 - j) * h - sh.y, gy = erf((y + h / 2) / r2s) - erf((y - h / 2) / r2s);
        for (let i = i0; i <= i1; i++) out[j * N + i] += coef * gx[i - i0] * gy;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------- pictures (rasters)

/**
 * A picture prepared for projecting: the N x N values with a border of zeros (so that the
 * interpolation never needs a bounds check), and its transpose (so that rays that run nearer
 * the x axis also read memory in order).
 */
export function prepareRaster(f, N) {
  const P = N + 2, rows = new Float64Array(P * P), cols = new Float64Array(P * P);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = f[j * N + i];
      rows[(j + 1) * P + i + 1] = v;
      cols[(i + 1) * P + j + 1] = v;
    }
  }
  return { N, P, rows, cols };
}

// The whole steps t = t0, t0 + 1, ... for which lo <= u0 + t du < hi, within [0, n - 1].
function stepRange(u0, du, lo, hi, n) {
  let a = 0, b = n - 1;
  if (du > 1e-12) { a = Math.max(a, Math.ceil((lo - u0) / du)); b = Math.min(b, Math.floor((hi - u0) / du - 1e-9)); }
  else if (du < -1e-12) { a = Math.max(a, Math.ceil((hi - u0) / du + 1e-9)); b = Math.min(b, Math.floor((lo - u0) / du)); }
  else if (!(u0 >= lo && u0 < hi)) return [1, 0];
  return [a, b];
}

/**
 * Line integrals of a picture (from prepareRaster) at angle theta, by Joseph's method: a ray
 * that runs nearer the y axis crosses every row once; on each row the picture is interpolated
 * linearly between the two nearest pixel centres, and the sum is multiplied by the length of
 * ray per row, h / |cos theta| (likewise by columns for the other rays).  This is the line
 * integral of the picture interpolated bilinearly along each row, accurate to O(h^2) for
 * smooth pictures.  A bin wider than a pixel is averaged over round(aperture ds / h) rays
 * spread across its aperture.  Writes out[0..M-1].
 */
export function projectRaster(raster, theta, M, ds, aperture, out) {
  const { N, P, rows, cols } = raster, h = 2 / N;
  const c = Math.cos(theta), sn = Math.sin(theta);
  const w = aperture * ds, K = Math.max(1, Math.round(w / h));
  const alongRows = Math.abs(c) >= Math.abs(sn);
  const step = alongRows ? sn / c : c / sn, len = h / Math.abs(alongRows ? c : sn);
  const img = alongRows ? rows : cols;
  for (let k = 0; k < M; k++) {
    let total = 0;
    for (let q = 0; q < K; q++) {
      const s = (k - M / 2) * ds + ((q + 0.5) / K - 0.5) * w;
      if (Math.abs(s) >= 1) continue;
      // Along rows: on row j the ray is at column u_j = u0 + j sn/c (from x cos + y sin = s).
      // Along columns: on column i it is at row v_i = v0 + i c/sn.
      const u0 = alongRows ? s / (c * h) - (N / 2) * step + N / 2 : N / 2 - s / (sn * h) - (N / 2) * step;
      const [a, b] = stepRange(u0, step, -0.5, N - 0.5, N);
      let acc = 0;
      for (let t = a; t <= b; t++) {
        const u = u0 + t * step, i0 = Math.floor(u), f = u - i0, o = (t + 1) * P + i0 + 1, v0 = img[o];
        acc += v0 + f * (img[o + 1] - v0);
      }
      total += acc;
    }
    out[k] = (total * len) / K;
  }
  return out;
}

// --------------------------------------------------------------------- back-projection

/** For each row of an N x N grid, the first and last pixel inside the scan circle. */
export function circleRows(N, radius = 1) {
  const h = 2 / N, lo = new Int32Array(N), hi = new Int32Array(N);
  for (let j = 0; j < N; j++) {
    const y = (N / 2 - j) * h, r2 = radius * radius - y * y;
    if (r2 <= 0) { lo[j] = 1; hi[j] = 0; continue; }
    const xm = Math.sqrt(r2);
    lo[j] = Math.max(0, Math.ceil(N / 2 - xm / h));
    hi[j] = Math.min(N - 1, Math.floor(N / 2 + xm / h));
  }
  return { lo, hi };
}

/**
 * Smear projections back across the picture: for every pixel inside the scan circle,
 * acc += weight * p(theta, x cos theta + y sin theta), with p interpolated linearly between
 * bins.  Two projections (say, raw and filtered) share one pass: accB may be null.
 * The projections must be padded: value k of the detector at index k + 1, zeros at 0 and
 * at M + 1, M + 2 (see padRow).
 */
export function backproject(N, rowsIn, theta, M, ds, accA, pA, wA, accB = null, pB = null, wB = 0) {
  const h = 2 / N, c = Math.cos(theta), sn = Math.sin(theta);
  const db = (c * h) / ds;
  const { lo, hi } = rowsIn;
  for (let j = 0; j < N; j++) {
    const i0 = lo[j], i1 = hi[j];
    if (i1 < i0) continue;
    const y = (N / 2 - j) * h, x0 = (i0 - N / 2) * h;
    let b = (x0 * c + y * sn) / ds + M / 2 + 1;
    let o = j * N + i0;
    if (accB) {
      for (let i = i0; i <= i1; i++, o++, b += db) {
        const k = Math.floor(b), f = b - k, a0 = pA[k], b0 = pB[k];
        accA[o] += wA * (a0 + f * (pA[k + 1] - a0));
        accB[o] += wB * (b0 + f * (pB[k + 1] - b0));
      }
    } else {
      for (let i = i0; i <= i1; i++, o++, b += db) {
        const k = Math.floor(b), f = b - k, a0 = pA[k];
        accA[o] += wA * (a0 + f * (pA[k + 1] - a0));
      }
    }
  }
}

/** A detector row padded for backproject(): one zero before, two after. */
export function padRow(row, M, out = new Float64Array(M + 3)) {
  out[0] = 0; out[M + 1] = 0; out[M + 2] = 0;
  for (let k = 0; k < M; k++) out[k + 1] = row[k];
  return out;
}

// ---------------------------------------------------------------------------- filters
//
// Filtered back-projection:  f(x, y) = sum over angles of Q(theta, x cos theta + y sin theta)
// times the angle step, where Q = p convolved with the ramp filter, whose transform is |nu|
// (nu in cycles per unit length; |k| / 2 pi with k = 2 pi nu).  The ramp is built from its
// band-limited kernel in real space (Kak and Slaney, eq. 3.61),
//     h(0) = 1 / 4 ds^2,   h(n ds) = 0 for even n,   -1 / (pi n ds)^2 for odd n,
// which, unlike sampling |nu| directly, gets the average (the k = 0 value) right.  The
// windows multiply it in frequency, nu' = nu / (cutoff * nu_Nyquist), zero for |nu'| > 1:

export const FILTERS = {
  ramlak: { label: 'Ram-Lak', title: 'The pure ramp |k|, cut off at the cutoff frequency (Ramachandran and Lakshminarayanan)', w: () => 1 },
  shepplogan: { label: 'Shepp-Logan', title: 'The ramp times sinc: a little smoother', w: (v) => (v === 0 ? 1 : Math.sin((Math.PI * v) / 2) / ((Math.PI * v) / 2)) },
  cosine: { label: 'Cosine', title: 'The ramp times cos(pi k / 2 k_c)', w: (v) => Math.cos((Math.PI * v) / 2) },
  hann: { label: 'Hann', title: 'The ramp times the Hann window (1 + cos(pi k / k_c)) / 2: much less noise, a little blur', w: (v) => 0.5 * (1 + Math.cos(Math.PI * v)) },
};

/** Smallest power of two >= 2M: room to convolve without wrapping round. */
export const padLength = (M) => 2 ** Math.ceil(Math.log2(2 * M));

/**
 * The filter's frequency response in FFT order (index m is frequency m / (L ds) cycles per
 * unit length for m < L/2, (m - L) / (L ds) above), real and even, including the factor ds of
 * the discrete convolution.  cutoff: a fraction of the Nyquist frequency 1 / 2 ds.
 */
export function filterResponse(name, M, ds, cutoff = 1) {
  const L = padLength(M), re = new Float64Array(L), im = new Float64Array(L);
  re[0] = 1 / (4 * ds * ds);
  for (let n = 1; n < L / 2; n += 2) re[n] = re[L - n] = -1 / (Math.PI * Math.PI * n * n * ds * ds);
  fft(re, im);
  const w = (FILTERS[name] || FILTERS.ramlak).w;
  const H = new Float64Array(L);
  for (let m = 0; m < L; m++) {
    const v = Math.abs(m < L / 2 ? m : m - L) / (L / 2) / cutoff; // fraction of the cutoff
    H[m] = v > 1 ? 0 : ds * re[m] * w(v);
  }
  return H;
}

/** Q = the filtered projection: out[0..M-1].  work: { re, im } of the padded length. */
export function filterRow(row, M, H, out, work) {
  const L = H.length, { re, im } = work;
  re.fill(0); im.fill(0);
  for (let k = 0; k < M; k++) re[k] = row[k];
  fft(re, im);
  for (let m = 0; m < L; m++) { re[m] *= H[m]; im[m] *= H[m]; }
  ifft(re, im);
  for (let k = 0; k < M; k++) out[k] = re[k];
  return out;
}

export const filterWork = (M) => ({ re: new Float64Array(padLength(M)), im: new Float64Array(padLength(M)) });

// --------------------------------------------------------------------- photon counting
//
// A ray that crosses attenuation mu(x, y) keeps the fraction exp(-integral of mu dl) of its
// photons.  The object's values are attenuation coefficients in units of water's, and the scan
// circle is 20 cm across with water's mu = 0.2 / cm (about 70 keV), so a value-1 path of one
// unit (10 cm) attenuates by exp(-2): MU = 2.  The detector counts n photons out of I0 sent,
// Poisson distributed, and the scanner reports p = -ln(n / I0) / MU.
//
// The polychromatic beam (beam hardening): half the photons at an energy where every material
// absorbs 4/3 as strongly, half where it absorbs 2/3 as strongly.  Then -ln(n / I0) / MU
// falls below p for long paths (the soft photons are used up first); no correction is made.
// (Real materials differ in how their absorption changes with energy; this keeps one ratio.)

export const MU = 2;
const HARD = [[0.5, 4 / 3], [0.5, 2 / 3]];

/** A small fast seeded random number generator (mulberry32): uniform in [0, 1). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// log(k!) by a table, then Stirling's series (error below 1e-13 from k = 10).
const LOG_FACT = [0, 0, 0.6931471805599453, 1.791759469228055, 3.1780538303479458, 4.787491742782046,
  6.579251212010101, 8.525161361065415, 10.60460290274525, 12.801827480081469];
function logFactorial(k) {
  if (k < 10) return LOG_FACT[k];
  const k2 = k * k;
  return (k + 0.5) * Math.log(k) - k + 0.9189385332046728 + (1 / 12 - (1 / 360 - 1 / (1260 * k2)) / k2) / k;
}

/**
 * A Poisson-distributed count with mean lambda, exactly: by multiplying uniforms (Knuth) below
 * 10, and by Hörmann's transformed rejection with squeeze (PTRS, 1993) above.
 */
export function poisson(lambda, rand) {
  if (lambda < 10) {
    const L = Math.exp(-lambda);
    let k = 0, p = rand();
    while (p > L) { k++; p *= rand(); }
    return k;
  }
  const slam = Math.sqrt(lambda), loglam = Math.log(lambda);
  const b = 0.931 + 2.53 * slam, a = -0.059 + 0.02483 * b;
  const invalpha = 1.1239 + 1.1328 / (b - 3.4), vr = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const U = rand() - 0.5, V = rand(), us = 0.5 - Math.abs(U);
    const k = Math.floor(((2 * a) / us + b) * U + lambda + 0.43);
    if (us >= 0.07 && V <= vr) return k;
    if (k < 0 || (us < 0.013 && V > us)) continue;
    if (Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <= -lambda + k * loglam - logFactorial(k)) return k;
  }
}

/** The expected transmitted fraction for a line integral p. */
export function transmission(p, poly) {
  if (!poly) return Math.exp(-MU * p);
  let t = 0;
  for (const [w, g] of HARD) t += w * Math.exp(-g * MU * p);
  return t;
}

/**
 * What the scanner reports for the exact line integrals p (row of M): with noise, Poisson
 * counts of I0 photons per bin (a count of 0 is read as half a photon: a photon-starved ray);
 * with the polychromatic beam, the beam-hardened value.  opts: { noise, I0, poly, seed }.
 */
export function measureRow(p, M, out, opts) {
  const { noise, I0, poly } = opts;
  if (!noise && !poly) { for (let k = 0; k < M; k++) out[k] = p[k]; return out; }
  const rand = noise ? random(opts.seed) : null;
  for (let k = 0; k < M; k++) {
    const T = transmission(p[k], poly);
    let n = I0 * T;
    if (noise) n = Math.max(0.5, poisson(n, rand));
    out[k] = -Math.log(n / I0) / MU;
  }
  return out;
}

// ------------------------------------------------------------------- Fourier space
//
// The projection-slice theorem: the 1D Fourier transform of the projection at angle theta,
//     P(theta, k) = integral of p(theta, s) e^{-iks} ds,
// is the 2D transform of the object, F(kx, ky) = integral of f e^{-i(kx x + ky y)} dx dy, on
// the line through k = 0 in the direction n:  P(theta, k) = F(k cos theta, k sin theta).

/**
 * P(theta, k) of one projection, by an FFT of the projection padded to L = padLength(M) with
 * s = 0 at index L/2: out.re/out.im[m] at k = (m - L/2) 2 pi / (L ds).
 */
export function projectionSpectrum(row, M, ds, outRe, outIm) {
  const L = outRe.length;
  outRe.fill(0); outIm.fill(0);
  for (let k = 0; k < M; k++) outRe[k - M / 2 + L / 2] = row[k];
  fftCentered(outRe, outIm);
  const sc = ds * Math.sqrt(L);
  for (let m = 0; m < L; m++) { outRe[m] *= sc; outIm[m] *= sc; }
}

/**
 * Direct Fourier reconstruction: the polar samples P(theta_j, k_m) are interpolated
 * bilinearly (in angle and in k) onto a square K x K grid of (kx, ky) with spacing
 * dk = 2 pi / (K h), and one inverse 2D FFT gives the picture, with pixels of side h; the
 * middle N x N are returned.  Lines not yet measured, and the wedge of angles outside a
 * limited range, count as zero.
 *   spec: { re, im }, nA rows of L (row j = angle j = j range / nA); measured: Uint8Array or null.
 */
export function directFourier(spec, nA, L, ds, range, measured, N, K = 2 * N) {
  const h = 2 / N, dk = TWO_PI / (K * h), dkS = TWO_PI / (L * ds), dth = range / nA;
  const full = Math.abs(range - Math.PI) < 1e-9;
  const re = new Float64Array(K * K), im = new Float64Array(K * K);
  const { re: sr, im: si } = spec;
  let ar = 0, ai = 0;
  // Add wgt times line j at signed k (index m = k / dkS + L/2, interpolated linearly).  Line
  // nA is line 0 seen from the other side: P(theta + pi, k) = P(theta, -k).
  const sample = (j, k, wgt) => {
    if (j >= nA) { j -= nA; k = -k; }
    if (measured && !measured[j]) return;
    const mf = k / dkS + L / 2, m = Math.floor(mf), t = mf - m;
    if (m < 0 || m + 1 >= L) return;
    const o = j * L + m;
    ar += wgt * (sr[o] + t * (sr[o + 1] - sr[o]));
    ai += wgt * (si[o] + t * (si[o + 1] - si[o]));
  };
  for (let v = 0; v < K; v++) {
    const ky = (K / 2 - v) * dk;
    for (let u = 0; u < K; u++) {
      const kx = (u - K / 2) * dk;
      // The line through this point: theta in [0, pi), and k signed along n.
      let phi = Math.atan2(ky, kx), k = Math.hypot(kx, ky);
      if (phi < 0) { phi += Math.PI; k = -k; }
      if (phi >= Math.PI) { phi -= Math.PI; k = -k; }
      const jf = phi / dth;
      if (!full && jf > nA - 1) continue; // the missing wedge
      const j = Math.min(Math.floor(jf), nA - (full ? 0 : 1)), t = jf - j;
      ar = 0; ai = 0;
      sample(j, k, 1 - t);
      if (t > 0) sample(j + 1, k, t);
      re[v * K + u] = ar; im[v * K + u] = ai;
    }
  }
  // f(r) = (1 / 4 pi^2) sum G e^{ik.r} dk^2 = (1 / h^2 K) times the unitary inverse transform.
  fft2Centered(re, im, K, K, true);
  const out = new Float64Array(N * N), off = (K - N) / 2, sc = 1 / (h * h * K);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out[j * N + i] = re[(j + off) * K + i + off] * sc;
  return out;
}

/**
 * The object's 2D transform F(kx, ky) on a K x K grid of spacing 2 pi / (K h) (the picture
 * padded with zeros to K x K), scaled to approximate the continuous transform: row v is
 * ky = (K/2 - v) dk, column u is kx = (u - K/2) dk, as drawn (ky up).
 */
export function objectSpectrum(f, N, K = 2 * N) {
  const re = new Float64Array(K * K), im = new Float64Array(K * K), off = (K - N) / 2, h = 2 / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) re[(j + off) * K + i + off] = f[j * N + i];
  fft2Centered(re, im, K, K);
  const sc = h * h * K; // unitary -> sum, times h^2
  for (let i = 0; i < K * K; i++) { re[i] *= sc; im[i] *= sc; }
  return { re, im, K, dk: TWO_PI / (K * h) };
}
