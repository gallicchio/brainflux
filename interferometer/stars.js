// Michelson's stellar interferometer: fringe visibility against baseline.
//
// Two mirrors a distance B apart sample the starlight at two points; the fringes they make have
// a visibility (contrast) equal to the modulus of the complex degree of coherence between those
// points, and by the van Cittert-Zernike theorem that is the normalised Fourier transform of the
// star's brightness on the sky, taken at the spatial frequency u = B/λ (cycles per radian):
//     V(u) = ∫ I(x, y) e^{-2πiux} dx dy / ∫ I dx dy        (x along the baseline).
// For a uniform disk of angular diameter θ this is 2J₁(x)/x with x = πθu = πBθ/λ, which first
// vanishes at x = 3.8317, i.e. B = 1.22 λ/θ.  A disk darker towards its edge (limb darkening,
// I = 1 - a(1 - μ), μ the cosine of the angle from the centre of the star's face) adds a term
// 3(sin x - x cos x)/x³, which first vanishes at x = 4.4934, further out.  Two stars add their
// transforms, each shifted by its position: V = Σ F_s V_s e^{-2πiux_s} / Σ F_s.
//
// Angles are in radians (1 mas = 1 milliarcsecond = 4.848e-9 rad), lengths in metres.

import { besselJ } from '../lib/bessel.js';

export const MAS = Math.PI / (180 * 3600 * 1000);
export const ARCSEC = 1000 * MAS;

/** 2 J₁(x) / x. */
export function airyAmp(x) {
  if (Math.abs(x) < 1e-6) return 1 - (x * x) / 8;
  return (2 * besselJ(1, Math.abs(x))[1]) / Math.abs(x);
}

/** 3 (sin x - x cos x) / x³, the transform of a disk of brightness μ. */
function muDisk(x) {
  const a = Math.abs(x);
  if (a < 1e-3) return 1 - (a * a) / 10;
  return (3 * (Math.sin(a) - a * Math.cos(a))) / (a * a * a);
}

/** The visibility of one disk, x = π θ u, with linear limb darkening a (0: uniform). */
export function diskVisibility(x, a = 0) {
  const fu = 1 - a, fm = (2 * a) / 3;          // the fluxes of the uniform and μ parts
  return (fu * airyAmp(x) + fm * muDisk(x)) / (fu + fm);
}

/**
 * The star(s): model = { stars: [{ theta, flux, x }], limb }, x the angular position along the
 * baseline.  Returns the complex visibility [re, im] at spatial frequency u = B/λ.
 */
export function visibility(model, u, out = [0, 0]) {
  let re = 0, im = 0, F = 0;
  for (const s of model.stars) {
    const V = s.flux * diskVisibility(Math.PI * s.theta * u, model.limb || 0), ph = -2 * Math.PI * u * s.x;
    re += V * Math.cos(ph); im += V * Math.sin(ph); F += s.flux;
  }
  out[0] = F ? re / F : 0; out[1] = F ? im / F : 0;
  return out;
}

/** One star of diameter theta, or a pair: separation rho at position angle pa from the baseline, flux ratio r. */
export function makeModel({ theta, binary = false, rho = 0, pa = 0, ratio = 1, limb = 0 }) {
  if (!binary) return { stars: [{ theta, flux: 1, x: 0, y: 0 }], limb };
  // Put the centre of light at the origin.
  const px = rho * Math.cos(pa), py = rho * Math.sin(pa), f1 = 1 / (1 + ratio), f2 = ratio / (1 + ratio);
  return { stars: [{ theta, flux: f1, x: -px * f2, y: -py * f2 }, { theta, flux: f2, x: px * f1, y: py * f1 }], limb };
}

/** Wavelengths (m) and weights across a Gaussian band of full width fwhm about lam. */
export function bandSamples(lam, fwhm, n = 31) {
  if (!(fwhm > 0)) return [[lam, 1]];
  const sd = fwhm / (2 * Math.sqrt(2 * Math.LN2)), out = [];
  for (let j = 0; j < n; j++) {
    const z = -2.5 + (5 * j) / (n - 1);
    out.push([lam + z * sd, Math.exp(-0.5 * z * z)]);
  }
  const W = out.reduce((a, [, w]) => a + w, 0);
  return out.map(([l, w]) => [l, w / W]);
}

/** The visibility at the central fringe for light spread over a band: the weighted mean of V(B/λ). */
export function bandVisibility(model, B, samples, out = [0, 0]) {
  let re = 0, im = 0;
  const v = [0, 0];
  for (const [lam, w] of samples) { visibility(model, B / lam, v); re += w * v[0]; im += w * v[1]; }
  out[0] = re; out[1] = im;
  return out;
}

/**
 * The visibility the hard way, for the tests: the star's brightness summed over a grid across
 * the sky (n points per diameter), then the Fourier sum at frequency u.
 */
export function visibilityNumeric(model, u, n = 400) {
  let re = 0, im = 0, F = 0;
  for (const s of model.stars) {
    const R = s.theta / 2, h = s.theta / n;
    let sre = 0, sim = 0, sf = 0;
    for (let i = 0; i < n; i++) {
      const x = -R + (i + 0.5) * h;
      // The column of the disk at x, summed over y (midpoint rule).
      let col = 0;
      for (let j = 0; j < n; j++) {
        const y = -R + (j + 0.5) * h, r2 = (x * x + y * y) / (R * R);
        if (r2 >= 1) continue;
        const mu = Math.sqrt(1 - r2);
        col += 1 - (model.limb || 0) * (1 - mu);
      }
      const ph = -2 * Math.PI * u * (x + s.x);
      sre += col * Math.cos(ph); sim += col * Math.sin(ph); sf += col;
    }
    re += (s.flux * sre) / sf; im += (s.flux * sim) / sf; F += s.flux;
  }
  return [re / F, im / F];
}

/** The first baseline (m) at which V(B/λ) has a minimum below tol, searching up to Bmax. */
export function firstNull(model, lam, Bmax, tol = 0.02) {
  const n = 4000, v = [0, 0];
  let prev = 1, falling = false;
  for (let i = 1; i <= n; i++) {
    const B = (Bmax * i) / n, m = Math.hypot(...visibility(model, B / lam, v));
    if (m > prev && falling && prev < tol) {
      // Refine by golden-section search on [B - 2h, B].
      let a = B - (2 * Bmax) / n, b = B;
      for (let it = 0; it < 60; it++) {
        const c = b - (b - a) / 1.618, d = a + (b - a) / 1.618;
        if (Math.hypot(...visibility(model, c / lam, v)) < Math.hypot(...visibility(model, d / lam, v))) b = d; else a = c;
      }
      return (a + b) / 2;
    }
    falling = m < prev;
    prev = m;
  }
  return NaN;
}
