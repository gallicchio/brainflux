// Drums and billiards: draw a shape, find its modes from the motion as a spectroscopist would,
// hear it as a drum, watch it as a quantum billiard.

import { Grid, Membrane, Billiard, packet, bump, randomState, Signal, findPeaks, ModeFilter, realPart, WINDOW_FWHM, energyStats } from './sim.js';
import { PRESETS, maskFromSdf, maskFromValues, paintMask, maskGeometry } from './shapes.js';
import { hearShape, spacings, histogram, weyl, poisson, wigner, gridCorrected } from './counting.js';
import { synthesize, play, stop as stopSound, SAMPLE_RATE } from './sound.js';
import { Ray } from './ray.js';
import { fft } from '../lib/fft.js';
import { colorize, autoBrightness } from '../lib/complexcolor.js';
import { el, $, slider, segmented, toggle, exprField, drawer, readHash, writeHash, fmt, toast } from '../lib/ui.js';
import { fitCanvas, Frame, themeColors, contour } from '../lib/plot.js';

const L_PHYS = 0.3;          // the box is 30 cm wide, for the drum's frequencies in hertz
const MODES = 80;            // exact modes (with eigenvectors) computed for every shape
const COUNT = 200;           // eigenvalues for Weyl's law and the level statistics

const state = {
  mode: 'quantum',           // 'quantum' | 'drum'
  shape: 'stadium',          // a preset id, 'typed' or 'drawn'
  params: {},                // the preset's parameters
  n: 128,
  tool: 'act',               // 'act' (strike / launch) | 'draw' | 'erase'
  brush: 3,
  speed: { quantum: 0.02, drum: 0.5 },
  fast: false,
  running: true,
  start: 'packet',           // quantum: 'packet' | 'random' | 'mode'; drum: 'strike' | 'mode'
  k: 30, angle: 0.6, sigma: 0.07, launch: { x: -0.22, y: -0.06 },
  strike: { x: 0.17, y: 0.07 }, mallet: 0.03,
  c: 100, ring: 1.2, volume: 0.5, sound: true, soundKind: 'strike',
  ray: true, sand: false, log: false, bright: 0,
  countTab: 'list',
  weylResidual: false,
  seed: 0,                   // the random state's seed (0: a new one each time)
  specMax: null,             // the spectrum's range, in λ
};

let grid = null, geo = null, mask = null;
let sim = null, signal = null, stride = 1, stepCount = 0;
let probe = null, psi0 = null, startField = null;
let filter = null, selected = null;   // selected: {kind: 'peak', lambda, Omega} | {kind: 'exact', k}
let ray = null, autoR = 1, conserved0 = 1, startStats = { mean: 0, spread: 0 };
let modes = null;                     // {key, values, vectors, nvec, pts, N}
let counted = null;                   // {key, values}
let pinned = null;                    // {label, values}
let solving = null;                   // {key, progress, purpose}
let spec = null, specDirty = true, modeDirty = true, countDirty = true;
let typedField = null, typedExpr = null, typedParams = {};

// ------------------------------------------------------------------ units

const isQ = () => state.mode === 'quantum';
/** The spectrum's variable from λ: E = λ/2 (ħ = m = 1, box side 1) or f in Hz. */
const xOf = (lambda) => (isQ() ? lambda / 2 : (state.c * Math.sqrt(Math.max(0, lambda))) / (2 * Math.PI * L_PHYS));
const lambdaOfX = (x) => (isQ() ? 2 * x : ((2 * Math.PI * L_PHYS * x) / state.c) ** 2);
const xUnit = () => (isQ() ? 'E' : 'f (Hz)');
/** λ from the numerical frequency Ω of the time stepper, and back. */
const lambdaOfOmega = (Om) => (isQ() ? 2 * sim.trueOmega(Om) : sim.trueOmega(Om) ** 2);
const omegaOfLambda = (l) => (isQ() ? sim.numericalOmega(l / 2) : sim.numericalOmega(Math.sqrt(l)));
const fmtX = (x) => (isQ() ? fmt(x, 4) : `${fmt(x, 4)}`);

// ------------------------------------------------------------------ the shape

function presetParams(id) {
  const p = PRESETS[id];
  return Object.fromEntries(Object.entries(p.params).map(([k, v]) => [k, v.value]));
}

function shapeKey() {
  if (state.shape === 'drawn') return `drawn:${state.n}:${rle(mask)}`;
  if (state.shape === 'typed') return `typed:${state.n}:${typedField.source}:${JSON.stringify(typedParams)}`;
  return `${state.shape}:${state.n}:${JSON.stringify(state.params)}`;
}

/** Build the mask and geometry of the current shape (not for 'drawn': the mask is the shape). */
function buildShape() {
  const n = state.n, h = 1 / (n - 1);
  if (state.shape === 'typed') {
    const N = n * n, x = new Float64Array(N), y = new Float64Array(N), r = new Float64Array(N), th = new Float64Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const g = j * n + i, xv = -0.5 + i * h, yv = -0.5 + j * h;
      x[g] = xv; y[g] = yv; r[g] = Math.hypot(xv, yv); th[g] = Math.atan2(yv, xv);
    }
    let vals;
    try { vals = typedExpr.evaluate({ x, y, r, theta: th, ...typedParams }, N).re; } catch { vals = new Float64Array(N); }
    mask = maskFromValues(n, vals);
    geo = { ...maskGeometry(mask, n, contour), outline: [] };
  } else if (state.shape === 'drawn') {
    geo = { ...maskGeometry(mask, n, contour), outline: [] };
  } else {
    geo = PRESETS[state.shape].make(state.params, h);
    mask = maskFromSdf(n, geo.sdf);
  }
  grid = new Grid(n, mask);
  wallImage = null;
}

function setShape(id, params, { keepRun = false } = {}) {
  if (id !== 'drawn' && id !== 'typed') {
    state.params = { ...presetParams(id), ...(params || {}) };
  }
  state.shape = id;
  if (id === 'typed') { typedExpr = typedField.expr; typedParams = typedField.params; }
  buildShape();
  showShapeControls();
  requestModes();
  if (!keepRun) {
    // A start point outside the new shape moves to its middle.
    if (!insideAt(state.launch.x, state.launch.y)) state.launch = centreOfMass();
    if (!insideAt(state.strike.x, state.strike.y)) state.strike = centreOfMass();
    if (state.start === 'mode') state.start = isQ() ? 'packet' : 'strike';
  }
  restart();
  updateHash();
}

function insideAt(x, y) {
  const g = grid.nearest(x, y);
  return g >= 0 && mask[g] === 1;
}

function centreOfMass() {
  let sx = 0, sy = 0, c = 0;
  for (const g of grid.inner) { const i = g % grid.n, j = (g - i) / grid.n; sx += i; sy += j; c++; }
  if (!c) return { x: 0, y: 0 };
  // The free point nearest the centre of mass (a ring's centre of mass is not inside it).
  const ci = sx / c, cj = sy / c;
  let best = grid.inner[0], bd = Infinity;
  for (const g of grid.inner) { const i = g % grid.n, j = (g - i) / grid.n, d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = g; } }
  const i = best % grid.n, j = (best - i) / grid.n;
  return { x: -0.5 + i * grid.h, y: -0.5 + j * grid.h };
}

// ------------------------------------------------------------------ the run

function restart() {
  if (!grid || grid.N === 0) { sim = null; signal = null; drawStage(); return; }
  const n = grid.n, N = n * n;
  filter = null;
  stepCount = 0;
  ray = null;
  let lamMean, lamSpread;
  if (isQ()) {
    sim = new Billiard(grid);
    let re, im;
    if (state.start === 'mode' && startField) { re = Float64Array.from(startField); im = new Float64Array(N); }
    else if (state.start === 'random') {
      // Smoothed noise puts a weight ∝ exp(−λ/kmax²) on each mode, on average.  With kmax² = 1.5
      // times the MODES-th eigenvalue (near 4π·MODES/A, by Weyl's law) the modes the solver
      // finds all get comparable weights, falling by half from the first to the last.
      const kmax = Math.sqrt((1.5 * 4 * Math.PI * MODES) / Math.max(0.02, geo.area));
      [re, im] = randomState(grid, kmax, state.seed || 1 + Math.floor(Math.random() * 1e6), true, geo.sdf);
    }
    else {
      [re, im] = packet(grid, state.launch.x, state.launch.y, state.k * Math.cos(state.angle), state.k * Math.sin(state.angle), state.sigma, geo.sdf);
      // The classical particle, at the packet's group velocity on this grid (short waves on a
      // grid are a little slower than k: v = sin(kh)/h along each axis).
      const kx = state.k * Math.cos(state.angle), ky = state.k * Math.sin(state.angle), h = grid.h;
      const vg = Math.hypot(Math.sin(kx * h) / h, Math.sin(ky * h) / h);
      ray = new Ray(geo.sdf, state.launch.x, state.launch.y, Math.cos(state.angle), Math.sin(state.angle), vg, h / 3);
      ray.t = 0;
    }
    psi0 = [Float64Array.from(re), Float64Array.from(im)];
    sim.set(re, im);
    const st = energyStats(grid, re, im, 1);
    lamMean = st.mean; lamSpread = st.spread;
  } else {
    sim = new Membrane(grid);
    if (state.start === 'mode' && startField) {
      probe = Float64Array.from(startField);
      sim.release(probe);
    } else {
      probe = bump(grid, state.strike.x, state.strike.y, state.mallet);
      sim.strike(probe);
    }
    const st = energyStats(grid, probe, null, 1);
    lamMean = st.mean; lamSpread = st.spread;
  }
  // Sample the signal often enough for the highest frequency present: mean + 5 spreads (for a
  // Gaussian spread of energies nothing is left beyond; for the exponential one of a random
  // state or a strike, e^−6 of the weight, which aliases harmlessly).
  const lamTop = Math.min(8 / (grid.h * grid.h), lamMean + 5 * lamSpread);
  const OmTop = omegaOfLambda(lamTop) + 1e-9;
  stride = Math.max(1, Math.floor(Math.PI / (1.2 * OmTop * sim.dt)));
  signal = new Signal(stride * sim.dt, isQ());
  // The spectrum's range: where the start has its energy, but no further than the grid is good.
  startStats = { mean: lamMean, spread: lamSpread };
  setSpectrumRange();
  if (selected && selected.kind === 'peak') filter = new ModeFilter(grid, omegaOfLambda(selected.lambda), 0);
  autoR = sim ? fieldBrightness() : 1;
  conserved0 = sim ? (isQ() ? sim.norm() : sim.energy()) : 1;
  spec = null; specDirty = true; modeDirty = true;
  updateReadouts();
  drawStage();
}

