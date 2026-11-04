// The sky and its Fourier transform: units, point-source presets, pictures, the few hundred
// points that stand in for a picture in the live simulation, and the ideal visibility
//
//     V(u, v) = Σ_k I_k e^{−2πi(u l_k + v m_k)}            (points)
//            = ∫ I(l, m) e^{−2πi(u l + v m)} dl dm          (a picture: van Cittert–Zernike)
//
// on the uv grid or at one (u, v).  Directions are direction cosines (l east, m north); the
// pictures are drawn with l to the right and m up, and so is the uv plane (u right, v up).
//
// Grids: the picture occupies NS x NS pixels of size pix (its field of view FOV = NS pix),
// embedded in the middle of an N x N grid (N = 2 NS) whose transform is V on cells of
// du = 1/(N pix) = 1/(2 FOV) wavelengths: two cells per fringe of the finest structure, so the
// drawn uv plane can be zoomed without looking blocky.  Cell (p, q), row q: u = (p − N/2) du,
// v = (N/2 − q) du.

import { fft2Centered } from '../lib/fft.js';
import { makePreset, PRESETS as GALLERY } from '../fft2d/presets.js';

export const NS = 128;              // the picture
export const N = 256;               // the transform grid
const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const C = 299792458;

// ------------------------------------------------------------------ units

/** Angle units: radians per unit and the symbol. */
export const ANGLE = { deg: [DEG, '°'], arcmin: [DEG / 60, '′'], arcsec: [DEG / 3600, '″'], mas: [DEG / 3.6e6, ' mas'], uas: [DEG / 3.6e9, ' µas'] };

/**
 * The presets that set the units: the carrier, the wavelength, how to label lengths and sky
 * angles, the field of view of the sky picture (in direction cosines) and how far the uv
 * picture reaches (metres).  The physics is the same in all of them: only the labels change,
 * except for the near field, where the sources sit at a finite height z.
 */
export const UNITS = {
  bench: { label: 'Lab bench', title: 'The lab: 915 MHz (λ = 32.8 cm), antennas a few metres apart, sources far away', nu0: 915e6, len: 'm', lenScale: 1, angle: 'deg', fov: 1.0, uvMax: 6, pointScale: 0.15, nearField: false },
  benchNear: { label: 'Lab bench, near field', title: 'The lab notebook: the sources 5 m above the antennas and 3 m from the axis, with the exact distances', nu0: 915e6, len: 'm', lenScale: 1, angle: 'deg', fov: 1.25, uvMax: 4, pointScale: 3, z: 5, nearField: true },
  vla: { label: 'VLA', title: 'The Very Large Array: 5 GHz (λ = 6 cm), baselines of kilometres, a sky of arcseconds', nu0: 5e9, len: 'km', lenScale: 1e3, angle: 'arcsec', fov: 20 * ANGLE.arcsec[0], uvMax: 36e3, pointScale: 5 * ANGLE.arcsec[0], nearField: false },
  // (The ring picture is 0.216 of the field across: 42 µas, as M87*'s, in a field of 194 µas.)
  eht: { label: 'EHT', title: 'The Event Horizon Telescope: 230 GHz (λ = 1.3 mm), baselines across the Earth, a sky of microarcseconds', nu0: 230e9, len: 'km', lenScale: 1e3, angle: 'uas', fov: 194 * ANGLE.uas[0], uvMax: 13e6, pointScale: 40 * ANGLE.uas[0], nearField: false },
};
export const wavelength = (nu0) => C / nu0;

/** An angle (a direction cosine, treated as sin θ) in the preset's unit. */
export function angleIn(units, l) {
  const [per] = ANGLE[units.angle];
  return (units.angle === 'deg' ? Math.asin(Math.max(-1, Math.min(1, l))) : l) / per;
}
/** The direction cosine of an angle given in the preset's unit. */
export function angleFrom(units, a) {
  const [per] = ANGLE[units.angle];
  return units.angle === 'deg' ? Math.sin(a * per) : a * per;
}

// ------------------------------------------------------------------ point sources

/**
 * Point-source layouts on the unit circle: [x, y, brightness].  `pentagon10` is the lab
 * notebook's pentagon turned by 10°, with a point at the top as there.
 */
