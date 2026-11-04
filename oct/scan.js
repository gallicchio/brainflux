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
//   - The scatterers within the beam add coherently, each with the phase e^{−2ik₀d} of its own
//     optical depth d (random, from one to the next): speckle, grains about a beam's width
//     across and a coherence length deep.  With speckle off, they add
//     their mean power instead: per unit depth, density × (4/π) s² × ∫∫ e^{−4ρ²/w²} = density
//     (4/π) s² πw²/4, what averaging many independent speckle patterns would give.
//   - The diffuse interfaces (rough on the scale of the wavelength) add their power, sampled
//     across the beam by Gauss–Hermite quadrature, so a tilted or curved interface seen through
//     a wide beam makes a burst spread over the depths it spans.
//   - Beads add coherently, like scatterers.
// Noise is complex and Gaussian, σ_r per component, correlated over a coherence length (as the
// band-passed noise of a time-domain trace comes out).
//
// Repeats (averaging against speckle).  The same line measured again gives the same speckle: it
// is interference, not noise, and only the noise is new.  It changes when something moves: the
// tissue (each scatterer's phase 2k₀nz turns over with a fraction of a wavelength of motion, and
// in real tissue, thousands of scatterers to a resolution cell, that alone makes a new pattern
// with the same mean; the scene here has about one to a cell, so the moved tissue is drawn as a
// new realisation of its scatterers, which is what those thousands would give) or the beam (a
// step δ across: the speckle of two beams δ apart is correlated e^{−2δ²/w²} in intensity, for any
// number of scatterers, since both the field's sum and the scatterers' own count are weighted by
// the beam's overlap with itself).  Averaging N repeats' intensities with pairwise correlations
// ρ_jk leaves the contrast C_N = C₁ √(Σ_jk ρ_jk)/N: C₁/√N when they are independent.

import { CELL, GH, cellScatterers, interfacesAt, makeBeam, mulberry32, hashCell, gaussPair, SCATTER_MS } from './sample.js';

/** Scatterers per lateral cell (10 × 10 μm) per 100 μm of depth. */
export const DENSITY = 40;

const scratch = { n: 0 };
function buffers(nz) {
  if (scratch.n !== nz) Object.assign(scratch, { n: nz, re: new Float64Array(nz), im: new Float64Array(nz), P: new Float64Array(nz), nr: new Float64Array(nz), ni: new Float64Array(nz) });
  return scratch;
}

// The scatterers of each lateral cell, made once and kept while the scene stays the same (the
// scans visit neighbouring columns in turn, so a cell is wanted many times over).  real: which
// realisation of them (0 to 63).
const cellCache = { scene: null, count: 0, map: new Map() };
function cell(scene, i, j, count, real = 0) {
  if (cellCache.scene !== scene || cellCache.count !== count) { cellCache.scene = scene; cellCache.count = count; cellCache.map.clear(); }
  const key = ((i + 32768) * 65536 + (j + 32768)) * 64 + real;
  let sc = cellCache.map.get(key);
  if (!sc) {
    if (cellCache.map.size > 12000) cellCache.map.clear();
    sc = Float32Array.from(cellScatterers(scene, i, j, { count, real }));
    cellCache.map.set(key, sc);
  }
  return sc;
}

/**
 * One column of the image at lateral (x, y): the A-scan amplitude on the optical-depth grid
 * d_m = m hd, m < nz, into out (Float32Array or Float64Array of nz).
 *   opts: beam (makeBeam), noise (σ_r), speckle (true: coherent; false: mean power), seed,
 *         density (scatterers per cell per 100 μm), shift (μm of optical depth added to every
 *         reflector: where the sample sits against the reference), scat (which realisation of the
 *         scatterers: 0, the scene's own), rep (which measurement: its noise is its own), quick
 *         (speckle off: the scatter on the beam's axis only, not averaged across it; exact where
 *         it does not change across the beam).
 * Returns out.
 */