/**
 * The spectrum's range.  A packet: where its energy is.  A random state or a struck drum holds
 * every mode: as far as the exact modes go (the MODES-th eigenvalue, by Weyl's law
 * Aλ − P√λ = 4πN until the solver has it), but never where the grid is poor.
 */
function setSpectrumRange() {
  const { mean, spread } = startStats;
  let want;
  if (isQ() && state.start === 'packet') want = mean + 3.5 * spread;
  else {
    const A = Math.max(0.02, geo.area), P = Number.isFinite(geo.perimeter) ? geo.perimeter : 0;
    const s = (P + Math.sqrt(P * P + 16 * Math.PI * MODES * A)) / (2 * A);
    const top = modes && modes.values.length ? modes.values[modes.values.length - 1] : s * s;
    want = Math.min(mean + 3 * spread, top * 1.05);
  }
  state.specMax = Math.min(want, 0.5 / (grid.h * grid.h));
  rangeSlider.value = +fmt(xOf(state.specMax), 3);
  specDirty = true;
}

function fieldBrightness() {
  if (isQ()) return autoBrightness(sim.re, sim.im, 0.5) * 0.8;
  // A drum: the size of the motion over a period.  Before the first step u is 0; estimate it
  // from the energy (u ~ v/ω).
  const v = Math.sqrt(sim.energy() * 2 / Math.max(1e-12, grid.area));
  const w = Math.sqrt(Math.max(1, energyStats(grid, probe, null, 1).mean));
  return Math.max(1e-12, (0.6 * v) / w);
}

/** Advance by `real` seconds of wall time. */
function advance(real) {
  if (!sim || !state.running) return;
  const budget = state.fast ? 32 : 12, t0 = performance.now();
  const target = state.fast ? Infinity : sim.t + state.speed[state.mode] * real;
  let steps = 0;
  while (sim.t < target) {
    sim.step();
    stepCount++;
    if (stepCount % stride === 0) record();
    if (++steps % 32 === 0 && performance.now() - t0 > budget) break;
  }
  if (ray) { ray.advance(sim.t - ray.t); ray.t = sim.t; }
}

function record() {
  const h2 = grid.h * grid.h;
  if (isQ()) {
    const [r0, i0] = psi0, R = sim.re, I = sim.im;
    let cr = 0, ci = 0;
    for (const g of grid.inner) { cr += r0[g] * R[g] + i0[g] * I[g]; ci += r0[g] * I[g] - i0[g] * R[g]; }
    signal.push(cr * h2, ci * h2);
    if (filter) filter.add(sim.t, stride * sim.dt, R, I);
  } else {
    let s = 0;
    for (const g of grid.inner) s += probe[g] * sim.u[g];
    signal.push(s * h2);
    if (filter) filter.add(sim.t, stride * sim.dt, sim.u, null);
  }
  specDirty = true;
  if (filter) modeDirty = true;
}

// ------------------------------------------------------------------ exact modes (worker)

let worker = null, jobs = [], job = null;
const cache = new Map();

function solve(key, maskCopy, n, count, vectors, purpose, done) {
  const ck = `${key}|${count}|${vectors}`;
  if (cache.has(ck)) { done(cache.get(ck)); return; }
  // A new request for the current shape replaces any other one for the current shape.
  if (purpose !== 'pin') {
    jobs = jobs.filter((j) => j.purpose === 'pin');
    if (job && job.purpose !== 'pin' && job.key !== key) { worker.terminate(); worker = null; job = null; }
  }
  jobs.push({ key, ck, mask: maskCopy, n, count, vectors, purpose, done });
  pump();
}

function pump() {
  if (job || !jobs.length) return;
  job = jobs.shift();
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const d = e.data;
      if (!job || d.id !== job.id) return;
      if (d.progress !== undefined) { if (job.purpose !== 'pin') solving = { key: job.key, progress: d.progress, purpose: job.purpose }; updateSolveNote(); return; }
      const j = job;
      job = null;
      if (j.purpose !== 'pin') solving = null;
      if (d.error) { toast(`The eigensolver failed: ${d.error}`); pump(); return; }
      const r = { key: j.key, values: d.values, vectors: d.vectors, nvec: d.nvec, pts: d.pts, N: d.N, dim: d.dim, ms: d.ms };
      cache.set(j.ck, r);
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      j.done(r);
      updateSolveNote();
      pump();
    };
  }
  job.id = Math.random();
  if (job.purpose !== 'pin') solving = { key: job.key, progress: 0, purpose: job.purpose };
  updateSolveNote();
  worker.postMessage({ id: job.id, n: job.n, mask: job.mask, count: job.count, vectors: job.vectors });
}

function requestModes() {
  modes = null; counted = null;
  const key = shapeKey();
  if (grid.N < 4) { updateSolveNote(); return; }
  solve(key, mask.slice(), state.n, MODES, MODES, 'modes', (r) => {
    if (r.key !== shapeKey()) return;
    modes = r;
    if (sim) setSpectrumRange();
    specDirty = true; modeDirty = true; countDirty = true;
    fillModeList();
    if (pendingSound) { pendingSound = false; strikeSound(); }
    // Counted before for this shape?
    const ck = `${key}|${COUNT}|0`;
    if (cache.has(ck)) { counted = cache.get(ck); countDirty = true; }
  });
  fillModeList();
  countDirty = true;
}

function requestCount() {
  const key = shapeKey();
  solve(key, mask.slice(), state.n, COUNT, 0, 'count', (r) => {
    if (r.key !== shapeKey()) return;
    counted = r; countDirty = true; drawCount();
  });
}

function updateSolveNote() {
  const note = $('#solve-note');
  if (solving && solving.key === shapeKey()) {
    note.textContent = `${solving.purpose === 'count' ? `counting ${COUNT} modes` : `computing ${MODES} exact modes`}… ${Math.round(100 * solving.progress)}%`;
  } else if (modes) note.textContent = `${modes.values.length} modes by shift-invert Lanczos (${(modes.ms / 1000).toFixed(1)} s)`;
  else note.textContent = '';
  $('#count-more').disabled = !!(solving && solving.purpose === 'count') || !!counted;
  $('#count-more').textContent = counted ? `${counted.values.length} modes counted` : solving && solving.purpose === 'count' ? `Counting… ${Math.round(100 * solving.progress)}%` : `Count ${COUNT} modes`;
}

/** Exact mode k as a grid array. */
function exactField(k) {
  if (!modes || k >= modes.nvec) return null;
  const f = new Float64Array(state.n * state.n), N = modes.N;
  for (let p = 0; p < N; p++) f[modes.pts[p]] = modes.vectors[k * N + p];
  return f;
}

/** Labels of the exact modes from the shape's exactly known spectrum, if there is one. */
function analyticLabels() {
  if (!modes || !geo.exact) return null;
  const lmax = modes.values[modes.values.length - 1] * 1.25 + 50;
  return geo.exact(lmax);
}

// ------------------------------------------------------------------ sound

let pendingSound = false;

function strikeSound() {
  if (!state.sound) return;
  if (!modes || !modes.nvec) { pendingSound = true; toast('Computing the modes for the sound…', 1500); return; }
  const N = modes.N, h2 = grid.h * grid.h, freqs = [], amps = [], taus = [];
  const f1 = xOfDrum(modes.values[0]);
  for (let k = 0; k < modes.nvec; k++) {
    const f = xOfDrum(modes.values[k]);
    let a = 0;
    if (state.soundKind === 'strike') {
      const v0 = probe;
      for (let p = 0; p < N; p++) a += modes.vectors[k * N + p] * v0[modes.pts[p]];
      a = (a * h2) ** 2 / Math.sqrt(modes.values[k]);
    } else a = 1 / Math.sqrt(modes.values[k]);
    freqs.push(f); amps.push(a); taus.push((state.ring * f1) / f);
  }
  playModes(freqs, amps, taus);
}

