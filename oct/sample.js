// What the light meets: layered samples (stacks of partially reflecting interfaces), 2D/3D
// scenes (curved layers of scattering tissue, a lesion, a rough surface, speckle), and the
// focused beam that scans them.  No DOM.
//
// Units: micrometres.  Depths z are geometric, measured into the sample from its front face,
// in a medium of index n: a reflector at depth z is at optical depth n z, round-trip path 2nz.
//
// A stack is { n, layers: [{ z, r }] }: interfaces at depths z with amplitude reflectivities r
// (signed: light going from a lower index to a higher one is reflected with r > 0, the other
// way with r < 0).  The light must get through every interface above a reflector, down and up,
// so the burst from interface i has amplitude r_i Π_{j<i} (1 − r_j²).

import { TWO_PI } from './source.js';

// ------------------------------------------------------------------------ random numbers

/** A small seeded generator (mulberry32): rng() in [0, 1). */
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of three integers and a seed, as a 32-bit seed for mulberry32 (the same cell always
 *  gets the same scatterers). */
export function hashCell(i, j, k, seed) {
  let h = Math.imul(i | 0, 0x9E3779B1) ^ Math.imul(j | 0, 0x85EBCA77) ^ Math.imul(k | 0, 0xC2B2AE3D) ^ Math.imul(seed | 0, 0x27D4EB2F);
  h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D); h ^= h >>> 15; h = Math.imul(h, 0x846CA68B); h ^= h >>> 16;
  return h | 0;
}

/** Two standard normal numbers (Box–Muller). */
export function gaussPair(rng, out = [0, 0]) {
  const u = 1 - rng(), v = rng(), R = Math.sqrt(-2 * Math.log(u));
  out[0] = R * Math.cos(TWO_PI * v); out[1] = R * Math.sin(TWO_PI * v);
  return out;
}

// ------------------------------------------------------------------------ stacks

/** Fresnel amplitude reflectivity at normal incidence from index n1 into n2. */
export const fresnel = (n1, n2) => (n2 - n1) / (n2 + n1);

/**
 * The layered samples: label, title (plain words), n, layers (z in μm, r), and the depth
 * (μm, geometric) the A-scan should cover.
 */
export const STACKS = {
  slide: {
    label: 'Cover slip', title: 'A microscope cover slip, 170 μm of glass (n = 1.52): a front face and a back face',
    n: 1.52, depth: 230, layers: [{ z: 0, r: fresnel(1, 1.52) }, { z: 170, r: fresnel(1.52, 1) }],
  },
  film: {
    label: 'Three-layer film', title: 'Three plastic layers laminated together (n ≈ 1.5), 30, 60 and 45 μm thick: four interfaces, the inner ones weak',
    n: 1.5, depth: 190, layers: [{ z: 0, r: 0.2 }, { z: 30, r: 0.04 }, { z: 90, r: -0.04 }, { z: 135, r: -0.2 }],
  },
  retina: {
    label: 'Retina-like stack', title: 'A stack like the retina\'s layers (n = 1.38): weak interfaces 40 to 90 μm apart, the photoreceptors and the pigment epithelium brightest',
    n: 1.38, depth: 420,
    layers: [{ z: 0, r: 0.03 }, { z: 40, r: 0.02 }, { z: 120, r: 0.015 }, { z: 160, r: 0.015 }, { z: 190, r: 0.015 },
      { z: 280, r: 0.02 }, { z: 300, r: 0.05 }, { z: 320, r: 0.07 }, { z: 340, r: 0.03 }],
  },
  pair: {
    label: 'Two surfaces', title: 'Two reflecting surfaces a settable optical distance apart (in air, n = 1): the resolution test',
    n: 1, depth: 240, gap: 8, layers: [{ z: 100, r: 0.2 }, { z: 108, r: 0.2 }],
  },
};

/** A fresh copy of a stack preset (layers in order of depth). */
export function makeStack(name, opts = {}) {
  const s = STACKS[name] || STACKS.slide;
  const st = { name, n: opts.n ?? s.n, depth: s.depth, layers: s.layers.map((l) => ({ ...l })) };
  if (name === 'pair') { st.gap = opts.gap ?? s.gap; st.layers[1].z = st.layers[0].z + st.gap / st.n; }
  return st;
}

