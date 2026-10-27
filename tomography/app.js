// Tomography: a CT scanner turns round an object, angle by angle; the sinogram fills row by
// row, Fourier space slice by slice, and two reconstructions build up as it goes.  The physics
// is in radon.js and scan.js; this file is the page.

import { Scanner } from './scan.js';
import { sheppLogan, disk, blob, FILTERS, filterResponse, objectSpectrum, TWO_PI } from './radon.js';
import { colorize } from '../lib/complexcolor.js';
import { el, $, slider, segmented, toggle, exprField, drawer, toast, readHash, writeHash, setSlots } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, fillSlots } from '../lib/plot.js';
import { stroke as paintStroke, paint } from '../fft2d/tools.js';
import { PRESETS as GALLERY, makePreset, loadImage, imageData } from '../fft2d/presets.js';

const N = 256, H = 2 / N;              // the picture: N x N pixels across the scan circle's diameter
const sc = new Scanner(N);
const DEG = Math.PI / 180;

// Colours on the black pictures (the same in light and dark themes).
const C = {
  source: '#ffb347', ray: 'rgba(255, 196, 120, 0.22)', detector: '#7fd3ff', profile: 'rgba(127, 211, 255, 0.28)',
  pick: '#ff5fd2', trace: '#ffe14d', circle: 'rgba(255, 255, 255, 0.4)', text: 'rgba(255, 255, 255, 0.82)',
};

// --------------------------------------------------------------------------- state

const DEFAULTS = {
  obj: 'phantom', contrast: 'modified', px: 0.45, py: 0.25,
  f: '(r < 0.8)*(1 + cos(k*(x cos(a) + y sin(a))))/2', fp: { k: 40, a: 1.0472 },
  na: 180, range: 180, nd: 256, ap: 1,
  noise: false, I0: 1e5, poly: false,
  filter: 'ramlak', cut: 1,
  speed: 40, keep: false,
  view: 'profile', under: false, circles: true, kz: 1,
  lo: null, hi: null,                  // the grey scale; null: chosen for the object
  py0: 0,                              // the profile's height y
};
const state = {
  ...structuredClone(DEFAULTS),
  playing: true, done: false,
  next: 0, progress: 0,                // the next angle to measure, and the fractional position
  tool: 'look', brush: { size: 9, value: 1 },
  pick: null,                          // a ray picked in the sinogram: { j, s }
  point: null,                         // a point picked on the object: { x, y, pinned }
  pmax: 1,                             // the sinogram's grey scale
  objRange: [0, 1],
  camera: null,
};

// ------------------------------------------------------------------------- objects

// The point: a Gaussian one pixel wide, with peak 1.
const POINT_SIGMA = H, POINT_MASS = TWO_PI * H * H;
const shapesFor = {
  phantom: () => sheppLogan(state.contrast),
  point: () => [blob(state.px, state.py, POINT_SIGMA, POINT_MASS)],
  disk: () => [disk(0, 0, 0.6, 1)],
  // The 1974 phantom (realistic attenuations) with two metal pins, 20 times water's.
  metal: () => [...sheppLogan('original'), ...[-0.32, 0.32].map((x) => ({ ...disk(x, -0.28, 0.035, 20 - 1.02), metal: true }))],
};
const OBJECTS = [
  { id: 'phantom', label: 'Shepp–Logan', title: 'The Shepp–Logan head phantom: ten ellipses, projected exactly' },
  { id: 'point', label: 'Point', title: 'One small Gaussian spot, projected exactly' },
  { id: 'disk', label: 'Disk', title: 'A uniform disk: its projection is the chord length 2√(R² − s²)' },
  { id: 'metal', label: 'Metal pins', title: 'The 1974 phantom with two metal pins, 20 times as absorbing as water' },
  { id: 'portrait', label: 'Fourier', title: "Joseph Fourier's portrait (public domain), projected numerically" },
  { id: 'formula', label: 'Formula', title: 'Type the object f(x, y)' },
];
const FORMULAS = [
  { label: 'Stripes', f: '(r < 0.8)*(1 + cos(k*(x cos(a) + y sin(a))))/2', fp: { k: 40, a: 1.0472 } },
  { label: 'Rings', f: '(r < 0.85)*(1 + cos(k*r))/2', fp: { k: 40 } },
  { label: 'Gaussian', f: 'exp(-r^2/(2 s^2))', fp: { s: 0.2 } },
  { label: 'Rectangle', f: '(abs(x) < a)*(abs(y) < b)', fp: { a: 0.5, b: 0.2 } },
  { label: 'Bars', f: '(abs(x) < 0.7)*(abs(y) < 0.6)*(cos(k*x*(1.2 + y)) > 0)', fp: { k: 60 } },
  { label: 'Zone plate', f: '(r < 0.9)*(1 + cos(k*r^2))/2', fp: { k: 100 } },
];
const FORMULA_HINTS = {
  k: { min: 1, max: 200, value: 40 }, a: { min: 0, max: Math.PI, value: 1 }, b: { min: 0.02, max: 0.95, value: 0.3 },
  s: { min: 0.02, max: 0.6, value: 0.2 }, R: { min: 0.05, max: 0.95, value: 0.5 }, w: { min: 0.01, max: 0.5, value: 0.1 },
  n: { min: 1, max: 20, value: 5, step: 1 }, x0: { min: -0.9, max: 0.9, value: 0 }, y0: { min: -0.9, max: 0.9, value: 0 },
};

// Pictures are kept inside the scan circle, with an edge softened over two pixels.
function maskToCircle(f) {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.hypot((i - N / 2) * H, (N / 2 - j) * H), o = j * N + i;
    if (r > 0.975) f[o] = 0; else if (r > 0.96) f[o] *= 0.5 * (1 + Math.cos((Math.PI * (r - 0.96)) / 0.015));
  }
  return f;
}

let formulaExpr = null;
function formulaPicture() {
  if (!formulaExpr) return new Float64Array(N * N);
  // Two by two samples per pixel, averaged.
  const S = 2, n = N * S, xs = new Float64Array(n * n), ys = new Float64Array(n * n), rs = new Float64Array(n * n), ts = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i / S - N / 2 + 0.5 / S - 0.5) * H, y = (N / 2 - j / S - 0.5 / S + 0.5) * H, o = j * n + i;
    xs[o] = x; ys[o] = y; rs[o] = Math.hypot(x, y); ts[o] = Math.atan2(y, x);
  }
  let v;
  try { v = formulaExpr.evaluate({ ...state.fp, x: xs, y: ys, r: rs, theta: ts }, n * n).re; }
  catch (e) { toast(e.message); return new Float64Array(N * N); }
  const f = new Float64Array(N * N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const val = v[j * n + i];
    if (Number.isFinite(val)) f[Math.floor(j / S) * N + Math.floor(i / S)] += val / (S * S);
  }
  return maskToCircle(f);
}

async function picturePreset(id) {
  if (id === 'portrait') return imageData(await loadImage('../fft2d/images/fourier-portrait.png'), N, 'fit')[0];
  const p = GALLERY.find((q) => q.id === id);
  if (p.image) return imageData(await loadImage(`../fft2d/${p.image}`), N, p.how)[0];
  return (await makePreset(p, N, 1))[0];
}

let loadToken = 0;
/** Put a new object in the scanner and start a scan of it. */
async function setObject(id, { restart = true } = {}) {
  const token = ++loadToken;
  if (id !== 'camera' && state.camera) stopCamera();
  if (shapesFor[id]) sc.setShapes(shapesFor[id]());
  else if (id === 'formula') sc.setPicture(formulaPicture());
  else if (id !== 'camera') {
    let f;
    try { f = await picturePreset(id.replace(/^g:/, '')); } catch (e) { toast(e.message); return; }
    if (token !== loadToken) return;
    sc.setPicture(maskToCircle(Float64Array.from(f)));
  }
  state.obj = id;
  objectChanged(true);
  if (restart) restartScan();
  updateObjectUI();
  updateHash();
}

/** The object's values changed: the grey scales, the sinogram's scale, Fourier space. */
function objectChanged(isNew = false) {
  let lo = Infinity, hi = -Infinity;
  for (const v of sc.truth) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // (Rounding leaves values like -5e-17 where ellipses cancel: those are zero.)
  if (Math.abs(lo) < 1e-9) lo = 0;
  if (Math.abs(hi) < 1e-9) hi = 0;
  state.objRange = [Math.min(0, lo), hi > lo ? hi : lo + 1];
  // The sinogram's scale: the largest line integral, from a dozen projections.
  const row = new Float64Array(sc.M);
  let pmax = 0;
  for (let a = 0; a < 12; a++) {
    sc.project((a * Math.PI) / 12, row);
    for (const v of row) if (v > pmax) pmax = v;
  }
  state.pmax = pmax > 0 ? pmax : 1;
  if (isNew) autoWindow();
  objVersion++;
  spectrumStale = true;
  if (isNew) updateSpectrum();
  dirty = true;
  schedule();
}

/** The object was edited (painting, a slider): measure it again if the scan is over. */
function objectEdited() {
  objectChanged(false);
  if (scanFinished() || jobs.flight) rescanSoon = true;
  schedule();
}

// ----------------------------------------------------------------------- scanning
//
// The scan runs angle by angle on this thread (each angle is cheap).  Once it is over, a change
// of settings or of the object measures every angle again at once; that is shared out between a
// few worker threads, and the pictures switch over when all are back.

const scanFinished = () => state.done && !state.playing;