export const POINT_PRESETS = {
  one: { label: 'One', title: 'A single point source straight up: the same correlation at every separation', points: [[0, 0, 1]] },
  offset: { label: 'One, off-centre', title: 'A single point source off to one side: the size of its correlation is the same everywhere, and its phase winds with the separation', points: [[0.75, 0.4, 1]] },
  binary: { label: 'Binary', title: 'Two points of unequal brightness: the correlation beats as the baseline grows', points: [[-0.5, 0, 1], [0.5, 0, 0.6]] },
  line: { label: 'Line of 4', title: 'Four points in a line, as in the lab', points: [[-0.75, 0, 1], [-0.25, 0, 1], [0.25, 0, 1], [0.75, 0, 1]] },
  triangle: { label: 'Triangle', title: 'An equilateral triangle, point up', points: ring(3, 0) },
  triangleDown: { label: 'Triangle, turned', title: 'The same triangle turned 180°: the same |V|, the opposite phase', points: ring(3, 180) },
  pentagon: { label: 'Pentagon', title: "The lab's pentagon of five sources, one at the top", points: ring(5, 0) },
  pentagon10: { label: 'Pentagon, turned 10°', title: "The lab notebook's rotated pentagon", points: ring(5, 10) },
  hexagon: { label: 'Hexagon', title: 'Six points on a ring', points: ring(6, 0) },
};
function ring(n, deg) {
  return Array.from({ length: n }, (_, k) => { const a = (TWO_PI * k) / n + deg * DEG; return [Math.sin(a), Math.cos(a), 1]; });
}

/**
 * The sources of a point preset: {l, m, I} in the far field (the layout scaled by `scale`
 * direction cosines, turned by `rotation` radians, brightnesses times `bright`), or {x, y, z, I}
 * in metres for the near field (scale in metres at height z).
 */
export function pointSources(preset, { scale = 0.3, rotation = 0, bright = 1, z = null } = {}) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return POINT_PRESETS[preset].points.map(([x, y, I]) => {
    const X = scale * (x * c - y * s), Y = scale * (x * s + y * c);
    return z ? { x: X, y: Y, z, I: I * bright } : { l: X, m: Y, I: I * bright };
  });
}

// ------------------------------------------------------------------ pictures

export const PICTURES = {
  disk: { label: 'Disk', title: 'A uniform disk: its transform is the Airy pattern, rings around a bright centre, the first dark ring at 1.22/diameter' },
  ring: { label: 'Ring', title: 'A thin ring, like the one around the black hole in M87: its transform rings too (a Bessel function)' },
  galaxy: { label: 'Galaxy', title: 'A bulge with two spiral arms: smooth, so its transform is concentrated near the origin' },
  portrait: { label: 'Fourier', title: 'Joseph Fourier, engraved by Geille after a drawing by J. Boilly (public domain)' },
  own: { label: 'Your picture', title: 'A picture of your own: choose a file, drop one on the sky, or paste one' },
};

/** A picture NS x NS, brightness ≥ 0 scaled to a total of 1.  Resolves to a Float64Array. */
export async function pictureSky(id, size = 1, image = null) {
  let re;
  if (id === 'galaxy') re = galaxy(NS, size);
  else if (id === 'own' && image) re = image;
  else {
    const p = GALLERY.find((g) => g.id === id) || GALLERY.find((g) => g.id === 'disk');
    const q = p.image ? { ...p, image: `../fft2d/${p.image}` } : p;
    [re] = await makePreset(q, NS, p.id === 'disk' ? 0.8 * size : p.id === 'ring' ? 0.6 * size : size);
  }
  return normalise(re);
}

export function normalise(re) {
  const sky = Float64Array.from(re, (v) => (v > 0 ? v : 0));
  let total = 0;
  for (let i = 0; i < sky.length; i++) total += sky[i];
  if (total > 0) for (let i = 0; i < sky.length; i++) sky[i] /= total;
  return sky;
}

/** A galaxy-looking thing: an elliptical bulge and two spiral arms, in an n x n picture. */
export function galaxy(n, size = 1) {
  const out = new Float64Array(n * n), R = 0.28 * n * size, h = n / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - h) / R, y = (h - j) / R;
    // The disk tilted 50°, turned 30°.
    const c = Math.cos(30 * DEG), s = Math.sin(30 * DEG);
    const X = x * c + y * s, Y = (-x * s + y * c) / Math.cos(50 * DEG);
    const r = Math.hypot(X, Y), th = Math.atan2(Y, X);
    const bulge = 1.2 * Math.exp(-(r * r) / (2 * 0.12 * 0.12)) + 0.35 * Math.exp(-r / 0.5);
    let arms = 0;
    for (const a0 of [0, Math.PI]) {
      const d = ((th - a0 - 2.2 * Math.log(r + 1e-9) + 20 * Math.PI) % TWO_PI) - Math.PI;
      arms += Math.exp(-(d * d) / (2 * 0.3 * 0.3)) * Math.exp(-r / 0.9) * (r > 0.15 ? 1 : r / 0.15);
    }
    out[j * n + i] = r < 1.6 ? (bulge + 0.45 * arms) * Math.exp(-((r / 1.3) ** 4)) : 0;
  }
  return out;
}

