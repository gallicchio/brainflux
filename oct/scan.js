// Scanning: the beam steps sideways across a scene, each step an A-scan, and the A-scans stack
// into a B-scan (x across, depth down); stepping the second axis stacks B-scans into a volume.
// No DOM.
//
// The A-scan of a column is computed in the envelope domain (the magnitude of the complex
// envelope that time-domain demodulation, or the Fourier-domain transform, recovers), on a grid
// of optical depth d (what the instrument measures: a mirror position, or a fringe frequency).
// The images show it as depth d/nView, the instrument's guess at the depth with one index.
//
// The focused beam gives a point ρ off its axis the amplitude e^{−2ρ²/w(z)²} (the light goes out
// through the beam's profile and comes back into the same fibre).
//   - The scatterers within the beam add coherently, each with its own random phase: speckle,
//     grains about a beam's width across and a coherence length deep.  With speckle off, they add
//     their mean power instead: per unit depth, density × (4/π) s² × ∫∫ e^{−4ρ²/w²} = density
//     (4/π) s² πw²/4, what averaging many independent speckle patterns would give.
//   - The diffuse interfaces (rough on the scale of the wavelength) add their power, sampled
//     across the beam by Gauss–Hermite quadrature, so a tilted or curved interface seen through
//     a wide beam makes a burst spread over the depths it spans.
//   - Beads add coherently, like scatterers.
// Noise is complex and Gaussian, σ_r per component, correlated over a coherence length (as the
// band-passed noise of a time-domain trace comes out).

import { CELL, GH, cellScatterers, interfacesAt, makeBeam, mulberry32, hashCell, gaussPair, SCATTER_MS } from './sample.js';

/** Scatterers per lateral cell (10 × 10 μm) per 100 μm of depth. */
export const DENSITY = 40;

const scratch = { n: 0 };
function buffers(nz) {
  if (scratch.n !== nz) Object.assign(scratch, { n: nz, re: new Float64Array(nz), im: new Float64Array(nz), P: new Float64Array(nz), nr: new Float64Array(nz), ni: new Float64Array(nz) });
  return scratch;
}

// The scatterers of each lateral cell, made once and kept while the scene stays the same (the
// scans visit neighbouring columns in turn, so a cell is wanted many times over).
const cellCache = { scene: null, count: 0, map: new Map() };
function cell(scene, i, j, count) {
  if (cellCache.scene !== scene || cellCache.count !== count) { cellCache.scene = scene; cellCache.count = count; cellCache.map.clear(); }
  const key = (i + 32768) * 65536 + (j + 32768);
  let sc = cellCache.map.get(key);
  if (!sc) {
    if (cellCache.map.size > 8000) cellCache.map.clear();
    sc = Float32Array.from(cellScatterers(scene, i, j, { count }));
    cellCache.map.set(key, sc);
  }
  return sc;
}

/**
 * One column of the image at lateral (x, y): the A-scan amplitude on the optical-depth grid
 * d_m = m hd, m < nz, into out (Float32Array or Float64Array of nz).
 *   opts: beam (makeBeam), noise (σ_r), speckle (true: coherent; false: mean power), seed,
 *         density (scatterers per cell per 100 μm), shift (μm of optical depth added to every
 *         reflector: where the sample sits against the reference).
 * Returns out.
 */