function restartScan() {
  const target = cancelJobs();
  sc.configure(target, false);
  sc.reset();
  state.next = 0; state.progress = 0;
  state.playing = true; state.done = false;
  kStale = true; dirty = true; versionCounter++;
  updatePlay();
  schedule();
}

function scanComplete() {
  state.playing = false; state.done = true; state.progress = sc.nA; state.next = sc.nA;
  versionCounter++;
  updatePlay();
}

/** Measure angle state.next, and move on. */
function measureNext() {
  const j = state.next;
  sc.measure(j);
  splatSlice(j);
  state.next++;
  if (state.next >= sc.nA) {
    if (state.keep) { state.next = 0; state.progress -= sc.nA; sc.pass++; }
    else scanComplete();
  }
}

function advance(dt) {
  // progress counts the angles of this turn that are due; angle `next` is measured once it is.
  state.progress += (state.speed * dt) / (sc.dth / DEG);
  const t0 = performance.now();
  while (state.playing && state.next < state.progress) {
    measureNext();
    // Don't fall behind: what doesn't fit in this frame waits for the next.
    if (performance.now() - t0 > 14) { state.progress = Math.min(state.progress, state.next); break; }
  }
  dirty = true;
}

function finishScan() {
  if (state.keep) { state.keep = false; keepToggle.on = false; }
  if (state.done) return;
  state.playing = true;
  while (state.next < sc.nA) measureNext();
  dirty = true; schedule();
}

// Measuring everything at once, in worker threads.
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
let workers = null;
try {
  workers = Array.from({ length: POOL }, () => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => blockDone(e.data);
    // If workers can't run here, do the job on this thread instead (with the settings it was for).
    w.onerror = () => {
      const opts = jobs.target || jobs.flight?.opts;
      workers = null; jobs.flight = null;
      if (opts) rescanAll(opts);
    };
    return w;
  });
} catch { workers = null; }
const jobs = { gen: 0, flight: null, target: null };
// Workers start with cold code: give each a block of angles to measure (and throw away) soon
// after the page opens, so that the first real request is fast.
setTimeout(() => {
  if (!workers) return;
  const opts = { ...sc.opts }, nA = opts.nA;
  workers.forEach((w, i) => w.postMessage({ gen: -1, N, opts, pass: 0, shapes: sheppLogan(), j0: Math.floor((i * nA) / workers.length), j1: Math.floor(((i + 1) * nA) / workers.length) }));
}, 1500);
const targetOpts = () => jobs.target || jobs.flight?.opts || sc.opts;

/** Measure every angle with these settings (and the object as it is), then show the result. */
function rescanAll(opts = targetOpts()) {
  jobs.target = { ...opts };
  if (!jobs.flight) dispatch();
}
function dispatch() {
  const opts = jobs.target;
  jobs.target = null;
  if (!opts) return;
  if (!workers) {
    // No workers: on this thread.
    sc.configure(opts, false);
    sc.measureAll();
    afterRescan();
    return;
  }
  const g = ++jobs.gen, nA = opts.nA, W = Math.min(workers.length, nA);
  jobs.flight = { g, opts, blocks: [], expected: W };
  const object = sc.shapes ? { shapes: sc.shapes } : { picture: sc.truth };
  for (let w = 0; w < W; w++) {
    const j0 = Math.floor((w * nA) / W), j1 = Math.floor(((w + 1) * nA) / W);
    workers[w].postMessage({ gen: g, N, opts, pass: sc.pass, ...object, j0, j1 });
  }
}
function blockDone(b) {
  const f = jobs.flight;
  if (!f || b.gen !== f.g) return;
  f.blocks.push(b);
  if (f.blocks.length < f.expected) return;
  // All back: switch over (even if newer settings are waiting, show this one meanwhile).
  sc.configure(f.opts, false);
  sc.reset();
  for (const blk of f.blocks) sc.mergeBlock(blk);
  jobs.flight = null;
  afterRescan();
  if (jobs.target) dispatch();
}
function afterRescan() {
  if (state.pick && state.pick.j >= sc.nA) state.pick = null;
  scanComplete();
  kStale = true; filterPlotStale = true; dirty = true;
  schedule();
}
/** Forget any rescan in progress; returns the settings it was for (or the current ones). */
function cancelJobs() {
  const target = targetOpts();
  jobs.gen++; jobs.flight = null; jobs.target = null;
  return target;
}

/** New geometry, photons or filter. */
function reconfigure(changes) {
  if (scanFinished() || jobs.flight) rescanAll({ ...targetOpts(), ...changes });
  else {
    // A scan in progress (or paused): the geometry starts it again; photons or filter apply
    // to what has been measured so far, and to the rest.
    const what = sc.configure(changes, true);
    versionCounter++;
    if (what === 'rescan') { if (state.pick && state.pick.j >= sc.nA) state.pick = null; restartScan(); }
    else if (what === 'remeasure') kStale = true;
  }
  filterPlotStale = true;
  dirty = true;
  updateHash();
  schedule();
}

// --------------------------------------------------------------------- the frame loop

let raf = 0, lastT = 0, dirty = true, rescanSoon = false, versionCounter = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(frame); }

function frame(t) {
  raf = 0;
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
  lastT = t;
  if (state.camera?.live) grabCamera();
  if (rescanSoon) { rescanSoon = false; if (scanFinished() || jobs.flight) rescanAll(); }
  if (state.playing) advance(dt);
  if (dirty) { draw(); dirty = false; }
  if (state.playing || state.camera?.live) schedule(); else lastT = 0;
}

// ----------------------------------------------------------------------- drawing

const greyCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
const off = { obj: greyCanvas(), bp: greyCanvas(), fbp: greyCanvas(), direct: greyCanvas() };
const greyImg = new ImageData(N, N);

function window_() {
  const lo = state.lo ?? state.objRange[0], hi = state.hi ?? state.objRange[1];
  return hi > lo ? [lo, hi] : [lo, lo + 1e-6];
}

function greyInto(canvas, values, lo, hi) {
  const d = greyImg.data, s = 255 / (hi - lo);
  for (let i = 0, o = 0; i < values.length; i++, o += 4) {
    const g = (values[i] - lo) * s;
    d[o] = d[o + 1] = d[o + 2] = g < 0 ? 0 : g > 255 ? 255 : g; d[o + 3] = 255;
  }
  canvas.getContext('2d').putImageData(greyImg, 0, 0);
}

// A square picture of the region [-W, W]^2: world to CSS pixels.
function view(canvas, W) {
  const { ctx, width } = fitCanvas(canvas);
  const s = width / (2 * W);
  return { ctx, size: width, s, X: (x) => width / 2 + x * s, Y: (y) => width / 2 - y * s, W };
}

function drawPicture(v, img) {
  const { ctx, X, Y, s } = v;
  ctx.save();
  ctx.beginPath(); ctx.arc(X(0), Y(0), s, 0, TWO_PI); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  // Pixel (i, j) is centred on ((i - N/2) h, (N/2 - j) h).
  ctx.drawImage(img, X(-1 - H / 2), Y(1 + H / 2), 2 * s, 2 * s);
  ctx.restore();
  ctx.strokeStyle = C.circle; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(X(0), Y(0), s, 0, TWO_PI); ctx.stroke(); ctx.setLineDash([]);
}

// What each cached picture was last drawn from: redraw it only when that changes.
const drawn = { obj: '', recon: '', sino: '' };
let objVersion = 0;

function draw() {
  const [lo, hi] = window_();
  const data = `${dataVersion()}`;
  if (drawn.obj !== `${objVersion}:${lo}:${hi}`) {
    greyInto(off.obj, sc.truth, lo, hi);
    drawn.obj = `${objVersion}:${lo}:${hi}`;
  }
  if (drawn.recon !== `${data}:${lo}:${hi}`) {
    greyInto(off.fbp, sc.fbp, lo, hi);
    // Back-projection has no natural scale (it is the object blurred by 1/r): its own.
    const bpLo = quantile(sc.bp, 0.002), bpHi = quantile(sc.bp, 0.998);
    greyInto(off.bp, sc.bp, bpLo, bpHi > bpLo ? bpHi : bpLo + 1);
    drawn.recon = `${data}:${lo}:${hi}`;
  }
  drawScanner();
  drawSinogram(data);
  drawK();
  drawRecon($('#bp'), off.bp, 'bp');
  drawRecon($('#fbp'), off.fbp, 'fbp');
  drawExtra();
  if (filterPlotStale) drawFilterPlot();
  updateReadouts(data);
}

function quantile(arr, q) {
  // An estimate from a sample of the pixels inside the circle (fast enough for every frame).
  const vals = [];
  for (let j = 2; j < N; j += 3) for (let i = 1; i < N; i += 3) {
    const x = (i - N / 2) * H, y = (N / 2 - j) * H;
    if (x * x + y * y < 0.98) vals.push(arr[j * N + i]);
  }
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
}

// The angle the source and detector are drawn at: the picked ray's, or the last measured.
function hardwareIndex() {
  if (state.pick) return state.pick.j;
  if (!sc.count) return 0;
  return (state.next - 1 + sc.nA) % sc.nA;
}

const SCAN_W = 1.36, SRC_D = 1.17, DET_D = 1.08, PROFILE_H = 0.25;