/** Grey levels NS x NS of an image element, the largest centred square. */
export function imageToSky(img) {
  const c = document.createElement('canvas');
  c.width = c.height = NS;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, side = Math.min(w, h);
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, NS, NS);
  const d = ctx.getImageData(0, 0, NS, NS).data, out = new Float64Array(NS * NS);
  for (let i = 0; i < NS * NS; i++) out[i] = (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 765;
  return out;
}

/**
 * The points that stand in for a picture in the live simulation: `count` pixels drawn from the
 * brightness (importance sampling, with replacement), each with the same share of the flux, so
 * that their V is an unbiased estimate of the picture's.  Returns {l, m, I} sources.
 */
export function samplePoints(sky, pix, count, random = Math.random) {
  const n = NS, cdf = new Float64Array(sky.length);
  let acc = 0;
  for (let i = 0; i < sky.length; i++) { acc += sky[i]; cdf[i] = acc; }
  if (acc === 0) return [];
  const out = [];
  for (let k = 0; k < count; k++) {
    const r = random() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
    const i = lo % n, j = (lo - i) / n;
    // Spread within the pixel, so a smooth picture is not a lattice.
    out.push({ l: (i - n / 2 + random()) * pix, m: (n / 2 - j - random()) * pix, I: acc / count });
  }
  return out;
}

// ------------------------------------------------------------------ the ideal V

/**
 * V on the N x N uv grid (cells du = 1/(N pix)) for a sky model: {kind: 'points', sources}
 * (closed form on the grid: the direction cosines of each source, whatever its distance) or
 * {kind: 'picture', sky} (the picture's centred transform, scaled so that V(0, 0) = the total).
 * Returns {re, im}.
 */
export function idealGrid(model, pix, directions) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N), du = 1 / (N * pix), h = N / 2;
  if (model.kind === 'picture') {
    const o = (N - NS) / 2;
    for (let j = 0; j < NS; j++) for (let i = 0; i < NS; i++) re[(j + o) * N + i + o] = model.sky[j * NS + i];
    fft2Centered(re, im, N, N, false);
    for (let i = 0; i < re.length; i++) { re[i] *= N; im[i] *= N; }
    return { re, im, du };
  }
  // Separable: e^{−2πi(ul + vm)} = e^{−2πiul} e^{−2πivm}, one row and one column per source.
  const cu = new Float64Array(N), su = new Float64Array(N), cv = new Float64Array(N), sv = new Float64Array(N);
  model.sources.forEach((s, k) => {
    const [l, m] = directions(k), I = s.I;
    for (let p = 0; p < N; p++) { const a = -TWO_PI * (p - h) * du * l; cu[p] = Math.cos(a); su[p] = Math.sin(a); }
    for (let q = 0; q < N; q++) { const a = -TWO_PI * (h - q) * du * m; cv[q] = I * Math.cos(a); sv[q] = I * Math.sin(a); }
    for (let q = 0; q < N; q++) {
      const c = cv[q], d = sv[q], row = q * N;
      for (let p = 0; p < N; p++) { re[row + p] += cu[p] * c - su[p] * d; im[row + p] += cu[p] * d + su[p] * c; }
    }
  });
  return { re, im, du };
}

/** V at one (u, v), exactly: the closed form for points, the sum over the picture's pixels. */
export function idealAt(model, pix, directions, u, v) {
  let re = 0, im = 0;
  if (model.kind === 'picture') {
    const sky = model.sky, h = NS / 2;
    const cu = new Float64Array(NS), su = new Float64Array(NS);
    for (let i = 0; i < NS; i++) { const a = -TWO_PI * u * (i - h) * pix; cu[i] = Math.cos(a); su[i] = Math.sin(a); }
    for (let j = 0; j < NS; j++) {
      const a = -TWO_PI * v * (h - j) * pix, c = Math.cos(a), s = Math.sin(a);
      let rr = 0, ri = 0;
      for (let i = 0; i < NS; i++) { const I = sky[j * NS + i]; if (I) { rr += I * cu[i]; ri += I * su[i]; } }
      re += rr * c - ri * s; im += rr * s + ri * c;
    }
    return [re, im];
  }
  model.sources.forEach((s, k) => {
    const [l, m] = directions(k), a = -TWO_PI * (u * l + v * m);
    re += s.I * Math.cos(a); im += s.I * Math.sin(a);
  });
  return [re, im];
}

