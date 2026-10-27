// Aperture synthesis: dishes on the rotating Earth sample the Fourier transform of the sky.
//
// Each pair of dishes (a baseline B, in metres) measures one complex number per moment, the
// visibility V(u, v) = int I(l, m) exp(-2 pi i (u l + v m)) dl dm, where (u, v) is the baseline as
// seen from the source, in wavelengths, and (l, m) are small angles on the sky (l east, m north).
// As the Earth turns, (u, v) moves along an ellipse.  With the baseline in equatorial
// coordinates (X towards hour angle 0 on the equator, Y towards the east, Z to the north pole),
// a source at hour angle H and declination dec gives (Thompson, Moran and Swenson, eq. 4.1)
//
//     u =  sin H X + cos H Y
//     v = -sin dec cos H X + sin dec sin H Y + cos dec Z
//     w =  cos dec cos H X - cos dec sin H Y + sin dec Z      (along the line of sight)
//
// so u^2 + ((v - Z cos dec) / sin dec)^2 = X^2 + Y^2: an ellipse of axis ratio sin dec.
//
// The dishes are placed on a map of the ground: east and north, in metres, from a point at
// latitude lat0 (and longitude 0, the meridian where H is measured).  The map is an azimuthal
// equidistant projection of a spherical Earth, so for a local array it is simply flat ground,
// and an Earth-sized array is placed on the globe correctly.  Each dish sees the source only
// while it is more than ELMIN above its own horizon.
//
// The image: the sky is an n x n grid of pixels of angular size pix; its discrete Fourier
// transform gives V on a grid of spacing du = 1 / (n pix) wavelengths.  Each (u, v) sample is
// put on the nearest grid point (and its mirror, -u, -v, since the sky is real); the dirty
// beam is the transform of these samples, the dirty image the transform of the sampled V, so
//     dirty image = sky (*) dirty beam      (circular convolution on the grid, exactly).

import { fft2, fft2Centered } from '../lib/fft.js';

export const R_EARTH = 6371e3;
export const ELMIN = (10 * Math.PI) / 180;
const DEG = Math.PI / 180;
const HOUR = Math.PI / 12;      // one hour of hour angle, in radians

// ------------------------------------------------------------------ the Earth

/** A point on the map (east, north metres from the centre at latitude lat0) to Earth-centred
 *  X, Y, Z in metres (X towards latitude 0 on the reference meridian, Z to the north pole). */
export function stationXYZ(E, N, lat0) {
  const cl = Math.cos(lat0), sl = Math.sin(lat0), s = Math.hypot(E, N);
  if (s === 0) return [R_EARTH * cl, 0, R_EARTH * sl];
  const c = s / R_EARTH, sc = Math.sin(c), cc = Math.cos(c), tE = E / s, tN = N / s;
  // Up = (cl, 0, sl), East = (0, 1, 0), North = (-sl, 0, cl); P = R (cos c Up + sin c t^).
  return [R_EARTH * (cc * cl - sc * tN * sl), R_EARTH * sc * tE, R_EARTH * (cc * sl + sc * tN * cl)];
}

/** The inverse: a point on the globe to its place on the map. */
export function mapPosition(P, lat0) {
  const cl = Math.cos(lat0), sl = Math.sin(lat0), r = Math.hypot(...P);
  const p = P.map((v) => v / r);
  const cosc = p[0] * cl + p[2] * sl;
  const tE = p[1], tN = -p[0] * sl + p[2] * cl, t = Math.hypot(tE, tN);   // t = sin c
  const c = Math.atan2(t, cosc);
  if (t < 1e-15) return [0, c > 1 ? -Math.PI * R_EARTH : 0];
  return [(c * R_EARTH * tE) / t, (c * R_EARTH * tN) / t];
}

/** Earth-centred position of a place at latitude, longitude (degrees). */
export function siteXYZ(lat, lon) {
  return [R_EARTH * Math.cos(lat * DEG) * Math.cos(lon * DEG), R_EARTH * Math.cos(lat * DEG) * Math.sin(lon * DEG), R_EARTH * Math.sin(lat * DEG)];
}