/**
 * The bursts a stack makes: [{ D, a, z, r }] with D the round-trip path 2(offset + n z) and a the
 * amplitude r Π(1 − r_j²) over the interfaces above.  offset: the front face's distance (in air)
 * beyond the point where the two arms are equal.
 */
export function bursts(stack, offset = 0) {
  const out = [];
  let through = 1;
  for (const l of [...stack.layers].sort((p, q) => p.z - q.z)) {
    out.push({ D: 2 * (offset + stack.n * l.z), a: l.r * through, z: l.z, r: l.r });
    through *= 1 - l.r * l.r;
  }
  return out;
}

// ------------------------------------------------------------------------ the beam

/**
 * The focused beam: a Gaussian beam of waist w₀ = λ₀/(π NA) (the Gaussian-beam demo's
 * w₀ = λ f/(π w), with NA = w/f the lens's aperture over its focal length), focused at depth
 * zFocus in a medium of index n, so its Rayleigh range is z_R = π n w₀²/λ₀ and its radius at
 * depth z is w(z) = w₀ √(1 + ((z − z_f)/z_R)²).  The depth of focus is 2 z_R.
 */
export function makeBeam(src, NA, n, zFocus) {
  const w0 = src.lam0 / (Math.PI * NA), zR = (Math.PI * n * w0 * w0) / src.lam0;
  return {
    NA, n, w0, zR, zFocus,
    width(z) { const u = (z - zFocus) / zR; return w0 * Math.sqrt(1 + u * u); },
  };
}

// Gauss–Hermite quadrature across the beam, in t = √2 ρ/w: ∫ e^{−t²} f dt by five points, the
// weights normalised to 1.  The amplitude the beam gives a point ρ off its axis is e^{−2ρ²/w²}
// (out through the beam's profile and back into the same fibre), so a diffuse interface seen
// through the beam adds its power with these weights at ρ = t w/√2.
const GH_T = [-2.0201828704561, -0.9585724646138, 0, 0.9585724646138, 2.0201828704561];
const GH_W0 = [0.0199532420590, 0.3936193231522, 0.9453087204829, 0.3936193231522, 0.0199532420590];
const GH_SUM = GH_W0.reduce((a, b) => a + b, 0);
export const GH = { t: GH_T, w: GH_W0.map((w) => w / GH_SUM) };

// ------------------------------------------------------------------------ scenes

/**
 * A scene is layers of scattering material under curved interfaces, with a lesion, in a medium
 * of index n, over x (across the B-scan) and y (the second scan axis), both in μm, with z down.
 *   bands: from the top down, { name, thick, scatter (the mean amplitude of a scatterer), r (the
 *          interface's reflectivity at its top, diffuse), colour }.
 *   shape: the depth of the top interface z0(x, y) (a curve), to which the band thicknesses add.
 *   lesion: { x, y, z, rx, ry, rz, gain, rim }: an ellipsoid where the scatterers are gain times
 *           as strong (0: a fluid-filled cyst), with a diffuse rim of reflectivity rim.
 * The scene's settable parts (tilt, roughness, the lesion on or off, speckle) are options of
 * sceneAt and makeScene.
 */