/**
 * V at display resolution: w x h pixels covering u in [−umax, umax] and v likewise (v up), into
 * re, im (w*h), exactly: the closed form for points; for a picture, its direct transform, done
 * separably (each row of the picture against every u, then every v): NS²w + NS w h products.
 */
export function idealWindow(model, pix, directions, grid, umax, w, h, re, im) {
  re.fill(0); im.fill(0);
  if (model.kind === 'picture') {
    const sky = model.sky, hS = NS / 2;
    // Row transforms: R[j][x] = Σ_i I(i, j) e^{−2πi u_x l_i}.
    const Rr = new Float64Array(NS * w), Ri = new Float64Array(NS * w), cs = new Float64Array(NS), sn = new Float64Array(NS);
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5 - w / 2) / w) * 2 * umax;
      for (let i = 0; i < NS; i++) { const a = -TWO_PI * u * (i - hS) * pix; cs[i] = Math.cos(a); sn[i] = Math.sin(a); }
      for (let j = 0; j < NS; j++) {
        let sr = 0, si = 0;
        const row = j * NS;
        for (let i = 0; i < NS; i++) { const I = sky[row + i]; if (I) { sr += I * cs[i]; si += I * sn[i]; } }
        Rr[j * w + x] = sr; Ri[j * w + x] = si;
      }
    }
    // Then V(u_x, v_y) = Σ_j R[j][x] e^{−2πi v_y m_j}, m_j = (NS/2 − j) pix.
    for (let y = 0; y < h; y++) {
      const v = ((h / 2 - y - 0.5) / h) * 2 * umax, row = y * w;
      for (let j = 0; j < NS; j++) {
        const a = -TWO_PI * v * (hS - j) * pix, c = Math.cos(a), s = Math.sin(a), o = j * w;
        for (let x = 0; x < w; x++) { const pr = Rr[o + x], pi = Ri[o + x]; re[row + x] += pr * c - pi * s; im[row + x] += pr * s + pi * c; }
      }
    }
    return;
  }
  const cu = new Float64Array(w), su = new Float64Array(w), cv = new Float64Array(h), sv = new Float64Array(h);
  model.sources.forEach((s, k) => {
    const [l, m] = directions(k), I = s.I;
    for (let x = 0; x < w; x++) { const a = -TWO_PI * ((x + 0.5 - w / 2) / w) * 2 * umax * l; cu[x] = Math.cos(a); su[x] = Math.sin(a); }
    for (let y = 0; y < h; y++) { const a = -TWO_PI * ((h / 2 - y - 0.5) / h) * 2 * umax * m; cv[y] = I * Math.cos(a); sv[y] = I * Math.sin(a); }
    for (let y = 0; y < h; y++) {
      const c = cv[y], d = sv[y], row = y * w;
      for (let x = 0; x < w; x++) { re[row + x] += cu[x] * c - su[x] * d; im[row + x] += cu[x] * d + su[x] * c; }
    }
  });
}

/** The picture (NS x NS) of point sources, each a small Gaussian blob, for the sampled-sky grids. */
export function pointsToGrid(sources, directions, pix) {
  const sky = new Float64Array(NS * NS), h = NS / 2, sig = 0.9;
  sources.forEach((s, k) => {
    const [l, m] = directions(k), ci = h + l / pix, cj = h - m / pix;
    for (let j = Math.max(0, Math.floor(cj - 3)); j <= Math.min(NS - 1, Math.ceil(cj + 3)); j++) for (let i = Math.max(0, Math.floor(ci - 3)); i <= Math.min(NS - 1, Math.ceil(ci + 3)); i++) {
      sky[j * NS + i] += (s.I * Math.exp(-((i - ci) ** 2 + (j - cj) ** 2) / (2 * sig * sig))) / (TWO_PI * sig * sig);
    }
  });
  return sky;
}

/** Total brightness of a model. */
export function totalFlux(model) {
  if (model.kind === 'picture') { let t = 0; for (const v of model.sky) t += v; return t; }
  return model.sources.reduce((a, s) => a + s.I, 0);
}
