// Scalar diffraction, from the aperture to the far field.
//
// A monochromatic field U(x, y, 0) just past an aperture is a sum of plane waves
// exp(i(kx x + ky y)); each one travels on to distance z picking up exp(i kz z), with
// kz = sqrt(k^2 - kx^2 - ky^2) (k = 2 pi / lambda).  So
//
//     U(x, y, z) = F^-1[ F[U(x, y, 0)] exp(i (kz - k) z) ]                  (angular spectrum)
//
// (the common factor exp(i k z) is left out).  Waves with kx^2 + ky^2 > k^2 don't propagate:
// kz is imaginary and they die away within a wavelength (evanescent).  In the paraxial limit,
// kz - k ~ -(kx^2 + ky^2) / 2k, and the propagator is that of the free Schrödinger equation:
// diffraction is the spreading of a wave packet, with z playing the part of time.
//
// The field lives on an n x n grid of spacing dx, periodic, which carries angles up to
// lambda / 2dx.  Light at that angle crosses half the window, n dx / 2, at
//
//     z_c = n dx^2 / lambda,
//
// and from there on it comes back on the other side (in k-space: the transfer function's phase
// turns by more than pi between neighbouring samples).  Zero padding only moves z_c out in
// proportion.  So past z_c the light gets a grid that grows with it, from the Fresnel transform
//
//     U(x, y, z) = e^{ik(x^2+y^2)/2z} / (i lambda z) ∫∫ U(x', y', 0) e^{ik(x'^2+y'^2)/2z} e^{-ik(xx'+yy')/z} dx'dy',
//
// one FFT whose output pitch is lambda z / (n dx): the grid spans the fixed range of angles
// +-lambda / 2dx, as the light does.  Its chirp e^{ik x'^2/2z} is sampled finely enough for
// z >= z_c.  At z_c both pitches are dx, and (with the paraxial kz) the two methods are the same
// sum: the sampled transfer function and the sampled impulse response are both exact there.
// As z grows the chirp inside goes to 1, and the pattern becomes the Fourier transform of the
// aperture (Fraunhofer), with the angle x / z fixed to each pixel.

import { fft2, fft2Centered, fftCentered, wavenumbers } from '../lib/fft.js';

/** The distance where the angular spectrum hands over to the Fresnel transform. */
export const criticalDistance = (n, dx, lambda) => (n * dx * dx) / lambda;

/** The pitch of the computed field at distance z: dx up to z_c, then lambda z / (n dx). */
export const pitchAt = (n, dx, lambda, z) => Math.max(dx, (lambda * z) / (n * dx));

// Multiply a spectrum (FFT order) by the transfer function exp(i (kz - k) z), in place.
function transfer(re, im, n, dx, lambda, z, paraxial) {
  const k = (2 * Math.PI) / lambda, kx = wavenumbers(n, dx);
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
}

function inverse(re, im, n) {
  fft2(re, im, n, n, +1);
  const inv = 1 / (n * n);
  for (let i = 0; i < re.length; i++) { re[i] *= inv; im[i] *= inv; }
}

/**
 * Propagate (re, im) by z, in place, on its own grid (the angular spectrum: right up to z_c).
 * paraxial: use the Fresnel (Schrödinger) propagator.
 */
export function propagate(re, im, n, dx, lambda, z, paraxial = false) {
  fft2(re, im, n, n, -1);
  transfer(re, im, n, dx, lambda, z, paraxial);
  inverse(re, im, n);
}

/** An m x m field placed in the middle of an n x n dark one (n >= m). */
export function padded(re, im, m, n) {
  const R = new Float64Array(n * n), I = new Float64Array(n * n), o = (n - m) >> 1;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { R[(j + o) * n + i + o] = re[j * m + i]; I[(j + o) * n + i + o] = im[j * m + i]; }
  return [R, I];
}

/** The aperture's angular spectrum (FFT order), for diffract() to reuse at many distances. */
export function spectrumOf(re, im, n) {
  const Fre = Float64Array.from(re), Fim = Float64Array.from(im);
  fft2(Fre, Fim, n, n, -1);
  return [Fre, Fim];
}

// cos and sin of a x^2 at x = (i - n/2) dx.
function chirp(n, dx, a) {
  const c = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) { const x = (i - n / 2) * dx, p = a * x * x; c[i] = Math.cos(p); s[i] = Math.sin(p); }
  return [c, s];
}