function drawScanner() {
  const v = view($('#scanner'), SCAN_W), { ctx, X, Y, size } = v;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  drawPicture(v, off.obj);
  const j = hardwareIndex(), th = sc.angle(j), c = Math.cos(th), sn = Math.sin(th);
  const n = [c, sn], d = [-sn, c];
  const P = (a, b) => [X(a * d[0] + b * n[0]), Y(a * d[1] + b * n[1])];   // a along the rays, b across
  const line = (p, q) => { ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); };
  // The rays: a sheet of parallel X-rays from the source to the detector.
  ctx.strokeStyle = C.ray; ctx.lineWidth = 1;
  for (let b = -0.9; b <= 0.9001; b += 0.15) line(P(SRC_D, b), P(-DET_D, b));
  // The source.
  ctx.strokeStyle = C.source; ctx.lineWidth = 4; ctx.lineCap = 'round';
  line(P(SRC_D, -1), P(SRC_D, 1));
  // The detector: its bins, if there are few enough to see.
  ctx.strokeStyle = C.detector; ctx.lineWidth = 4; ctx.lineCap = 'butt';
  if (sc.M <= 96) {
    const ds = sc.ds, w = Math.max(0.15, sc.opts.aperture) * ds;
    for (let k = 0; k < sc.M; k++) { const s0 = (k - sc.M / 2) * ds; line(P(-DET_D, s0 - w / 2), P(-DET_D, s0 + w / 2)); }
  } else line(P(-DET_D, -1), P(-DET_D, 1));
  ctx.lineCap = 'butt';
  // What the detector measured at this angle, drawn outward from it.
  if (sc.measured[j]) {
    const M = sc.M, row = sc.meas.subarray(j * M, (j + 1) * M), k0 = (k) => (k - M / 2) * sc.ds;
    ctx.beginPath(); ctx.moveTo(...P(-DET_D, k0(0)));
    for (let k = 0; k < M; k++) ctx.lineTo(...P(-DET_D - PROFILE_H * Math.max(0, Math.min(1.15, row[k] / state.pmax)), k0(k)));
    ctx.lineTo(...P(-DET_D, k0(M - 1)));
    ctx.closePath();
    ctx.fillStyle = C.profile; ctx.fill();
    ctx.strokeStyle = C.detector; ctx.lineWidth = 1.2; ctx.stroke();
  }
  // A picked ray.
  if (state.pick) {
    ctx.strokeStyle = C.pick; ctx.lineWidth = 1.6;
    line(P(SRC_D, state.pick.s), P(-DET_D, state.pick.s));
    ctx.fillStyle = C.pick; ctx.beginPath(); ctx.arc(...P(-DET_D, state.pick.s), 3.5, 0, TWO_PI); ctx.fill();
  }
  // The point object, which is only a pixel wide: a ring round it.
  if (state.obj === 'point') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(X(state.px), Y(state.py), 9, 0, TWO_PI); ctx.stroke();
  }
  // A picked point.
  if (state.point) {
    ctx.strokeStyle = C.trace; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(X(state.point.x), Y(state.point.y), 5, 0, TWO_PI); ctx.stroke();
  }
  // The brush.
  if (brushHover && (state.tool === 'brush' || state.tool === 'eraser')) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(X(brushHover.x), Y(brushHover.y), Math.max(2, (state.brush.size / 2) * H * v.s), 0, TWO_PI); ctx.stroke();
  }
  ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = C.text; ctx.textBaseline = 'top';
  fillSlots(ctx, ['θ = ', { v: th / DEG, dec: 1, w: 5 }, '°'], 8, 8);
}

// The sinogram: s across, theta down.
const SINO_M = { left: 34, right: 8, top: 8, bottom: 20 };
const sinoImg = { canvas: document.createElement('canvas'), data: null };
function sinoGeom() {
  const cv = $('#sinogram'), r = cv.getBoundingClientRect();
  const w = r.width - SINO_M.left - SINO_M.right, h = r.height - SINO_M.top - SINO_M.bottom;
  const M = sc.M, ds = sc.ds, dth = sc.dth;
  return {
    w, h,
    X: (s) => SINO_M.left + ((s / ds + M / 2 + 0.5) / M) * w,
    Y: (th) => SINO_M.top + ((th + dth / 2) / Math.PI) * h,
    s: (px) => (((px - SINO_M.left) / w) * M - 0.5 - M / 2) * ds,
    th: (py) => ((py - SINO_M.top) / h) * Math.PI - dth / 2,
  };
}

function drawSinogram(data) {
  const cv = $('#sinogram'), { ctx, width, height } = fitCanvas(cv);
  const g = sinoGeom(), M = sc.M, nA = sc.nA;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
  // The rows measured so far, grey from 0 to the largest line integral.
  const ic = sinoImg.canvas;
  if (ic.width !== M || ic.height !== nA) { ic.width = M; ic.height = nA; sinoImg.data = new ImageData(M, nA); drawn.sino = ''; }
  if (drawn.sino !== `${data}:${state.pmax}`) {
    const d = sinoImg.data.data, sc255 = 255 / (1.05 * state.pmax);
    for (let j = 0; j < nA; j++) {
      const on = sc.measured[j];
      for (let k = 0, o = j * M * 4; k < M; k++, o += 4) {
        const gv = sc.meas[j * M + k] * sc255;
        d[o] = d[o + 1] = d[o + 2] = gv < 0 ? 0 : gv > 255 ? 255 : gv; d[o + 3] = on ? 255 : 0;
      }
    }
    ic.getContext('2d').putImageData(sinoImg.data, 0, 0);
    drawn.sino = `${data}:${state.pmax}`;
  }
  ctx.imageSmoothingEnabled = nA > g.h;
  const rangeFrac = sc.opts.range / Math.PI;
  ctx.drawImage(ic, SINO_M.left, SINO_M.top, g.w, g.h * rangeFrac);
  // The angles never reached (a limited range): hatched.
  if (rangeFrac < 0.999) {
    const y0 = SINO_M.top + g.h * rangeFrac;
    ctx.save(); ctx.beginPath(); ctx.rect(SINO_M.left, y0, g.w, g.h * (1 - rangeFrac)); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    for (let x = -g.h; x < g.w; x += 9) { ctx.beginPath(); ctx.moveTo(SINO_M.left + x, y0 + g.h); ctx.lineTo(SINO_M.left + x + g.h, y0); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = C.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('not measured', SINO_M.left + g.w / 2, y0 + (g.h * (1 - rangeFrac)) / 2);
  }
  // Axes.
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const a of [0, 45, 90, 135, 180]) {
    const y = SINO_M.top + (a / 180) * g.h;
    ctx.fillText(`${a}°`, SINO_M.left - 5, y);
    ctx.beginPath(); ctx.moveTo(SINO_M.left - 3, y); ctx.lineTo(SINO_M.left, y); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const s of [-1, -0.5, 0, 0.5, 1]) {
    const x = SINO_M.left + ((s + 1) / 2) * g.w;
    ctx.fillText(s === 0 ? 's = 0' : String(s).replace('-', '−'), x, SINO_M.top + g.h + 4);
  }
  // The angle being measured.
  if (state.playing && nA > 1) {
    const y = g.Y(sc.angle(state.next) - sc.dth / 2);
    ctx.fillStyle = C.detector;
    ctx.beginPath(); ctx.moveTo(SINO_M.left - 1, y); ctx.lineTo(SINO_M.left - 7, y - 4); ctx.lineTo(SINO_M.left - 7, y + 4); ctx.fill();
  }
  // A point's sinusoid.
  if (state.point) {
    const { x, y } = state.point;
    ctx.save(); ctx.beginPath(); ctx.rect(SINO_M.left, SINO_M.top, g.w, g.h); ctx.clip();
    ctx.strokeStyle = C.trace; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let a = 0; a <= 180; a += 1) {
      const t = a * DEG, s = x * Math.cos(t) + y * Math.sin(t);
      const px = g.X(s), py = SINO_M.top + (a / 180) * g.h;
      if (a) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
  // A picked ray.
  if (state.pick) {
    const px = g.X(state.pick.s), py = g.Y(sc.angle(state.pick.j));
    ctx.strokeStyle = C.pick; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 6, 0, TWO_PI); ctx.stroke();
  }
}

// Fourier space: a 512 x 512 picture of (kx, ky) out to the pixels' Nyquist frequency pi / h.
const KS = 2 * N, KMAX = Math.PI / H, DKP = (2 * KMAX) / KS;
const kCanvas = document.createElement('canvas'); kCanvas.width = kCanvas.height = KS;
const kCtx = kCanvas.getContext('2d');
const kImg = new ImageData(KS, KS);
let kBase = null, kR = 1, kStale = true, spectrumStale = true, objSpec = null, spectrumTimer = 0;
let sliceRGBA = new Uint8ClampedArray(0);

function updateSpectrum() {
  // The object's 2D transform: for the brightness, and to draw faintly under the slices.
  objSpec = objectSpectrum(sc.truth, N, KS);
  const mags = new Float64Array(KS * KS);
  for (let i = 0; i < mags.length; i++) mags[i] = Math.hypot(objSpec.re[i], objSpec.im[i]);
  const sorted = mags.slice().sort();
  kR = Math.max(sorted[Math.floor(0.985 * (mags.length - 1))], 1e-2 * sorted[mags.length - 1]) || 1;
  kBase = new Uint8ClampedArray(KS * KS * 4);
  colorize(objSpec.re, objSpec.im, kBase, kR, 'complex');
  for (let i = 0; i < kBase.length; i += 4) { kBase[i] *= 0.38; kBase[i + 1] *= 0.38; kBase[i + 2] *= 0.38; }
  spectrumStale = false;
  kStale = true;
}

