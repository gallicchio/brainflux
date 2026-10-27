// The scanner: an object, a set of angles and a detector; the sinogram it measures, angle by
// angle, and the reconstructions that build up as it goes.  No DOM.
//
//   const sc = new Scanner(256);
//   sc.setShapes(sheppLogan());            // or sc.setPicture(Float64Array(N * N))
//   sc.configure({ nA: 180, M: 256 });     // angles, detector bins, ...
//   for (let j = 0; j < sc.nA; j++) sc.measure(j);
//   sc.bp, sc.fbp                          // plain and filtered back-projections, N x N
//
// Measuring angle j again (a second turn, or a changed object) replaces its row: the old
// row's contribution is taken out of the back-projections and the new one put in, so the
// pictures always hold one row per angle.

import {
  projectShapes, rasterizeShapes, prepareRaster, projectRaster, circleRows, backproject, padRow,
  filterResponse, filterRow, filterWork, padLength, measureRow, projectionSpectrum, directFourier,
} from './radon.js';

const DEFAULTS = {
  nA: 180,          // number of angles
  range: Math.PI,   // angular range (radians, at most pi)
  M: 256,           // detector bins across the scan circle
  aperture: 1,      // each bin's width as a fraction of the spacing
  noise: false,     // photon counting
  I0: 1e5,          // photons sent along each ray
  poly: false,      // two-energy beam (beam hardening)
  filter: 'ramlak',
  cutoff: 1,        // the filter's cutoff, a fraction of the Nyquist frequency
  seed: 1,          // for the photon noise
};

export class Scanner {
  constructor(N = 256) {
    this.N = N;
    this.h = 2 / N;
    this.inside = circleRows(N, 1);
    this.truth = new Float64Array(N * N);   // the object as pixels
    this.shapes = null;                       // analytic shapes, or null for a picture
    this.metal = [];                          // the shapes that are metal
    this.raster = null;
    this.bp = new Float64Array(N * N);
    this.fbp = new Float64Array(N * N);
    this.opts = { ...DEFAULTS };
    this.count = 0;                           // angles measured so far
    this.pass = 0;                            // turns of the scanner: fresh photon noise each turn
    this.allocate();
  }

  get nA() { return this.opts.nA; }
  get M() { return this.opts.M; }
  get ds() { return 2 / this.opts.M; }
  get dth() { return this.opts.range / this.opts.nA; }
  angle(j) { return j * this.dth; }

  allocate() {
    const { nA, M } = this.opts, L = padLength(M);
    this.L = L;
    this.ideal = new Float64Array(nA * M);    // noiseless line integrals
    this.idealQ = new Float64Array(nA * M);   // the part of them through metal (for beam hardening)
    this.meas = new Float64Array(nA * M);     // what the scanner reports (the sinogram)
    this.filt = new Float64Array(nA * M);     // filtered projections
    this.spec = { re: new Float32Array(nA * L), im: new Float32Array(nA * L) };
    this.measured = new Uint8Array(nA);
    this.work = filterWork(M);
    this.rowA = new Float64Array(M); this.rowB = new Float64Array(M);
    this.padA = new Float64Array(M + 3); this.padB = new Float64Array(M + 3);
    this.specRe = new Float64Array(L); this.specIm = new Float64Array(L);
    this.H = filterResponse(this.opts.filter, M, this.ds, this.opts.cutoff);
    this.reset();
  }

  /** Forget every measurement. */
  reset() {
    this.measured.fill(0);
    this.count = 0;
    this.bp.fill(0); this.fbp.fill(0);
  }