// Multiply a centred n x n field by e^{ia(x^2 + y^2)}, the product of two 1D chirps.
function multiplyChirp(re, im, n, dx, a) {
  const [c, s] = chirp(n, dx, a);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = j * n + i, cr = c[i] * c[j] - s[i] * s[j], ci = c[i] * s[j] + s[i] * c[j];
      const r = re[o] * cr - im[o] * ci;
      im[o] = re[o] * ci + im[o] * cr; re[o] = r;
    }
  }
}

/**
 * The Fresnel transform, in place: (re, im), centred at (n/2, n/2) with pitch dx, becomes the
 * field at z, centred likewise with pitch lambda z / (n dx), which is returned.  Right for
 * z >= z_c.  curvature = false leaves out the factor e^{ik(x^2+y^2)/2z}, a spherical wave from
 * the middle of the aperture, whose phase soon turns faster than the pixels: what is left is
 * the phase of the far field (of the Fourier transform).
 */
export function fresnel(re, im, n, dx, lambda, z, curvature = true) {
  const k = (2 * Math.PI) / lambda, p = (lambda * z) / (n * dx);
  multiplyChirp(re, im, n, dx, k / (2 * z));
  fft2Centered(re, im, n, n);
  // The transform is unitary (1/n); the integral wants n dx^2 / (i lambda z) = (dx / p) / i.
  const s = dx / p;
  for (let o = 0; o < re.length; o++) { const r = re[o]; re[o] = im[o] * s; im[o] = -r * s; }
  if (curvature) multiplyChirp(re, im, n, p, k / (2 * z));
  return p;
}

/**
 * The field at distance z of the aperture field (re0, im0) (n x n, pitch dx, centred), on the
 * grid that suits z: the aperture's own up to z_c, by the angular spectrum, and beyond it the
 * Fresnel transform's, of pitch lambda z / (n dx).  Returns {re, im, pitch}; (re0, im0) are
 * left alone.  spectrum: spectrumOf(re0, im0, n), if already known.  curvature: see fresnel().
 */
export function diffract(re0, im0, n, dx, lambda, z, { curvature = true, spectrum = null } = {}) {
  if (z <= criticalDistance(n, dx, lambda)) {
    const [Fre, Fim] = spectrum ?? spectrumOf(re0, im0, n);
    const re = Float64Array.from(Fre), im = Float64Array.from(Fim);
    transfer(re, im, n, dx, lambda, z, false);
    inverse(re, im, n);
    return { re, im, pitch: dx };
  }
  const re = Float64Array.from(re0), im = Float64Array.from(im0);
  return { re, im, pitch: fresnel(re, im, n, dx, lambda, z, curvature) };
}

/**
 * The middle row of diffract()'s field (y = 0 when the field is centred in the array) at many
 * distances: the side view, x across and z down.  Returns Float64Array(zs.length * n) of
 * intensities, row a on the pitch pitchAt(n, dx, lambda, zs[a]).  Only one row is needed, so
 * the sum over y is done first and then one 1D transform over x per distance.
 */