function splatSlice(j) {
  if (kStale) return;   // drawn in full later
  const L = sc.L, th = sc.angle(j), c = Math.cos(th), sn = Math.sin(th), dkS = TWO_PI / (L * sc.ds);
  if (sliceRGBA.length !== 4 * L) sliceRGBA = new Uint8ClampedArray(4 * L);
  colorize(sc.spec.re.subarray(j * L, (j + 1) * L), sc.spec.im.subarray(j * L, (j + 1) * L), sliceRGBA, kR, 'complex');
  const d = kImg.data;
  for (let m = 0; m < L; m++) {
    const k = (m - L / 2) * dkS / DKP;
    const u = Math.round(KS / 2 + k * c), v = Math.round(KS / 2 - k * sn);
    if (u < 0 || v < 0 || u >= KS || v >= KS) continue;
    const o = (v * KS + u) * 4;
    d[o] = sliceRGBA[4 * m]; d[o + 1] = sliceRGBA[4 * m + 1]; d[o + 2] = sliceRGBA[4 * m + 2]; d[o + 3] = 255;
  }
  kDirtyImage = true;
}
let kDirtyImage = true;

function rebuildK() {
  if (spectrumStale) updateSpectrum();
  const d = kImg.data;
  if (state.under && kBase) d.set(kBase);
  else { d.fill(0); for (let i = 3; i < d.length; i += 4) d[i] = 255; }
  kStale = false;
  for (let j = 0; j < sc.nA; j++) if (sc.measured[j]) splatSlice(j);
  kDirtyImage = true;
}

function drawK() {
  if (spectrumStale && !spectrumTimer) {
    // Painting changes the object every frame: recompute its transform a few times a second.
    spectrumTimer = setTimeout(() => { spectrumTimer = 0; updateSpectrum(); dirty = true; schedule(); }, kBase ? 250 : 0);
  }
  if (kStale && !spectrumStale) rebuildK();
  if (kDirtyImage) { kCtx.putImageData(kImg, 0, 0); kDirtyImage = false; }
  const kw = KMAX / state.kz, v = view($('#kspace'), kw), { ctx, size, X, Y, s } = v;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  const src = KS / state.kz;
  ctx.drawImage(kCanvas, (KS - src) / 2, (KS - src) / 2, src, src, 0, 0, size, size);
  const ring = (k, dash, label) => {
    if (k >= kw * 1.41) return;
    ctx.strokeStyle = C.circle; ctx.lineWidth = 1; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.arc(X(0), Y(0), k * s, 0, TWO_PI); ctx.stroke(); ctx.setLineDash([]);
    // Labelled up and to the left, clear of the axes' labels.
    if (label && k * s > 30 && k < kw * 0.95) { ctx.fillStyle = C.text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(label, X(-0.71 * k) - 2, Y(0.71 * k) - 2); }
  };
  if (state.circles) {
    ring(Math.PI / sc.ds, [6, 4], 'π/ds');
    ring(Math.PI / sc.dth, [2, 3], 'π/Δθ');
  }
  // The slice of the picked ray, and the one being measured.
  const sliceLine = (j, colour, w) => {
    const th = sc.angle(j), r = KMAX * 1.5;
    ctx.strokeStyle = colour; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(X(-r * Math.cos(th)), Y(-r * Math.sin(th))); ctx.lineTo(X(r * Math.cos(th)), Y(r * Math.sin(th))); ctx.stroke();
  };
  if (state.pick) sliceLine(state.pick.j, 'rgba(255, 95, 210, 0.7)', 1);
  else if (state.playing && sc.count) sliceLine(hardwareIndex(), 'rgba(127, 211, 255, 0.45)', 1);
  ctx.fillStyle = C.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  subscripted(ctx, 'k', 'x', ' →', size - 40, size / 2 + 4);
  subscripted(ctx, '↑ k', 'y', '', size / 2 + 4, 6);
}

// Text with a subscript, as k_x: base, then the subscript smaller and lower, then the rest.
function subscripted(ctx, base, sub, rest, x, y) {
  const font = ctx.font;
  ctx.fillText(base, x, y); x += ctx.measureText(base).width;
  ctx.font = font.replace(/\d+px/, (m) => `${Math.round(parseInt(m, 10) * 0.75)}px`);
  ctx.fillText(sub, x, y + 5); x += ctx.measureText(sub).width;
  ctx.font = font;
  if (rest) ctx.fillText(rest, x, y);
}

function drawRecon(canvas, img, which) {
  const v = view(canvas, 1), { ctx, size, X, Y } = v;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  drawPicture(v, img);
  overlays(v, which);
}

function overlays(v, which) {
  const { ctx, X, Y } = v;
  if (state.view === 'profile') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(X(-1), Y(state.py0)); ctx.lineTo(X(1), Y(state.py0)); ctx.stroke(); ctx.setLineDash([]);
  }
  if (state.pick && which === 'bp') {
    // Where the picked measurement was smeared.
    const th = sc.angle(state.pick.j), c = Math.cos(th), sn = Math.sin(th), s = state.pick.s;
    ctx.strokeStyle = C.pick; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X(s * c + 1.5 * sn), Y(s * sn - 1.5 * c)); ctx.lineTo(X(s * c - 1.5 * sn), Y(s * sn + 1.5 * c)); ctx.stroke();
  }
  if (state.point) {
    ctx.strokeStyle = C.trace; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(X(state.point.x), Y(state.point.y), 5, 0, TWO_PI); ctx.stroke();
  }
}

// The sixth panel.
let directCache = { key: '', img: null, time: 0 };
function directImage() {
  const key = `${dataVersion()}`;
  const now = performance.now();
  if (directCache.key !== key && (!state.playing || now - directCache.time > 400)) {
    directCache = { key, img: sc.directFourier(), time: now };
  }
  return directCache.img;
}

const dataVersion = () => `${versionCounter}:${sc.count}:${state.next}:${sc.pass}`;

function drawExtra() {
  const cv = $('#extra'), wrap = $('#extra-wrap');
  const plot = state.view !== 'direct';
  wrap.classList.toggle('plot', plot);
  if (state.view === 'direct') {
    const img = directImage();
    const [lo, hi] = window_();
    if (img) greyInto(off.direct, img, lo, hi);
    drawRecon(cv, off.direct, 'direct');
    return;
  }
  const { ctx, width, height } = fitCanvas(cv);
  const col = themeColors();
  ctx.fillStyle = col.panel; ctx.fillRect(0, 0, width, height);
  if (state.view === 'profile') drawProfile(ctx, width, height, col);
  else drawProjection(ctx, width, height, col);
}

const BP_COLOUR = '#d4872a';

function drawProfile(ctx, width, height, col) {
  const f = new Frame(ctx, width, height, { left: 40, right: 44, top: 22, bottom: 30 });
  const [lo, hi] = window_(), pad = 0.12 * (hi - lo);
  f.x0 = -1; f.x1 = 1; f.y0 = lo - pad; f.y1 = hi + pad;
  f.axes({ xlabel: 'x', colors: col });
  const j = Math.max(0, Math.min(N - 1, Math.round(N / 2 - state.py0 / H)));
  const xs = (i) => (i - N / 2) * H;
  const inside = (i) => xs(i) ** 2 + state.py0 ** 2 <= 1;
  // The back-projection on its own scale (right).
  let bmax = 0;
  const bvals = [];
  for (let i = 0; i < N; i++) if (inside(i)) bvals.push(sc.bp[j * N + i]);
  bvals.sort((a, b) => a - b);
  bmax = (bvals[Math.floor(0.93 * (bvals.length - 1))] || 1) * 1.3;
  const YB = f.rightAxis(0, bmax, '', col);
  const curve = (get, colour, width_, dash = [], Y = (y) => f.Y(y)) => {
    f.clip();
    ctx.strokeStyle = colour; ctx.lineWidth = width_; ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < N; i++) {
      if (!inside(i)) { started = false; continue; }
      const y = Y(get(i));
      if (!started) { ctx.moveTo(f.X(xs(i)), y); started = true; } else ctx.lineTo(f.X(xs(i)), y);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  };
  curve((i) => sc.bp[j * N + i], BP_COLOUR, 1.2, [4, 3], YB);
  if (state.obj === 'point') {
    // m / r: the back-projection of a point of mass m, with nothing adjusted.
    const m = POINT_MASS;
    curve((i) => m / Math.hypot(xs(i) - state.px, (N / 2 - j) * H - state.py), col.ink3, 1, [1.5, 2.5], YB);
  }
  curve((i) => sc.truth[j * N + i], col.ink2, 2.4);
  curve((i) => sc.fbp[j * N + i], col.accent, 1.4);
  // A legend.
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let x = f.left + 4;
  const item = (label, colour, dash = [], w = 2) => {
    ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x + 16, 10); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col.ink2; ctx.fillText(label, x + 19, 10);
    x += 24 + ctx.measureText(label).width;
  };
  item('object', col.ink2, [], 2.4);
  item('filtered', col.accent);
  item(state.obj === 'point' ? 'back-proj. (right), m/r' : 'back-proj. (right)', BP_COLOUR, [4, 3], 1.2);
}

function projRow() {
  const j = state.pick ? state.pick.j : hardwareIndex();
  return sc.measured[j] ? j : -1;
}

