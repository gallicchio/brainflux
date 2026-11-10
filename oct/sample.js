// What the light meets: layered samples (stacks of partially reflecting interfaces), 2D/3D
// scenes (curved layers of scattering tissue, a lesion, a rough surface, speckle), and the
// focused beam that scans them.  No DOM.
//
// Units: micrometres.  Depths z are geometric, measured into the sample from its front face,
// in a medium of index n: a reflector at depth z is at optical depth n z, round-trip path 2nz.
//
// A stack is { n, layers: [{ z, r }] }: interfaces at depths z with amplitude reflectivities r
// (signed, and measured against the reference mirror's reflection: the Fresnel coefficient at
// normal incidence is (n₁ − n₂)/(n₁ + n₂), negative where the index rises, and the metal reference
// mirror's is −1, so relative to it a face where the index rises has r > 0, one where it falls
// r < 0; only this relative sign shows in the fringes).  The light must get through every
// interface above a reflector, down and up, so the burst from interface i has amplitude
// r_i Π_{j<i} (1 − r_j²).

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

/** The Fresnel amplitude reflectivity at normal incidence from index n1 into n2, (n1 − n2)/(n1 + n2),
 *  divided by the reference mirror's −1 (see the top of this file). */
export const fresnel = (n1, n2) => (n2 - n1) / (n2 + n1);

/**
 * The layered samples: label, title (plain words), n, layers (z in μm, r), and the depth
 * (μm, geometric) the A-scan should cover.
 */
export const STACKS = {
  one: {
    label: 'One surface', title: 'One glass surface (r = 0.2): one fringe frequency in the spectrum, one peak in its transform',
    n: 1, depth: 0, fdOnly: true, layers: [{ z: 0, r: 0.2, name: 'surface' }],
  },
  slide: {
    label: 'Cover slip', title: 'A microscope cover slip, 170 μm of glass (n = 1.52): a front face and a back face',
    n: 1.52, depth: 230, layers: [{ z: 0, r: fresnel(1, 1.52), name: 'front face' }, { z: 170, r: fresnel(1.52, 1), name: 'back face' }],
  },
  film: {
    label: 'Three-layer film', title: 'Three plastic layers laminated together (n ≈ 1.5), 30, 60 and 45 μm thick: four interfaces, the two inside weak',
    n: 1.5, depth: 190, layers: [{ z: 0, r: 0.2, name: 'front' }, { z: 30, r: 0.04, name: 'first bond' }, { z: 90, r: -0.04, name: 'second bond' }, { z: 135, r: -0.2, name: 'back' }],
  },
  retina: {
    label: 'Retina-like stack', title: 'A stack like the retina\'s layers (n = 1.38): nine weak interfaces, the deepest ones (the photoreceptors and the pigment epithelium) brightest',
    n: 1.38, depth: 420,
    layers: [{ z: 0, r: 0.03, name: 'inner limiting membrane' }, { z: 40, r: 0.02, name: 'nerve fibres' }, { z: 120, r: 0.015, name: 'inner plexiform' },
      { z: 160, r: 0.015, name: 'inner nuclear' }, { z: 190, r: 0.015, name: 'outer plexiform' }, { z: 280, r: 0.02, name: 'outer limiting membrane' },
      { z: 300, r: 0.05, name: 'photoreceptors' }, { z: 320, r: 0.07, name: 'pigment epithelium' }, { z: 340, r: 0.03, name: 'Bruch\'s membrane' }],
  },
  pair: {
    label: 'Two surfaces', title: 'Two reflecting surfaces a settable distance apart (in air, n = 1): how close can they be and still be told apart?',
    n: 1, depth: 8, gap: 8, layers: [{ z: 0, r: 0.2, name: 'first surface' }, { z: 8, r: 0.2, name: 'second surface' }],
  },
};