  /**
   * Change settings.  Returns what changed: 'rescan' (the geometry: the rows are out of date
   * and have been forgotten), 'remeasure' (the photons or the beam), 'refilter' (the filter),
   * or ''.  With work = true the stored rows are then measured or filtered again here; with
   * work = false that is left to the caller (who will measure everything afresh).
   */
  configure(changes, work = true) {
    const o = this.opts, old = { ...o };
    Object.assign(o, changes);
    o.nA = Math.max(1, Math.round(o.nA));
    o.M = Math.max(4, 2 * Math.round(o.M / 2));
    o.range = Math.min(Math.PI, Math.max(1e-3, o.range));
    if (o.nA !== old.nA || o.M !== old.M) { this.allocate(); return 'rescan'; }
    if (o.range !== old.range || o.aperture !== old.aperture) { this.reset(); return 'rescan'; }
    const filterChanged = o.filter !== old.filter || o.cutoff !== old.cutoff;
    if (filterChanged) this.H = filterResponse(o.filter, o.M, this.ds, o.cutoff);
    if (o.noise !== old.noise || o.poly !== old.poly || (o.noise && o.I0 !== old.I0) || o.seed !== old.seed) {
      if (work) this.remeasure();
      return 'remeasure';
    }
    if (filterChanged) { if (work) this.refilter(); return 'refilter'; }
    return '';
  }

  /** The object: analytic shapes (exact projections); raster: also make the picture of it. */
  setShapes(shapes, raster = true) {
    this.shapes = shapes;
    this.metal = shapes.filter((sh) => sh.metal);
    this.raster = null;
    if (raster) rasterizeShapes(shapes, this.N, 4, this.truth);
  }

  /** The object: a picture, N x N, row by row (projected numerically). */
  setPicture(f) {
    this.shapes = null;
    this.metal = [];
    if (f !== this.truth) this.truth.set(f);
    this.raster = prepareRaster(this.truth, this.N);
  }

  /** Noiseless line integrals at angle theta into out (length M); their part through metal
   *  into outQ, if given. */
  project(theta, out, outQ = null) {
    const { M, aperture } = this.opts;
    out.fill(0);
    if (this.shapes) projectShapes(this.shapes, theta, M, this.ds, aperture, out);
    else projectRaster(this.raster, theta, M, this.ds, aperture, out);
    if (outQ) { outQ.fill(0); if (this.metal.length) projectShapes(this.metal, theta, M, this.ds, aperture, outQ); }
    return out;
  }

  // What the scanner reports for row j's line integrals (into out).
  measureIdeal(j, out) {
    const { M } = this.opts, o = this.opts;
    const pQ = this.metal.length ? this.idealQ.subarray(j * M, (j + 1) * M) : null;
    return measureRow(this.ideal.subarray(j * M, (j + 1) * M), M, out, { noise: o.noise, I0: o.I0, poly: o.poly, seed: this.rowSeed(j) }, pQ);
  }

  rowSeed(j) { return (Math.imul(this.opts.seed + 7919 * this.pass, 0x9E3779B1) ^ Math.imul(j + 1, 0x85EBCA6B)) >>> 0; }

  /** Measure angle j: its row of the sinogram, its filtered row, its slice of k-space. */
  measure(j) {
    const { M } = this.opts, L = this.L, theta = this.angle(j);
    this.project(theta, this.ideal.subarray(j * M, (j + 1) * M), this.idealQ.subarray(j * M, (j + 1) * M));
    const m = this.measureIdeal(j, this.rowA);
    const q = filterRow(m, M, this.H, this.rowB, this.work);
    const oldM = this.meas.subarray(j * M, (j + 1) * M), oldQ = this.filt.subarray(j * M, (j + 1) * M);
    // Back-project the change: the new row, less the old one if this angle was measured before.
    const again = this.measured[j];
    for (let k = 0; k < M; k++) {
      this.padA[k + 1] = again ? m[k] - oldM[k] : m[k];
      this.padB[k + 1] = again ? q[k] - oldQ[k] : q[k];
    }
    backproject(this.N, this.inside, theta, M, this.ds, this.bp, this.padA, this.dth, this.fbp, this.padB, this.dth);
    oldM.set(m); oldQ.set(q);
    projectionSpectrum(m, M, this.ds, this.specRe, this.specIm);
    this.spec.re.set(this.specRe, j * L); this.spec.im.set(this.specIm, j * L);
    if (!again) { this.measured[j] = 1; this.count++; }
  }

  /** Measure every angle afresh. */
  measureAll() {
    this.reset();
    for (let j = 0; j < this.nA; j++) this.measure(j);
  }