function drawProjection(ctx, width, height, col) {
  const f = new Frame(ctx, width, height, { left: 40, right: 44, top: 22, bottom: 30 });
  const j = projRow(), M = sc.M;
  f.x0 = -1; f.x1 = 1; f.y0 = -0.08 * state.pmax; f.y1 = 1.12 * state.pmax;
  f.axes({ xlabel: 's', colors: col });
  if (j < 0) return;
  const p = sc.meas.subarray(j * M, (j + 1) * M), q = sc.filt.subarray(j * M, (j + 1) * M);
  let qmax = 0;
  for (const v of q) qmax = Math.max(qmax, Math.abs(v));
  qmax = qmax || 1;
  const YQ = f.rightAxis(-qmax * 1.1, qmax * 1.1, '', col);
  const sOf = (k) => (k - M / 2) * sc.ds;
  f.clip();
  // Zero of the filtered projection.
  ctx.strokeStyle = col.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.left, YQ(0)); ctx.lineTo(f.right, YQ(0)); ctx.stroke();
  const curve = (arr, Y, colour, w) => {
    ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.beginPath();
    for (let k = 0; k < M; k++) { const x = f.X(sOf(k)), y = Y(arr[k]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  };
  curve(p, (v) => f.Y(v), col.ink2, 2);
  curve(q, YQ, col.accent, 1.3);
  ctx.restore();
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = col.ink2; fillSlots(ctx, ['projection p(s) at θ = ', { v: sc.angle(j) / DEG, dec: 1, w: 5 }, '° (left)'], f.left + 4, 10);
  ctx.fillStyle = col.accent; ctx.textAlign = 'right'; ctx.fillText('filtered (right)', f.right - 2, 10);
}

let filterPlotStale = true;
function drawFilterPlot() {
  filterPlotStale = false;
  const cv = $('#filter-plot'), { ctx, width, height } = fitCanvas(cv), col = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 30, right: 10, top: 8, bottom: 34 });
  f.x0 = 0; f.x1 = 1; f.y0 = 0; f.y1 = 1.05;
  f.axes({ xlabel: 'frequency |k|, as a fraction of π/ds', colors: col });
  // Using the settings being worked towards, if a rescan is on its way.
  const o = targetOpts(), M = o.M, ds = 2 / M, Hr = filterResponse(o.filter, M, ds, o.cutoff), L = Hr.length, nyq = 1 / (2 * ds);
  f.clip();
  ctx.strokeStyle = col.ink3; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(f.X(0), f.Y(0)); ctx.lineTo(f.X(1), f.Y(1)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath();
  for (let m = 0; m <= L / 2; m++) { const x = f.X(m / (L / 2)), y = f.Y(Hr[m] / nyq); if (m) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke(); ctx.restore();
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
  ctx.fillStyle = col.ink3; ctx.textAlign = 'left'; ctx.fillText('ramp |k|', f.X(0.06), f.Y(0.98));
  ctx.fillStyle = col.accent; ctx.fillText(FILTERS[o.filter].label, f.X(0.06), f.Y(0.84));
}

// --------------------------------------------------------------------- readouts

const pixel = (arr, x, y) => {
  const i = Math.round(x / H + N / 2), j = Math.round(N / 2 - y / H);
  return i >= 0 && j >= 0 && i < N && j < N ? arr[j * N + i] : 0;
};
let hover = { scanner: null, sinogram: null, kspace: null, bp: null, fbp: null, extra: null };

let rmsCache = { key: '', rms: NaN, smooth: NaN };
// The pixels "away from edges": where the object is the same, to 0.1% of its range, for four
// pixels all round.  The difference there is noise and streaks, not the blur of edges.
let smoothMask = { version: -1, mask: null, count: 0 };
function smoothPixels() {
  if (smoothMask.version === objVersion) return smoothMask;
  const f = sc.truth, R = 4, tol = 1e-3 * (state.objRange[1] - state.objRange[0]);
  const mx = new Float64Array(N * N), mn = new Float64Array(N * N), mask = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let a = -Infinity, b = Infinity;
    for (let d = Math.max(0, i - R); d <= Math.min(N - 1, i + R); d++) { const v = f[j * N + d]; if (v > a) a = v; if (v < b) b = v; }
    mx[j * N + i] = a; mn[j * N + i] = b;
  }
  let count = 0, total = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i - N / 2) * H, y = (N / 2 - j) * H;
    if (x * x + y * y > 0.95 * 0.95) continue;
    total++;
    let a = -Infinity, b = Infinity;
    for (let d = Math.max(0, j - R); d <= Math.min(N - 1, j + R); d++) { const o = d * N + i; if (mx[o] > a) a = mx[o]; if (mn[o] < b) b = mn[o]; }
    if (a - b <= tol) { mask[j * N + i] = 1; count++; }
  }
  smoothMask = { version: objVersion, mask, count, total };
  return smoothMask;
}
function rmsSmooth(img) {
  const { mask, count, total } = smoothPixels();
  if (count < 0.05 * total) return NaN;
  let s = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const d = img[i] - sc.truth[i]; s += d * d; }
  return Math.sqrt(s / count);
}
// The readouts under the pictures: each number in a slot of its own, a fixed number of characters
// wide with fixed decimals, so that nothing in a readout moves as the numbers change (setSlots).
const XY = (p) => ['x ', { v: p.x, dec: 3, w: 6 }, ', y ', { v: p.y, dec: 3, w: 6 }, ': '];
const RMS = (v) => (Number.isFinite(v) ? { v, dec: 4, w: 6, tiny: true } : { text: '–', w: 6 });
function updateReadouts(data) {
  const nA = sc.nA, j = hardwareIndex(), NA = { v: nA, dec: 0, w: 3 };   // (up to 720 angles)
  // The scanner.
  const hs = hover.scanner;
  setSlots($('#scan-readout'), hs && Math.hypot(hs.x, hs.y) <= 1
    ? [...XY(hs), 'attenuation ', { v: pixel(sc.truth, hs.x, hs.y), dec: 3, w: 6 }]
    : state.playing ? ['angle ', { v: Math.min(state.next + 1, nA), dec: 0, w: 3 }, ' of ', NA, ', θ = ', { v: sc.angle(Math.min(state.next, nA - 1)) / DEG, dec: 1, w: 5 }, '°']
      : [{ v: sc.count, dec: 0, w: 3 }, ' of ', NA, ' angles measured over ', { v: sc.opts.range / DEG, dec: 0, w: 3 }, '°']);
  // The sinogram.
  const hg = hover.sinogram || state.pick;
  if (hg && hg.j !== undefined && hg.j >= 0 && hg.j < nA) {
    const k = Math.round(hg.s / sc.ds + sc.M / 2);
    const val = sc.measured[hg.j] && k >= 0 && k < sc.M ? { v: sc.meas[hg.j * sc.M + k], dec: 4, w: 7 } : 'not measured';
    setSlots($('#sino-readout'), ['θ ', { v: sc.angle(hg.j) / DEG, dec: 1, w: 5 }, '°, s ', { v: hg.s, dec: 3, w: 6 }, ': p = ', val]);
  } else setSlots($('#sino-readout'), [NA, ' angles × ', { v: sc.M, dec: 0, w: 3 }, ' detector bins']);
  setSlots($('#sino-note'), state.point ? ['the dashed curve: (', { v: state.point.x, dec: 2, w: 5 }, ', ', { v: state.point.y, dec: 2, w: 5 }, ')'] : []);
  // Fourier space.
  const hk = hover.kspace;
  if (hk) {
    const k = Math.hypot(hk.x, hk.y);
    setSlots($('#k-readout'), ['kx ', { v: hk.x, dec: 1, w: 6 }, ', ky ', { v: hk.y, dec: 1, w: 6 }, ': |k| ', { v: k, dec: 1, w: 5 },
      ', wavelength ', k ? { v: TWO_PI / k, dec: 3, w: 6 } : { text: '∞', w: 6 }]);
  } else setSlots($('#k-readout'), [{ v: sc.count, dec: 0, w: 3 }, ' slices of ', { v: sc.L, dec: 0, w: 4 }, ' samples; detector Nyquist π/ds = ', { v: Math.PI / sc.ds, dec: 1, w: 5 }]);
  $('#k-note').textContent = state.under ? 'slices over the object’s 2D transform' : 'one slice per projection';
  // The reconstructions.
  const hb = hover.bp;
  setSlots($('#bp-readout'), hb ? [...XY(hb), { v: pixel(sc.bp, hb.x, hb.y), dec: 3, w: 7 }] : ['its own grey scale']);
  if (rmsCache.key !== `${data}:${objVersion}`) {
    rmsCache = { key: `${data}:${objVersion}`, rms: sc.count ? sc.rmsError(sc.fbp) : NaN, smooth: sc.count ? rmsSmooth(sc.fbp) : NaN };
  }
  const hf = hover.fbp, rms = rmsCache.rms, smooth = rmsCache.smooth;
  state.rmsSmooth = smooth;
  setSlots($('#fbp-readout'), hf ? [...XY(hf), { v: pixel(sc.fbp, hf.x, hf.y), dec: 4, w: 7 }, ' (object ', { v: pixel(sc.truth, hf.x, hf.y), dec: 4, w: 7 }, ')']
    : ['RMS error ', RMS(rms), ...(Number.isFinite(smooth) ? [', away from edges ', RMS(smooth)] : [])]);
  state.rms = rms;
  setSlots($('#fbp-note'), [FILTERS[sc.opts.filter].label, ...(sc.opts.cutoff < 1 ? [', cut at ', { v: sc.opts.cutoff, dec: 2, w: 4 }] : [])]);
  // The sixth panel.
  const he = hover.extra;
  if (state.view === 'direct') {
    const img = directCache.img, e = img && sc.count ? sc.rmsError(img) : NaN;
    state.rmsDirect = e;
    setSlots($('#extra-readout'), he ? [...XY(he), { v: pixel(img || sc.fbp, he.x, he.y), dec: 4, w: 7 }] : ['RMS error ', RMS(e)]);
    $('#extra-note').textContent = 'slices gridded, one inverse FFT';
  } else if (state.view === 'profile') {
    setSlots($('#extra-readout'), ['along y = ', { v: state.py0, dec: 3, w: 6 }, ' (drag on a reconstruction to move it)']);
    $('#extra-note').textContent = '';
  } else {
    const jr = projRow();
    setSlots($('#extra-readout'), jr >= 0 ? ['angle ', { v: jr + 1, dec: 0, w: 3 }, ': click the sinogram to choose another'] : ['nothing measured yet']);
    $('#extra-note').textContent = '';
  }
}