/** (u, v, w) of the baseline (X, Y, Z) for a source at hour angle H, declination dec (radians). */
export function uvw(X, Y, Z, H, dec) {
  const sH = Math.sin(H), cH = Math.cos(H), sd = Math.sin(dec), cd = Math.cos(dec);
  return [sH * X + cH * Y, -sd * cH * X + sd * sH * Y + cd * Z, cd * cH * X - cd * sH * Y + sd * Z];
}

/** Sine of the source's elevation seen from the place P (Earth-centred) at hour angle H. */
export function sinElevation(P, H, dec) {
  const r = Math.hypot(...P), cd = Math.cos(dec);
  return (cd * Math.cos(H) * P[0] - cd * Math.sin(H) * P[1] + Math.sin(dec) * P[2]) / r;
}

/**
 * The tracks of every baseline in the uv plane, in metres (divide by the wavelength for u, v).
 *   pos     Earth-centred positions of the dishes
 *   dec     declination; hours: the length of the observation, centred on transit (H = 0)
 *   steps   samples along the track (one, at H = 0, when hours = 0)
 * Returns { H, nb, pairs, u, v, ok, up } with u, v, ok of length nb * steps (baseline-major).
 */
export function tracks(pos, { dec, hours, steps = 241, elMin = ELMIN }) {
  const ns = pos.length, nt = hours > 0 ? steps : 1;
  const H = Float64Array.from({ length: nt }, (_, k) => (nt === 1 ? 0 : (-hours / 2 + (hours * k) / (nt - 1)) * HOUR));
  const up = new Uint8Array(ns * nt), smin = Math.sin(elMin);
  for (let a = 0; a < ns; a++) for (let k = 0; k < nt; k++) up[a * nt + k] = sinElevation(pos[a], H[k], dec) > smin ? 1 : 0;
  const pairs = [];
  for (let a = 0; a < ns; a++) for (let b = a + 1; b < ns; b++) pairs.push([a, b]);
  const nb = pairs.length, u = new Float64Array(nb * nt), v = new Float64Array(nb * nt), ok = new Uint8Array(nb * nt);
  const sd = Math.sin(dec), cd = Math.cos(dec);
  pairs.forEach(([a, b], p) => {
    const X = pos[b][0] - pos[a][0], Y = pos[b][1] - pos[a][1], Z = pos[b][2] - pos[a][2];
    for (let k = 0; k < nt; k++) {
      const sH = Math.sin(H[k]), cH = Math.cos(H[k]), o = p * nt + k;
      u[o] = sH * X + cH * Y;
      v[o] = -sd * cH * X + sd * sH * Y + cd * Z;
      ok[o] = up[a * nt + k] & up[b * nt + k];
    }
  });
  return { H, nt, nb, pairs, u, v, ok, up };
}

// ------------------------------------------------------------------ gridding and imaging

/**
 * Put the samples (up to time index upto) on the n x n grid of spacing du (wavelengths per
 * cell, = 1 / field of view).  Grid index (p, q), row q: u = (p - n/2) du, v = (n/2 - q) du, so
 * the grid drawn as an image has u to the right and v up, like the sky.
 *   weighting  'natural' (each sample counts) or 'uniform' (each sampled cell counts once)
 * Returns { S, samples, dropped }: samples on the grid, and samples beyond its edge.
 */