export function column(scene, src, x, y, hd, nz, out, opts = {}) {
  const beam = opts.beam, { re, im, P, nr, ni } = buffers(nz), shift = opts.shift || 0;
  re.fill(0); im.fill(0); P.fill(0);
  // The envelope |γ(Δ)| = e^{−σ_k²Δ²/2} against d = Δ/2 is e^{−2σ_k²u²}; its square e^{−4σ_k²u²}.
  const sigk = src.sigk, s1 = 2 * sigk * sigk, s2 = 4 * sigk * sigk, reachD = src.reach / 2;
  // The Gaussians e^{−s(u + mh)²} below are advanced by two multiplications per sample (their
  // ratio between successive samples is itself geometric).
  const cc2 = Math.exp(-2 * s2 * hd * hd);
  const addPower = (dc, p) => {
    dc += shift;
    const m0 = Math.max(0, Math.ceil((dc - reachD) / hd)), m1 = Math.min(nz - 1, Math.floor((dc + reachD) / hd));
    if (m1 < m0) return;
    const u0 = m0 * hd - dc;
    let g = p * Math.exp(-s2 * u0 * u0), f = Math.exp(-s2 * (2 * u0 * hd + hd * hd));
    for (let m = m0; m <= m1; m++) { P[m] += g; g *= f; f *= cc2; }
  };
  // A burst of amplitude a from optical depth dc.  Its demodulated field is a γ(Δ − 2dc) without
  // the common carrier e^{ik₀Δ}: a envelope times the phase e^{−2ik₀dc}, which differs from one
  // scatterer to the next by many turns (they are wavelengths apart): that is what makes speckle.
  const cc = Math.exp(-2 * s1 * hd * hd), k2 = 2 * src.k0;
  const addField = (dc, a) => {
    dc += shift;
    const m0 = Math.max(0, Math.ceil((dc - reachD) / hd)), m1 = Math.min(nz - 1, Math.floor((dc + reachD) / hd));
    if (m1 < m0) return;
    const u0 = m0 * hd - dc, ph = k2 * dc, cr = a * Math.cos(ph), ci = -a * Math.sin(ph);
    let g = Math.exp(-s1 * u0 * u0), f = Math.exp(-s1 * (2 * u0 * hd + hd * hd));
    for (let m = m0; m <= m1; m++) { re[m] += g * cr; im[m] += g * ci; g *= f; f *= cc; }
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
      const count = opts.density ?? DENSITY, real = opts.scat || 0;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const sc = cell(scene, i, j, count, real);
        for (let q = 0; q < sc.length; q += 4) {
          const zs = sc[q + 2], dx = sc[q] - x, dy = sc[q + 1] - y, e = (2 * (dx * dx + dy * dy)) / w2At(zs);
          if (e > 7) continue;   // e^{−7} < 10⁻³ of the beam's axis
          addField(scene.zToD(prof, zs), sc[q + 3] * Math.exp(-e));
        }
      }
    } else {
      // Their mean power: density × (4/π) s² × π w²/4 per unit geometric depth, by steps of a
      // third of a grid cell (quick: one cell, which is still fine against the burst's width).
      const rho = (opts.density ?? DENSITY) / (CELL * CELL * 100), dz = hd / ((opts.quick ? 1 : 3) * scene.nView);
      // Where the scatter changes across the beam (cell walls, the lesion's edge), its square is
      // averaged over the beam's profile by the same quadrature as the interfaces.
      const varies = !opts.quick && (!!scene.lesion || scene.bands.some((b) => b.cells));
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
    const rng = mulberry32(hashCell(Math.round(x * 10), Math.round(y * 10), 1 + 2 * (opts.rep || 0), (opts.seed ?? 1) + 99)), g = [0, 0];
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

/** How many depth samples an image of the scene needs: about 2.5 per coherence length (more for
 *  a scene that asks for them, as the beads do, to measure the width of a point's image). */
export function depthSamples(scene, src, lo = 256, hi = 1536) {
  return Math.max(lo, Math.min(hi, 32 * Math.ceil((scene.nView * scene.depth) / (src.lc / (scene.samplesPerLc || 2.5)) / 32)));
}

/**
 * The repeats of an averaged B-scan, in the order they are measured: [{ dy, scat, rep }], dy the
 * beam's step along y (μm), scat the realisation of the scatterers, rep the measurement (its
 * noise).  how: 'tissue' (the tissue moves between repeats: new scatterers each time, the beam
 * where it was) or 'beam' (the tissue still, the beam stepped by `step` μm along y, about the
 * line: 0, +step, −step, +2 step, ...; step 0: nothing moves, only the noise is new).
 */
export function repeatPlan(N, how = 'tissue', step = 0) {
  const out = [];
  for (let k = 0; k < N; k++) {
    const j = k % 2 ? (k + 1) / 2 : -k / 2;
    out.push({ dy: how === 'beam' ? j * step : 0, scat: how === 'tissue' ? k : 0, rep: k });
  }
  return out;
}

/**
 * The contrast an average of the repeats of `plan` leaves, as a fraction of one B-scan's:
 * √(Σ_jk ρ_jk)/N, with ρ the correlation of two repeats' speckle (0 between different
 * realisations of the scatterers; e^{−2δ²/w²} between beams δ apart).  w: the beam's radius (μm),
 * or a list of radii (the beam's width at each place the contrast is measured: the sum is
 * averaged over them).
 */
export function averagedContrast(plan, w) {
  const ws = typeof w === 'number' ? [w] : w;
  let s = 0;
  for (const a of plan) for (const b of plan) {
    if (a.scat !== b.scat) continue;
    const d2 = (a.dy - b.dy) ** 2;
    if (!d2) { s += ws.length; continue; }
    for (const r of ws) s += Math.exp((-2 * d2) / (r * r));
  }
  return Math.sqrt(s / ws.length) / plan.length;
}

/**
 * The beam's radius at the depth of every sample of the speckle regions of columns cols (see
 * speckleRegion), every `every`-th of them: what averagedContrast needs to predict a beam-stepped
 * average's contrast.
 */
export function regionWidths(bs, beam, cols, every = 7) {
  const out = [], sc = bs.scene;
  let k = 0;
  for (const ix of cols) {
    const x = bs.x(ix), prof = sc.profile(x, bs.y);
    for (const [m0, m1] of speckleRegion(sc, x, bs.y, bs.hd, bs.nz)) for (let m = m0; m < m1; m++) {
      if (k++ % every) continue;
      // The geometric depth of optical depth d: bisection on zToD.
      const d = (m + 0.5) * bs.hd;
      let lo = 0, hi = sc.depth;
      for (let it = 0; it < 30; it++) { const z = 0.5 * (lo + hi); if (sc.zToD(prof, z) < d) lo = z; else hi = z; }
      out.push(beam.width(0.5 * (lo + hi)));
    }
  }
  return out;
}

/**
 * A B-scan being built: columns ix = 0 … nx−1 at x = −halfWidth + (ix + ½) pitch, at the row y;
 * img (Float32Array nx × nz, column-major: img[ix * nz + m]) holds the amplitudes, done[ix] which
 * columns are measured.  The optical-depth grid d = m hd covers nView × the scene's depth.
 * Averaged (setAverage): N repeats of the line (repeatPlan), their intensities averaged, img the
 * square root of the mean; reps[ix] how many of them column ix holds.  The scan's tasks are the
 * columns of the first repeat, then those of the second, ...: task t is repeat ⌊t/nx⌋ of column
 * t mod nx.
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
    this.reps = new Uint16Array(nx);
    this.count = 0;
    this.opts = {};
    this.setAverage(1);
  }
  x(ix) { return -this.scene.halfWidth + (ix + 0.5) * this.pitch; }
  /** Average N repeats (repeatPlan's how and step); forgets what was measured. */
  setAverage(N = 1, how = 'tissue', step = 0) {
    this.N = Math.max(1, N | 0); this.how = how; this.step = step;
    this.plan = repeatPlan(this.N, how, step);
    this.sum = this.N > 1 ? new Float32Array(this.nx * this.nz) : null;
    this.tmp = new Float32Array(this.nz);
    this.reset();
  }
  get tasks() { return this.N * this.nx; }
  reset() { this.done.fill(0); this.reps.fill(0); this.count = 0; this.img.fill(0); if (this.sum) this.sum.fill(0); }
  /** Where repeat k's beam is (y) and its options. */
  repeat(k, opts = this.opts) { const r = this.plan[k] || this.plan[0]; return { y: this.y + r.dy, opts: { ...opts, scat: r.scat, rep: r.rep } }; }
  /** Where task t's beam is and with what options: { ix, k, x, y, opts }. */
  task(t, opts = this.opts) { const ix = t % this.nx, k = Math.floor(t / this.nx), r = this.repeat(k, opts); return { ix, k, x: this.x(ix), y: r.y, opts: r.opts }; }
  /** Measure repeat k of column ix (repeat 0 starts the column afresh). */
  measure(ix, opts = this.opts, k = 0) {
    this.opts = opts;
    const r = this.repeat(k, opts);
    this.add(ix, column(this.scene, this.src, this.x(ix), r.y, this.hd, this.nz, this.tmp, r.opts), k);
  }
  /** Measure task t (see the class's comment). */
  measureTask(t, opts = this.opts) { this.measure(t % this.nx, opts, Math.floor(t / this.nx)); }
  measureAll(opts = this.opts) { for (let t = 0; t < this.tasks; t++) this.measureTask(t, opts); }
  /** Put repeat k's A-scan amplitudes A (measured here or elsewhere) into column ix. */
  add(ix, A, k = 0) {
    const nz = this.nz, col = this.img.subarray(ix * nz, (ix + 1) * nz);
    if (this.N === 1) { col.set(A); this.reps[ix] = 1; }
    else {
      const s = this.sum.subarray(ix * nz, (ix + 1) * nz);
      if (k === 0) { s.fill(0); this.reps[ix] = 0; }
      for (let m = 0; m < nz; m++) s[m] += A[m] * A[m];
      const n = ++this.reps[ix];
      for (let m = 0; m < nz; m++) col[m] = Math.sqrt(s[m] / n);
    }
    if (!this.done[ix]) { this.done[ix] = 1; this.count++; }
  }
  /** The column's A-scan: { D0: 0, h: hd, A } (optical depth). */
  aScan(ix) { return { A: this.img.subarray(ix * this.nz, (ix + 1) * this.nz), D0: 0, h: this.hd }; }
}

