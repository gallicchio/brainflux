// A two-mirror optical cavity: stability, the Gaussian mode it selects, its resonant
// frequencies, and rays bouncing between its mirrors.
//
// Mirrors of radii R1, R2 (R > 0 concave towards the other mirror, Infinity flat) a distance L
// apart.  With g_i = 1 - L/R_i, the cavity is stable (a ray started near the axis stays near it,
// and a Gaussian mode exists) when 0 <= g1 g2 <= 1.  Lengths in millimetres.

import { free, mirror, mul, applyABCD, applyRay, beamOf } from './gauss.js';

export const C_LIGHT = 299792458e3; // mm/s

export const gParams = (L, R1, R2) => [1 - L / R1, 1 - L / R2];

/** Strictly inside the stable region (the edges, g1 g2 = 0 or 1, are only marginally stable). */
export function isStable(g1, g2) { const p = g1 * g2; return p > 0 && p < 1; }

/** The round-trip ray matrix, starting just after mirror 1, heading for mirror 2. */
export const roundTrip = (L, R1, R2) => mul(mirror(R1), free(L), mirror(R2), free(L));

/**
 * The cavity's Gaussian mode, or null if there is none.  Returns
 *   q1      q just after mirror 1, heading for mirror 2 (the round trip gives it back)
 *   w0, zw  the waist and its distance from mirror 1 (towards mirror 2)
 *   zR      the Rayleigh range
 *   w1, w2  the spot sizes on the mirrors
 *   gouy    the one-way Gouy phase psi1 (0..pi), so the round trip gains 2 psi1
 */
export function eigenmode(L, R1, R2, lambda) {
  const [A, B, C, D] = roundTrip(L, R1, R2);
  const [g1, g2] = gParams(L, R1, R2), p = g1 * g2;
  let q1;
  if (Math.abs(g1) < 1e-12 && Math.abs(g2) < 1e-12) {
    // The symmetric confocal cavity (R1 = R2 = L): two round trips return every ray (the
    // round trip is -1), so every q comes back; its mode is the limit of nearly confocal
    // symmetric cavities, with the waist in the middle and zR = L/2.
    q1 = { re: -L / 2, im: L / 2 };
  } else {
    if (!(p > 0 && p < 1) || B === 0) return null;
    // C q^2 + (D - A) q - B = 0: 1/q = (D - A)/(2B) - i sqrt(1 - m^2)/|B| (Im 1/q < 0), with
    // m = (A + D)/2 = 2 g1 g2 - 1, so 1 - m^2 = 4 g1 g2 (1 - g1 g2).
    const ur = (D - A) / (2 * B), ui = -Math.sqrt(4 * p * (1 - p)) / Math.abs(B);
    const d = ur * ur + ui * ui;
    q1 = { re: ur / d, im: -ui / d };
  }
  const m = (A + D) / 2;
  const b1 = beamOf(q1, lambda);
  const q2 = { re: q1.re + L, im: q1.im };
  const b2 = beamOf(q2, lambda);
  return {
    q1, w0: b1.w0, zw: -q1.re, zR: q1.im, w1: b1.w, w2: b2.w,
    gouy: Math.atan2(q2.re, q2.im) - Math.atan2(q1.re, q1.im),
    roundTripCos: m,
  };
}

/** The textbook closed forms (Siegman, Lasers, ch. 19), for checking. */
export function closedForms(L, g1, g2, lambda) {
  const p = g1 * g2, s = (lambda * L) / Math.PI;
  return {
    w0: Math.sqrt(s * Math.sqrt(p * (1 - p)) / Math.abs(g1 + g2 - 2 * p)),
    w1: Math.sqrt(s * Math.sqrt(g2 / (g1 * (1 - p)))),
    w2: Math.sqrt(s * Math.sqrt(g1 / (g2 * (1 - p)))),
    zw: (L * g2 * (1 - g1)) / (g1 + g2 - 2 * p),
    gouy: Math.acos(Math.sign(g1) * Math.sqrt(p)),
  };
}

/** The free spectral range c / 2L, in Hz. */
export const fsr = (L) => C_LIGHT / (2 * L);

/**
 * The resonances of the modes of order N = m + n (Hermite-Gauss) or 2p + |l| (Laguerre-Gauss):
 * the round trip phase 2kL - 2(N+1) psi1 must be 2 pi q, so
 *     nu / FSR = q + (N + 1) psi1 / pi.
 * Returns [{ q, N, nu }] (nu in units of the FSR) with nu in [lo, hi], N <= Nmax.
 */
export function modeLines(psi1, Nmax, lo, hi) {
  const out = [];
  for (let N = 0; N <= Nmax; N++) {
    const off = ((N + 1) * psi1) / Math.PI;
    for (let q = Math.ceil(lo - off - 1e-9); q + off <= hi + 1e-9; q++) out.push({ q, N, nu: q + off });
  }
  return out;
}

/**
 * Bounce a ray between the mirrors.  Starts at mirror 1, (x, theta) heading for mirror 2.
 * Returns the positions on the mirrors, alternately 2, 1, 2, 1 ... ({ x, mirror }), and the
 * (x, theta) at mirror 1 after each round trip; stops early when |x| > aperture.
 */
export function bounce(L, R1, R2, x, theta, passes, aperture = Infinity) {
  const hits = [{ x, mirror: 1 }], phase = [[x, theta]];
  let r = [x, theta];
  for (let k = 0; k < passes; k++) {
    const toMirror = k % 2 === 0 ? 2 : 1;
    r = applyRay(free(L), r);
    hits.push({ x: r[0], mirror: toMirror });
    if (Math.abs(r[0]) > aperture) return { hits, phase, lost: k + 1 };
    r = applyRay(mirror(toMirror === 2 ? R2 : R1), r);
    if (toMirror === 1) phase.push(r);
  }
  return { hits, phase, lost: 0 };
}

/** Does the mode reproduce itself?  q after one round trip, for checking. */
export const afterRoundTrip = (L, R1, R2, q) => applyABCD(roundTrip(L, R1, R2), q);