function playModes(freqs, amps, taus) {
  const dur = Math.min(5, Math.max(1, 4 * state.ring));
  const s = synthesize(freqs, amps, taus, SAMPLE_RATE, dur);
  if (!play(s, state.volume)) toast('This browser has no Web Audio.');
}

const xOfDrum = (lambda) => (state.c * Math.sqrt(lambda)) / (2 * Math.PI * L_PHYS);

function playSpectrum(values) {
  const f1 = xOfDrum(values[0]);
  const freqs = Array.from(values, xOfDrum);
  playModes(freqs, Array.from(values, (l) => 1 / Math.sqrt(l)), freqs.map((f) => (state.ring * f1) / f));
}

// ------------------------------------------------------------------ the main loop

let last = 0, frames = 0, lastSpec = 0, lastMode = 0;
// Milliseconds spent in each part of the frames so far (for the tests).
const timing = { frames: 0, advance: 0, stage: 0, spectrum: 0, mode: 0, other: 0 };
function loop(now) {
  const real = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  let t = performance.now(), t1;
  advance(real);
  t1 = performance.now(); timing.advance += t1 - t; t = t1;
  frames++; timing.frames++;
  if (frames % 10 === 0 && sim) {
    // The brightness follows the field, slowly (a drum's displacement passes through zero).
    const R = isQ() ? autoBrightness(sim.re, sim.im, 0.5) * 0.8 : autoBrightness(sim.u, null, 0.6) * 0.9;
    if (Number.isFinite(R) && R > 0 && (isQ() || sim.t > 0)) autoR = 0.8 * autoR + 0.2 * R;
  }
  drawStage();
  t1 = performance.now(); timing.stage += t1 - t; t = t1;
  if (specDirty && now - lastSpec > (state.fast ? 250 : 120)) { lastSpec = now; drawSpectrum(); }
  t1 = performance.now(); timing.spectrum += t1 - t; t = t1;
  if (modeDirty && now - lastMode > 200) { lastMode = now; drawMode(); }
  t1 = performance.now(); timing.mode += t1 - t; t = t1;
  if (countDirty) drawCount();
  if (frames % 10 === 0) updateReadouts();
  timing.other += performance.now() - t;
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ drawing: the stage

const stage = $('#stage');
let fieldImage = null, wallImage = null, wallLayer = null, flipMap = null;

function ensureImages() {
  const n = state.n;
  if (!fieldImage || fieldImage.width !== n) {
    fieldImage = document.createElement('canvas'); fieldImage.width = fieldImage.height = n;
    flipMap = new Int32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) flipMap[j * n + i] = (n - 1 - j) * n + i;
  }
  if (!wallImage) {
    wallImage = document.createElement('canvas'); wallImage.width = wallImage.height = n;
    const ctx = wallImage.getContext('2d'), img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 4, g = (n - 1 - j) * n + i;
      if (!mask[g]) { img.data[o] = 46; img.data[o + 1] = 49; img.data[o + 2] = 58; img.data[o + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
  }
}

/** Box coordinates to canvas pixels (grid point i is the centre of image pixel i). */
function toCanvas(x, y, W) {
  const n = state.n, s = W / n;
  return [((x + 0.5) / grid.h + 0.5) * s, (n - 0.5 - (y + 0.5) / grid.h) * s];
}
function fromCanvas(X, Y, W) {
  const n = state.n, s = W / n;
  return [-0.5 + (X / s - 0.5) * grid.h, -0.5 + (n - 0.5 - Y / s) * grid.h];
}

function drawStage() {
  const { ctx, width: W, height: H } = fitCanvas(stage);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!grid) return;
  ensureImages();
  if (sim) {
    const n = state.n, ictx = fieldImage.getContext('2d'), img = ictx.createImageData(n, n);
    const R = autoR * 10 ** -state.bright;
    if (isQ()) colorize(sim.re, sim.im, img.data, R, 'complex', flipMap);
    else colorize(sim.u, null, img.data, R, 'complex', flipMap);
    ictx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fieldImage, 0, 0, W, H);
  }
  // The walls, and the true edge of a preset over its staircase: drawn once at the canvas's own
  // resolution, then copied each frame.
  if (!wallLayer || wallLayer.width !== stage.width || wallLayer.height !== stage.height || wallLayer.src !== wallImage) {
    wallLayer = document.createElement('canvas');
    wallLayer.width = stage.width; wallLayer.height = stage.height; wallLayer.src = wallImage;
    const w = wallLayer.getContext('2d'), s = stage.width / W;
    w.setTransform(s, 0, 0, s, 0, 0);
    w.imageSmoothingEnabled = false;
    w.drawImage(wallImage, 0, 0, W, H);
    w.strokeStyle = 'rgba(255,255,255,0.35)'; w.lineWidth = 1;
    for (const line of geo.outline || []) {
      w.beginPath();
      line.forEach(([x, y], i) => { const [X, Y] = toCanvas(x, y, W); if (i) w.lineTo(X, Y); else w.moveTo(X, Y); });
      w.stroke();
    }
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(wallLayer, 0, 0); ctx.restore();
  // The classical particle and its path.
  if (isQ() && ray && state.ray) {
    // The last 60 legs of the path, fading with age, in five strokes.
    const pts = ray.path.concat([[ray.x, ray.y]]);
    ctx.lineWidth = 1.4;
    const first = Math.max(0, pts.length - 61), span = pts.length - 1 - first;
    for (let gI = 0; gI < 5; gI++) {
      const a = Math.floor(first + (span * gI) / 5), b = Math.floor(first + (span * (gI + 1)) / 5);
      if (b <= a) continue;
      ctx.strokeStyle = `rgba(255, 214, 90, ${0.2 + 0.16 * (gI + 1)})`;
      ctx.beginPath();
      for (let i = a; i <= b; i++) { const [X, Y] = toCanvas(...pts[i], W); if (i === a) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke();
    }
    const [X, Y] = toCanvas(ray.x, ray.y, W);
    ctx.fillStyle = '#ffd65a'; ctx.beginPath(); ctx.arc(X, Y, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }
  // The mallet.
  if (!isQ() && state.start === 'strike') {
    const [X, Y] = toCanvas(state.strike.x, state.strike.y, W);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X, Y, Math.max(4, (2 * state.mallet * W) / (state.n * grid.h)), 0, 2 * Math.PI); ctx.stroke();
  }
  // The launch arrow while dragging.
  if (drag && drag.kind === 'launch') {
    const [X0, Y0] = toCanvas(drag.x0, drag.y0, W), [X1, Y1] = toCanvas(drag.x1, drag.y1, W);
    arrow(ctx, X0, Y0, X1, Y1, '#ffd65a');
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`k = ${fmt(state.k, 3)}`, X1 + 8, Y1 - 6);
  }
  // The brush.
  if (hover && state.tool !== 'act') {
    const [X, Y] = toCanvas(hover.x, hover.y, W);
    ctx.strokeStyle = state.tool === 'draw' ? 'rgba(120,200,255,0.9)' : 'rgba(255,120,120,0.9)';
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X, Y, ((state.brush + 0.5) * W) / state.n, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '12px system-ui, sans-serif';
  const label = isQ() ? 'ψ: colour is the phase, brightness |ψ|' : 'u: red up, cyan down';
  ctx.fillText(label, 8, 16);
  if (grid.N === 0) { ctx.fillText('Draw a shape (choose Draw below the presets).', 8, 34); }
}

function arrow(ctx, x0, y0, x1, y1, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), L = 10;
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - L * Math.cos(a - 0.4), y1 - L * Math.sin(a - 0.4));
  ctx.lineTo(x1 - L * Math.cos(a + 0.4), y1 - L * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}

// ------------------------------------------------------------------ drawing: the spectrum

const specCanvas = $('#spectrum'), sigCanvas = $('#signal');
let specFrame = null;

function computeSpectrum() {
  if (!sim || !signal || signal.length < 16) { spec = null; return; }
  const OmMax = omegaOfLambda(state.specMax);
  const sp = signal.spectrum(fft, OmMax, OmMax / 1500);
  const x = new Float64Array(sp.omega.length);
  for (let j = 0; j < x.length; j++) x[j] = xOf(lambdaOfOmega(sp.omega[j]));
  const peaks = findPeaks(sp.omega, sp.amp, 0.02).map((p) => ({ ...p, lambda: lambdaOfOmega(p.omega) }));
  spec = { omega: sp.omega, x, amp: sp.amp, peaks };
}

function drawSpectrum() {
  specDirty = false;
  computeSpectrum();
  drawSignal();
  const { ctx, width, height } = fitCanvas(specCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const f = new Frame(ctx, width, height, { left: 44, right: 10, top: 16, bottom: 34 });
  specFrame = f;
  f.x0 = 0; f.x1 = xOf(state.specMax);
  let top = 0;
  if (spec) for (let j = 1; j < spec.amp.length; j++) if (spec.x[j] <= f.x1) top = Math.max(top, spec.amp[j]);
  if (state.log) { f.y0 = -4; f.y1 = 0.2; } else { f.y0 = 0; f.y1 = top > 0 ? top * 1.12 : 1; }
  const Y = (a) => (state.log ? f.Y(Math.max(-4, Math.log10(Math.max(1e-12, a / (top || 1))))) : f.Y(a));
  f.clip();
  if (spec) {
    ctx.beginPath();
    ctx.moveTo(f.X(0), f.bottom);
    for (let j = 0; j < spec.amp.length; j++) ctx.lineTo(f.X(spec.x[j]), Y(spec.amp[j]));
    ctx.lineTo(f.X(spec.x[spec.x.length - 1]), f.bottom);
    ctx.closePath();
    ctx.fillStyle = c.accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.4; ctx.stroke();
  }
  // Exact eigenvalues: ticks along the bottom (and the pinned drum's along the top), on top.
  if (modes) {
    ctx.strokeStyle = c.good; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const l of (counted || modes).values) { const X = f.X(xOf(l)); if (X > f.right) break; ctx.moveTo(X, f.bottom); ctx.lineTo(X, f.bottom - 9); }
    ctx.stroke();
  }
  if (pinned) {
    ctx.strokeStyle = c.warn; ctx.lineWidth = 1.6; ctx.beginPath();
    for (const l of pinned.values) { const X = f.X(xOf(l)); if (X > f.right) break; ctx.moveTo(X, f.top); ctx.lineTo(X, f.top + 9); }
    ctx.stroke();
  }
  // The selected frequency.
  if (selected) {
    const l = selected.kind === 'peak' ? selected.lambda : modes?.values[selected.k];
    if (l !== undefined) {
      const X = f.X(xOf(l));
      ctx.strokeStyle = c.warn; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(X, f.top); ctx.lineTo(X, f.bottom); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.restore();
  // The resolution: a peak's width for this length of run.
  if (sim && signal && signal.T > 0) {
    const Om = omegaOfLambda(state.specMax * 0.5), dOm = WINDOW_FWHM / signal.T;
    const dx = Math.abs(xOf(lambdaOfOmega(Om + dOm / 2)) - xOf(lambdaOfOmega(Math.max(0, Om - dOm / 2))));
    const w = Math.max(1, f.X(dx) - f.X(0)), x1 = f.right - 6, x0 = x1 - Math.min(w, f.w * 0.6);
    ctx.strokeStyle = c.ink2; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, 8); ctx.lineTo(x1, 8); ctx.moveTo(x0, 4); ctx.lineTo(x0, 12); ctx.moveTo(x1, 4); ctx.lineTo(x1, 12); ctx.stroke();
    ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`a peak's width, ${isQ() ? 'ΔE' : 'Δf'} ≈ ${fmt(dx, 2)}${isQ() ? '' : ' Hz'}`, x0 - 6, 8);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  f.axes({ xlabel: isQ() ? 'energy E  (ħ = m = 1, box side 1)' : 'frequency f (Hz)', ylabel: state.log ? 'log₁₀' : '', yTicks: state.log });
  $('#spec-note').textContent = signal ? `run ${isQ() ? `t = ${fmt(signal.T, 3)}` : `${fmt(signal.T * L_PHYS / state.c * 1000, 3)} ms`}` : '';
}

function drawSignal() {
  const { ctx, width, height } = fitCanvas(sigCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  if (!signal || !signal.length) return;
  const K = signal.length, left = 44, right = 10, w = width - left - right, top = 4, h = height - 18;
  let mx = 0;
  for (let k = 0; k < K; k++) mx = Math.max(mx, isQ() ? Math.hypot(signal.re[k], signal.im[k]) : Math.abs(signal.re[k]));
  mx = mx || 1;
  ctx.strokeStyle = c.line; ctx.strokeRect(left + 0.5, top + 0.5, w, h);
  ctx.strokeStyle = c.ink2; ctx.lineWidth = 1;
  ctx.beginPath();
  const cols = Math.max(1, Math.floor(w));
  for (let px = 0; px < cols; px++) {
    const a = Math.floor((px * K) / cols), b = Math.max(a + 1, Math.floor(((px + 1) * K) / cols));
    let lo = Infinity, hi = -Infinity;
    for (let k = a; k < b && k < K; k++) { const v = isQ() ? Math.hypot(signal.re[k], signal.im[k]) : signal.re[k]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const Y = (v) => (isQ() ? top + h - (v / mx) * h : top + h / 2 - (v / mx) * (h / 2));
    ctx.moveTo(left + px + 0.5, Y(hi)); ctx.lineTo(left + px + 0.5, Y(lo) + 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = c.ink2; ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(isQ() ? '|⟨ψ(0)|ψ(t)⟩|' : 'u under the mallet', left + 4, top + 11);
  ctx.textAlign = 'right';
  ctx.fillText(isQ() ? `t = ${fmt(signal.T, 3)}` : `${fmt((signal.T * L_PHYS) / state.c * 1000, 3)} ms`, width - right - 2, height - 3);
  ctx.textAlign = 'left';
  ctx.fillText('0', left, height - 3);
}

// ------------------------------------------------------------------ drawing: the mode

const modeCanvas = $('#mode');
let modeImage = null, shownMode = null;

function currentModeField() {
  if (!selected) return null;
  if (selected.kind === 'exact') {
    const f = exactField(selected.k);
    return f ? { field: f, fraction: 1, exact: true } : null;
  }
  if (!filter || filter.samples < 4) return null;
  const [re, im] = filter.result();
  return { ...realPart(grid, re, im), exact: false, re, im };
}

function drawMode() {
  modeDirty = false;
  const { ctx, width: W, height: H } = fitCanvas(modeCanvas);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const m = currentModeField();
  shownMode = m;
  const info = $('#mode-info');
  if (!m) {
    if (selected) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px system-ui, sans-serif'; ctx.fillText('building…', 10, 20); }
    info.innerHTML = selected ? 'building the mode from the motion…' : 'Click a peak of the spectrum to build its mode from the motion, or a mode in the list of exact modes.';
    $('#excite').disabled = true; $('#hear-mode').disabled = true;
    return;
  }
  const n = state.n, f = m.field;
  let big = 0;
  for (const g of grid.inner) big = Math.max(big, Math.abs(f[g]));
  if (!modeImage || modeImage.width !== n) { modeImage = document.createElement('canvas'); modeImage.width = modeImage.height = n; }
  const ictx = modeImage.getContext('2d'), img = ictx.createImageData(n, n);
  if (state.sand) {
    // Chladni's sand collects where the plate is still: on the nodal lines.
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const g = (n - 1 - j) * n + i, o = (j * n + i) * 4;
      if (!mask[g]) { img.data[o] = 46; img.data[o + 1] = 49; img.data[o + 2] = 58; img.data[o + 3] = 255; continue; }
      const s = Math.exp(-((f[g] / (0.12 * big)) ** 2));
      img.data[o] = 30 + 215 * s; img.data[o + 1] = 26 + 200 * s; img.data[o + 2] = 20 + 160 * s; img.data[o + 3] = 255;
    }
  } else {
    colorize(f, null, img.data, 0.35 * big, 'complex', flipMap);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const g = (n - 1 - j) * n + i, o = (j * n + i) * 4;
      if (!mask[g]) { img.data[o] = 46; img.data[o + 1] = 49; img.data[o + 2] = 58; }
    }
  }
  ictx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = !state.sand;
  ctx.drawImage(modeImage, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  if (!state.sand) {
    // The nodal lines: where the mode is zero (walls left out).
    const vals = new Float64Array(n * n).fill(NaN);
    for (const g of grid.inner) vals[g] = f[g];
    for (let g = 0; g < n * n; g++) if (!mask[g]) { const i = g % n; if ((i > 0 && mask[g - 1]) || (i < n - 1 && mask[g + 1]) || mask[g - n] || mask[g + n]) vals[g] = 0; }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    const s = W / n;
    contour(vals, n, n, 0, (x0, y0, x1, y1) => {
      // Skip segments that run along the wall (both ends at wall points).
      ctx.moveTo((x0 + 0.5) * s, (n - 0.5 - y0) * s); ctx.lineTo((x1 + 0.5) * s, (n - 0.5 - y1) * s);
    });
    ctx.stroke();
  }
  // What it is.
  const lines = [];
  if (m.exact) {
    const k = selected.k, l = modes.values[k];
    lines.push(`<b>Mode ${k + 1}</b> of the direct solver: λ = ${fmt(l, 6)}, ${isQ() ? `E = ${fmt(l / 2, 6)}` : `f = ${fmt(xOfDrum(l), 5)} Hz`}`);
    const lab = analyticLabels();
    if (lab && lab[k]) lines.push(`exactly: ${lab[k].label}, λ = ${fmt(lab[k].lambda, 6)} (grid ${fmt(100 * (l / lab[k].lambda - 1), 2)}%)`);
  } else {
    const T = filter.T;
    lines.push(`<b>Built from the motion</b> at ${isQ() ? `E = ${fmt(selected.lambda / 2, 5)}` : `f = ${fmt(xOfDrum(selected.lambda), 5)} Hz`}: ∫ψ(t)e<sup>iEt</sup>w(t)dt over ${isQ() ? `t = ${fmt(T, 3)}` : `${fmt(T * L_PHYS / state.c * 1000, 3)} ms`}`);
    if (modes && modes.nvec) {
      // The overlap with the exact modes near this λ (a degenerate set counts together).
      const near = [];
      modes.values.forEach((l, k) => { if (k < modes.nvec && Math.abs(l - selected.lambda) < 0.01 * selected.lambda + 2) near.push(k); });
      if (near.length) {
        let ov = 0, nn = 0;
        const N = modes.N, h2 = grid.h * grid.h;
        for (const g of grid.inner) nn += m.re[g] ** 2 + m.im[g] ** 2;
        for (const k of near) {
          let a = 0, b = 0;
          for (let p = 0; p < N; p++) { const v = modes.vectors[k * N + p], g = modes.pts[p]; a += v * m.re[g]; b += v * m.im[g]; }
          ov += (a * a + b * b) * h2;
        }
        lines.push(`${fmt(100 * ov / nn, 4)}% of it is exact mode${near.length > 1 ? 's' : ''} ${near.map((k) => k + 1).join(', ')} (λ = ${fmt(modes.values[near[0]], 6)})`);
      } else lines.push('no exact mode this close among the ones computed');
    } else lines.push(`${fmt(100 * m.fraction, 3)}% real after turning its phase`);
  }
  info.innerHTML = lines.join('<br>');
  $('#excite').disabled = false; $('#hear-mode').disabled = isQ() && false;
}

// ------------------------------------------------------------------ the exact modes list

function fillModeList() {
  const list = $('#modes-list');
  if (!modes) { list.innerHTML = '<div class="muted small">computing…</div>'; return; }
  const lab = analyticLabels();
  const rows = [];
  rows.push(`<tr><th>#</th><th>λ</th><th>${isQ() ? 'E' : 'f (Hz)'}</th>${lab ? `<th>exact</th><th>λ exact</th><th>grid</th>` : ''}</tr>`);
  modes.values.forEach((l, k) => {
    const a = lab && lab[k];
    rows.push(`<tr data-k="${k}" class="${selected && selected.kind === 'exact' && selected.k === k ? 'sel' : ''}"><td>${k + 1}</td><td>${fmt(l, 6)}</td><td>${fmt(xOf(l), 5)}</td>${a ? `<td>${a.label}</td><td>${fmt(a.lambda, 6)}</td><td>${fmt(100 * (l / a.lambda - 1), 2)}%</td>` : lab ? '<td></td><td></td><td></td>' : ''}</tr>`);
  });
  list.innerHTML = `<table class="modes mono small">${rows.join('')}</table>`;
  if (state.countTab === 'list') $('#list-note').textContent = geo.exactNote ? `exactly: ${geo.exactNote}` : '';
}

$('#modes-list').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-k]');
  if (!tr) return;
  selectExact(+tr.dataset.k);
});

function selectExact(k) {
  selected = { kind: 'exact', k };
  filter = null;
  modeDirty = true; specDirty = true;
  for (const tr of document.querySelectorAll('#modes-list tr[data-k]')) tr.classList.toggle('sel', +tr.dataset.k === k);
  drawMode();
}

function selectPeak(lambda) {
  selected = { kind: 'peak', lambda };
  // The filter starts now and integrates from here on.
  filter = new ModeFilter(grid, omegaOfLambda(lambda), sim.t);
  for (const tr of document.querySelectorAll('#modes-list tr.sel')) tr.classList.remove('sel');
  modeDirty = true; specDirty = true;
  if (!state.running) setRunning(true);
}

// ------------------------------------------------------------------ drawing: counting

const countCanvas = $('#count');

function drawCount() {
  countDirty = false;
  if (state.countTab === 'list') return;
  const { ctx, width, height } = fitCanvas(countCanvas);
  const c = themeColors();
  ctx.clearRect(0, 0, width, height);
  const values = (counted || modes)?.values;
  const note = $('#count-note');
  if (!values || values.length < 8) { note.textContent = solving ? 'waiting for the eigenvalues…' : ''; return; }
  const h = grid.h;
  if (state.countTab === 'weyl') {
    // Either N(λ) itself, or what is left after the area term, N − Aλ/4π, against √λ: there the
    // perimeter term is a straight line falling with slope −P/4π.
    const resid = state.weylResidual;
    const A = geo.area, P = geo.perimeter, K = geo.K ?? 0;
    const area = (l) => (A * gridCorrected(l, h)) / (4 * Math.PI);
    const f = new Frame(ctx, width, height, { left: 40, right: 10, top: 10, bottom: 32 });
    const lmax = values[values.length - 1] * 1.02;
    const X = (l) => f.X(resid ? Math.sqrt(l) : l);
    f.x0 = 0; f.x1 = resid ? Math.sqrt(lmax) : lmax;
    if (resid) {
      let lo = 0, hi = 0;
      values.forEach((l, k) => { lo = Math.min(lo, k - area(l)); hi = Math.max(hi, k + 1 - area(l)); });
      f.y0 = Math.floor(lo - 1); f.y1 = Math.ceil(hi + 1);
    } else { f.y0 = 0; f.y1 = values.length * 1.08; }
    const Y = (l, v) => f.Y(resid ? v - area(l) : v);
    f.clip();
    const curve = (fn, color, dash, w = 1.5) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
      ctx.beginPath();
      for (let px = 0; px <= f.w; px += 2) {
        const u = f.invX(f.left + px), l = resid ? u * u : u, y = Y(l, fn(l));
        if (px) ctx.lineTo(f.left + px, y); else ctx.moveTo(f.left + px, y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (resid) { ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.left, f.Y(0)); ctx.lineTo(f.right, f.Y(0)); ctx.stroke(); }
    else curve((l) => (A * l) / (4 * Math.PI), c.ink3, [2, 3]);
    // The staircase, then Weyl's three terms over it.
    ctx.strokeStyle = c.accent; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0, 0));
    values.forEach((l, k) => { ctx.lineTo(X(l), Y(l, k)); ctx.lineTo(X(l), Y(l, k + 1)); });
    ctx.stroke();
    curve((l) => weyl(A, P, K, gridCorrected(l, h)), c.warn, [6, 3], 1.8);
    ctx.restore();
    f.axes({ xlabel: resid ? '√λ' : 'λ', ylabel: resid ? 'N − Aλ/4π' : 'N(λ)' });
    const fit = hearShape(values, { h, K: geo.K ?? null });
    note.innerHTML = `<span class="key" style="--c:${c.accent}"></span>counted &nbsp;<span class="key dashed" style="--c:${c.warn}"></span>Weyl, Aλ/4π − P√λ/4π + K`
      + (resid ? '' : ` &nbsp;<span class="key dotted" style="--c:${c.ink3}"></span>area alone`) + '<br>'
      + (fit ? `Heard from ${values.length} modes: area ${fmt(fit.area, 4)} (true ${fmt(A, 4)}), perimeter ${fmt(fit.perimeter, 3)} (true ${fmt(P, 3)})` : '')
      + (state.shape === 'drawn' || state.shape === 'typed' ? ' (true values estimated from the drawing)' : '');
  } else {
    const sp = spacings(values);
    const f = new Frame(ctx, width, height, { left: 40, right: 10, top: 10, bottom: 32 });
    f.x0 = 0; f.x1 = 3.5; f.y0 = 0; f.y1 = 1.1;
    if (sp) {
      const bins = values.length > 120 ? 14 : 10, hist = histogram(sp.s, 3.5, bins), bw = 3.5 / bins;
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.35;
      for (let b = 0; b < bins; b++) ctx.fillRect(f.X(b * bw) + 1, f.Y(Math.min(hist[b], 1.1)), f.X(bw) - f.X(0) - 2, f.Y(0) - f.Y(Math.min(hist[b], 1.1)));
      ctx.globalAlpha = 1;
      const curve = (fn, color, dash) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
        ctx.beginPath();
        for (let px = 0; px <= f.w; px += 2) { const s = f.invX(f.left + px); if (px) ctx.lineTo(f.left + px, f.Y(fn(s))); else ctx.moveTo(f.left + px, f.Y(fn(s))); }
        ctx.stroke(); ctx.setLineDash([]);
      };
      curve(poisson, c.ink2, [6, 3]);
      curve(wigner, c.warn, []);
      note.innerHTML = `<span class="key dashed" style="--c:${c.ink2}"></span>Poisson e<sup>−s</sup> (regular) &nbsp; <span class="key" style="--c:${c.warn}"></span>Wigner (πs/2)e<sup>−πs²/4</sup> (chaotic)<br>`
        + `${sp.s.length} spacings of the unfolded spectrum; below ¼: ${fmt(100 * sp.small, 2)}% (Poisson 22%, Wigner 4.8%)`;
    }
    f.axes({ xlabel: 's (spacing / mean spacing)', ylabel: 'P(s)' });
  }
}

