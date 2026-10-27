// Scalar diffraction by the angular spectrum method.
//
// A monochromatic field U(x, y, 0) just past an aperture is a sum of plane waves
// exp(i(kx x + ky y)); each one travels on to distance z picking up exp(i kz z), with
// kz = sqrt(k^2 - kx^2 - ky^2) (k = 2 pi / lambda).  So
//
//     U(x, y, z) = F^-1[ F[U(x, y, 0)] exp(i (kz - k) z) ]
//
// (the common factor exp(i k z) is left out).  Waves with kx^2 + ky^2 > k^2 don't propagate:
// kz is imaginary and they die away within a wavelength (evanescent).  In the paraxial limit,
// kz - k ~ -(kx^2 + ky^2) / 2k, and the propagator is that of the free Schrödinger equation:
// diffraction is the spreading of a wave packet, with z playing the part of time.
//
// The field lives on an n x n grid of spacing dx, periodic: light that spreads past the edge
// comes back on the other side, so apertures are padded with darkness (see padded()).

import { fft2, wavenumbers } from '../lib/fft.js';

/** Propagate (re, im) by z, in place.  paraxial: use the Fresnel (Schrödinger) propagator. */
export function propagate(re, im, n, dx, lambda, z, paraxial = false) {
  const k = (2 * Math.PI) / lambda, kx = wavenumbers(n, dx);
  fft2(re, im, n, n, -1);
  for (let j = 0; j < n; j++) {
    const ky2 = kx[j] * kx[j];
    for (let i = 0; i < n; i++) {
      const q2 = kx[i] * kx[i] + ky2, o = j * n + i;
      let mag = 1, ph;
      if (paraxial) ph = (-q2 * z) / (2 * k);
      else if (q2 <= k * k) ph = (Math.sqrt(k * k - q2) - k) * z;
      else { ph = -k * z; mag = Math.exp(-Math.sqrt(q2 - k * k) * z); }
      const c = mag * Math.cos(ph), s = mag * Math.sin(ph);
      const r = re[o] * c - im[o] * s;
      im[o] = re[o] * s + im[o] * c; re[o] = r;
    }
  }
  fft2(re, im, n, n, +1);
  const inv = 1 / (n * n);
  for (let i = 0; i < re.length; i++) { re[i] *= inv; im[i] *= inv; }
}

/** An m x m field placed in the middle of an n x n dark one (n >= m). */
export function padded(re, im, m, n) {
  const R = new Float64Array(n * n), I = new Float64Array(n * n), o = (n - m) >> 1;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { R[(j + o) * n + i + o] = re[j * m + i]; I[(j + o) * n + i + o] = im[j * m + i]; }
  return [R, I];
}

/**
 * The middle row of the field (y = 0 when the field is centred in the array) at many
 * distances: the side view, x across and z down.  Returns Float64Array(zs.length * n) of
 * intensities.  Only one row is needed, so the sum over ky is done first (with the phase
 * (-1)^m that puts y at the middle row) and then one 1D transform over kx per distance.
 */
export function sideView(re0, im0, n, dx, lambda, zs, paraxial = false) {
  const out = new Float64Array(zs.length * n);
  const k = (2 * Math.PI) / lambda, kx = wavenumbers(n, dx);
  const Fre = Float64Array.from(re0), Fim = Float64Array.from(im0);
  fft2(Fre, Fim, n, n, -1);
  const ar = new Float64Array(n), ai = new Float64Array(n);
  zs.forEach((z, a) => {
    ar.fill(0); ai.fill(0);
    for (let j = 0; j < n; j++) {
      const ky2 = kx[j] * kx[j], sign = j % 2 ? -1 : 1; // exp(i ky y_mid) = (-1)^j
      for (let i = 0; i < n; i++) {
        const q2 = kx[i] * kx[i] + ky2, o = j * n + i;
        let mag = sign, ph;
        if (paraxial) ph = (-q2 * z) / (2 * k);
        else if (q2 <= k * k) ph = (Math.sqrt(k * k - q2) - k) * z;
        else { ph = 0; mag *= Math.exp(-Math.sqrt(q2 - k * k) * z); }
        const c = mag * Math.cos(ph), s = mag * Math.sin(ph);
        ar[i] += Fre[o] * c - Fim[o] * s; ai[i] += Fre[o] * s + Fim[o] * c;
      }
    }
    // The inverse transform over kx (sign +1), then 1/n^2.
    fft2(ar, ai, n, 1, +1);
    const inv = 1 / (n * n);
    for (let i = 0; i < n; i++) out[a * n + i] = (ar[i] * ar[i] + ai[i] * ai[i]) * inv * inv;
  });
  return out;
}
