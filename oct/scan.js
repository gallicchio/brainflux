// Scanning: the beam steps sideways across a scene, each step an A-scan, and the A-scans stack
// into a B-scan (x across, depth down); stepping the second axis stacks B-scans into a volume.
// No DOM.
//
// The A-scan of a column is computed in the envelope domain (the magnitude of the complex
// envelope that time-domain demodulation, or the Fourier-domain transform, recovers), on a grid
// of optical depth d = n z (what the instrument measures: a mirror position, or a fringe
// frequency), so that a scene made in geometric depth z appears stretched by n.
//
// The focused beam gives a point ρ off its axis the amplitude e^{−2ρ²/w(z)²} (the light goes out
// through the beam's profile and comes back into the same fibre).  The scatterers within the
// beam add coherently, each with its own random phase: that is speckle, with grains about a
// beam's width across and a coherence length deep.  The diffuse interfaces (rough on the scale
// of the wavelength) add their power, sampled across the beam by Gauss–Hermite quadrature, so a
// tilted or curved interface seen through a wide beam makes a burst spread over the depths it
// spans.  Noise is complex and Gaussian, of standard deviation σ_r per component, correlated
// over a coherence length (the band-pass of the demodulation), as the time-domain trace's noise
// comes out.

import { CELL, GH, cellScatterers, interfacesAt, makeBeam, mulberry32, hashCell, gaussPair } from './sample.js';

/** The grids: the B-scan of the scene's full width, and the volume. */
export const BSCAN_GRID = { nx: 256, nz: 384 };
export const VOLUME_GRID = { nx: 64, ny: 64, nz: 256 };

/** Scatterers per lateral cell per 100 μm of depth (about two per resolution cell at 840 nm, NA 0.05). */
export const DENSITY = 40;

const scratch = { re: new Float64Array(0), im: new Float64Array(0), P: new Float64Array(0), nr: new Float64Array(0), ni: new Float64Array(0) };
function buffers(nz) {
  if (scratch.re.length !== nz) for (const k of Object.keys(scratch)) scratch[k] = new Float64Array(nz);
  return scratch;
}

// The scatterers of each lateral cell, made once and kept while the scene stays the same (the
// scans visit neighbouring columns in turn, so a cell is wanted many times over).
const cellCache = { scene: null, count: 0, map: new Map() };
function cell(scene, i, j, count) {
  if (cellCache.scene !== scene || cellCache.count !== count) { cellCache.scene = scene; cellCache.count = count; cellCache.map.clear(); }
  const key = i * 65536 + j;
  let sc = cellCache.map.get(key);
  if (!sc) {
    if (cellCache.map.size > 6000) cellCache.map.clear();
    sc = Float32Array.from(cellScatterers(scene, i, j, { count }));
    cellCache.map.set(key, sc);
  }
  return sc;
}

/**
 * One column of the image at lateral (x, y): the A-scan amplitude on the optical-depth grid
 * d_m = m hd, m < nz, into out (Float32Array or Float64Array of nz).
 *   opts: beam (makeBeam), noise (σ_r), speckle (true/false), seed, density.
 * Returns out.
 */