export function gridSamples(tr, lambda, n, du, { upto = Infinity, weighting = 'natural' } = {}) {
  const S = new Float64Array(n * n), h = n / 2, lim = h - 1, inv = 1 / (lambda * du);
  let samples = 0, dropped = 0;
  const kmax = Math.min(tr.nt - 1, upto);
  for (let p = 0; p < tr.nb; p++) {
    for (let k = 0; k <= kmax; k++) {
      const o = p * tr.nt + k;
      if (!tr.ok[o]) continue;
      const a = Math.round(tr.u[o] * inv), b = Math.round(tr.v[o] * inv);
      if (Math.abs(a) > lim || Math.abs(b) > lim) { dropped++; continue; }
      // The sample and its mirror image at (-u, -v): the sky is real, so V(-u,-v) = V(u,v)*.
      S[(h - b) * n + h + a] += 1;
      S[(h + b) * n + h - a] += 1;
      samples++;
    }
  }
  if (weighting === 'uniform') for (let i = 0; i < S.length; i++) S[i] = S[i] > 0 ? 1 : 0;
  return { S, samples, dropped };
}

/** The dirty beam: the transform of the sampling, real, 1 at the centre pixel (n/2, n/2). */
export function dirtyBeam(S, n) {
  const re = Float64Array.from(S), im = new Float64Array(n * n);
  fft2Centered(re, im, n, n, true);
  const c = re[(n / 2) * n + n / 2];
  if (c > 0) for (let i = 0; i < re.length; i++) re[i] /= c;
  return re;
}

/** The visibilities of the whole sky on the grid: its centred transform (unnormalised). */
export function skyTransform(sky, n) {
  const re = Float64Array.from(sky), im = new Float64Array(n * n);
  fft2Centered(re, im, n, n, false);
  for (let i = 0; i < re.length; i++) { re[i] *= n; im[i] *= n; }
  return { re, im };
}

/** The dirty image: the sampled visibilities transformed back, in units where a point
 *  source of flux F peaks at F (Jy per beam).  Equal to sky (*) dirtyBeam(S). */
export function dirtyImage(S, V, n) {
  let W = 0;
  for (let i = 0; i < S.length; i++) W += S[i];
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  if (W === 0) return re;
  for (let i = 0; i < re.length; i++) { re[i] = S[i] * V.re[i]; im[i] = S[i] * V.im[i]; }
  fft2Centered(re, im, n, n, true);
  const s = n / W;
  for (let i = 0; i < re.length; i++) re[i] *= s;
  return re;
}

// ------------------------------------------------------------------ CLEAN

/** Start a CLEAN: the residual is the dirty image, the model empty. */
export function cleanStart(dirty) {
  return { residual: Float64Array.from(dirty), model: new Float64Array(dirty.length), iterations: 0, components: 0, done: false };
}

/**
 * Hogbom's CLEAN: find the brightest pixel of the residual (in absolute value), put gain times
 * it into the model there, and subtract that much of the dirty beam centred there.  Repeat.
 * Stops after `steps` iterations or when the peak falls below `threshold`.  Returns the state.
 */
export function cleanSteps(cs, beam, n, { gain = 0.1, steps = 1, threshold = 0 } = {}) {
  const R = cs.residual, M = cs.model, h = n / 2;
  // The brightest pixel (kept from the last pass, which finds it while subtracting).
  let best = cs.peak ?? -1, bv = best >= 0 ? Math.abs(R[best]) : 0;
  if (best < 0) for (let i = 0; i < R.length; i++) { const a = Math.abs(R[i]); if (a > bv) { bv = a; best = i; } }
  for (let s = 0; s < steps; s++) {
    if (bv <= threshold || bv === 0) { cs.done = true; break; }
    const g = gain * R[best], i0 = best % n, j0 = (best - i0) / n;
    if (M[best] === 0) cs.components++;
    M[best] += g;
    // R(i, j) -= g B(i - i0 + n/2, j - j0 + n/2), indices mod n, finding the next peak too.
    const off = (h - i0 + n) % n, cut = n - off;
    bv = 0;
    for (let j = 0; j < n; j++) {
      const rrow = j * n, brow = (((j - j0 + h) % n + n) % n) * n;
      for (let i = 0; i < cut; i++) {
        const v = (R[rrow + i] -= g * beam[brow + i + off]), a = v < 0 ? -v : v;
        if (a > bv) { bv = a; best = rrow + i; }
      }
      for (let i = cut; i < n; i++) {
        const v = (R[rrow + i] -= g * beam[brow + i - cut]), a = v < 0 ? -v : v;
        if (a > bv) { bv = a; best = rrow + i; }
      }
    }
    cs.iterations++;
  }
  cs.peak = best;
  cs.peakValue = bv;
  return cs;
}