// ------------------------------------------------------------------ readouts

/** The relative change of the scheme's conserved quantity since the start. */
function drift(v) {
  const d = v / conserved0 - 1;
  return Math.abs(d) < 1e-16 ? '< 1e-16' : d.toExponential(0);
}

function updateReadouts() {
  if (!sim) { $('#readouts').innerHTML = ''; return; }
  const items = [];
  if (isQ()) {
    items.push(['t', fmt(sim.t, 4)], ['norm drift', drift(sim.norm())]);
    const st = energyStats(grid, sim.re, sim.im, 0.5);
    items.push(['⟨E⟩', `${fmt(st.mean, 4)} ± ${fmt(st.spread, 3)}`]);
    if (ray) items.push(['bounces', ray.bounces]);
  } else {
    const ms = (sim.t * L_PHYS) / state.c * 1000;
    items.push(['t', `${fmt(ms, 4)} ms`]);
    if (!state.fast) items.push(['slowed down', `${fmt(1 / ((L_PHYS / state.c) * state.speed.drum), 2)} times`]);
    items.push(['energy drift', drift(sim.energy())]);
  }
  items.push(['grid', `${state.n}² (${grid.N} free points)`]);
  $('#readouts').innerHTML = items.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
}

// ------------------------------------------------------------------ pointer on the stage