export function column(scene, src, x, y, hd, nz, out, opts = {}) {
  const n = scene.n, beam = opts.beam, { re, im, P, nr, ni } = buffers(nz);
  re.fill(0); im.fill(0); P.fill(0);
  // The envelope |γ(Δ)| = e^{−σ_k²Δ²/2} against d = Δ/2 is e^{−2σ_k²u²}; its square e^{−4σ_k²u²}.
  const sigk = src.sigk, s1 = 2 * sigk * sigk, s2 = 4 * sigk * sigk;
  const reachD = src.reach / 2;
  // A burst of power p at optical depth dc, as the square of the envelope (incoherent).
  const addPower = (dc, p) => {
    const m0 = Math.max(0, Math.ceil((dc - reachD) / hd)), m1 = Math.min(nz - 1, Math.floor((dc + reachD) / hd));
    for (let m = m0; m <= m1; m++) { const u = m * hd - dc; P[m] += p * Math.exp(-s2 * u * u); }
  };
  // A burst of amplitude a (real: a random phase of 0 or π) at optical depth dc (coherent).  The
  // Gaussian e^{−s(u + mh)²} is advanced by two multiplications per sample (its ratio between
  // successive samples is itself a geometric sequence).
  const cc = Math.exp(-2 * s1 * hd * hd);
  const addField = (dc, a) => {
    const m0 = Math.max(0, Math.ceil((dc - reachD) / hd)), m1 = Math.min(nz - 1, Math.floor((dc + reachD) / hd));
    if (m1 < m0) return;
    const u0 = m0 * hd - dc;
    let g = a * Math.exp(-s1 * u0 * u0), f = Math.exp(-s1 * (2 * u0 * hd + hd * hd));
    for (let m = m0; m <= m1; m++) { re[m] += g; g *= f; f *= cc; }
  };
  // The interfaces, sampled across the beam.
  const wAt = (z) => (beam ? beam.width(z) : 0);
  if (beam) {
    // Each interface is sampled across the beam at the beam's width at that interface's depth
    // (its depth on the axis), with the power weights e^{−4ρ²/w²} at ρ = t w/2.
    for (const f0 of interfacesAt(scene, x, y)) {
      const w = wAt(f0.z);
      for (let s = 0; s < 5; s++) for (let t = 0; t < 5; t++) {
        const g = interfacesAt(scene, x + (GH.t[s] * w) / 2, y + (GH.t[t] * w) / 2).find((f) => f.id === f0.id);
        if (g) addPower(n * g.z, GH.w[s] * GH.w[t] * g.a * g.a);
      }
    }
  } else {
    for (const f of interfacesAt(scene, x, y)) addPower(n * f.z, f.a * f.a);
  }
  // The scatterers within the beam, coherently.
  if (opts.speckle !== false && beam) {
    const wMax = Math.max(wAt(0), wAt(scene.depth)), R = 2.2 * wMax;
    const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL), j0 = Math.floor((y - R) / CELL), j1 = Math.floor((y + R) / CELL);
    const count = opts.density ?? DENSITY;
    const w0 = beam.w0, zR2 = beam.zR * beam.zR, zf = beam.zFocus;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const sc = cell(scene, i, j, count);
      for (let q = 0; q < sc.length; q += 4) {
        const zs = sc[q + 2], dz = zs - zf, w2 = w0 * w0 * (1 + (dz * dz) / zR2);
        const dx = sc[q] - x, dy = sc[q + 1] - y, e = (2 * (dx * dx + dy * dy)) / w2;
        if (e > 7) continue;   // e^{−7} < 10⁻³ of the beam's axis
        addField(n * zs, sc[q + 3] * Math.exp(-e));
      }
    }
  }
  // Noise: complex, correlated over the coherence length.
  if (opts.noise > 0) {
    const rng = mulberry32(hashCell(Math.round(x), Math.round(y), 1, (opts.seed ?? 1) + 99)), g = [0, 0];
    for (let m = 0; m < nz; m++) { gaussPair(rng, g); nr[m] = g[0]; ni[m] = g[1]; }
    const sd = 1 / (2 * sigk) / hd;                 // the burst envelope's σ in samples
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

/**
 * A B-scan being built: columns ix = 0 … nx−1 at x = −halfWidth + (ix + ½) pitch, at the row y;
 * img (Float32Array nx × nz, column-major: img[ix * nz + m]) holds the amplitudes, done[ix] which
 * columns are measured.  The optical-depth grid d = m hd covers n × the scene's depth.
 */
export class BScan {
  constructor(scene, src, grid = BSCAN_GRID, y = 0) {
    this.scene = scene; this.src = src; this.y = y;
    this.nx = grid.nx; this.nz = grid.nz;
    this.pitch = (2 * scene.halfWidth) / this.nx;
    this.dMax = scene.n * scene.depth;
    this.hd = this.dMax / this.nz;
    this.img = new Float32Array(this.nx * this.nz);
    this.done = new Uint8Array(this.nx);
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
 * A volume: ny B-scans at y = −halfWidth + (iy + ½) pitch, each nx columns of nz samples;
 * data[(iy * nx + ix) * nz + m].  Slices: xz at iy (a B-scan), yz at ix, and xy (en face) at m.
 */
export class Volume {
  constructor(scene, src, grid = VOLUME_GRID) {
    this.scene = scene; this.src = src;
    this.nx = grid.nx; this.ny = grid.ny; this.nz = grid.nz;
    this.pitch = (2 * scene.halfWidth) / this.nx;
    this.pitchY = (2 * scene.halfWidth) / this.ny;
    this.dMax = scene.n * scene.depth;
    this.hd = this.dMax / this.nz;
    this.data = new Float32Array(this.nx * this.ny * this.nz);
    this.done = new Uint8Array(this.ny);
    this.count = 0;
    this.opts = {};
  }
  x(ix) { return -this.scene.halfWidth + (ix + 0.5) * this.pitch; }
  y(iy) { return -this.scene.halfWidth + (iy + 0.5) * this.pitchY; }
  reset() { this.done.fill(0); this.count = 0; this.data.fill(0); }
  /** Measure B-scan iy: every column at that y. */
  measure(iy, opts = this.opts) {
    this.opts = opts;
    const { nx, nz } = this, y = this.y(iy);
    for (let ix = 0; ix < nx; ix++) column(this.scene, this.src, this.x(ix), y, this.hd, nz, this.data.subarray((iy * nx + ix) * nz, (iy * nx + ix + 1) * nz), opts);
    if (!this.done[iy]) { this.done[iy] = 1; this.count++; }
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
  /** The en-face slice at depth sample m: Float32Array nx × ny (iy * nx + ix). */
  sliceXY(m, out = new Float32Array(this.nx * this.ny)) {
    const { nx, nz } = this;
    for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < nx; ix++) out[iy * nx + ix] = this.data[(iy * nx + ix) * nz + m];
    return out;
  }
  /** The en-face projection: the mean amplitude over depth samples m0 ≤ m < m1. */
  projectXY(m0, m1, out = new Float32Array(this.nx * this.ny)) {
    const { nx, nz } = this;
    for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < nx; ix++) {
      let s = 0;
      const base = (iy * nx + ix) * nz;
      for (let m = m0; m < m1; m++) s += this.data[base + m];
      out[iy * nx + ix] = s / Math.max(1, m1 - m0);
    }
    return out;
  }
}

/** The beam for a scene: NA, focus depth (geometric, μm). */
export function sceneBeam(scene, src, NA, zFocus) { return makeBeam(src, NA, scene.n, zFocus); }

/**
 * Where the brightest reflector of each column of a B-scan image is: { x, d } for every column
 * (for measuring a layer's tilt: a straight line fitted to them).
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
    out.push({ x: bs.x(ix), d: bm * bs.hd, a: best });
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
