// Hermite-Gauss and Laguerre-Gauss modes: the beams that keep their shape as they travel.
//
// In units of the waist (x, y in w0, z in zR: zeta = z/zR), every mode depends on zeta alone.
// With w = w0 sqrt(1 + zeta^2), psi = atan(zeta) and the wavefront phase
// k r^2/(2R) = (r/w0)^2 zeta / (1 + zeta^2), the modes (physicists' convention,
// times exp(i(kz - wt))) are
//
//   HG_mn = (w0/w) u_m(x/w) u_n(y/w) exp(i k r^2/2R) exp(-i (m+n+1) psi),
//           u_m(s) = (2/pi)^(1/4) H_m(sqrt2 s) exp(-s^2) / sqrt(2^m m!)
//   LG_pl = (w0/w) sqrt(2 p!/(pi (p+|l|)!)) (sqrt2 r/w)^|l| L_p^|l|(2 r^2/w^2) exp(-r^2/w^2)
//           exp(i l phi) exp(i k r^2/2R) exp(-i (2p+|l|+1) psi)
//
// each normalised to unit power at every z (in units where w0 = 1).  The order N = m + n or
// 2p + |l| fixes the Gouy phase (N+1) psi, and so the resonant frequency in a cavity.

import { hermite } from './gauss.js';
import { fft2, wavenumbers } from '../lib/fft.js';

export { hermite };

/** The generalised Laguerre polynomial L_p^a(u), by the three-term recurrence. */
export function laguerre(p, a, u) {
  if (p === 0) return 1;
  let l0 = 1, l1 = 1 + a - u;
  for (let k = 1; k < p; k++) {
    const l2 = ((2 * k + 1 + a - u) * l1 - (k + a) * l0) / (k + 1);
    l0 = l1; l1 = l2;
  }
  return l1;
}

const factorial = (n) => { let f = 1; for (let k = 2; k <= n; k++) f *= k; return f; };

/** The order N of a mode, which sets its Gouy phase (N+1) psi. */
export function order(mode) {
  if (mode.family === 'lg') return 2 * mode.p + Math.abs(mode.l);
  if (mode.family === 'mix') return 1;
  return mode.m + mode.n;
}

/** The 1D Hermite-Gauss function u_m(s), s = x / w (unit norm in s). */
export function hg1d(m, s) {
  return (Math.pow(2 / Math.PI, 0.25) * hermite(m, Math.SQRT2 * s) * Math.exp(-s * s)) / Math.sqrt(2 ** m * factorial(m));
}

/**
 * Fill (re, im), nx by ny, row 0 at the top, with a mode at zeta = z/zR.  The square spans
 * [-half, half] in units of w0 in both directions.  Mode: { family: 'hg', m, n } |
 * { family: 'lg', p, l } | { family: 'mix', alpha, phi } (cos(alpha) HG10 + e^{i phi} sin(alpha) HG01).
 * Values are normalised to unit power (w0 = 1).  Returns the peak |field|.
 */
export function fillMode(re, im, nx, ny, half, mode, zeta) {
  const w = Math.sqrt(1 + zeta * zeta), psi = Math.atan(zeta), curv = zeta / (1 + zeta * zeta);
  const N = order(mode), gouy = -(N + 1) * psi;
  const dx = (2 * half) / nx, dy = (2 * half) / ny;
  const fam = mode.family;
  // Everything separates in x and y except the Laguerre polynomial: the wavefront phase
  // exp(i r^2 curv) and the Gouy phase go into the column factors (cxr, cxi) and the row
  // factors (cyr, cyi); exp(-r^2/w^2) and the Hermite functions too.
  const xs = new Float64Array(nx), ys = new Float64Array(ny);
  for (let i = 0; i < nx; i++) xs[i] = -half + (i + 0.5) * dx;
  for (let j = 0; j < ny; j++) ys[j] = half - (j + 0.5) * dy;
  const cxr = new Float64Array(nx), cxi = new Float64Array(nx), cyr = new Float64Array(ny), cyi = new Float64Array(ny);
  const gx = new Float64Array(nx), gy = new Float64Array(ny);   // exp(-x^2/w^2), exp(-y^2/w^2)
  for (let i = 0; i < nx; i++) {
    const p = xs[i] * xs[i] * curv + gouy;
    cxr[i] = Math.cos(p) / w; cxi[i] = Math.sin(p) / w;
    gx[i] = Math.exp(-(xs[i] * xs[i]) / (w * w));
  }
  for (let j = 0; j < ny; j++) {
    const p = ys[j] * ys[j] * curv;
    cyr[j] = Math.cos(p); cyi[j] = Math.sin(p);
    gy[j] = Math.exp(-(ys[j] * ys[j]) / (w * w));
  }
  let ux0, ux1, uy0, uy1;
  if (fam === 'hg' || fam === 'mix') {
    const mx = fam === 'hg' ? mode.m : 1, my = fam === 'hg' ? mode.n : 0;
    ux0 = Float64Array.from(xs, (x) => hg1d(mx, x / w)); uy0 = Float64Array.from(ys, (y) => hg1d(my, y / w));
    if (fam === 'mix') { ux1 = Float64Array.from(xs, (x) => hg1d(0, x / w)); uy1 = Float64Array.from(ys, (y) => hg1d(1, y / w)); }
  }
  const al = fam === 'lg' ? Math.abs(mode.l) : 0, sgn = fam === 'lg' && mode.l < 0 ? -1 : 1;
  const lgNorm = fam === 'lg' ? Math.sqrt((2 * factorial(mode.p)) / (Math.PI * factorial(mode.p + al))) : 0;
  const ca = fam === 'mix' ? Math.cos(mode.alpha) : 0, sa = fam === 'mix' ? Math.sin(mode.alpha) : 0;
  const cp = fam === 'mix' ? Math.cos(mode.phi) : 0, sp = fam === 'mix' ? Math.sin(mode.phi) : 0;
  const s = Math.SQRT2 / w;
  let peak = 0;
  for (let j = 0; j < ny; j++) {
    const y = ys[j];
    for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      let ar, ai = 0; // the amplitude, before the phase factors
      if (fam === 'hg') ar = ux0[i] * uy0[j];
      else if (fam === 'mix') { ar = ca * ux0[i] * uy0[j] + sa * cp * ux1[i] * uy1[j]; ai = sa * sp * ux1[i] * uy1[j]; }
      else {
        // (sqrt2 r/w)^|l| exp(i l phi) = (sqrt2 (x +- i y)/w)^|l|
        const x = xs[i], ur = s * x, ui = sgn * s * y;
        let pr = 1, pi = 0;
        for (let k = 0; k < al; k++) { const t = pr * ur - pi * ui; pi = pr * ui + pi * ur; pr = t; }
        const rad = lgNorm * laguerre(mode.p, al, s * s * (x * x + y * y)) * gx[i] * gy[j];
        ar = rad * pr; ai = rad * pi;
      }
      // Times exp(i (x^2 curv + gouy)) / w and exp(i y^2 curv).
      const br = ar * cxr[i] - ai * cxi[i], bi = ar * cxi[i] + ai * cxr[i];
      const vr = br * cyr[j] - bi * cyi[j], vi = br * cyi[j] + bi * cyr[j];
      re[o] = vr; im[o] = vi;
      const a = vr * vr + vi * vi;
      if (a > peak) peak = a;
    }
  }
  return Math.sqrt(peak);
}