export function column(scene, src, x, y, hd, nz, out, opts = {}) {
  const beam = opts.beam, { re, im, P, nr, ni } = buffers(nz), shift = opts.shift || 0;
  re.fill(0); im.fill(0); P.fill(0);
  // The envelope |γ(Δ)| = e^{−σ_k²Δ²/2} against d = Δ/2 is e^{−2σ_k²u²}; its square e^{−4σ_k²u²}.
  const sigk = src.sigk, s1 = 2 * sigk * sigk, s2 = 4 * sigk * sigk, reachD = src.reach / 2;
  const addPower = (dc, p) => {
    dc += shift;
    const m0 = Math.max(0, Math.ceil((dc - reachD) / hd)), m1 = Math.min(nz - 1, Math.floor((dc + reachD) / hd));
    for (let m = m0; m <= m1; m++) { const u = m * hd - dc; P[m] += p * Math.exp(-s2 * u * u); }
  };
  // A burst of real amplitude a at optical depth dc: the Gaussian e^{−s(u + mh)²} advanced by two
  // multiplications per sample (its ratio between successive samples is itself geometric).
  const cc = Math.exp(-2 * s1 * hd * hd);
  const addField = (dc, a) => {
    dc += shift;
    const m0 = Math.max(0, Math.ceil((dc - reachD) / hd)), m1 = Math.min(nz - 1, Math.floor((dc + reachD) / hd));
    if (m1 < m0) return;
    const u0 = m0 * hd - dc;
    let g = a * Math.exp(-s1 * u0 * u0), f = Math.exp(-s1 * (2 * u0 * hd + hd * hd));
    for (let m = m0; m <= m1; m++) { re[m] += g; g *= f; f *= cc; }
  };
  const prof = scene.profile(x, y);
  // The interfaces, each sampled across the beam at the beam's width at its depth.
  for (const f0 of interfacesAt(scene, x, y, prof)) {
    if (!beam) { addPower(f0.d, f0.a * f0.a); continue; }
    const w = beam.width(f0.z);
    for (let s = 0; s < 5; s++) for (let t = 0; t < 5; t++) {
      const g = s === 2 && t === 2 ? f0 : interfacesAt(scene, x + (GH.t[s] * w) / 2, y + (GH.t[t] * w) / 2).find((f) => f.id === f0.id);
      if (g) addPower(g.d, GH.w[s] * GH.w[t] * g.a * g.a);
    }
  }
  if (beam) {
    const w0 = beam.w0, zR2 = beam.zR * beam.zR, zf = beam.zFocus, w2At = (z) => w0 * w0 * (1 + ((z - zf) * (z - zf)) / zR2);
    const wMax = Math.sqrt(Math.max(w2At(0), w2At(scene.depth)));
    if (opts.speckle !== false) {
      // The scatterers within the beam, coherently.
      const R = 1.9 * wMax;
      const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL), j0 = Math.floor((y - R) / CELL), j1 = Math.floor((y + R) / CELL);
      const count = opts.density ?? DENSITY;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const sc = cell(scene, i, j, count);
        for (let q = 0; q < sc.length; q += 4) {
          const zs = sc[q + 2], dx = sc[q] - x, dy = sc[q + 1] - y, e = (2 * (dx * dx + dy * dy)) / w2At(zs);
          if (e > 7) continue;   // e^{−7} < 10⁻³ of the beam's axis
          addField(scene.zToD(prof, zs), sc[q + 3] * Math.exp(-e));
        }
      }
    } else {
      // Their mean power: density × (4/π) s² × π w²/4 per unit geometric depth, by steps of a
      // third of a grid cell.
      const rho = (opts.density ?? DENSITY) / (CELL * CELL * 100), dz = hd / (3 * scene.nView);
      // Where the scatter changes across the beam (cell walls, the lesion's edge), its square is
      // averaged over the beam's profile by the same quadrature as the interfaces.
      const varies = !!scene.lesion || scene.bands.some((b) => b.cells);
      for (let z = 0.5 * dz; z < scene.depth; z += dz) {
        let s2 = 0;
        if (varies) {
          const w = Math.sqrt(w2At(z));
          for (let s = 0; s < 5; s++) for (let t = 0; t < 5; t++) { const v = scene.scatterAt(x + (GH.t[s] * w) / 2, y + (GH.t[t] * w) / 2, z, prof); s2 += GH.w[s] * GH.w[t] * v * v; }
        } else { const v = scene.scatterAt(x, y, z, prof); s2 = v * v; }
        if (s2) { const T = scene.through(prof, z); addPower(scene.zToD(prof, z), rho * SCATTER_MS * s2 * T * T * (Math.PI / 4) * w2At(z) * dz); }
      }
    }
    // The beads.
    if (scene.beads) for (const b of scene.beadsNear(x, y, 2.7 * wMax)) {
      const dx = b.x - x, dy = b.y - y, e = (2 * (dx * dx + dy * dy)) / w2At(b.z);
      if (e < 9) addField(scene.zToD(prof, b.z), b.a * scene.through(prof, b.z) * Math.exp(-e));
    }
  }
  // Noise: complex, correlated over the coherence length.
  if (opts.noise > 0) {
    const rng = mulberry32(hashCell(Math.round(x * 10), Math.round(y * 10), 1, (opts.seed ?? 1) + 99)), g = [0, 0];
    for (let m = 0; m < nz; m++) { gaussPair(rng, g); nr[m] = g[0]; ni[m] = g[1]; }
    const sd = 1 / (2 * sigk) / hd;                 // the burst envelope's standard deviation, in samples
    const K = Math.max(1, Math.ceil(3 * sd)), ker = new Float64Array(2 * K + 1);
    let norm = 0;
    for (let k = -K; k <= K; k++) { ker[k + K] = Math.exp(-(k * k) / (2 * sd * sd)); norm += ker[k + K] * ker[k + K]; }
    const scale = opts.noise / Math.sqrt(norm);
    for (let m = 0; m < nz; m++) {
      let ar = 0, ai = 0;
      for (let k = -K; k <= K; k++) { const q = m + k; if (q >= 0 && q < nz) { ar += ker[k + K] * nr[q]; ai += ker[k + K] * ni[q]; } }
      re[m] += scale * ar; im[m] += scale * ai;
    }
  }
  for (let m = 0; m < nz; m++) out[m] = Math.sqrt(re[m] * re[m] + im[m] * im[m] + P[m]);
  return out;
}