/**
 * Where a B-scan's speckle is measured, in the column at (x, y): [[m0, m1], ...] the depth samples
 * (m0 ≤ m < m1) inside the bands of scatterers, at least `margin` μm of optical depth from their
 * edges (where the interfaces' bursts are), none in a column that passes near the lesion or in
 * bands of cells (whose walls make their own pattern).  The deepest band: down to 220 μm of
 * optical depth below its top.
 */
export function speckleRegion(scene, x, y, hd, nz, margin = 8) {
  const out = [], L = scene.lesion;
  if (L && scene.opts.lesion && Math.abs(x - L.x) < L.rx + 2 * margin && Math.abs(y - L.y) < L.ry + 2 * margin) return out;
  const prof = scene.profile(x, y);
  for (let i = 0; i < scene.nb; i++) {
    const b = scene.bands[i];
    if (!(b.scatter > 0) || b.cells) continue;
    const d0 = prof.dtops[i] + margin, d1 = (i + 1 < scene.nb ? prof.dtops[i + 1] : prof.dtops[i] + 220) - margin;
    const m0 = Math.max(0, Math.ceil(d0 / hd)), m1 = Math.min(nz, Math.floor(d1 / hd) + 1);
    if (m1 > m0) out.push([m0, m1]);
  }
  return out;
}

