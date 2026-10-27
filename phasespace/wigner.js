// The Wigner function of a wave function sampled on a grid, and the Husimi Q function, with
// FFTs, one per column of phase space.  Units: hbar = 1.
//
//     W(x, p) = (1/pi hbar) integral psi*(x + y) psi(x - y) exp(2 i p y / hbar) dy
//
// Discretised with y = k h (k integer) and x on the wave function's own grid (spacing dx, with
// h = s dx), the points x +- y are grid points and
//
//     W(x, p) = (h / pi) sum_k psi*(x - k h) psi(x + k h) exp(-2 i p k h)
//
// is a Fourier series in p: an FFT of length K gives it at p_m = m pi / (K h), m = -K/2 .. K/2 - 1.
// The 2 in exp(2ipy) is why the momenta reach only +-pi / 2h, half the Nyquist momentum pi/h
// of a grid of spacing h: the product psi*(x - y) psi(x + y) oscillates in y twice as fast as
// psi does.  So the wave function is first band-limited to |p| < pi / 2h (bandLimit below);
// then the sum is exact for it (the sampling theorem), and nothing aliases.  Zero padding (K
// larger than the number of terms) only interpolates finer in p: the sum over k is finite,
// since psi vanishes outside its domain (x +- y outside it contribute nothing), so W at any p
// is still exact.
//
// The sequence A_k = psi*(x - kh) psi(x + kh) is Hermitian (A_-k = conj A_k), so its transform
// is real: two columns are done in one complex FFT, as A + i B.
//
// Exact discrete identities (tested): sum_m W dp = |psi(x)|^2 at every column; sum over all
// columns of W dx = |phi(p)|^2 for the band-limited psi (when every grid point is a column).

import { fft, ifft } from '../lib/fft.js';

/**
 * psi with its Fourier components above |p| = pmax removed (hbar = 1): exactly band-limited.
 * re, im have a power-of-two length n and spacing dx; the results go to outRe, outIm.
 */
export function bandLimit(re, im, dx, pmax, outRe = new Float64Array(re.length), outIm = new Float64Array(re.length)) {
  const n = re.length;
  outRe.set(re); outIm.set(im);
  fft(outRe, outIm);
  const dk = (2 * Math.PI) / (n * dx);
  for (let i = 0; i < n; i++) {
    const k = (i < n / 2 ? i : i - n) * dk;
    if (Math.abs(k) > pmax) { outRe[i] = 0; outIm[i] = 0; }
  }
  ifft(outRe, outIm);
  return { re: outRe, im: outIm };
}

/**
 * A rectangle of phase space, x in [x0, x1] and p in [p0, p1], sampled for W and Q.
 *   grid:   { n, dx, xmin } of the wave function's samples x_j = xmin + j dx
 *   window: { x0, x1, p0, p1 }
 *   opts:   cols, rows (roughly how many to compute in the window), margin (the band limit
 *           is this many times the largest |p| in the window, so that a state reaching a
 *           little beyond the window is not cut), q (force a column spacing, in grid
 *           points), align (an x that falls on a column if it is in the window: the origin)
 * Values are stored column by column, W[c * rows + r] at (x[c], p[r]), p increasing with r.
 */