/** How many depth samples an image of the scene needs: about 2.5 per coherence length. */
export function depthSamples(scene, src, lo = 256, hi = 1024) {
  return Math.max(lo, Math.min(hi, 32 * Math.ceil((scene.nView * scene.depth) / (src.lc / 2.5) / 32)));
}

/**
 * A B-scan being built: columns ix = 0 … nx−1 at x = −halfWidth + (ix + ½) pitch, at the row y;
 * img (Float32Array nx × nz, column-major: img[ix * nz + m]) holds the amplitudes, done[ix] which
 * columns are measured.  The optical-depth grid d = m hd covers nView × the scene's depth.
 */
export class BScan {
  constructor(scene, src, { nx = 512, nz = depthSamples(scene, src), y = 0 } = {}) {
    this.scene = scene; this.src = src; this.y = y;
    this.nx = nx; this.nz = nz;
    this.pitch = (2 * scene.halfWidth) / nx;
    this.dMax = scene.nView * scene.depth;
    this.hd = this.dMax / nz;
    this.img = new Float32Array(nx * nz);
    this.done = new Uint8Array(nx);
    this.count = 0;
    this.opts = {};
  }
  x(ix) { return -this.scene.halfWidth + (ix + 0.5) * this.pitch; }
  reset() { this.done.fill(0); this.count = 0; this.img.fill(0); }
  /** Measure column ix (again, if it was). */
  measure(ix, opts = this.opts) {
    this.opts = opts;
    column(this.scene, this.src, this.x(ix), this.y, this.hd, this.nz, this.img.subarray(ix * this.nz, (ix + 1) * this.nz), opts);
    if (!this.done[ix]) { this.done[ix] = 1; this.count++; }
  }
  measureAll(opts = this.opts) { for (let ix = 0; ix < this.nx; ix++) this.measure(ix, opts); }
  /** The column's A-scan: { D0: 0, h: hd, A } (optical depth). */
  aScan(ix) { return { A: this.img.subarray(ix * this.nz, (ix + 1) * this.nz), D0: 0, h: this.hd }; }
}

/**
 * A volume: ny B-scans at y = −halfWidth + (iy + ½) pitchY, each nx columns of nz samples;
 * data[(iy * nx + ix) * nz + m].  Slices: xz at iy (a B-scan), yz at ix, and xy (en face) at m.
 */