  /** Back-project the stored rows again (both pictures, or only the filtered one). */
  rebuild(onlyFiltered = false) {
    const { M } = this.opts;
    if (!onlyFiltered) this.bp.fill(0);
    this.fbp.fill(0);
    for (let j = 0; j < this.nA; j++) {
      if (!this.measured[j]) continue;
      padRow(this.filt.subarray(j * M, (j + 1) * M), M, this.padB);
      if (onlyFiltered) {
        backproject(this.N, this.inside, this.angle(j), M, this.ds, this.fbp, this.padB, this.dth);
      } else {
        padRow(this.meas.subarray(j * M, (j + 1) * M), M, this.padA);
        backproject(this.N, this.inside, this.angle(j), M, this.ds, this.bp, this.padA, this.dth, this.fbp, this.padB, this.dth);
      }
    }
  }

  /** A new filter: filter the stored rows again, and rebuild the filtered back-projection. */
  refilter() {
    const { M } = this.opts;
    this.H = filterResponse(this.opts.filter, M, this.ds, this.opts.cutoff);
    for (let j = 0; j < this.nA; j++) {
      if (!this.measured[j]) continue;
      filterRow(this.meas.subarray(j * M, (j + 1) * M), M, this.H, this.filt.subarray(j * M, (j + 1) * M), this.work);
    }
    this.rebuild(true);
  }

  /** New measurement settings (noise, beam): measure the stored ideal rows again. */
  remeasure() {
    const { M } = this.opts, L = this.L;
    for (let j = 0; j < this.nA; j++) {
      if (!this.measured[j]) continue;
      const m = this.measureIdeal(j, this.meas.subarray(j * M, (j + 1) * M));
      filterRow(m, M, this.H, this.filt.subarray(j * M, (j + 1) * M), this.work);
      projectionSpectrum(m, M, this.ds, this.specRe, this.specIm);
      this.spec.re.set(this.specRe, j * L); this.spec.im.set(this.specIm, j * L);
    }
    this.rebuild();
  }

  /**
   * The rows and pictures of a block of angles j0 <= j < j1 measured elsewhere (a worker, by
   * another Scanner with the same settings, object and pass): copied in, and the pictures added.
   */
  mergeBlock(b) {
    const M = this.M, L = this.L;
    this.ideal.set(b.ideal, b.j0 * M); this.idealQ.set(b.idealQ, b.j0 * M); this.meas.set(b.meas, b.j0 * M); this.filt.set(b.filt, b.j0 * M);
    this.spec.re.set(b.specRe, b.j0 * L); this.spec.im.set(b.specIm, b.j0 * L);
    for (let i = 0; i < this.bp.length; i++) { this.bp[i] += b.bp[i]; this.fbp[i] += b.fbp[i]; }
    for (let j = b.j0; j < b.j1; j++) if (!this.measured[j]) { this.measured[j] = 1; this.count++; }
  }

  /** Measure angles j0 <= j < j1 from nothing, and package them for mergeBlock. */
  measureBlock(j0, j1) {
    this.reset();
    for (let j = j0; j < j1; j++) this.measure(j);
    const M = this.M, L = this.L;
    return {
      j0, j1, ideal: this.ideal.slice(j0 * M, j1 * M), idealQ: this.idealQ.slice(j0 * M, j1 * M), meas: this.meas.slice(j0 * M, j1 * M), filt: this.filt.slice(j0 * M, j1 * M),
      specRe: this.spec.re.slice(j0 * L, j1 * L), specIm: this.spec.im.slice(j0 * L, j1 * L), bp: this.bp.slice(), fbp: this.fbp.slice(),
    };
  }

  /** The direct Fourier (gridding) reconstruction from the measured slices. */
  directFourier() {
    return directFourier(this.spec, this.nA, this.L, this.ds, this.opts.range, this.measured, this.N);
  }

  /** RMS of (picture - object) over the pixels within `radius` of the centre. */
  rmsError(img, radius = 0.95) {
    const N = this.N, h = this.h;
    let s = 0, n = 0;
    for (let j = 0; j < N; j++) {
      const y = (N / 2 - j) * h;
      for (let i = 0; i < N; i++) {
        const x = (i - N / 2) * h;
        if (x * x + y * y > radius * radius) continue;
        const d = img[j * N + i] - this.truth[j * N + i];
        s += d * d; n++;
      }
    }
    return Math.sqrt(s / n);
  }
}