export class PhaseGrid {
  constructor({ n, dx, xmin }, { x0, x1, p0, p1 }, { cols = 360, rows = 360, margin = 2, q = 0, align = 0 } = {}) {
    this.n = n; this.dx = dx; this.xmin = xmin;
    this.x0 = x0; this.x1 = x1; this.p0 = p0; this.p1 = p1;
    // Columns: grid points in [x0, x1], every q-th one.  They may run past the domain (W = 0).
    let fa = Math.ceil((x0 - xmin) / dx - 1e-9);
    const fb = Math.floor((x1 - xmin) / dx + 1e-9);
    this.q = q || Math.max(1, Math.ceil(Math.max(1, fb - fa) / Math.max(2, cols - 1)));
    const ja = Math.round((align - xmin) / dx);
    if (ja >= fa && ja <= fb) fa += (((ja - fa) % this.q) + this.q) % this.q;
    const span = Math.max(0, fb - fa);
    this.cols = Math.floor(span / this.q) + 1;
    this.j0 = fa;
    this.x = new Float64Array(this.cols);
    for (let c = 0; c < this.cols; c++) this.x[c] = xmin + (fa + c * this.q) * dx;
    this.cellX = this.q * dx;
    // The y step h = s dx: the largest that keeps every momentum in the window (with a margin)
    // below the band limit pi / 2h.
    const pm = Math.max(Math.abs(p0), Math.abs(p1), 1e-9);
    this.s = Math.max(1, Math.floor(Math.PI / (2 * margin * pm * dx)));
    this.h = this.s * dx;
    this.pmax = Math.PI / (2 * this.h);           // the band limit
    this.kmax = Math.floor((n - 1) / (2 * this.s)); // |y| <= half the domain
    let K = 8;
    while (K < 2 * this.kmax + 1) K *= 2;
    // At least 0.6 of the rows asked for in the window (K is a power of two).
    const want = (0.6 * rows * 2 * this.pmax) / Math.max(1e-9, p1 - p0);
    while (K < want && K < 16384) K *= 2;
    this.K = K;
    this.dp = Math.PI / (K * this.h);
    const m0 = Math.max(-K / 2, Math.ceil(p0 / this.dp - 1e-9));
    const m1 = Math.min(K / 2 - 1, Math.floor(p1 / this.dp + 1e-9));
    this.m0 = m0;
    this.rows = Math.max(1, m1 - m0 + 1);
    this.p = new Float64Array(this.rows);
    for (let r = 0; r < this.rows; r++) this.p[r] = (m0 + r) * this.dp;
    this.cell = this.cellX * this.dp;               // the area of one sample
    this.W = new Float64Array(this.rows * this.cols);
    this.Q = new Float64Array(this.rows * this.cols);
    this._zr = new Float64Array(K); this._zi = new Float64Array(K);
  }

  /** The band limit to apply to psi before wigner(): |p| < pmax. */
  prepare(re, im, out) {
    return bandLimit(re, im, this.dx, this.pmax, out?.re, out?.im);
  }

  /** W on the grid from a band-limited psi (length n).  Fills and returns this.W. */
  wigner(re, im, out = this.W) {
    const { n, s, K, cols, rows, q, j0, kmax, m0 } = this;
    const zr = this._zr, zi = this._zi, scale = this.h / Math.PI;
    for (let c = 0; c < cols; c += 2) {
      zr.fill(0); zi.fill(0);
      for (let t = 0; t < 2 && c + t < cols; t++) {
        const j = j0 + (c + t) * q;
        if (j < 0 || j >= n) continue;
        const kk = Math.min(kmax, Math.floor(Math.min(j, n - 1 - j) / s));
        for (let k = -kk; k <= kk; k++) {
          const a = j - k * s, b = j + k * s;
          const ar = re[a], ai = im[a], br = re[b], bi = im[b];
          // A_k = conj(psi_a) psi_b
          const Ar = ar * br + ai * bi, Ai = ar * bi - ai * br;
          const idx = k < 0 ? k + K : k;
          if (t === 0) { zr[idx] += Ar; zi[idx] += Ai; } else { zr[idx] -= Ai; zi[idx] += Ar; }
        }
      }
      fft(zr, zi);
      const o = c * rows;
      for (let r = 0; r < rows; r++) {
        const m = m0 + r, idx = m < 0 ? m + K : m;
        out[o + r] = scale * zr[idx];
        if (c + 1 < cols) out[o + rows + r] = scale * zi[idx];
      }
    }
    return out;
  }