export class Volume {
  constructor(scene, src, { nx = 64, ny = 64, nz = 256 } = {}) {
    this.scene = scene; this.src = src;
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.pitch = (2 * scene.halfWidth) / nx;
    this.pitchY = (2 * scene.halfWidth) / ny;
    this.dMax = scene.nView * scene.depth;
    this.hd = this.dMax / nz;
    this.data = new Float32Array(nx * ny * nz);
    this.done = new Uint8Array(ny);
    this.count = 0;
    this.opts = {};
  }
  x(ix) { return -this.scene.halfWidth + (ix + 0.5) * this.pitch; }
  y(iy) { return -this.scene.halfWidth + (iy + 0.5) * this.pitchY; }
  reset() { this.done.fill(0); this.count = 0; this.data.fill(0); }
  /** Measure B-scan iy (columns ix0 ≤ ix < ix1 of it; all by default). */
  measure(iy, opts = this.opts, ix0 = 0, ix1 = this.nx) {
    this.opts = opts;
    const { nx, nz } = this, y = this.y(iy);
    for (let ix = ix0; ix < ix1; ix++) column(this.scene, this.src, this.x(ix), y, this.hd, nz, this.data.subarray((iy * nx + ix) * nz, (iy * nx + ix + 1) * nz), opts);
    if (ix1 >= nx && !this.done[iy]) { this.done[iy] = 1; this.count++; }
  }
  measureAll(opts = this.opts) { for (let iy = 0; iy < this.ny; iy++) this.measure(iy, opts); }
  /** The B-scan at iy: Float32Array nx × nz, column-major. */
  sliceXZ(iy) { return this.data.subarray(iy * this.nx * this.nz, (iy + 1) * this.nx * this.nz); }
  /** The cross-section at ix: Float32Array ny × nz, column-major (iy * nz + m). */
  sliceYZ(ix, out = new Float32Array(this.ny * this.nz)) {
    const { nx, nz } = this;
    for (let iy = 0; iy < this.ny; iy++) out.set(this.data.subarray((iy * nx + ix) * nz, (iy * nx + ix + 1) * nz), iy * nz);
    return out;
  }
  /** The en-face slice: the mean amplitude over depth samples m0 ≤ m < m1 (one sample by
   *  default), Float32Array nx × ny (iy * nx + ix). */
  sliceXY(m0, m1 = m0 + 1, out = new Float32Array(this.nx * this.ny)) {
    const { nx, nz } = this, k = 1 / Math.max(1, m1 - m0);
    for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < nx; ix++) {
      let s = 0;
      const base = (iy * nx + ix) * nz;
      for (let m = m0; m < m1; m++) s += this.data[base + m];
      out[iy * nx + ix] = s * k;
    }
    return out;
  }
}

/** The beam for a scene: NA, focus depth (geometric, μm), in the scene's index. */
export function sceneBeam(scene, src, NA, zFocus) { return makeBeam(src, NA, scene.nView, zFocus); }

/**
 * Where the brightest reflector of each measured column of a B-scan is, between optical depths
 * dLo and dHi: [{ x, d, a }] (for measuring a layer's tilt: a straight line fitted to them).
 */
export function ridge(bs, dLo = 0, dHi = Infinity) {
  const out = [];
  for (let ix = 0; ix < bs.nx; ix++) {
    if (!bs.done[ix]) continue;
    let best = -1, bm = 0;
    for (let m = 0; m < bs.nz; m++) {
      const d = m * bs.hd;
      if (d < dLo || d > dHi) continue;
      const v = bs.img[ix * bs.nz + m];
      if (v > best) { best = v; bm = m; }
    }
    // A parabola through the peak and its neighbours.
    const A = bs.img, b0 = ix * bs.nz;
    let f = 0;
    if (bm > 0 && bm + 1 < bs.nz) { const a = A[b0 + bm - 1], b = A[b0 + bm], c = A[b0 + bm + 1]; const den = a - 2 * b + c; if (den < 0) f = (0.5 * (a - c)) / den; }
    out.push({ x: bs.x(ix), d: (bm + f) * bs.hd, a: best });
  }
  return out;
}

/** The slope and intercept of the least-squares line d = slope x + d0 through points { x, d }. */
export function fitLine(pts) {
  let sx = 0, sd = 0, sxx = 0, sxd = 0;
  const n = pts.length;
  for (const p of pts) { sx += p.x; sd += p.d; sxx += p.x * p.x; sxd += p.x * p.d; }
  const slope = (n * sxd - sx * sd) / (n * sxx - sx * sx);
  return { slope, d0: (sd - slope * sx) / n };
}