/**
 * The clean beam: an elliptical Gaussian fitted to the main lobe of the dirty beam (the pixels
 * above 0.35 connected to the centre), exp(-(a x^2 + 2 b x y + c y^2)) in pixels (x right, y
 * down).  Returns { a, b, c, major, minor, angle }: the full widths at half maximum in pixels,
 * and the direction of the major axis, (cos angle, sin angle) in those coordinates.
 */
export function fitBeam(beam, n) {
  const h = n / 2, seen = new Uint8Array(n * n), stack = [h * n + h];
  seen[h * n + h] = 1;
  // Weighted least squares for ln B = -(a x^2 + 2 b xy + c y^2): rows (x^2, 2xy, y^2), weight B^2.
  const N = [0, 0, 0, 0, 0, 0], r = [0, 0, 0];
  let count = 0;
  const limit = (n * n) / 8;
  while (stack.length && count < limit) {
    const o = stack.pop(), i = o % n, j = (o - i) / n, x = i - h, y = j - h, B = beam[o];
    if (o !== h * n + h) {
      const w = B * B, L = -Math.log(B), f = [x * x, 2 * x * y, y * y];
      N[0] += w * f[0] * f[0]; N[1] += w * f[0] * f[1]; N[2] += w * f[0] * f[2];
      N[3] += w * f[1] * f[1]; N[4] += w * f[1] * f[2]; N[5] += w * f[2] * f[2];
      for (let k = 0; k < 3; k++) r[k] += w * f[k] * L;
      count++;
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const q = jj * n + ii;
      if (seen[q] || beam[q] < 0.35) continue;
      seen[q] = 1; stack.push(q);
    }
  }
  let sol = count >= 3 ? solve3([[N[0], N[1], N[2]], [N[1], N[3], N[4]], [N[2], N[4], N[5]]], r) : null;
  const narrowest = Math.log(2) / 0.25;    // a FWHM of one pixel
  if (!sol) sol = [narrowest, 0, narrowest];
  let [a, b, c] = sol;
  // Eigenvalues of [[a, b], [b, c]]: keep them positive, and the widths between a pixel and a
  // quarter of the image (a single fringe has no width along its crests).
  const mean = (a + c) / 2, dev = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const lmin = (4 * Math.log(2)) / (n / 4) ** 2;
  const l1 = Math.min(narrowest, Math.max(lmin, mean + dev)), l2 = Math.min(narrowest, Math.max(lmin, mean - dev));
  const ang = 0.5 * Math.atan2(2 * b, a - c);   // the narrow axis (eigenvalue l1)
  const ca = Math.cos(ang), sa = Math.sin(ang);
  a = l1 * ca * ca + l2 * sa * sa; c = l1 * sa * sa + l2 * ca * ca; b = (l1 - l2) * ca * sa;
  const fw = (l) => 2 * Math.sqrt(Math.log(2) / l);
  // stripes: the main lobe has no end along one direction (one baseline, or one line of them).
  return { a, b, c, major: fw(l2), minor: fw(l1), angle: ang + Math.PI / 2, stripes: l2 <= lmin * 1.0001 };
}