/**
 * One row of a mode's field in the plane y = 0, for the side view: the complex amplitude at
 * x (in w0) for zeta, without the carrier.  For HG_mn with n odd the plane y = 0 is a node, so
 * the side view shows y = w0/2 instead (the caller passes y).
 */
export function modeAt(mode, x, y, zeta) {
  const w = Math.sqrt(1 + zeta * zeta), psi = Math.atan(zeta), curv = zeta / (1 + zeta * zeta);
  const N = order(mode), r2 = x * x + y * y;
  let ar, ai = 0;
  if (mode.family === 'hg') ar = hg1d(mode.m, x / w) * hg1d(mode.n, y / w);
  else if (mode.family === 'mix') {
    const a = Math.cos(mode.alpha) * hg1d(1, x / w) * hg1d(0, y / w), b = Math.sin(mode.alpha) * hg1d(0, x / w) * hg1d(1, y / w);
    ar = a + b * Math.cos(mode.phi); ai = b * Math.sin(mode.phi);
  } else {
    const s2 = (2 * r2) / (w * w), al = Math.abs(mode.l);
    const norm = Math.sqrt((2 * factorial(mode.p)) / (Math.PI * factorial(mode.p + al)));
    const rad = norm * Math.pow(Math.sqrt(s2), al) * laguerre(mode.p, al, s2) * Math.exp(-r2 / (w * w));
    const az = mode.l * Math.atan2(y, x);
    ar = rad * Math.cos(az); ai = rad * Math.sin(az);
  }
  ar /= w; ai /= w;
  const ph = r2 * curv - (N + 1) * psi, c = Math.cos(ph), s = Math.sin(ph);
  return [ar * c - ai * s, ar * s + ai * c];
}

/**
 * The angular spectrum method of diffraction/optics.js, split in two so that one field can be
 * sent to many distances cheaply: spectrum() transforms it once, fromSpectrum() applies
 * exp(i (kz - k) z), kz = sqrt(k^2 - kx^2 - ky^2), and transforms back.  The same numbers as
 * optics.js's propagate(re, im, n, dx, lambda, z) (checked in the tests).
 */
export function spectrum(re, im, n, dx, lambda) {
  const R = Float64Array.from(re), I = Float64Array.from(im);
  fft2(R, I, n, n, -1);
  // kz - k for each component (NaN where evanescent: those decay as exp(-|kz| z)).
  const k = (2 * Math.PI) / lambda, kx = wavenumbers(n, dx), dkz = new Float64Array(n * n), decay = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q2 = kx[i] * kx[i] + kx[j] * kx[j], o = j * n + i;
    if (q2 <= k * k) dkz[o] = Math.sqrt(k * k - q2) - k;
    else { dkz[o] = -k; decay[o] = Math.sqrt(q2 - k * k); }
  }
  return { R, I, n, dkz, decay };
}

export function fromSpectrum(S, z, outRe = new Float64Array(S.n * S.n), outIm = new Float64Array(S.n * S.n)) {
  const { R, I, n, dkz, decay } = S, inv = 1 / (n * n);
  for (let o = 0; o < n * n; o++) {
    const ph = dkz[o] * z, mag = (decay[o] ? Math.exp(-decay[o] * z) : 1) * inv;
    const c = mag * Math.cos(ph), s = mag * Math.sin(ph);
    outRe[o] = R[o] * c - I[o] * s; outIm[o] = R[o] * s + I[o] * c;
  }
  fft2(outRe, outIm, n, n, +1);
  return [outRe, outIm];
}

/** The overlap <a|b> = sum conj(a) b dA of two sampled fields (dA the cell area). */
export function overlap(are, aim, bre, bim, dA) {
  let r = 0, i = 0;
  for (let k = 0; k < are.length; k++) {
    r += are[k] * bre[k] + aim[k] * bim[k];
    i += are[k] * bim[k] - aim[k] * bre[k];
  }
  return { re: r * dA, im: i * dA };
}