let drag = null, hover = null;

function boxAt(e) {
  const r = stage.getBoundingClientRect();
  const [x, y] = fromCanvas(e.clientX - r.left, e.clientY - r.top, r.width);
  return { x, y };
}

stage.addEventListener('pointerdown', (e) => {
  if (!grid) return;
  stage.setPointerCapture(e.pointerId);
  const p = boxAt(e);
  if (state.tool !== 'act') {
    if (state.shape !== 'drawn') { state.shape = 'drawn'; showShapeControls(); }
    drag = { kind: 'paint', last: p };
    paintAt(p, p);
    return;
  }
  if (isQ()) {
    if (!insideAt(p.x, p.y)) return;
    drag = { kind: 'launch', x0: p.x, y0: p.y, x1: p.x + Math.cos(state.angle) * state.k / 200, y1: p.y + Math.sin(state.angle) * state.k / 200, moved: false };
  } else {
    if (!insideAt(p.x, p.y)) return;
    state.strike = p; state.start = 'strike';
    restart();
    strikeSound();
    updateHash();
  }
});

stage.addEventListener('pointermove', (e) => {
  const p = boxAt(e);
  hover = p;
  if (!drag) return;
  if (drag.kind === 'paint') { paintAt(drag.last, p); drag.last = p; return; }
  if (drag.kind === 'launch') {
    const dx = p.x - drag.x0, dy = p.y - drag.y0, L = Math.hypot(dx, dy);
    if (L > 0.01) {
      drag.moved = true;
      state.angle = Math.atan2(dy, dx);
      state.k = Math.max(3, Math.min(kMax(), Math.round(200 * L)));
      drag.x1 = drag.x0 + (Math.cos(state.angle) * state.k) / 200; drag.y1 = drag.y0 + (Math.sin(state.angle) * state.k) / 200;
      kSlider.value = state.k; angleSlider.value = +(state.angle * 180 / Math.PI).toFixed(1);
    }
  }
});