// ------------------------------------------------------------------------ pointing

function worldOf(canvas, e, W) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width - 0.5) * 2 * W, y: (0.5 - (e.clientY - r.top) / r.height) * 2 * W };
}

// The scanner: point at the object, or paint on it.
const scanCanvas = $('#scanner');
let brushHover = null, painting = null;
function pixelOf(p) { return { i: Math.round(p.x / H + N / 2), j: Math.round(N / 2 - p.y / H) }; }
function startPainting() {
  if (state.camera?.live) pauseCamera();
  if (sc.shapes || state.obj !== 'painted') {
    // From now on the object is a picture.
    sc.setPicture(sc.truth);
    state.obj = 'painted';
    updateObjectUI(); updateHash();
  }
}
function paintAt(p, last) {
  const value = state.tool === 'eraser' ? 0 : state.brush.value, brush = { shape: 'round', size: state.brush.size };
  const im = paintIm.length === N * N ? paintIm : (paintIm = new Float64Array(N * N));
  const a = pixelOf(p);
  if (last) { const b = pixelOf(last); paintStroke(sc.truth, im, N, b.i, b.j, a.i, a.j, brush, value, 0); }
  else paint(sc.truth, im, N, a.i, a.j, brush, value, 0);
  maskToCircle(sc.truth);
  sc.setPicture(sc.truth);
  objectEdited();
}
let paintIm = new Float64Array(0);

scanCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  scanCanvas.setPointerCapture(e.pointerId);
  const p = worldOf(scanCanvas, e, SCAN_W);
  if (state.tool === 'look') {
    state.point = Math.hypot(p.x, p.y) <= 1.02 ? { ...p, pinned: true } : null;
    dragging = 'look';
  } else {
    if (Math.hypot(p.x, p.y) > 1) return;
    startPainting();
    painting = p;
    paintAt(p, null);
  }
  dirty = true; schedule();
  e.preventDefault();
});
let dragging = null;
scanCanvas.addEventListener('pointermove', (e) => {
  const p = worldOf(scanCanvas, e, SCAN_W);
  hover.scanner = p;
  if (state.tool === 'look') {
    if (dragging === 'look' || !state.point?.pinned) state.point = Math.hypot(p.x, p.y) <= 1.02 ? { ...p, pinned: dragging === 'look' } : (state.point?.pinned ? state.point : null);
  } else {
    brushHover = p;
    if (painting) { paintAt(p, painting); painting = p; }
  }
  dirty = true; schedule();
});
const endScan = () => { dragging = null; if (painting) { painting = null; spectrumStale = true; } dirty = true; schedule(); };
scanCanvas.addEventListener('pointerup', endScan);
scanCanvas.addEventListener('pointercancel', endScan);
scanCanvas.addEventListener('pointerleave', () => {
  hover.scanner = null; brushHover = null;
  if (state.point && !state.point.pinned) state.point = null;
  dirty = true; schedule();
});

// The sinogram: pick a ray.
const sinoCanvas = $('#sinogram');
function sinoAt(e) {
  const r = sinoCanvas.getBoundingClientRect(), g = sinoGeom();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const th = g.th(py), j = Math.round(th / sc.dth), s = g.s(px);
  return j >= 0 && j < sc.nA && th <= sc.opts.range && Math.abs(s) <= 1 ? { j, s } : null;
}
let pickingSino = false;
sinoCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  sinoCanvas.setPointerCapture(e.pointerId);
  pickingSino = true;
  state.pick = sinoAt(e);
  dirty = true; schedule();
});
sinoCanvas.addEventListener('pointermove', (e) => {
  const a = sinoAt(e);
  hover.sinogram = a;
  if (pickingSino && a) state.pick = a;
  dirty = true; schedule();
});
const endSino = () => { pickingSino = false; };
sinoCanvas.addEventListener('pointerup', endSino);
sinoCanvas.addEventListener('pointercancel', endSino);
sinoCanvas.addEventListener('pointerleave', () => { hover.sinogram = null; dirty = true; schedule(); });

// Fourier space: read out k.
const kCanvasEl = $('#kspace');
kCanvasEl.addEventListener('pointermove', (e) => { hover.kspace = worldOf(kCanvasEl, e, KMAX / state.kz); dirty = true; schedule(); });
const kZoom = $('#k-zoom');
for (const z of [1, 2, 4]) kZoom.append(el('option', { value: z }, z === 1 ? 'Whole' : `${z}× zoom`));
kZoom.addEventListener('change', () => { state.kz = +kZoom.value; dirty = true; updateHash(); schedule(); });
kCanvasEl.addEventListener('pointerleave', () => { hover.kspace = null; dirty = true; schedule(); });

// The reconstructions: read out values; drag to move the profile.
for (const [id, key] of [['#bp', 'bp'], ['#fbp', 'fbp'], ['#extra', 'extra']]) {
  const cv = $(id);
  let down = false;
  const setProfile = (p) => {
    state.py0 = Math.max(-0.99, Math.min(0.99, p.y));
    profileSlider.value = +state.py0.toFixed(3);
  };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || state.view !== 'profile' || key === 'extra') return;
    cv.setPointerCapture(e.pointerId); down = true;
    setProfile(worldOf(cv, e, 1));
    dirty = true; schedule();
  });
  cv.addEventListener('pointermove', (e) => {
    if (key === 'extra' && state.view !== 'direct') return;
    const p = worldOf(cv, e, 1);
    hover[key] = Math.hypot(p.x, p.y) <= 1 ? p : null;
    if (down) setProfile(p);
    dirty = true; schedule();
  });
  const up = () => { down = false; updateHash(); };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hover[key] = null; dirty = true; schedule(); });
}

// ------------------------------------------------------------------------ controls

const playButton = $('#play');
function updatePlay() {
  playButton.textContent = state.playing ? 'Pause' : state.done ? 'Play' : 'Go on';
}
playButton.addEventListener('click', () => {
  if (state.playing) state.playing = false;
  else if (state.done && !state.keep) { sc.pass++; restartScan(); return; }
  else { state.playing = true; state.progress = state.next; }
  updatePlay(); dirty = true; schedule();
});
$('#again').addEventListener('click', () => { sc.pass++; restartScan(); });
$('#finish').addEventListener('click', finishScan);

const speedSlider = slider({ label: 'Speed (°/s)', min: 2, max: 720, log: true, value: state.speed, title: 'How fast the scanner turns, in degrees per second',
  onInput: (v) => { state.speed = v; updateHash(); } });
$('#speed-box').append(speedSlider);
const keepToggle = toggle('Keep turning', state.keep, (on) => {
  state.keep = on;
  if (on && !state.playing) {
    if (state.done) { sc.pass++; restartScan(); } else { state.playing = true; state.progress = state.next; }
  }
  updatePlay(); updateHash(); schedule();
}, 'Turn round and round, replacing each angle with a fresh measurement (changes to the object show up as the scanner passes)');
$('#keep-box').append(keepToggle);

// Objects.
const objectButtons = {};
for (const o of OBJECTS) {
  const b = el('button', { type: 'button', title: o.title, 'aria-pressed': 'false', onclick: () => chooseObject(o.id) }, o.label);
  $('#objects').append(b);
  objectButtons[o.id] = b;
}
const gallery = $('#gallery');
gallery.append(el('option', { value: '', disabled: true, selected: true }, 'Pictures…'));
for (const p of GALLERY) if (p.side === 'x' && p.id !== 'portrait') gallery.append(el('option', { value: `g:${p.id}`, title: p.title }, p.label));
gallery.addEventListener('change', () => { chooseObject(gallery.value); gallery.value = ''; });

function chooseObject(id) {
  setObject(id);
}

// Options that belong to one object.
const contrastSeg = segmented([
  { value: 'modified', label: 'High contrast', title: 'Toft’s modified phantom: skull 1, brain 0.2, the details 0.1 apart' },
  { value: 'original', label: '1974', title: 'Shepp and Logan’s original: skull 2, brain 1.02, the details only 0.01 apart (realistic attenuations)' },
], state.contrast, (v) => { state.contrast = v; setObject('phantom'); }, { label: 'Contrast' });
const pxSlider = slider({ label: 'x₀', min: -0.9, max: 0.9, step: 0.005, value: state.px, onInput: (v) => { state.px = v; movePoint(); } });
const pySlider = slider({ label: 'y₀', min: -0.9, max: 0.9, step: 0.005, value: state.py, onInput: (v) => { state.py = v; movePoint(); } });
function movePoint() {
  sc.setShapes(shapesFor.point());
  objectEdited();
  updateHash();
}
const formulaField = exprField({
  label: '<math><mi>f</mi><mo>(</mo><mi>x</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo></math>',
  value: state.f, params: state.fp, variables: ['x', 'y', 'r', 'theta'], hints: FORMULA_HINTS,
  onChange: (expr, params) => {
    formulaExpr = expr; state.f = expr.source; state.fp = params;
    if (state.obj !== 'formula') return;
    sc.setPicture(formulaPicture());
    objectEdited();
    updateHash();
  },
});
formulaExpr = formulaField.expr;
const formulaPresets = el('div', { class: 'formula-presets' }, ...FORMULAS.map((p) => el('button', { type: 'button', onclick: () => setFormula(p.f, p.fp) }, p.label)));
const formulaHelp = el('div', { class: 'small muted' }, 'x, y, r and θ (theta) are coordinates; the scan circle has radius 1.  Other names become sliders.');
function setFormula(f, fp) {
  state.f = f; state.fp = { ...fp };
  formulaField.set(f, fp, false);
  formulaExpr = formulaField.expr;
  setObject('formula');
}