  /**
   * The Husimi function Q(x, p) = |<x, p|psi>|^2 / 2 pi hbar, where |x, p> is a coherent state
   * whose |psi|^2 has standard deviation sigma (sigma^2 = hbar / 2 m omega for an oscillator).
   * It equals W smoothed by that coherent state's own Wigner function, a Gaussian of variances
   * sigma^2 and hbar^2 / 4 sigma^2, and is never negative.  Fills and returns this.Q.
   *
   * Computed as a windowed Fourier transform: psi times the window g(x' - x), sampled at
   * spacing hq (fine enough for the window's own spread of momenta), transformed.  Q is smooth
   * on the scales sigma and 1/2 sigma, so it is computed on a coarser grid (a sixth of those
   * scales) and interpolated linearly to the grid of W; the interpolation error is a few
   * parts in a thousand of the peak.
   */
  husimi(re, im, sigma, out = this.Q) {
    const { n, dx, cols, rows, q, j0 } = this;
    const sp = 1 / (2 * sigma);
    const sq = Math.max(1, Math.min(this.s, Math.floor(Math.PI / ((this.pmax + 6 * sp) * dx))));
    const hq = sq * dx;
    const kq = Math.ceil((7 * sigma) / hq);
    let L = 16;
    while (L < 2 * kq + 1 || (2 * Math.PI) / (L * hq) > sp / 6) L *= 2;
    const dpq = (2 * Math.PI) / (L * hq);
    if (!this._qr || this._qr.length !== L) { this._qr = new Float64Array(L); this._qi = new Float64Array(L); }
    const zr = this._qr, zi = this._qi;
    const g = new Float64Array(2 * kq + 1), norm = (2 * Math.PI * sigma * sigma) ** -0.25;
    for (let k = -kq; k <= kq; k++) g[k + kq] = norm * Math.exp(-((k * hq) ** 2) / (4 * sigma * sigma));
    const scale = (hq * hq) / (2 * Math.PI);
    // For each row of W, the two transform bins around its momentum and the weight.
    const lo = new Int32Array(rows), wt = new Float64Array(rows);
    for (let r = 0; r < rows; r++) {
      const f = this.p[r] / dpq, m = Math.floor(f);
      lo[r] = m; wt[r] = f - m;
    }
    const stride = Math.max(1, Math.floor(sigma / 6 / this.cellX));
    const column = (c) => {
      zr.fill(0); zi.fill(0);
      const j = j0 + c * q;
      for (let k = -kq; k <= kq; k++) {
        const b = j + k * sq;
        if (b < 0 || b >= n) continue;
        const idx = k < 0 ? k + L : k;
        zr[idx] = re[b] * g[k + kq]; zi[idx] = im[b] * g[k + kq];
      }
      fft(zr, zi);
      const o = c * rows;
      for (let r = 0; r < rows; r++) {
        const a = ((lo[r] % L) + L) % L, b = (a + 1) % L;
        const qa = zr[a] * zr[a] + zi[a] * zi[a], qb = zr[b] * zr[b] + zi[b] * zi[b];
        out[o + r] = scale * (qa + wt[r] * (qb - qa));
      }
    };
    let prev = 0;
    column(0);
    for (let c = stride; ; c += stride) {
      const cc = Math.min(c, cols - 1);
      if (cc <= prev) break;
      column(cc);
      // Columns in between, linearly.
      for (let k = prev + 1; k < cc; k++) {
        const t = (k - prev) / (cc - prev), a = prev * rows, b = cc * rows, o = k * rows;
        for (let r = 0; r < rows; r++) out[o + r] = out[a + r] + t * (out[b + r] - out[a + r]);
      }
      prev = cc;
      if (cc === cols - 1) break;
    }
    return out;
  }

  /** The x marginal of F (W or Q) within the window: sum over p of F dp, per column. */
  xMarginal(F = this.W, out = new Float64Array(this.cols)) {
    const { rows, cols, dp } = this;
    out.fill(0);
    for (let c = 0; c < cols; c++) {
      let a = 0;
      for (let r = 0, o = c * rows; r < rows; r++) a += F[o + r];
      out[c] = a * dp;
    }
    return out;
  }