const endDrag = () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === 'paint') { shapeChangedByPaint(); return; }
  if (d.kind === 'launch') {
    state.launch = { x: d.x0, y: d.y0 }; state.start = 'packet';
    startSeg.value = 'packet';
    restart();
    updateHash();
  }
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('pointerleave', () => { hover = null; });

const kMax = () => Math.round(0.75 / grid.h);

function paintAt(a, b) {
  const n = state.n, h = grid.h, v = state.tool === 'draw' ? 1 : 0;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (h * Math.max(1, state.brush / 2))));
  for (let s = 0; s <= steps; s++) {
    const x = a.x + ((b.x - a.x) * s) / steps, y = a.y + ((b.y - a.y) * s) / steps;
    paintMask(mask, n, (x + 0.5) / h, (y + 0.5) / h, state.brush, v);
  }
  // Show the new walls at once; the drum is rebuilt when the stroke ends.
  wallImage = null;
  sim = null;
}

function shapeChangedByPaint() {
  state.shape = 'drawn';
  for (const b of Object.values(presetButtons)) b.setAttribute('aria-pressed', 'false');
  buildShape();
  requestModes();
  if (!insideAt(state.launch.x, state.launch.y)) state.launch = centreOfMass();
  if (!insideAt(state.strike.x, state.strike.y)) state.strike = centreOfMass();
  restart();
  updateHash();
}

// ------------------------------------------------------------------ spectrum interaction

specCanvas.addEventListener('pointerdown', (e) => {
  if (!specFrame || !sim) return;
  const r = specCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const f = specFrame;
  // Near the ticks of the exact eigenvalues: pick that mode.
  if (modes && py > f.bottom - 12 && py < f.bottom + 6) {
    let best = -1, bd = 8;
    modes.values.forEach((l, k) => { const d = Math.abs(f.X(xOf(l)) - px); if (d < bd) { bd = d; best = k; } });
    if (best >= 0) { selectExact(best); return; }
  }
  if (!spec) return;
  let best = null, bd = 12;
  for (const p of spec.peaks) { const d = Math.abs(f.X(xOf(p.lambda)) - px); if (d < bd) { bd = d; best = p; } }
  if (best) selectPeak(best.lambda);
  else if (px > f.left && px < f.right) {
    // Not near a peak: filter at the frequency clicked anyway.
    selectPeak(lambdaOfX(f.invX(px)));
  }
});

specCanvas.addEventListener('pointermove', (e) => {
  if (!specFrame) return;
  const r = specCanvas.getBoundingClientRect(), px = e.clientX - r.left, f = specFrame;
  if (px < f.left || px > f.right) { $('#spec-hover').textContent = ''; return; }
  const x = f.invX(px);
  let s = `${xUnit()} = ${fmtX(x)}`;
  if (modes) {
    const l = lambdaOfX(x);
    let best = 0;
    modes.values.forEach((v, k) => { if (Math.abs(v - l) < Math.abs(modes.values[best] - l)) best = k; });
    s += ` · nearest exact mode ${best + 1} at ${fmtX(xOf(modes.values[best]))}`;
  }
  $('#spec-hover').textContent = s;
});

// ------------------------------------------------------------------ controls

const playButton = $('#play');
function setRunning(on) { state.running = on; playButton.textContent = on ? 'Pause' : 'Play'; }
playButton.addEventListener('click', () => setRunning(!state.running));
$('#restart').addEventListener('click', () => { restart(); if (!isQ() && state.start === 'strike') strikeSound(); });
const fastButton = toggle('Fast', state.fast, (on) => { state.fast = on; }, 'Run as fast as the computer can (for the spectrum), drawing a few times a second');
$('#run-row').append(fastButton);
const speedSlider = slider({ label: 'speed', min: 0.001, max: 2, log: true, value: state.speed[state.mode], title: 'Simulated time per second',
  onInput: (v) => { state.speed[state.mode] = v; } });
$('#speed-box').append(speedSlider);

const modeSeg = segmented([
  { value: 'drum', label: 'Drum', title: 'A membrane: u_tt = c²∇²u.  Strike it, hear it.' },
  { value: 'quantum', label: 'Quantum billiard', title: 'A particle in a box: iħψ_t = −(ħ²/2m)∇²ψ.  Launch a packet.' },
], state.mode, (v) => setMode(v), { label: 'What the shape is' });
$('#mode-seg').append(modeSeg);

function setMode(m) {
  stopSound();
  state.mode = m;
  modeSeg.value = m;
  speedSlider.setRange(m === 'drum' ? 0.02 : 0.001, m === 'drum' ? 20 : 2);
  speedSlider.value = state.speed[m];
  if (state.start === 'mode' && startField) { /* keep the mode */ } else state.start = m === 'drum' ? 'strike' : 'packet';
  $('#drum-controls').hidden = m !== 'drum';
  $('#quantum-controls').hidden = m !== 'quantum';
  $('#act-label').textContent = m === 'drum' ? 'Strike' : 'Launch';
  selected = selected && selected.kind === 'exact' ? selected : null;
  filter = null;
  fillModeList();
  restart();
  updateHash();
}

// The shape.
const presetButtons = {};
for (const [id, p] of Object.entries(PRESETS)) {
  const b = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { selected = null; setShape(id); } }, p.label);
  $('#presets').append(b);
  presetButtons[id] = b;
}
const typedButton = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { selected = null; setShape('typed'); } }, 'Typed');
$('#presets').append(typedButton);

const paramBox = $('#shape-params');
let paramTimer = 0;
function showShapeControls() {
  for (const [id, b] of Object.entries(presetButtons)) b.setAttribute('aria-pressed', String(id === state.shape));
  typedButton.setAttribute('aria-pressed', String(state.shape === 'typed'));
  paramBox.innerHTML = '';
  $('#typed-box').hidden = state.shape !== 'typed';
  if (PRESETS[state.shape]) {
    for (const [k, spec] of Object.entries(PRESETS[state.shape].params)) {
      paramBox.append(slider({ label: spec.label, min: spec.min, max: spec.max, value: state.params[k], title: spec.title,
        onInput: (v) => {
          state.params[k] = Math.min(spec.max, Math.max(spec.min, v));
          clearTimeout(paramTimer);
          paramTimer = setTimeout(() => { selected = null; setShape(state.shape, state.params); }, 150);
        } }));
    }
  }
  const note = state.shape === 'drawn' ? 'Your own drawing.' : state.shape === 'typed' ? 'Free inside, where the formula is true (non-zero).' : geo?.note || '';
  $('#shape-note').textContent = note;
}

typedField = exprField({
  label: '<math><mtext>inside if</mtext></math>',
  value: 'x^2/a^2 + y^2/b^2 < 1', variables: ['x', 'y', 'r', 'theta'],
  hints: { a: { min: 0.05, max: 0.5, value: 0.45 }, b: { min: 0.05, max: 0.5, value: 0.3 }, R: { min: 0.05, max: 0.5, value: 0.4 }, w: { min: 0.01, max: 0.5, value: 0.1 } },
  params: { a: 0.45, b: 0.3 },
  onChange: (expr, params) => {
    typedExpr = expr; typedParams = params;
    if (state.shape !== 'typed') return;
    clearTimeout(paramTimer);
    paramTimer = setTimeout(() => { selected = null; buildShape(); requestModes(); if (!insideAt(state.launch.x, state.launch.y)) state.launch = centreOfMass(); if (!insideAt(state.strike.x, state.strike.y)) state.strike = centreOfMass(); restart(); updateHash(); }, 200);
  },
});
typedExpr = typedField.expr; typedParams = typedField.params;
$('#typed-box').append(typedField);