export function sideView(re0, im0, n, dx, lambda, zs) {
  const out = new Float64Array(zs.length * n);
  const k = (2 * Math.PI) / lambda, kx = wavenumbers(n, dx), zc = criticalDistance(n, dx, lambda);
  const ar = new Float64Array(n), ai = new Float64Array(n);
  // Up to z_c, the angular spectrum: sum over ky with the phase (-1)^j that puts y at the middle
  // row.  The transfer function at each distance is the last one times exp(i (kz - k) dz), so
  // that equal steps cost no sines.
  let F = null, Hr, Hi, Sr, Si, last = 0, step = NaN;
  // Beyond it, the Fresnel transform: sum over y' of U e^{ik y'^2/2z}, skipping dark rows.
  const rows = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) if (re0[j * n + i] !== 0 || im0[j * n + i] !== 0) { rows.push(j); break; }
  }
  zs.forEach((z, a) => {
    ar.fill(0); ai.fill(0);
    if (z <= zc) {
      if (!F) {
        F = spectrumOf(re0, im0, n);
        Hr = new Float64Array(n * n).fill(1); Hi = new Float64Array(n * n);
        Sr = new Float64Array(n * n); Si = new Float64Array(n * n);
      }
      const dz = z - last;
      if (dz !== step) {
        for (let o = 0; o < n * n; o++) { Sr[o] = 1; Si[o] = 0; }
        transfer(Sr, Si, n, dx, lambda, dz, false);
        step = dz;
      }
      last = z;
      for (let j = 0; j < n; j++) {
        const sign = j % 2 ? -1 : 1; // exp(i ky y_mid) = (-1)^j
        for (let i = 0, o = j * n; i < n; i++, o++) {
          const hr = Hr[o] * Sr[o] - Hi[o] * Si[o], hi = Hr[o] * Si[o] + Hi[o] * Sr[o];
          Hr[o] = hr; Hi[o] = hi;
          ar[i] += sign * (F[0][o] * hr - F[1][o] * hi); ai[i] += sign * (F[0][o] * hi + F[1][o] * hr);
        }
      }
      // The inverse transform over kx (sign +1), then 1/n^2.
      fft2(ar, ai, n, 1, +1);
      const inv = 1 / (n * n);
      for (let i = 0; i < n; i++) out[a * n + i] = (ar[i] * ar[i] + ai[i] * ai[i]) * inv * inv;
    } else {
      const [c, s] = chirp(n, dx, k / (2 * z));
      for (const j of rows) {
        for (let i = 0, o = j * n; i < n; i++, o++) {
          // U e^{ik(x'^2 + y'^2)/2z}: the chirp in y' now, in x' below.
          ar[i] += re0[o] * c[j] - im0[o] * s[j]; ai[i] += re0[o] * s[j] + im0[o] * c[j];
        }
      }
      for (let i = 0; i < n; i++) { const r = ar[i] * c[i] - ai[i] * s[i]; ai[i] = ar[i] * s[i] + ai[i] * c[i]; ar[i] = r; }
      fftCentered(ar, ai);
      // fftCentered is unitary (1/sqrt n) where the 2D one has 1/n; then dx / pitch as in fresnel().
      const g = (n * dx * dx) / (lambda * z) / Math.sqrt(n);
      for (let i = 0; i < n; i++) out[a * n + i] = (ar[i] * ar[i] + ai[i] * ai[i]) * g * g;
    }
  });
  return out;
}

/**
 * An aperture sampled on the n x n grid, pixel (i, j) at x = (i - n/2) dx, y = (n/2 - j) dx:
 * each pixel is the average over its area (sub x sub points), so that edges and rings fall
 * between pixels smoothly.  Sampling at pixel centres instead snaps them to the grid: a 300 um
 * square comes out 296 um wide, and a zone plate's fine rings alias, sending light to foci and
 * directions a real plate doesn't.  t(x, y) is the amplitude transmission; with phase = true,
 * it is the phase instead, NaN where the aperture is opaque.  Pixels whose four corners and
 * centre agree are taken as uniform.  Returns [re, im].
 */
export function sampleAperture(n, dx, t, { phase = false, sub = 4 } = {}) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  const add = (v, o, w) => {
    if (!phase) re[o] += v * w;
    else if (v === v) { re[o] += Math.cos(v) * w; im[o] += Math.sin(v) * w; } // NaN: opaque
  };
  // The corners, (n + 1)^2 of them, shared by neighbouring pixels.
  const m = n + 1, corner = new Float64Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) corner[j * m + i] = t((i - n / 2 - 0.5) * dx, (n / 2 - j + 0.5) * dx);
  const same = (a, b) => a === b || (a !== a && b !== b);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = j * n + i, x = (i - n / 2) * dx, y = (n / 2 - j) * dx, v = t(x, y);
      const c = j * m + i;
      if (same(v, corner[c]) && same(v, corner[c + 1]) && same(v, corner[c + m]) && same(v, corner[c + m + 1])) { add(v, o, 1); continue; }
      const w = 1 / (sub * sub);
      for (let b = 0; b < sub; b++) {
        for (let a = 0; a < sub; a++) add(t(x + ((a + 0.5) / sub - 0.5) * dx, y - ((b + 0.5) / sub - 0.5) * dx), o, w);
      }
    }
  }
  return [re, im];
}

/**
 * How many zones a Fresnel zone plate of focal length f gets on a grid of pitch dx: out to the
 * radius rmax, but none narrower than 2.5 pixels.  Zone m spans m lambda f < r^2 < (m+1) lambda f,
 * so the outermost of M is about sqrt(lambda f / M) / 2 wide.  Finer rings alias: their higher
 * harmonics (which make the foci at f/3, f/5...) fold back into spurious directions.
 */
export const zoneCount = (f, lambda, dx, rmax = 800) =>
  Math.max(2, Math.floor(Math.min(rmax ** 2 / (lambda * f), (lambda * f) / (4 * (2.5 * dx) ** 2))));