  /** The p marginal of F within the window: sum over x of F dx, per row. */
  pMarginal(F = this.W, out = new Float64Array(this.rows)) {
    const { rows, cols, cellX } = this;
    out.fill(0);
    for (let c = 0; c < cols; c++) for (let r = 0, o = c * rows; r < rows; r++) out[r] += F[o + r];
    for (let r = 0; r < rows; r++) out[r] *= cellX;
    return out;
  }

  /**
   * Numbers that characterise F over the window: its integral, its least and greatest
   * values, the volume of its negative part, and 2 pi hbar times the integral of F^2 (the
   * purity, 1 for a pure state's W).
   */
  stats(F = this.W) {
    let sum = 0, neg = 0, sq = 0, min = Infinity, max = -Infinity, imin = 0;
    for (let i = 0; i < F.length; i++) {
      const v = F[i];
      sum += v; sq += v * v;
      if (v < 0) neg -= v;
      if (v < min) { min = v; imin = i; }
      if (v > max) max = v;
    }
    const a = this.cell;
    return {
      total: sum * a, negative: neg * a, purity: 2 * Math.PI * sq * a, min, max,
      minAt: [this.x[Math.floor(imin / this.rows)], this.p[imin % this.rows]],
    };
  }

  /**
   * The distribution of the quadrature X = x cos(theta) + (p / u) sin(theta) (u: the unit of
   * momentum that counts as one unit of x), from F, in nb bins on [X0, X1]: the shadow of F
   * on a line at angle theta.  At theta = 0 it is the x marginal.  Cloud-in-cell binning.
   */
  quadrature(F, theta, u, X0, X1, nb, out = new Float64Array(nb)) {
    const { rows, cols, x, p } = this;
    const c = Math.cos(theta), s = Math.sin(theta) / u, w = (X1 - X0) / nb;
    out.fill(0);
    for (let k = 0; k < cols; k++) {
      const xc = x[k] * c;
      for (let r = 0; r < rows; r++) {
        const v = F[k * rows + r];
        if (v === 0) continue;
        const f = (xc + p[r] * s - X0) / w - 0.5, i = Math.floor(f), t = f - i;
        if (i >= 0 && i < nb) out[i] += v * (1 - t);
        if (i + 1 >= 0 && i + 1 < nb) out[i + 1] += v * t;
      }
    }
    // Each sample carries F dx dp; the density in X is that over the bin width.
    const k = this.cell / w;
    for (let i = 0; i < nb; i++) out[i] *= k;
    return out;
  }

  /**
   * Draw N points (x, p) from the density max(F, 0) on the grid (uniform within a cell).
   * rng() returns uniform numbers in [0, 1).
   */
  sample(F, N, rng, outX = new Float64Array(N), outP = new Float64Array(N)) {
    const { rows, cols, x, p, cellX, dp } = this;
    const cdf = new Float64Array(rows * cols);
    let acc = 0;
    for (let i = 0; i < cdf.length; i++) { acc += Math.max(0, F[i]); cdf[i] = acc; }
    if (!(acc > 0)) return null;
    for (let s = 0; s < N; s++) {
      const u = rng() * acc;
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
      const c = Math.floor(lo / rows), r = lo - c * rows;
      outX[s] = x[c] + (rng() - 0.5) * cellX;
      outP[s] = p[r] + (rng() - 0.5) * dp;
    }
    return { x: outX, p: outP };
  }

  /** The value of F at (xv, pv) by bilinear interpolation (0 outside the window). */
  at(F, xv, pv) {
    const fc = (xv - this.x[0]) / this.cellX, fr = (pv - this.p[0]) / this.dp;
    const c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0 || r < 0 || c >= this.cols - 1 || r >= this.rows - 1) return 0;
    const tc = fc - c, tr = fr - r, i = c * this.rows + r, R = this.rows;
    return (1 - tc) * ((1 - tr) * F[i] + tr * F[i + 1]) + tc * ((1 - tr) * F[i + R] + tr * F[i + R + 1]);
  }
}

/** A small, fast, seedable random number generator (mulberry32): uniform in [0, 1). */
export function rng32(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