function updateObjectUI() {
  for (const [id, b] of Object.entries(objectButtons)) b.setAttribute('aria-pressed', String(id === state.obj));
  const box = $('#object-options');
  box.replaceChildren();
  if (state.obj === 'phantom') box.append(contrastSeg);
  else if (state.obj === 'point') box.append(pxSlider, pySlider);
  else if (state.obj === 'formula') box.append(formulaPresets, formulaField, formulaHelp);
  else if (state.obj === 'painted') box.append(el('div', { class: 'small muted' }, 'Painted: projected numerically from now on.'));
  else if (state.obj.startsWith('g:') || state.obj === 'custom' || state.obj === 'camera') box.append(el('div', { class: 'small muted' }, 'A picture: projected numerically (line sums with linear interpolation).'));
  contrastSeg.value = state.contrast;
}

// Tools.
const toolSeg = segmented([
  { value: 'look', label: 'Point at', title: 'Point at the object to see its sinusoid in the sinogram (click to pin it)' },
  { value: 'brush', label: 'Brush', title: 'Paint attenuation onto the object' },
  { value: 'eraser', label: 'Eraser', title: 'Paint zero' },
], state.tool, (v) => setTool(v), { label: 'Tool' });
$('#tool-box').append(el('span', { class: 'small muted' }, 'Tool'), toolSeg);
const sizeSlider = slider({ label: 'Brush size', min: 1, max: 60, step: 1, value: state.brush.size, onInput: (v) => { state.brush.size = Math.round(v); } });
const valueSlider = slider({ label: 'Attenuation', min: 0, max: 3, step: 0.01, value: state.brush.value, title: 'What the brush paints, in units of water', onInput: (v) => { state.brush.value = v; } });
function setTool(t) {
  state.tool = t; toolSeg.value = t;
  $('#brush-box').replaceChildren(...(t === 'brush' ? [sizeSlider, valueSlider] : t === 'eraser' ? [sizeSlider] : []));
  scanCanvas.classList.toggle('brush', t !== 'look');
  if (t !== 'look' && state.point && !state.point.pinned) state.point = null;
  dirty = true; schedule();
}

// Pictures of your own.
async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That is not a picture.'); return; }
  try {
    const img = await createImageBitmap(file);
    if (state.camera) stopCamera();
    sc.setPicture(maskToCircle(Float64Array.from(imageData(img, N, 'fit')[0])));
    state.obj = 'custom';
    objectChanged(true); restartScan(); updateObjectUI(); updateHash();
  } catch { toast('Could not read that picture.'); }
}
$('#upload').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
const dropZone = $('#cell-scan .sq');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drop'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drop'); loadFile(e.dataTransfer.files[0]); });
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

// The camera: the scanner keeps turning, and each angle sees the picture of its moment.
const cameraButton = $('#camera');
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const video = el('video', { muted: true, playsInline: true });
    video.srcObject = stream;
    await video.play();
    state.camera = { stream, video, live: true, first: true };
    state.obj = 'camera';
    cameraButton.setAttribute('aria-pressed', 'true'); cameraButton.textContent = 'Camera';
    state.keep = true; keepToggle.on = true;
    updateObjectUI(); updateHash();
    restartScan();
  } catch {
    toast(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'No camera available (or permission was refused).' : 'Browsers allow the camera only on https:// pages.');
  }
}
function grabCamera() {
  const cam = state.camera;
  if (cam.video.readyState < 2) return;
  const f = imageData(cam.video, N, 'fit')[0], g = new Float64Array(N * N);
  // A mirror image, as people expect of a camera facing them.
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) g[j * N + i] = f[j * N + (N - 1 - i)];
  sc.setPicture(maskToCircle(g));
  objectChanged(cam.first);
  cam.first = false;
}
function pauseCamera() {
  if (!state.camera) return;
  state.camera.live = false;
  cameraButton.setAttribute('aria-pressed', 'false'); cameraButton.textContent = 'Camera (paused)';
}
function stopCamera() {
  if (!state.camera) return;
  state.camera.stream.getTracks().forEach((t) => t.stop());
  state.camera = null;
  cameraButton.setAttribute('aria-pressed', 'false'); cameraButton.textContent = 'Camera';
}
cameraButton.addEventListener('click', () => {
  if (!state.camera) startCamera();
  else if (state.camera.live) { stopCamera(); setObject('portrait'); }
  else { state.camera.live = true; cameraButton.setAttribute('aria-pressed', 'true'); cameraButton.textContent = 'Camera'; schedule(); }
});

// The scanner's geometry and its photons.
const anglesSlider = slider({ label: 'Angles', min: 1, max: 720, log: true, step: 1, value: state.na, title: 'How many projections, evenly spread over the range',
  onInput: (v) => { state.na = Math.max(1, Math.round(v)); anglesSlider.value = state.na; reconfigure({ nA: state.na }); } });
const rangeSlider = slider({ label: 'Range (°)', min: 5, max: 180, step: 1, value: state.range, title: 'The angle the scanner turns through (180° measures every line once)',
  onInput: (v) => { state.range = v; reconfigure({ range: v * DEG }); } });
const detSlider = slider({ label: 'Detector bins', min: 8, max: 512, log: true, step: 2, value: state.nd, title: 'How many detector bins span the scan circle',
  onInput: (v) => { state.nd = Math.max(8, 2 * Math.round(v / 2)); detSlider.value = state.nd; reconfigure({ M: state.nd }); } });
$('#geometry').append(anglesSlider, rangeSlider, detSlider);
const noiseToggle = toggle('Photon noise', state.noise, (on) => { state.noise = on; reconfigure({ noise: on }); photonsSlider.hidden = !on; },
  'Count photons: each ray gets a Poisson-distributed number out of I0 sent');
$('#noise-box').append(noiseToggle);
const photonsSlider = slider({ label: 'Photons I₀', labelHTML: false, min: 100, max: 1e8, log: true, value: state.I0, title: 'Photons sent along each ray at each angle',
  onInput: (v) => { state.I0 = v; reconfigure({ I0: v }); } });
$('#photons-box').append(photonsSlider);
photonsSlider.hidden = !state.noise;
const apertureSlider = slider({ label: 'Detector width', min: 0.05, max: 1, step: 0.01, value: state.ap, title: 'Each bin’s width as a fraction of the spacing: 1, side by side; small, point samples',
  onInput: (v) => { state.ap = v; reconfigure({ aperture: v }); } });
const beamSeg = segmented([
  { value: false, label: 'One energy', title: 'A monochromatic beam' },
  { value: true, label: 'Two energies', title: 'Half the photons absorbed 4/3 as strongly as water’s mean, half 2/3: beam hardening' },
], state.poly, (v) => { state.poly = v; reconfigure({ poly: v }); }, { label: 'Beam' });
$('#more-box').append(apertureSlider, el('div', { class: 'small muted' }, 'Beam'), beamSeg);

// The filter.
const filterSeg = segmented(Object.entries(FILTERS).map(([value, f]) => ({ value, label: f.label, title: f.title })), state.filter,
  (v) => { state.filter = v; reconfigure({ filter: v }); }, { label: 'Filter' });
$('#filter-box').append(filterSeg);
const cutoffSlider = slider({ label: 'Cutoff', min: 0.05, max: 1, step: 0.01, value: state.cut, title: 'The highest frequency the filter keeps, as a fraction of the detector’s Nyquist frequency π/ds',
  onInput: (v) => { state.cut = v; reconfigure({ cutoff: v }); } });
$('#cutoff-box').append(cutoffSlider);

// What to show.
const loSlider = slider({ label: 'Black at', min: -0.5, max: 2.5, step: 0.001, value: 0, title: 'The value drawn black in the object and the reconstructions',
  onInput: (v) => { state.lo = v; if (state.hi === null) state.hi = window_()[1]; dirty = true; updateHash(); schedule(); } });
const hiSlider = slider({ label: 'White at', min: -0.5, max: 2.5, step: 0.001, value: 1, title: 'The value drawn white',
  onInput: (v) => { state.hi = v; if (state.lo === null) state.lo = window_()[0]; dirty = true; updateHash(); schedule(); } });
const autoButton = el('button', { type: 'button', title: 'Black at the object’s smallest value, white at its largest', onclick: () => { autoWindow(); updateHash(); } }, 'Whole range');
$('#window-box').append(loSlider, hiSlider, el('div', { class: 'row' }, autoButton));
function autoWindow() {
  state.lo = null; state.hi = null;
  syncWindowSliders();
  dirty = true; schedule();
}
function setWindow(lo, hi) { state.lo = lo; state.hi = hi; syncWindowSliders(); dirty = true; schedule(); }
function syncWindowSliders() {
  const [lo, hi] = window_(), [a, b] = state.objRange;
  const span = Math.max(b - a, hi - lo, 1e-3);
  loSlider.setRange(Math.min(a - 0.25 * span, lo), Math.max(b, hi)); hiSlider.setRange(Math.min(a, lo), Math.max(b + 0.25 * span, hi));
  loSlider.value = +lo.toPrecision(4); hiSlider.value = +hi.toPrecision(4);
}
const profileSlider = slider({ label: 'Profile at y', min: -0.99, max: 0.99, step: 0.005, value: state.py0, title: 'The height of the profile in the sixth panel',
  onInput: (v) => { state.py0 = v; dirty = true; updateHash(); schedule(); } });