/**
 * The speckle contrast of a B-scan: the standard deviation of I/I₀ over its mean, I the image's
 * intensity (its amplitude squared) and I₀ the speckle-free picture's (ref: amplitudes, laid out
 * as img; noisePower is added to it, what the noise brings on average), over the speckle regions
 * of the columns cols, where I₀ is at least ten times the noise's power.  { C, mean, n }: C is 1
 * for fully developed speckle, more where a resolution cell holds only a few scatterers.
 */
export function speckleContrast(bs, ref, cols, { noisePower = 0, margin = 8, img = bs.img } = {}) {
  const nz = bs.nz;
  let s = 0, s2 = 0, n = 0;
  for (const ix of cols) {
    for (const [m0, m1] of speckleRegion(bs.scene, bs.x(ix), bs.y, bs.hd, nz, margin)) {
      for (let m = m0; m < m1; m++) {
        const a0 = ref[ix * nz + m], i0 = a0 * a0;
        if (!(i0 > 10 * noisePower)) continue;
        const a = img[ix * nz + m], r = (a * a) / (i0 + noisePower);
        s += r; s2 += r * r; n++;
      }
    }
  }
  const mean = n ? s / n : NaN;
  return { C: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) / mean : NaN, mean, n };
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
  /**
   * The optical depth of band `band`'s top (0: the surface) under every A-scan of the volume:
   * Float32Array nx × ny (iy * nx + ix).  (Where the page knows it to be; an instrument finds it
   * in the image first: segmentation.)
   */
  layerDepths(band = 0, out = new Float32Array(this.nx * this.ny)) {
    const b = Math.max(0, Math.min(this.scene.nb, band | 0));
    for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < this.nx; ix++) out[iy * this.nx + ix] = this.scene.profile(this.x(ix), this.y(iy)).dtops[b];
    return out;
  }
  /** The depth sample (fractional) at `below` μm of depth as the images show it (optical ÷ nView)
   *  under a layer at optical depth dL: sample m covers optical depths m hd to (m + 1) hd. */
  followRow(dL, below) { return (dL + below * this.scene.nView) / this.hd - 0.5; }
  /**
   * A flattened en-face slab: under every A-scan, the mean amplitude over `samples` depth samples
   * centred `below` μm under the layer (layerD, from layerDepths), following its curve rather than
   * a flat plane.  Float32Array nx × ny (iy * nx + ix).
   */
  sliceFollow(layerD, below, samples = 1, out = new Float32Array(this.nx * this.ny)) {
    const { nx, nz } = this, half = (samples - 1) / 2;
    for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const m0 = Math.max(0, Math.round(this.followRow(layerD[iy * nx + ix], below) - half)), m1 = Math.min(nz, m0 + samples);
      let s = 0;
      const base = (iy * nx + ix) * nz;
      for (let m = m0; m < m1; m++) s += this.data[base + m];
      out[iy * nx + ix] = m1 > m0 ? s / (m1 - m0) : 0;
    }
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