const toolSeg = segmented([
  { value: 'act', html: '<span id="act-label">Launch</span>', title: 'Click (and drag) on the shape: strike the drum, or launch a packet with the momentum you drag' },
  { value: 'draw', label: 'Draw', title: 'Paint free membrane' },
  { value: 'erase', label: 'Erase', title: 'Paint walls' },
], state.tool, (v) => { state.tool = v; stage.classList.toggle('painting', v !== 'act'); }, { label: 'What a click does' });
$('#tool-seg').append(toolSeg);
const brushSlider = slider({ label: 'brush', min: 1, max: 12, step: 1, value: state.brush, title: 'The radius of the brush, in grid steps', onInput: (v) => { state.brush = v; } });
$('#brush-box').append(brushSlider);
$('#clear').addEventListener('click', () => { mask.fill(0); state.tool = 'draw'; toolSeg.value = 'draw'; stage.classList.add('painting'); shapeChangedByPaint(); toast('Draw a shape on the grid.'); });
$('#fill').addEventListener('click', () => { const n = state.n; for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) mask[j * n + i] = 1; shapeChangedByPaint(); });

// The drum.
const malletSlider = slider({ label: 'mallet', min: 0.008, max: 0.1, log: true, value: state.mallet, title: 'The width of the mallet: a narrow one excites more high modes (a brighter sound)',
  onInput: (v) => { state.mallet = v; if (state.start === 'strike') restart(); } });
const cSlider = slider({ label: 'c (m/s)', min: 20, max: 300, log: true, value: state.c, title: 'The speed of waves on the membrane, √(tension / mass per area); the box is 30 cm wide',
  onInput: (v) => { state.c = v; specDirty = true; fillModeList(); } });
const ringSlider = slider({ label: 'ring (s)', min: 0.1, max: 5, log: true, value: state.ring, title: 'How long the fundamental rings (higher modes die sooner: every mode lasts the same number of cycles)',
  onInput: (v) => { state.ring = v; } });
const volSlider = slider({ label: 'volume', min: 0, max: 1, value: state.volume, onInput: (v) => { state.volume = v; } });
$('#drum-box').append(malletSlider, cSlider, ringSlider, volSlider);
const soundToggle = toggle('Sound on strike', state.sound, (on) => { state.sound = on; if (!on) stopSound(); }, 'Hear the drum each time you strike it');
const soundKindSeg = segmented([
  { value: 'strike', label: 'as struck', title: 'Each mode as loud as the strike makes it (the sound under the mallet)' },
  { value: 'spectrum', label: 'every mode', title: 'Every mode equally (∝ 1/f): the spectrum alone, wherever it is struck' },
], state.soundKind, (v) => { state.soundKind = v; }, { label: 'Sound' });
$('#sound-row').append(soundToggle, soundKindSeg);
$('#strike-again').addEventListener('click', () => { restart(); state.sound = true; soundToggle.on = true; strikeSound(); });
$('#pin').addEventListener('click', () => {
  if (!modes) { toast('Wait for the exact modes.'); return; }
  pinned = { label: shapeLabel(), values: Float64Array.from(modes.values) };
  $('#pinned-note').textContent = `Pinned: ${pinned.label} (red ticks at the top of the spectrum)`;
  $('#play-pinned').disabled = false;
  specDirty = true;
});
$('#play-pinned').addEventListener('click', () => { if (pinned) playSpectrum(pinned.values); });
$('#play-this').addEventListener('click', () => { if (modes) playSpectrum(modes.values); else toast('Wait for the exact modes.'); });

function shapeLabel() {
  if (PRESETS[state.shape]) return PRESETS[state.shape].label;
  return state.shape === 'typed' ? 'typed shape' : 'drawing';
}

// The billiard.
const kSlider = slider({ label: '|k|', min: 3, max: 90, value: state.k, title: 'The packet\'s wavenumber (momentum ħk): E = ħ²k²/2m',
  onInput: (v) => { state.k = Math.min(kMax(), v); state.start = 'packet'; startSeg.value = 'packet'; restartSoon(); } });
const angleSlider = slider({ label: 'angle °', min: -180, max: 180, value: +(state.angle * 180 / Math.PI).toFixed(1), title: 'The direction it is launched in',
  onInput: (v) => { state.angle = (v * Math.PI) / 180; state.start = 'packet'; startSeg.value = 'packet'; restartSoon(); } });
const sigmaSlider = slider({ label: 'width σ', min: 0.02, max: 0.15, value: state.sigma, title: 'The packet\'s size: a narrow packet has a wide spread of momenta, so of energies',
  onInput: (v) => { state.sigma = v; state.start = 'packet'; startSeg.value = 'packet'; restartSoon(); } });
$('#packet-box').append(kSlider, angleSlider, sigmaSlider);
const startSeg = segmented([
  { value: 'packet', label: 'Packet', title: 'A Gaussian wave packet (drag on the shape to launch one)' },
  { value: 'random', label: 'Random state', title: 'A random, smooth wave function: it contains every mode, so its spectrum shows them all' },
], state.start, (v) => { state.start = v; state.seed = 0; restart(); updateHash(); }, { label: 'Start from' });
$('#start-row').append(startSeg);
const rayToggle = toggle('Classical particle', state.ray, (on) => { state.ray = on; }, 'A classical particle launched with the packet, bouncing off the walls');
$('#ray-row').append(rayToggle);

let restartTimer = 0;
function restartSoon() { clearTimeout(restartTimer); restartTimer = setTimeout(() => { restart(); updateHash(); }, 100); }

// The spectrum's controls.
const rangeSlider = slider({ label: 'up to', min: 1, max: 5000, log: true, value: 1000, title: 'The top of the spectrum shown',
  onInput: (v) => { state.specMax = Math.max(1e-6, lambdaOfX(v)); specDirty = true; } });
$('#range-box').append(rangeSlider);
const logToggle = toggle('log', state.log, (on) => { state.log = on; specDirty = true; }, 'Logarithmic vertical scale: the small peaks too');
$('#spec-tools').append(logToggle);

// The mode panel.
$('#excite').addEventListener('click', () => {
  const m = shownMode;
  if (!m) return;
  startField = Float64Array.from(m.field);
  // Normalise.
  const s = Math.sqrt(grid.dot(startField));
  for (const g of grid.inner) startField[g] /= s;
  state.start = 'mode';
  restart();
});
$('#hear-mode').addEventListener('click', () => {
  if (!selected) return;
  const l = selected.kind === 'exact' ? modes.values[selected.k] : selected.lambda;
  const f = xOfDrum(l), f1 = modes ? xOfDrum(modes.values[0]) : f;
  playModes([f], [1], [Math.max(0.3, (state.ring * f1) / f)]);
});
const sandToggle = toggle('Sand', state.sand, (on) => { state.sand = on; modeDirty = true; drawMode(); }, 'Show the nodal lines as Chladni showed them: sand collects where the membrane is still');
$('#mode-tools').append(sandToggle);

// The exact modes, and counting them.
const countSeg = segmented([
  { value: 'list', label: 'Exact modes', title: 'The direct solver\'s eigenvalues (and the exactly known ones, for the square, circle and triangle)' },
  { value: 'weyl', label: 'Weyl\'s law', title: 'The number of modes below λ' },
  { value: 'spacing', label: 'Spacings', title: 'How the gaps between neighbouring modes are distributed' },
], state.countTab, (v) => showTab(v), { label: 'Exact modes and counting' });
$('#count-tabs').append(countSeg);
function showTab(v) {
  state.countTab = v; countSeg.value = v;
  $('#list-tab').hidden = v !== 'list';
  $('#count-tab').hidden = v === 'list';
  $('#weyl-tools').hidden = v !== 'weyl';
  $('#list-note').textContent = v === 'list' ? (geo?.exactNote ? `exactly: ${geo.exactNote}` : '') : '';
  countDirty = true;
  if (v !== 'list') drawCount();
}
$('#count-more').addEventListener('click', () => requestCount());
const residToggle = toggle('Take away the area term', state.weylResidual, (on) => { state.weylResidual = on; drawCount(); },
  'Plot N(λ) − Aλ/4π against √λ: what is left is the perimeter term, a straight line of slope −P/4π, and the fluctuations');
$('#weyl-tools').append(residToggle);

// The display.
$('#bright-box').append(slider({ label: 'brightness', min: -1.5, max: 1.5, value: 0, step: 0.01, onInput: (v) => { state.bright = v; } }));
const gridSeg = segmented([96, 128, 160].map((n) => ({ value: n, label: `${n}²`, title: n === 160 ? 'Finer: about twice as slow' : n === 96 ? 'Coarser and faster' : 'The default' })),
  state.n, (n) => { state.n = n; if (state.shape === 'drawn') { state.shape = 'stadium'; state.params = presetParams('stadium'); } selected = null; setShape(state.shape, state.params); }, { label: 'Grid' });