/** A fresh copy of a stack preset (layers in order of depth). */
export function makeStack(name, opts = {}) {
  const s = STACKS[name] || STACKS.slide;
  const st = { name, n: opts.n ?? s.n, depth: s.depth, layers: s.layers.map((l) => ({ ...l })) };
  if (name === 'pair') { st.gap = opts.gap ?? s.gap; st.layers[1].z = st.layers[0].z + st.gap / st.n; st.depth = st.layers[1].z; }
  return st;
}

/**
 * The plate of view 1: a front surface at a distance z1 (in air) beyond the point where the two
 * arms are equal and, with two, a back surface behind a thickness t of glass of index n.  The
 * front face reflects r = (n − 1)/(n + 1), the back face the same with the sign turned over.
 */
export function plateStack({ two = false, t = 100, n = 1.5 } = {}) {
  const layers = [{ z: 0, r: fresnel(1, n) }];
  if (two) layers.push({ z: t, r: fresnel(n, 1) });
  return { name: 'plate', n, depth: two ? t : 0, layers };
}

/**
 * The bursts a stack makes: [{ D, a, z, r, beta }] with D the round-trip path 2(offset + n z) and
 * a the amplitude r Π(1 − r_j²) over the interfaces above.  offset: the front face's distance (in
 * air) beyond the point where the two arms are equal.  beta: the dispersion every burst gets from
 * glass in the sample arm (source.js), 0 for none.
 */