export const SCENES = {
  retina: {
    label: 'Retina', title: 'Layers like the retina\'s, curved with the eye (n = 1.38), with a cyst in the inner layers',
    n: 1.38, depth: 520, halfWidth: 1000, curvature: 1 / 12000, base: 70,
    bands: [
      { name: 'nerve fibres', thick: 40, scatter: 0.040, r: 0.020, colour: '#c8a04a' },
      { name: 'ganglion cells', thick: 80, scatter: 0.022, r: 0, colour: '#8f9a5b' },
      { name: 'inner nuclear', thick: 40, scatter: 0.010, r: 0, colour: '#5f7f8f' },
      { name: 'outer plexiform', thick: 30, scatter: 0.024, r: 0, colour: '#8f8a6a' },
      { name: 'outer nuclear', thick: 90, scatter: 0.005, r: 0, colour: '#4a5a73' },
      { name: 'photoreceptors', thick: 40, scatter: 0.020, r: 0.045, colour: '#c0b070' },
      { name: 'pigment epithelium', thick: 20, scatter: 0.055, r: 0.030, colour: '#a06a3a' },
      { name: 'choroid', thick: 200, scatter: 0.018, r: 0, colour: '#8a4a4a' },
    ],
    lesion: { x: 250, y: 100, z: 140, rx: 170, ry: 140, rz: 55, gain: 0, rim: 0.015 },
  },
  onion: {
    label: 'Onion', title: 'Concentric curved shells, alternately bright and dark (n = 1.35), with a bright blob inside',
    n: 1.35, depth: 520, halfWidth: 1000, curvature: 1 / 2500, base: 60,
    bands: [
      { name: 'skin', thick: 30, scatter: 0.030, r: 0.030, colour: '#c8a04a' },
      { name: 'shell 1', thick: 70, scatter: 0.008, r: 0.025, colour: '#5f7f8f' },
      { name: 'shell 2', thick: 60, scatter: 0.028, r: 0.025, colour: '#8f9a5b' },
      { name: 'shell 3', thick: 70, scatter: 0.008, r: 0.025, colour: '#5f7f8f' },
      { name: 'shell 4', thick: 60, scatter: 0.028, r: 0.025, colour: '#8f9a5b' },
      { name: 'core', thick: 300, scatter: 0.008, r: 0.025, colour: '#4a5a73' },
    ],
    lesion: { x: -200, y: -150, z: 260, rx: 120, ry: 120, rz: 60, gain: 3, rim: 0.0 },
  },
  plate: {
    label: 'Glass plate', title: 'A 200 μm plate of glass (n = 1.5) with a scattering coat underneath: tilt it and the image tilts n times as much',
    n: 1.5, depth: 420, halfWidth: 1000, curvature: 0, base: 80,
    bands: [
      { name: 'glass', thick: 200, scatter: 0.0, r: 0.2, colour: '#7fb3d5' },
      { name: 'coat', thick: 150, scatter: 0.025, r: -0.1, colour: '#8f8a6a' },
    ],
    lesion: null,
  },
};

const SCENE_DEFAULTS = { tilt: 0, rough: 0, lesion: true, speckle: true, density: 1, seed: 1 };

/** A scene with its options: { ...preset, name, opts, zTop(x, y), tops: the depths of each band's top at (x, y) }. */
export function makeScene(name, opts = {}) {
  const p = SCENES[name] || SCENES.retina;
  const o = { ...SCENE_DEFAULTS, ...opts };
  const nb = p.bands.length;
  // The bands' thicknesses add up from the top interface.
  const cum = [0];
  for (let i = 0; i < nb; i++) cum.push(cum[i] + p.bands[i].thick);
  // Roughness: a smooth random height field, a few sinusoids across x and y.
  const rng = mulberry32(o.seed * 7919 + 17), waves = [];
  for (let i = 0; i < 6; i++) waves.push({ kx: (TWO_PI / (60 + 140 * rng())) * (rng() < 0.5 ? 1 : -1), ky: TWO_PI / (60 + 140 * rng()) * (rng() < 0.5 ? 1 : -1), ph: TWO_PI * rng() });
  const tanT = Math.tan((o.tilt * Math.PI) / 180);
  const scene = {
    ...p, name, opts: o, cum,
    /** The depth of the top interface at (x, y). */
    zTop(x, y = 0) {
      let z = p.base + p.curvature * (x * x + y * y) * 0.5 + x * tanT;
      if (o.rough > 0) { let s = 0; for (const w of waves) s += Math.sin(w.kx * x + w.ky * y + w.ph); z += o.rough * s * 0.4; }
      return z;
    },
    /** The depth of band i's top at (x, y) (i = nb: the bottom of the last band). */
    top(i, x, y = 0) { return this.zTop(x, y) + cum[i]; },
    /** Which band holds the point (x, y, z): its index, or −1 above the sample, nb below. */
    bandAt(x, y, z) {
      const u = z - this.zTop(x, y);
      if (u < 0) return -1;
      for (let i = 0; i < nb; i++) if (u < cum[i + 1]) return i;
      return nb;
    },
    /** Is (x, y, z) inside the lesion? */
    inLesion(x, y, z) {
      const L = p.lesion;
      if (!L || !o.lesion) return false;
      const a = (x - L.x) / L.rx, b = (y - L.y) / L.ry, c = (z - L.z - this.zTop(x, y) + p.base) / L.rz;
      return a * a + b * b + c * c < 1;
    },
    /** The lesion's rim crossing at (x, y): the two depths where the beam enters and leaves it, or null. */
    lesionRim(x, y = 0) {
      const L = p.lesion;
      if (!L || !o.lesion) return null;
      const a = (x - L.x) / L.rx, b = (y - L.y) / L.ry, s = 1 - a * a - b * b;
      if (s <= 0) return null;
      const h = L.rz * Math.sqrt(s), zc = L.z + this.zTop(x, y) - p.base;
      return [zc - h, zc + h];
    },
    /** The mean scatterer amplitude at (x, y, z): the band's, times the lesion's gain inside it. */
    scatterAt(x, y, z) {
      const i = this.bandAt(x, y, z);
      if (i < 0 || i >= nb) return 0;
      let s = p.bands[i].scatter;
      if (p.lesion && o.lesion && this.inLesion(x, y, z)) s *= p.lesion.gain;
      return s;
    },
  };
  return scene;
}