$('#grid-box').append(gridSeg);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); playButton.click(); }
  else if (e.key === 'r' || e.key === 'R') $('#restart').click();
  else if (e.key === 'f' || e.key === 'F') fastButton.click();
});
window.addEventListener('resize', () => { specDirty = true; modeDirty = true; countDirty = true; });

// ------------------------------------------------------------------ the address

function rle(m) {
  // Runs of alternating 0s and 1s (starting with 0s), in base 36.
  const out = [];
  let cur = 0, run = 0;
  for (let g = 0; g < m.length; g++) { if (m[g] === cur) run++; else { out.push(run.toString(36)); cur = m[g]; run = 1; } }
  out.push(run.toString(36));
  return out.join('.');
}
function unrle(s, N) {
  const m = new Uint8Array(N);
  let g = 0, cur = 0;
  for (const part of s.split('.')) { const r = parseInt(part, 36) || 0; if (cur) m.fill(1, g, Math.min(N, g + r)); g += r; cur ^= 1; }
  return m;
}

function updateHash() {
  const h = { mode: state.mode, shape: state.shape };
  if (PRESETS[state.shape]) {
    const def = presetParams(state.shape), r = (v) => +(+v).toPrecision(4);
    const p = Object.fromEntries(Object.entries(state.params).map(([k, v]) => [k, r(v)]));
    if (JSON.stringify(p) !== JSON.stringify(Object.fromEntries(Object.entries(def).map(([k, v]) => [k, r(v)])))) h.p = JSON.stringify(p);
  } else if (state.shape === 'typed') { h.V = typedField.source; h.p = JSON.stringify(typedParams); }
  else if (state.shape === 'drawn') h.mask = rle(mask);
  if (state.n !== 128) h.n = state.n;
  if (isQ()) {
    if (state.start === 'random') h.start = 'random';
    else Object.assign(h, { k: +state.k.toFixed(2), a: +(state.angle * 180 / Math.PI).toFixed(1), s: +state.sigma.toFixed(3), x: +state.launch.x.toFixed(3), y: +state.launch.y.toFixed(3) });
  } else Object.assign(h, { x: +state.strike.x.toFixed(3), y: +state.strike.y.toFixed(3), w: +state.mallet.toFixed(4) });
  writeHash(h);
}

// ------------------------------------------------------------------ experiments

function go({ mode = 'quantum', shape = 'stadium', params = {}, start, seed = 0, k = 30, angle = 0.6, sigma = 0.07, launch, strike, mallet = 0.03, fast = false, speed, count = false, tab, sand = false, select, peak, sound = false, log = false }) {
  stopSound();
  selected = null; filter = null; startField = null;
  pinned = null; $('#pinned-note').textContent = ''; $('#play-pinned').disabled = true;
  Object.assign(state, { k, angle, sigma, fast, sand, log, mallet, seed });
  malletSlider.value = mallet;
  if (launch) state.launch = launch;
  if (strike) state.strike = strike;
  kSlider.value = k; angleSlider.value = +(angle * 180 / Math.PI).toFixed(1); sigmaSlider.value = sigma;
  fastButton.on = fast; sandToggle.on = sand; logToggle.on = log;
  state.mode = mode; modeSeg.value = mode;
  if (speed) state.speed[mode] = speed;
  state.start = start || (mode === 'drum' ? 'strike' : 'packet');
  startSeg.value = state.start === 'random' ? 'random' : 'packet';
  $('#drum-controls').hidden = mode !== 'drum';
  $('#quantum-controls').hidden = mode !== 'quantum';
  $('#act-label').textContent = mode === 'drum' ? 'Strike' : 'Launch';
  speedSlider.setRange(mode === 'drum' ? 0.02 : 0.001, mode === 'drum' ? 20 : 2);
  speedSlider.value = state.speed[mode];
  state.tool = 'act'; toolSeg.value = 'act'; stage.classList.remove('painting');
  showTab(tab || 'list');
  setShape(shape, params);
  setRunning(true);
  if (count) requestCount();
  if (select !== undefined) whenModes(() => selectExact(select));
  if (peak !== undefined) whenModes(() => selectPeak(modes.values[peak]));
  if (sound) strikeSound();
}

function whenModes(fn) {
  const key = shapeKey();
  const check = () => { if (shapeKey() !== key) return; if (modes) fn(); else setTimeout(check, 200); };
  check();
}

const setups = {
  spectroscopy: () => go({ shape: 'stadium', start: 'random', seed: 1, fast: true }),
  filter: () => go({ shape: 'stadium', start: 'random', seed: 1, fast: true, peak: 11 }),
  sharpen: () => go({ mode: 'drum', shape: 'circle', strike: { x: 0.11, y: 0.07 }, fast: false, speed: 2 }),
  square: () => go({ mode: 'drum', shape: 'square', strike: { x: 0.13, y: 0.21 }, select: 1 }),
  circle: () => go({ mode: 'drum', shape: 'circle', strike: { x: 0.12, y: 0.09 }, select: 0 }),
  strike: () => go({ mode: 'drum', shape: 'circle', strike: { x: 0, y: 0 }, mallet: 0.03 }),
  chladni: () => go({ mode: 'drum', shape: 'square', sand: true, select: 20 }),
  weyl: () => go({ mode: 'drum', shape: 'sinai8', count: true, tab: 'weyl' }),
  poisson: () => go({ mode: 'drum', shape: 'rectangle', count: true, tab: 'spacing' }),
  wigner: () => go({ mode: 'drum', shape: 'qstadium', count: true, tab: 'spacing' }),
  gww: () => {
    go({ mode: 'drum', shape: 'gww1' });
    whenModes(() => {
      $('#pin').click();
      setShape('gww2');
    });
  },
  revival: () => go({ shape: 'square', k: 25, angle: 0.5, sigma: 0.07, launch: { x: -0.2, y: -0.1 }, speed: 0.05 }),
  scars: () => go({ shape: 'stadium', k: 30, angle: 0, sigma: 0.05, launch: { x: -0.3, y: 0 }, fast: true }),
  draw: () => { go({ mode: 'drum', shape: 'circle' }); state.tool = 'draw'; toolSeg.value = 'draw'; stage.classList.add('painting'); },
};
drawer($('#help'), $('#help-button'), setups);

// ------------------------------------------------------------------ start

(function start() {
  const h = readHash();
  try {
    if (setups[h.setup]) { setups[h.setup](); return; }
    if (h.mode === 'drum' || h.mode === 'quantum') { state.mode = h.mode; modeSeg.value = h.mode; }
    if ([96, 128, 160].includes(+h.n)) { state.n = +h.n; gridSeg.value = state.n; }
    if (state.mode === 'quantum') {
      if (h.start === 'random') state.start = 'random';
      if (Number.isFinite(+h.k) && h.k !== undefined) state.k = +h.k;
      if (Number.isFinite(+h.a) && h.a !== undefined) state.angle = (+h.a * Math.PI) / 180;
      if (Number.isFinite(+h.s) && h.s !== undefined) state.sigma = +h.s;
      if (h.x !== undefined && h.y !== undefined) state.launch = { x: +h.x, y: +h.y };
    } else {
      state.start = 'strike';
      if (h.x !== undefined && h.y !== undefined) state.strike = { x: +h.x, y: +h.y };
      if (h.w !== undefined && +h.w > 0) state.mallet = +h.w;
    }
    kSlider.value = state.k; angleSlider.value = +(state.angle * 180 / Math.PI).toFixed(1); sigmaSlider.value = state.sigma; malletSlider.value = state.mallet;
    startSeg.value = state.start === 'random' ? 'random' : 'packet';
    $('#drum-controls').hidden = state.mode !== 'drum';
    $('#quantum-controls').hidden = state.mode !== 'quantum';
    $('#act-label').textContent = state.mode === 'drum' ? 'Strike' : 'Launch';
    speedSlider.setRange(state.mode === 'drum' ? 0.02 : 0.001, state.mode === 'drum' ? 20 : 2);
    speedSlider.value = state.speed[state.mode];
    if (h.shape === 'drawn' && h.mask) {
      mask = unrle(h.mask, state.n * state.n); state.shape = 'drawn';
      buildShape(); showShapeControls(); requestModes(); restart();
    } else if (h.shape === 'typed') {
      state.shape = 'typed';
      typedField.set(h.V || typedField.source, h.p ? JSON.parse(h.p) : {}, false);
      typedExpr = typedField.expr; typedParams = typedField.params;
      setShape('typed');
    } else setShape(PRESETS[h.shape] ? h.shape : 'stadium', h.p ? JSON.parse(h.p) : undefined);
  } catch (err) {
    console.warn('Could not restore the set-up from the address:', err);
    setShape('stadium');
  }
})();
requestAnimationFrame(loop);

window.__app = {
  state, setups, get grid() { return grid; }, get sim() { return sim; }, get signal() { return signal; }, get spec() { return spec; },
  get modes() { return modes; }, get counted() { return counted; }, get geo() { return geo; }, get filter() { return filter; },
  get selected() { return selected; }, get ray() { return ray; }, get pinned() { return pinned; }, get mask() { return mask; },
  get norm0() { return conserved0; }, get psi0() { return psi0; }, get probe() { return probe; }, timing,
  selectPeak, selectExact, restart, setShape, setMode, computeSpectrum: () => { computeSpectrum(); return spec; }, lambdaOfOmega, xOf,
  ready: true,
};
