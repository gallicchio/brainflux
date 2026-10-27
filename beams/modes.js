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
  // Per-column and per-row factors for Hermite-Gauss (it separates in x and y).
  const fam = mode.family;
  let ux0, ux1, uy0, uy1;
  if (fam === 'hg' || fam === 'mix') {
    const mx = fam === 'hg' ? mode.m : 1, ny_ = fam === 'hg' ? mode.n : 0;
    ux0 = new Float64Array(nx); uy0 = new Float64Array(ny);
    for (let i = 0; i < nx; i++) ux0[i] = hg1d(mx, (-half + (i + 0.5) * dx) / w);
    for (let j = 0; j < ny; j++) uy0[j] = hg1d(ny_, (half - (j + 0.5) * dy) / w);
    if (fam === 'mix') {
      ux1 = new Float64Array(nx); uy1 = new Float64Array(ny);
      for (let i = 0; i < nx; i++) ux1[i] = hg1d(0, (-half + (i + 0.5) * dx) / w);
      for (let j = 0; j < ny; j++) uy1[j] = hg1d(1, (half - (j + 0.5) * dy) / w);
    }
  }
  const lgNorm = fam === 'lg' ? Math.sqrt((2 * factorial(mode.p)) / (Math.PI * factorial(mode.p + Math.abs(mode.l)))) : 0;
  const ca = fam === 'mix' ? Math.cos(mode.alpha) : 0, sa = fam === 'mix' ? Math.sin(mode.alpha) : 0;
  const cp = fam === 'mix' ? Math.cos(mode.phi) : 0, sp = fam === 'mix' ? Math.sin(mode.phi) : 0;
  let peak = 0;
  for (let j = 0; j < ny; j++) {
    const y = half - (j + 0.5) * dy;
    for (let i = 0; i < nx; i++) {
      const x = -half + (i + 0.5) * dx, r2 = x * x + y * y, o = j * nx + i;
      let ar, ai = 0; // the amplitude without the common phase
      if (fam === 'hg') ar = ux0[i] * uy0[j];
      else if (fam === 'mix') { ar = ca * ux0[i] * uy0[j] + sa * cp * ux1[i] * uy1[j]; ai = sa * sp * ux1[i] * uy1[j]; }
      else {
        const s2 = (2 * r2) / (w * w), al = Math.abs(mode.l);
        const rad = lgNorm * Math.pow(Math.sqrt(s2), al) * laguerre(mode.p, al, s2) * Math.exp(-r2 / (w * w));
        const az = mode.l * Math.atan2(y, x);
        ar = rad * Math.cos(az); ai = rad * Math.sin(az);
      }
      ar /= w; ai /= w;
      const ph = r2 * curv + gouy, c = Math.cos(ph), s = Math.sin(ph);
      re[o] = ar * c - ai * s; im[o] = ar * s + ai * c;
      const a = re[o] * re[o] + im[o] * im[o];
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

/** The overlap <a|b> = sum conj(a) b dA of two sampled fields (dA the cell area). */
export function overlap(are, aim, bre, bim, dA) {
  let r = 0, i = 0;
  for (let k = 0; k < are.length; k++) {
    r += are[k] * bre[k] + aim[k] * bim[k];
    i += are[k] * bim[k] - aim[k] * bre[k];
  }
  return { re: r * dA, im: i * dA };
}