export function bursts(stack, offset = 0, beta = 0) {
  const out = [];
  let through = 1;
  for (const l of [...stack.layers].sort((p, q) => p.z - q.z)) {
    out.push({ D: 2 * (offset + stack.n * l.z), a: l.r * through, z: l.z, r: l.r, beta, name: l.name });
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

// Gauss–Hermite quadrature across the beam: ∫ e^{−t²} f dt by five points, the weights normalised
// to 1.  The amplitude the beam gives a point ρ off its axis is e^{−2ρ²/w²} (out through the
// beam's profile and back into the same fibre), its power e^{−4ρ²/w²}, so a diffuse interface
// seen through the beam adds its power with these weights at ρ = t w/2 along each axis.
const GH_T = [-2.0201828704561, -0.9585724646138, 0, 0.9585724646138, 2.0201828704561];
const GH_W0 = [0.0199532420590, 0.3936193231522, 0.9453087204829, 0.3936193231522, 0.0199532420590];
const GH_SUM = GH_W0.reduce((a, b) => a + b, 0);
export const GH = { t: GH_T, w: GH_W0.map((w) => w / GH_SUM) };


// ------------------------------------------------------------------------ scenes

/**
 * Scenes to scan: bands of scattering material under curved interfaces, over x (across the
 * B-scan) and y (the second scan axis), both in μm, with the geometric depth z down.
 *   n0: the index above the first interface; nView: the index the instrument assumes when it
 *       turns optical depth into depth (the B-scan's depth is optical depth ÷ nView).
 *   base, curvature: the top interface at the centre, and its curvature (z = base + c ρ²/2:
 *       c < 0 a bowl, c > 0 a dome).  pit: the standard deviation (μm) of the foveal pit, where
 *       each band's thickness is multiplied by 1 − pit_i e^{−ρ²/2s²}.
 *   bands, from the top down: { name, thick, scatter (the mean amplitude of a scatterer), r (the
 *       reflectivity of the band's top, diffuse), n, pit, mu (the attenuation of the light's power
 *       per μm, one way: what comes back from depth z has lost e^{−2∫μ dz} of its power, e^{−∫μ dz}
 *       of its amplitude, to scattering and absorption above it), cells: { sx, sy, wall, inside, shift,
 *       shiftY } (cell walls every sx along x and sy along y, offset by those fractions of a cell:
 *       the scatterers are as strong as `scatter` within wall/2 of a wall, `inside` times as
 *       strong elsewhere) }.
 *   lesion: { x, y, dz (its centre's depth below the surface), rx, ry, rz, gain (the
 *       scatterers inside are gain times as strong: 0 for a fluid-filled cyst), rim (the
 *       reflectivity of its wall) }.
 *   beads: { dx, dz, z0, z1, a }: point scatterers of amplitude a on a grid (x and y every dx,
 *       z from z0 to z1 every dz).
 *   NA, focus: the beam's numerical aperture and focal depth this scene opens with.
 *   samplesPerLc: depth samples per coherence length in its images (2.5 if not given).
 */
export const SCENES = {
  retina: {
    label: 'Retina', title: 'The layers of the retina at the back of the eye, with the foveal pit in the middle and a fluid-filled cyst beside it',
    n0: 1.336, nView: 1.38, halfWidth: 1500, depth: 650, base: 120, curvature: -1 / 20000, pit: 300, NA: 0.03, focus: 260,
    bands: [
      { name: 'nerve fibre layer', thick: 45, scatter: 0.045, r: 0.02, n: 1.38, pit: 1, mu: 0.002, colour: '#d9b45a' },
      { name: 'ganglion cells', thick: 55, scatter: 0.02, r: 0, n: 1.38, pit: 1, mu: 0.0015, colour: '#a7a865' },
      { name: 'inner plexiform', thick: 40, scatter: 0.03, r: 0, n: 1.38, pit: 0.95, mu: 0.0015, colour: '#b9a46e' },
      { name: 'inner nuclear', thick: 35, scatter: 0.006, r: 0, n: 1.38, pit: 0.85, mu: 0.001, colour: '#5f7f8f' },
      { name: 'outer plexiform', thick: 25, scatter: 0.026, r: 0, n: 1.38, pit: 0.5, mu: 0.0015, colour: '#a39a72' },
      { name: 'outer nuclear', thick: 75, scatter: 0.0035, r: 0, n: 1.38, pit: -0.45, mu: 0.001, colour: '#4a5a73' },
      { name: 'photoreceptors', thick: 35, scatter: 0.012, r: 0.045, n: 1.38, pit: -0.15, mu: 0.003, colour: '#c9b878' },
      { name: 'pigment epithelium', thick: 22, scatter: 0.06, r: 0.03, n: 1.38, pit: 0, mu: 0.025, colour: '#b0703a' },
      { name: 'choroid', thick: 420, scatter: 0.024, r: 0, n: 1.38, pit: 0, mu: 0.005, colour: '#8a4a4a' },
    ],
    lesion: { x: 680, y: 60, dz: 95, rx: 200, ry: 170, rz: 46, gain: 0, rim: 0.012 },
  },
  onion: {
    label: 'Onion', title: 'An onion\'s skin and the rows of large cells under it: their walls scatter, their insides hardly at all',
    n0: 1.0, nView: 1.35, halfWidth: 1000, depth: 600, base: 70, curvature: 1 / 4000, pit: 0, NA: 0.04, focus: 220,
    bands: [
      { name: 'skin', thick: 18, scatter: 0.035, r: 0.1, n: 1.35, pit: 0, mu: 0.004, colour: '#d9c48a' },
      { name: 'first row of cells', thick: 95, scatter: 0.05, r: 0.012, n: 1.35, pit: 0, mu: 0.0015, colour: '#b9b07a', cells: { sx: 150, sy: 150, wall: 5, inside: 0.08, shift: 0, shiftY: 0.17 } },
      { name: 'second row', thick: 115, scatter: 0.05, r: 0.012, n: 1.35, pit: 0, mu: 0.0015, colour: '#a9a06a', cells: { sx: 170, sy: 160, wall: 5, inside: 0.08, shift: 0.5, shiftY: 0.36 } },
      { name: 'third row', thick: 135, scatter: 0.05, r: 0.012, n: 1.35, pit: 0, mu: 0.0015, colour: '#b9b07a', cells: { sx: 190, sy: 170, wall: 5, inside: 0.08, shift: 0.25, shiftY: 0.62 } },
      { name: 'fourth row', thick: 400, scatter: 0.05, r: 0.012, n: 1.35, pit: 0, mu: 0.0015, colour: '#a9a06a', cells: { sx: 210, sy: 180, wall: 5, inside: 0.08, shift: 0.75, shiftY: 0.83 } },
    ],
    lesion: null,
  },
  beads: {
    label: 'Beads in gel', title: 'Tiny beads in clear gel on a grid 60 μm apart and 100 μm deep: each one shows how a single point is blurred, across and in depth',
    n0: 1.33, nView: 1.33, halfWidth: 300, depth: 700, base: 30, curvature: 0, pit: 0, NA: 0.05, focus: 350, samplesPerLc: 8,
    bands: [{ name: 'gel', thick: 900, scatter: 0, r: 0.02, n: 1.33, pit: 0, colour: '#4a6a80' }],
    lesion: null,
    beads: { dx: 60, dz: 100, z0: 100, z1: 600, a: 0.05 },
  },
  plate: {
    label: 'Glass plate', title: 'A plate of glass 200 μm thick (n = 1.5, its faces ground so they scatter light back at any tilt) on a painted backing: tilt it',
    n0: 1.0, nView: 1.0, halfWidth: 1000, depth: 600, base: 120, curvature: 0, pit: 0, NA: 0.04, focus: 200,
    bands: [
      { name: 'glass', thick: 200, scatter: 0, r: 0.2, n: 1.5, pit: 0, colour: '#7fb3d5' },
      { name: 'paint', thick: 400, scatter: 0.025, r: -0.06, n: 1.45, pit: 0, mu: 0.008, colour: '#8f8a6a' },
    ],
    lesion: null,
  },
};

const SCENE_DEFAULTS = { tilt: 0, rough: 0, lesion: true, seed: 1 };

/**
 * A scene with its options (tilt: degrees, about the y axis; rough: the top surface's roughness,
 * μm; lesion: on or off; seed: the scatterers).  Its methods take lateral positions (x, y):
 *   profile(x, y): { tops, dtops } the geometric and optical depths of each band's top (and of
 *     the last band's bottom), the latter n0 z₀ + Σ n_i (thickness_i): what OCT measures;
 *   zToD(prof, z): optical depth of geometric depth z on that column;
 *   bandAt(prof, z), scatterAt(x, y, z, prof), inLesion(x, y, z), lesionRim(x, y);
 *   beadsNear(x, y, R): the beads within R laterally.
 */
export function makeScene(name, opts = {}) {
  const p = SCENES[name] || SCENES.retina;
  const o = { ...SCENE_DEFAULTS, ...opts };
  const nb = p.bands.length;
  const rng = mulberry32(o.seed * 7919 + 17), waves = [];
  for (let i = 0; i < 6; i++) waves.push({ kx: (TWO_PI / (60 + 140 * rng())) * (rng() < 0.5 ? 1 : -1), ky: (TWO_PI / (60 + 140 * rng())) * (rng() < 0.5 ? 1 : -1), ph: TWO_PI * rng() });
  const tanT = Math.tan((o.tilt * Math.PI) / 180), s2 = p.pit ? 2 * p.pit * p.pit : 0;
  const nLast = p.bands[nb - 1].n;
  const scene = {
    ...p, name, opts: o, nb,
    /** The smooth top surface (no roughness) at (x, y). */
    zSmooth(x, y = 0) { return p.base + 0.5 * p.curvature * (x * x + y * y) + x * tanT; },
    /** How far the pit lowers the surface at (x, y): the thickness the inner bands lose there. */
    pitDepth(x, y = 0) {
      if (!s2) return 0;
      const g = Math.exp(-(x * x + y * y) / s2);
      let t = 0;
      for (let i = 0; i < nb; i++) t += p.bands[i].thick * p.bands[i].pit * g;
      return t;
    },
    /** The surface at (x, y), with its pit but without roughness: what the lesion's depth is measured from. */
    zSurf(x, y = 0) { return this.zSmooth(x, y) + this.pitDepth(x, y); },
    /** The top surface at (x, y), roughness included. */
    zTop(x, y = 0) {
      let z = this.zSmooth(x, y);
      if (o.rough > 0) { let s = 0; for (const w of waves) s += Math.sin(w.kx * x + w.ky * y + w.ph); z += o.rough * s * 0.41; }
      return z;
    },
    profile(x, y = 0, out = { tops: new Float64Array(nb + 1), dtops: new Float64Array(nb + 1), atts: new Float64Array(nb + 1) }) {
      const { tops, dtops } = out, g = s2 ? Math.exp(-(x * x + y * y) / s2) : 0;
      void g;
      // The pit thins the inner bands: the surface dips by as much, and the deep bands stay smooth.
      const thin = this.pitDepth(x, y), zs = this.zSmooth(x, y) + thin;
      tops[0] = this.zTop(x, y) + thin;
      let cum = zs;
      for (let i = 0; i < nb; i++) {
        cum += p.bands[i].thick * (1 - p.bands[i].pit * g);
        tops[i + 1] = Math.max(tops[i], cum);
      }
      dtops[0] = p.n0 * tops[0];
      for (let i = 0; i < nb; i++) dtops[i + 1] = dtops[i] + p.bands[i].n * (tops[i + 1] - tops[i]);
      if (!out.atts) out.atts = new Float64Array(nb + 1);
      out.atts[0] = 0;
      for (let i = 0; i < nb; i++) out.atts[i + 1] = out.atts[i] + (p.bands[i].mu || 0) * (tops[i + 1] - tops[i]);
      return out;
    },
    /** The amplitude that survives the trip down to z and back: e^{−∫μ dz}. */
    through(prof, z) {
      const { tops, atts } = prof;
      if (z <= tops[0]) return 1;
      for (let i = 0; i < nb; i++) if (z < tops[i + 1]) return Math.exp(-(atts[i] + (p.bands[i].mu || 0) * (z - tops[i])));
      return Math.exp(-(atts[nb] + (p.bands[nb - 1].mu || 0) * (z - tops[nb])));
    },
    zToD(prof, z) {
      const { tops, dtops } = prof;
      if (z < tops[0]) return p.n0 * z;
      for (let i = 0; i < nb; i++) if (z < tops[i + 1]) return dtops[i] + p.bands[i].n * (z - tops[i]);
      return dtops[nb] + nLast * (z - tops[nb]);
    },
    bandAt(prof, z) {
      const { tops } = prof;
      if (z < tops[0]) return -1;
      for (let i = 0; i < nb; i++) if (z < tops[i + 1]) return i;
      return nb;
    },
    inLesion(x, y, z) {
      const L = p.lesion;
      if (!L || !o.lesion) return false;
      const a = (x - L.x) / L.rx, b = (y - L.y) / L.ry, c = (z - this.zSurf(x, y) - L.dz) / L.rz;
      return a * a + b * b + c * c < 1;
    },
    /** Where the beam at (x, y) enters and leaves the lesion (geometric depths), or null. */
    lesionRim(x, y = 0) {
      const L = p.lesion;
      if (!L || !o.lesion) return null;
      const a = (x - L.x) / L.rx, b = (y - L.y) / L.ry, s = 1 - a * a - b * b;
      if (s <= 0) return null;
      const h = L.rz * Math.sqrt(s), zc = this.zSurf(x, y) + L.dz;
      return [zc - h, zc + h];
    },
    /** The mean scatterer amplitude at (x, y, z). */
    scatterAt(x, y, z, prof = this.profile(x, y)) {
      const i = this.bandAt(prof, z);
      if (i < 0 || i >= nb) return 0;
      const b = p.bands[i];
      let s = b.scatter;
      if (b.cells) {
        const c = b.cells, u = x / c.sx + c.shift, v = y / c.sy + 0.5 + c.shiftY;
        const du = Math.abs(u - Math.round(u)) * c.sx, dv = Math.abs(v - Math.round(v)) * c.sy;
        if (du > c.wall / 2 && dv > c.wall / 2) s *= c.inside;
      }
      if (p.lesion && o.lesion && this.inLesion(x, y, z)) s *= p.lesion.gain;
      return s;
    },
    /** The beads within R of (x, y) laterally: [{ x, y, z, a }]. */
    beadsNear(x, y, R) {
      const B = p.beads, out = [];
      if (!B) return out;
      const lim = p.halfWidth - B.dx / 2;
      for (let i = Math.ceil((x - R) / B.dx); i <= Math.floor((x + R) / B.dx); i++) {
        const bx = i * B.dx;
        if (Math.abs(bx) > lim) continue;
        for (let j = Math.ceil((y - R) / B.dx); j <= Math.floor((y + R) / B.dx); j++) {
          const by = j * B.dx;
          if (Math.abs(by) > lim) continue;
          for (let z = B.z0; z <= B.z1 + 1e-9; z += B.dz) out.push({ x: bx, y: by, z, a: B.a });
        }
      }
      return out;
    },
  };
  return scene;
}

/**
 * The diffuse interfaces the beam meets at (x, y): [{ id, z, d, r, a }] from the top down (the
 * bands' tops with r ≠ 0, and the lesion's rim), z geometric, d optical, each with a = r times
 * what the interfaces above let through, there and back.
 */
export function interfacesAt(scene, x, y = 0, prof = scene.profile(x, y)) {
  const out = [];
  for (let i = 0; i < scene.nb; i++) if (scene.bands[i].r) out.push({ id: i, z: prof.tops[i], d: prof.dtops[i], r: scene.bands[i].r });
  const rim = scene.lesionRim(x, y);
  if (rim && scene.lesion.rim) {
    out.push({ id: -2, z: rim[0], d: scene.zToD(prof, rim[0]), r: scene.lesion.rim });
    out.push({ id: -3, z: rim[1], d: scene.zToD(prof, rim[1]), r: -scene.lesion.rim });
  }
  out.sort((p, q) => p.z - q.z);
  let through = 1;
  for (const f of out) { f.a = f.r * through * scene.through(prof, f.z); through *= 1 - f.r * f.r; }
  return out;
}

/** The lateral cell size of the scatterers (μm): scatterers are made cell by cell from a hash. */
export const CELL = 10;

/**
 * The scatterers in the lateral cell (i, j) (x in [iC, (i+1)C), y likewise), down to the scene's
 * depth: Float64Array of [x, y, z, amplitude, ...], the amplitude including what the light loses
 * on its way there and back.  count: scatterers per cell per 100 μm of depth.  The amplitudes are
 * Rayleigh-distributed about the local mean `scatter` (scale s √(2/π), so their mean is s and
 * their mean square (4/π) s²); their phases come from their depths (scan.js).  real: which
 * realisation (0, the scene's own; 1, 2, ...: the same tissue with its scatterers in other places,
 * as when it has moved between two measurements).
 */
export function cellScatterers(scene, i, j, { count = 40, real = 0 } = {}) {
  const rng = mulberry32(hashCell(i, j, 2 * real, scene.opts.seed));
  const n = Math.round((count * scene.depth) / 100);
  const out = new Float64Array(4 * n);
  const prof = scene.profile((i + 0.5) * CELL, (j + 0.5) * CELL);
  let m = 0;
  for (let q = 0; q < n; q++) {
    const x = (i + rng()) * CELL, y = (j + rng()) * CELL, z = rng() * scene.depth;
    const u = rng(), v = rng();
    const s = scene.scatterAt(x, y, z, prof);
    if (s === 0) continue;
    out[m++] = x; out[m++] = y; out[m++] = z; out[m++] = s * scene.through(prof, z) * 0.7978845608 * Math.sqrt(-2 * Math.log(1 - u));
    void v;   // (drawn to keep the sequence of random numbers)
  }
  return out.subarray(0, m);
}

/** The mean square of a scatterer's amplitude, as a multiple of scatter²: 4/π. */
export const SCATTER_MS = 4 / Math.PI;