function solve3(A, r) {
  const m = A.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;
    if (Math.abs(m[p][c]) < 1e-300) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let i = 0; i < 3; i++) {
      if (i === c) continue;
      const f = m[i][c] / m[c][c];
      for (let k = c; k < 4; k++) m[i][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** The restored image: the CLEAN components convolved with the clean beam, plus the residual. */
let kernel = null;
export function restore(cs, fit, n) {
  const h = n / 2;
  if (!kernel || kernel.fit !== fit || kernel.n !== n) {
    // The Gaussian with its peak at index (0, 0), wrapped, and its transform (kept).
    const gr = new Float64Array(n * n), gi = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      const y = j < h ? j : j - n;
      for (let i = 0; i < n; i++) {
        const x = i < h ? i : i - n;
        const e = fit.a * x * x + 2 * fit.b * x * y + fit.c * y * y;
        gr[j * n + i] = e < 50 ? Math.exp(-e) : 0;
      }
    }
    fft2(gr, gi, n, n, -1);
    kernel = { fit, n, gr, gi };
  }
  const { gr, gi } = kernel;
  const mr = Float64Array.from(cs.model), mi = new Float64Array(n * n);
  fft2(mr, mi, n, n, -1);
  for (let i = 0; i < mr.length; i++) {
    const a = mr[i] * gr[i] - mi[i] * gi[i], b = mr[i] * gi[i] + mi[i] * gr[i];
    mr[i] = a; mi[i] = b;
  }
  fft2(mr, mi, n, n, +1);
  const out = new Float64Array(n * n), inv = 1 / (n * n);
  for (let i = 0; i < out.length; i++) out[i] = mr[i] * inv + cs.residual[i];
  return out;
}

// ------------------------------------------------------------------ arrays of dishes

/** Distances between dishes: the longest and the shortest baseline (Earth-centred positions). */
export function baselineRange(pos) {
  let lo = Infinity, hi = 0;
  for (let a = 0; a < pos.length; a++) for (let b = a + 1; b < pos.length; b++) {
    const d = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return [lo === Infinity ? 0 : lo, hi];
}

// Sites of the Event Horizon Telescope (2018), latitude and longitude in degrees, rounded.
export const EHT_SITES = [
  ['ALMA', -23.029, -67.755], ['APEX', -23.006, -67.759], ['LMT', 18.986, -97.315],
  ['SMT', 32.702, -109.891], ['JCMT', 19.823, -155.477], ['SMA', 19.824, -155.478],
  ['IRAM 30m', 37.066, -3.393], ['SPT', -90, 0], ['GLT', 76.535, -68.686],
];
export const EHT_CENTRE = { lat: 10, lon: -70 };

/**
 * Preset layouts, as [east, north] metres (and names for the EHT).
 *   two    two dishes about 630 m apart
 *   line   eight dishes on an east-west line at the marks of a Golomb ruler (0 1 4 9 15 22 32
 *          34): every one of the 28 spacings is different
 *   y      a Y like the Very Large Array: 9 dishes on each of three arms at azimuths 355, 115
 *          and 235 degrees, at distances growing as (k + 1/2)^1.716 out to `arm` metres (arm
 *          600 m is about the VLA's D configuration, 1950 m its C, 6400 m B, 21 km A)
 *   eht    the Event Horizon Telescope's sites, on the map centred at EHT_CENTRE
 */
export function layout(kind, { arm = 1950, unit = 72 } = {}) {
  if (kind === 'two') return { dishes: [[-300, -100], [300, 100]] };
  if (kind === 'line') return { dishes: [0, 1, 4, 9, 15, 22, 32, 34].map((m) => [(m - 17) * unit, 0]) };
  if (kind === 'y') {
    const dishes = [];
    for (const az of [355, 115, 235]) {
      for (let k = 1; k <= 9; k++) {
        const r = arm * ((k + 0.5) / 9.5) ** 1.716;
        dishes.push([r * Math.sin(az * DEG), r * Math.cos(az * DEG)]);
      }
    }
    return { dishes };
  }
  if (kind === 'eht') {
    const lat0 = EHT_CENTRE.lat * DEG;
    return {
      dishes: EHT_SITES.map(([, la, lo]) => mapPosition(siteXYZ(la, lo - EHT_CENTRE.lon), lat0)),
      names: EHT_SITES.map((s) => s[0]),
    };
  }
  throw new Error(`no layout ${kind}`);
}