/**
 * The diffuse interfaces the beam meets at (x, y): [{ z, r }] from the top down (the bands'
 * tops with r ≠ 0, and the lesion's rim), each attenuated by the interfaces above it.
 */
export function interfacesAt(scene, x, y = 0) {
  const out = [];
  const nb = scene.bands.length;
  for (let i = 0; i < nb; i++) if (scene.bands[i].r) out.push({ id: i, z: scene.top(i, x, y), r: scene.bands[i].r });
  const rim = scene.lesionRim(x, y);
  if (rim && scene.lesion.rim) { out.push({ id: -2, z: rim[0], r: scene.lesion.rim }); out.push({ id: -3, z: rim[1], r: -scene.lesion.rim }); }
  out.sort((p, q) => p.z - q.z);
  let through = 1;
  for (const f of out) { f.a = f.r * through; through *= 1 - f.r * f.r; }
  return out;
}

/** The lateral cell size of the scatterers (μm): scatterers are made cell by cell from a hash. */
export const CELL = 10;

/**
 * The scatterers in the lateral cell (i, j) (x in [iC, (i+1)C), y likewise), down to the scene's
 * depth: Float64Array of [x, y, z, amplitude (signed: a random phase of 0 or π is enough for
 * speckle), ...].  count: scatterers per cell per 100 μm of depth (the density); flat: a 2D scene
 * (the B-scan view): all the scatterers of the cell at y = yc, in a strip CELL wide.
 */
export function cellScatterers(scene, i, j, { count = 24, flat = false, yc = 0 } = {}) {
  const rng = mulberry32(hashCell(i, j, 0, scene.opts.seed));
  const n = Math.round((count * scene.depth) / 100);
  const out = new Float64Array(4 * n);
  let m = 0;
  for (let q = 0; q < n; q++) {
    const x = (i + rng()) * CELL, y = flat ? yc : (j + rng()) * CELL, z = rng() * scene.depth;
    const s = scene.scatterAt(x, y, z);
    // Rayleigh-distributed amplitudes of mean s (scale s √(2/π)), with a random sign (a random
    // phase of 0 or π is enough to make speckle).
    const u = rng(), v = rng();
    if (s === 0) continue;
    const a = s * 0.7978845608 * Math.sqrt(-2 * Math.log(1 - u)) * (v < 0.5 ? -1 : 1);
    out[m++] = x; out[m++] = y; out[m++] = z; out[m++] = a;
  }
  return out.subarray(0, m);
}