$('#window-box').append(profileSlider);
const underToggle = toggle('Object’s transform underneath', state.under, (on) => { state.under = on; kStale = true; dirty = true; updateHash(); schedule(); },
  'Draw the object’s own 2D Fourier transform faintly under the measured slices');
const circleToggle = toggle('Circles', state.circles, (on) => { state.circles = on; dirty = true; schedule(); },
  'In Fourier space: the detector’s Nyquist frequency π/ds (dashed), and the radius n_θ inside which the angles sample fully (dotted)');
$('#show-box').append(underToggle, circleToggle);

const extraSelect = $('#extra-view');
for (const [v, label] of [['profile', 'Profile through the pictures'], ['projection', 'One projection, filtered'], ['direct', 'Direct Fourier reconstruction']]) extraSelect.append(el('option', { value: v }, label));
extraSelect.value = state.view;
extraSelect.addEventListener('change', () => setView(extraSelect.value));
function setView(v) { state.view = v; extraSelect.value = v; directCache.key = ''; dirty = true; updateHash(); schedule(); }

new ResizeObserver(() => { filterPlotStale = true; dirty = true; schedule(); }).observe($('.tomo'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { filterPlotStale = true; dirty = true; schedule(); });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); playButton.click(); }
});

// ----------------------------------------------------------------------- the address

let hashTimer = 0;
function updateHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = {};
    const put = (k, v) => { if (v !== DEFAULTS[k] && v !== null && v !== undefined) h[k] = v; };
    if (!['painted', 'custom', 'camera'].includes(state.obj)) put('obj', state.obj);
    if (state.obj === 'phantom') put('contrast', state.contrast);
    if (state.obj === 'point') { put('px', state.px); put('py', state.py); }
    if (state.obj === 'formula') { h.f = state.f; h.fp = Object.entries(state.fp).map(([k, v]) => `${k}:${+v.toPrecision(5)}`).join(','); }
    put('na', state.na); put('range', state.range); put('nd', state.nd); put('ap', state.ap);
    if (state.noise) { h.noise = 1; h.I0 = +state.I0.toPrecision(3); }
    if (state.poly) h.poly = 1;
    put('filter', state.filter); put('cut', state.cut);
    put('speed', +state.speed.toPrecision(3)); if (state.keep) h.keep = 1;
    put('view', state.view); put('kz', state.kz); if (state.under) h.under = 1; if (!state.circles) h.circles = 0;
    if (state.lo !== null) { h.lo = +state.lo.toPrecision(4); h.hi = +state.hi.toPrecision(4); }
    put('py0', +state.py0.toFixed(3));
    writeHash(h);
  }, 200);
}

// ---------------------------------------------------------------------- experiments

/** Put everything back to the defaults, then apply a set-up's changes, and start scanning. */
async function apply(changes = {}) {
  const s = { ...structuredClone(DEFAULTS), ...changes };
  Object.assign(state, { contrast: s.contrast, px: s.px, py: s.py, f: s.f, fp: s.fp, na: s.na, range: s.range, nd: s.nd, ap: s.ap,
    noise: s.noise, I0: s.I0, poly: s.poly, filter: s.filter, cut: s.cut, speed: s.speed, keep: s.keep, view: s.view, under: s.under,
    circles: s.circles, py0: s.py0, kz: s.kz });
  kZoom.value = s.kz;
  state.pick = null; state.point = s.point || null;
  // The controls.
  speedSlider.value = s.speed; keepToggle.on = s.keep;
  anglesSlider.value = s.na; rangeSlider.value = s.range; detSlider.value = s.nd; apertureSlider.value = s.ap;
  noiseToggle.on = s.noise; photonsSlider.value = s.I0; photonsSlider.hidden = !s.noise; beamSeg.value = s.poly;
  filterSeg.value = s.filter; cutoffSlider.value = s.cut;
  underToggle.on = s.under; circleToggle.on = s.circles; profileSlider.value = s.py0;
  pxSlider.value = s.px; pySlider.value = s.py;
  extraSelect.value = s.view;
  $('#more').open = s.ap !== 1 || s.poly;
  setTool(s.tool || 'look');
  if (s.obj === 'formula') { formulaField.set(s.f, s.fp, false); formulaExpr = formulaField.expr; }
  cancelJobs();
  sc.reset();
  sc.configure({ nA: s.na, range: s.range * DEG, M: s.nd, aperture: s.ap, noise: s.noise, I0: s.I0, poly: s.poly, filter: s.filter, cutoff: s.cut });
  filterPlotStale = true; directCache.key = '';
  await setObject(s.obj);
  if (s.lo !== null && s.lo !== undefined) setWindow(s.lo, s.hi); else autoWindow();
  updateHash();
}

const setups = {
  sinusoid: () => apply({ obj: 'point', px: 0.45, py: 0.25, speed: 30, view: 'projection' }),
  smear: () => apply({ obj: 'phantom', na: 1 }),
  blur: () => apply({ obj: 'point', px: 0.3, py: 0.2, py0: 0.2, na: 360, speed: 120 }),
  ramp: () => apply({ obj: 'phantom', view: 'projection', speed: 30 }),
  slice: () => apply({ obj: 'formula', f: FORMULAS[0].f, fp: { k: 40, a: 1.0472 }, na: 36, speed: 12, under: true, kz: 4 }),
  density: () => apply({ obj: 'phantom', na: 12, speed: 20, view: 'direct' }),
  streaks: () => apply({ obj: 'phantom', na: 24, speed: 30 }),
  wedge: () => apply({ obj: 'phantom', range: 110, na: 110, speed: 30, py0: 0.35 }),
  noise: () => apply({ obj: 'phantom', contrast: 'original', noise: true, I0: 1e5, lo: 0.95, hi: 1.1, py0: 0.1 }),
  aliasing: () => apply({ obj: 'formula', f: '(r < 0.9)*(1 + cos(k*r^2))/2', fp: { k: 100 }, nd: 64, ap: 0.2, speed: 90 }),
  metal: () => apply({ obj: 'metal', noise: true, I0: 1e5, poly: true, filter: 'hann', lo: 0.9, hi: 1.15, py0: -0.28, speed: 90 }),
  faint: () => apply({ obj: 'phantom', contrast: 'original', lo: 1, hi: 1.05, py0: -0.605, speed: 90 }),
  picture: () => apply({ obj: 'portrait', na: 360, speed: 90 }),
};
const help = drawer($('#help'), $('#help-button'), setups);

// --------------------------------------------------------------------------- start

function fromHash(h) {
  const num = (v, d) => (v !== undefined && Number.isFinite(+v) ? +v : d);
  const c = {
    obj: h.obj || DEFAULTS.obj, contrast: h.contrast === 'original' ? 'original' : 'modified',
    px: num(h.px, DEFAULTS.px), py: num(h.py, DEFAULTS.py),
    na: num(h.na, DEFAULTS.na), range: num(h.range, DEFAULTS.range), nd: num(h.nd, DEFAULTS.nd), ap: num(h.ap, DEFAULTS.ap),
    noise: h.noise === '1', I0: num(h.I0, DEFAULTS.I0), poly: h.poly === '1',
    filter: FILTERS[h.filter] ? h.filter : DEFAULTS.filter, cut: num(h.cut, DEFAULTS.cut),
    speed: num(h.speed, DEFAULTS.speed), keep: h.keep === '1',
    view: ['profile', 'projection', 'direct'].includes(h.view) ? h.view : DEFAULTS.view,
    under: h.under === '1', circles: h.circles !== '0', py0: num(h.py0, DEFAULTS.py0), kz: [1, 2, 4].includes(+h.kz) ? +h.kz : 1,
    lo: h.lo !== undefined ? +h.lo : null, hi: h.hi !== undefined ? +h.hi : null,
  };
  if (h.f) {
    c.f = h.f;
    c.fp = {};
    for (const part of (h.fp || '').split(',')) { const [k, v] = part.split(':'); if (k && Number.isFinite(+v)) c.fp[k] = +v; }
  }
  const valid = OBJECTS.some((o) => o.id === c.obj) || (c.obj.startsWith('g:') && GALLERY.some((p) => `g:${p.id}` === c.obj));
  if (!valid) c.obj = DEFAULTS.obj;
  return c;
}

const hash = readHash();
updatePlay();
const ready = setups[hash.setup] ? setups[hash.setup]().then(() => help.open()) : apply(fromHash(hash));

// For the tests (tools/cdp.py), and for curious students with the console open.
window.__app = {
  Scanner, state, sc, setups, setObject, reconfigure, finishScan, restartScan, setView, setWindow, setTool,
  get idle() { return !jobs.flight && !jobs.target && !rescanSoon; }, get workers() { return workers ? workers.length : 0; },
  get rms() { return state.rms; }, get rmsSmooth() { return state.rmsSmooth; }, get rmsDirect() { return state.rmsDirect; }, directImage, draw, ready: false,
};
ready.then(() => { window.__app.ready = true; });
